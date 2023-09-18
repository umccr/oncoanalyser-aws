import {join as pathjoin} from "path";

import {Construct} from 'constructs';

import {Environment, Stack, StackProps} from "aws-cdk-lib";
import {JobDefinition} from "@aws-cdk/aws-batch-alpha";
import {DockerImageAsset} from 'aws-cdk-lib/aws-ecr-assets';
import {Repository} from "aws-cdk-lib/aws-ecr";
import {EcrImage} from 'aws-cdk-lib/aws-ecs';
import {PolicyStatement, Policy, ManagedPolicy, ServicePrincipal, Role} from 'aws-cdk-lib/aws-iam'
import {Code, Function as LambdaFunction, Runtime} from 'aws-cdk-lib/aws-lambda'
import {Bucket} from "aws-cdk-lib/aws-s3";
import {StringParameter} from "aws-cdk-lib/aws-ssm";

import {ECRDeployment, DockerImageName} from "cdk-ecr-deployment";

import {createPipelineRoles} from "../base-roles";


interface IDockerImageBuild extends StackProps {
  env: Environment;
  workflowName: string;
  gitReference: string;
  dockerTag?: string;
}

export interface IPipelineStack extends StackProps {
  env: Environment;
  envBuild: Environment;
  workflowName: string;
  pipelineVersionTag: string;
  dockerTag?: string;
  fusionFs: boolean;
  jobQueuePipelineArn: string;
  jobQueueTaskArns: Map<string, string>;
  nfBucketName: string;
  nfPrefixTemp: string;
  nfPrefixOutput: string;
  refdataBucketName: string;
  refdataPrefix: string;
  ssmParameters: Map<string, string>;
}

export class PipelineStack extends Stack {

  constructor(scope: Construct, id: string, props: IPipelineStack) {
    super(scope, id, props);

    // Create Docker image and deploy
    const dockerStack = new DockerImageBuildStack(this, `DockerImageBuildStack-${props.workflowName}`, {
      env: props.envBuild,
      workflowName: props.workflowName,
      gitReference: props.pipelineVersionTag,
      dockerTag: props.dockerTag,
    });

    // Create roles
    const jobQueueTaskArnsArray = Array.from(props.jobQueueTaskArns.values());
    const stackRoles = createPipelineRoles({
      context: this,
      workflowName: props.workflowName,
      jobQueueArns: jobQueueTaskArnsArray,
    });

    // Bucket permissions
    const nfBucket = Bucket.fromBucketName(this, `S3Bucket-nfBucket-${props.workflowName}`,
      props.nfBucketName,
    );

    nfBucket.grantReadWrite(stackRoles.taskRole, `${props.nfPrefixTemp}/*/${props.workflowName}/*`);
    nfBucket.grantReadWrite(stackRoles.pipelineRole, `${props.nfPrefixTemp}/*/${props.workflowName}/*`);

    nfBucket.grantReadWrite(stackRoles.taskRole, `${props.nfPrefixOutput}/*/${props.workflowName}/*`);
    nfBucket.grantReadWrite(stackRoles.pipelineRole, `${props.nfPrefixOutput}/*/${props.workflowName}/*`);

    const refdataBucket = Bucket.fromBucketName(this, `S3Bucket-refdataBucket-${props.workflowName}`,
      props.refdataBucketName,
    );

    refdataBucket.grantRead(stackRoles.taskRole, `${props.refdataPrefix}/*`);
    refdataBucket.grantRead(stackRoles.pipelineRole, `${props.refdataPrefix}/*`);

    // Create job definition for pipeline execution
    // First, get mount points and volumes for Docker container
    // NOTE(SW): host Docker socket is always mounted in the container to launch Docker containers for local processes
    const containerMountPoints = [
      {
        sourceVolume: 'docker_socket',
        containerPath: '/var/run/docker.sock',
        readOnly: false,
      },
    ];

    const containerVolumes = [
      {
        name: 'docker_socket',
        host: { 'sourcePath': '/var/run/docker.sock' }
      },
    ];

    // Additionally for local execution, when not using FusionFS we must also
    // mount the Nextflow workdir with a host path
    if (!props.fusionFs) {

      containerMountPoints.push(
        {
          sourceVolume: 'nextflow_workdir',
          containerPath: '/root/pipeline/work/',
          readOnly: false,
        },
      );

      containerVolumes.push(
        {
          name: 'nextflow_workdir',
          host: { 'sourcePath': '/root/pipeline/work/' }
        },
      );

    }

    const pipelineJobDefinition = new JobDefinition(this, `Nextflow-${props.workflowName}`, {
      container: {
        image: dockerStack.image,
        command: ['true'],
        memoryLimitMiB: 1000,
        vcpus: 1,
        jobRole: stackRoles.pipelineRole,
        mountPoints: containerMountPoints,
        volumes: containerVolumes,
      },
    });

    // Create Lambda function role
    const lambdaSubmissionRole = new Role(this, `LambdaSubmitRole-${props.workflowName}`, {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess'),
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ]
    });
    new Policy(this, `LambdaBatchPolicy-${props.workflowName}`, {
      roles: [lambdaSubmissionRole],
      statements: [new PolicyStatement({
        actions: [
          'batch:SubmitJob',
        ],
        resources: [
          props.jobQueuePipelineArn,
          pipelineJobDefinition.jobDefinitionArn,
        ],
      })],
    });

    // Create Lambda function
    const aws_lambda_function = new LambdaFunction(this, `LambdaSubmissionFunction-${props.workflowName}`, {
      functionName: `${props.workflowName}-batch-job-submission`,
      handler: 'lambda_code.main',
      runtime: Runtime.PYTHON_3_9,
      code: Code.fromAsset(pathjoin(__dirname, props.workflowName, 'lambda_functions', 'batch_job_submission')),
      role: lambdaSubmissionRole
    });

    // Create SSM parameters
    new StringParameter(this, `SsmParameter-batch_job_definition-${props.workflowName}`, {
      parameterName: `/nextflow_stack/${props.workflowName}/batch_job_definition_arn`,
      stringValue: pipelineJobDefinition.jobDefinitionArn,
    });

    new StringParameter(this, `SsmParameter-batch_instance_task_role-${props.workflowName}`, {
      parameterName: `/nextflow_stack/${props.workflowName}/batch_instance_task_role_arn`,
      stringValue: stackRoles.taskRole.roleArn,
    });

    new StringParameter(this, `SsmParameter-batch_instance_task_profile-${props.workflowName}`, {
      parameterName: `/nextflow_stack/${props.workflowName}/batch_instance_task_profile_arn`,
      stringValue: stackRoles.taskProfile.attrArn,
    });

    new StringParameter(this, `SsmParameter-submission_lambda-${props.workflowName}`, {
      parameterName: `/nextflow_stack/${props.workflowName}/submission_lambda_arn`,
      stringValue: aws_lambda_function.functionArn,
    });

    // Store SSM parameters from settings
    for (let [key, value] of props.ssmParameters) {
      new StringParameter(this, `SsmParameter-${key.replace(/^.*\//, '')}-${props.workflowName}`, {
        parameterName: key,
        stringValue: value,
      });
    }
  }
}

export class DockerImageBuildStack extends Stack {
  public readonly image: EcrImage;

  constructor(scope: Construct, id: string, props: IDockerImageBuild) {
    super(scope, id, props);

    const dockerTag = props.dockerTag || "latest";

    const image = new DockerImageAsset(this, `CDKDockerImage-${props.workflowName}`, {
      buildArgs: { 'PIPELINE_GITHUB_REF': props.gitReference },
      directory: pathjoin(__dirname, props.workflowName),
    });

    const dockerDestBase = `${props.env.account}.dkr.ecr.${props.env.region}.amazonaws.com`;

    new ECRDeployment(this, `DeployDockerImage-${props.workflowName}`, {
      src: new DockerImageName(image.imageUri),
      dest: new DockerImageName(`${dockerDestBase}/${props.workflowName}:${dockerTag}`),
    });

    const ecrRepository = Repository.fromRepositoryName(this, `EcrRespository-${props.workflowName}`, props.workflowName);
    this.image = EcrImage.fromEcrRepository(ecrRepository, dockerTag);
  }
}
