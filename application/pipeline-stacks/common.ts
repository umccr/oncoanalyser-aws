import * as path from 'path';

import { Construct } from 'constructs';

import * as batch from 'aws-cdk-lib/aws-batch';
import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';

import * as ecrDeployment from 'cdk-ecr-deployment';

import * as baseRoles from '../shared/base-roles';


interface IDockerImageBuild extends cdk.StackProps {
  env: cdk.Environment;
  workflowName: string;
  gitReference: string;
  dockerTag?: string;
}

export interface IPipelineStack extends cdk.StackProps {
  env: cdk.Environment;
  envBuild: cdk.Environment;
  workflowName: string;
  pipelineVersionTag: string;
  dockerTag?: string;
  jobQueuePipelineArns: string[];
  jobQueueTaskArns: string[];
  nfBucketName: string;
  nfPrefixTemp: string;
  nfPrefixOutput: string;
  refdataBucketName: string;
  refdataPrefix: string;
  ssmParameters: Map<string, string>;
}


export class PipelineStack extends cdk.Stack {
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
    const stackRoles = baseRoles.createPipelineRoles({
      context: this,
      workflowName: props.workflowName,
      jobQueueArns: props.jobQueueTaskArns,
    });

    // Bucket permissions
    const nfBucket = s3.Bucket.fromBucketName(this, `S3Bucket-nfBucket-${props.workflowName}`,
      props.nfBucketName,
    );

    nfBucket.grantReadWrite(stackRoles.taskRole, `${props.nfPrefixTemp}/*/${props.workflowName}/*`);
    nfBucket.grantReadWrite(stackRoles.pipelineRole, `${props.nfPrefixTemp}/*/${props.workflowName}/*`);

    nfBucket.grantReadWrite(stackRoles.taskRole, `${props.nfPrefixOutput}/*/${props.workflowName}/*`);
    nfBucket.grantReadWrite(stackRoles.pipelineRole, `${props.nfPrefixOutput}/*/${props.workflowName}/*`);

    const refdataBucket = s3.Bucket.fromBucketName(this, `S3Bucket-refdataBucket-${props.workflowName}`,
      props.refdataBucketName,
    );

    refdataBucket.grantRead(stackRoles.taskRole, `${props.refdataPrefix}/*`);
    refdataBucket.grantRead(stackRoles.pipelineRole, `${props.refdataPrefix}/*`);

    // Create job definition for pipeline execution
    const pipelineJobDefinition = new batch.EcsJobDefinition(this, `Nextflow-${props.workflowName}`, {
      container: new batch.EcsEc2ContainerDefinition(this, `Nextflow-Container-${props.workflowName}`, {
        cpu: 1,
        image: dockerStack.image,
        command: ['true'],
        memory: cdk.Size.mebibytes(1000),
        jobRole: stackRoles.pipelineRole,
        // NOTE(SW): host Docker socket is mounted in the container to launch Docker containers for local processes
        volumes: [
          batch.EcsVolume.host({
            name: 'docker_socket',
            containerPath: '/var/run/docker.sock',
            readonly: false,
          }),
        ],
      }),
    });

    // Create Lambda function role
    const lambdaSubmissionRole = new iam.Role(this, `LambdaSubmitRole-${props.workflowName}`, {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ]
    });

    new iam.Policy(this, `LambdaBatchPolicy-${props.workflowName}`, {
      roles: [lambdaSubmissionRole],
      statements: [new iam.PolicyStatement({
        actions: [
          'batch:SubmitJob',
          'batch:TagResource',
        ],
        resources: [
          ...props.jobQueuePipelineArns,
          pipelineJobDefinition.jobDefinitionArn,
        ],
      })],
    });

    // Create Lambda function
    const aws_lambda_function = new lambda.Function(this, `LambdaSubmissionFunction-${props.workflowName}`, {
      functionName: `${props.workflowName}-batch-job-submission`,
      handler: 'lambda_code.main',
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset(path.join(__dirname, props.workflowName, 'lambda_functions', 'batch_job_submission')),
      role: lambdaSubmissionRole
    });

    // Create SSM parameters
    new ssm.StringParameter(this, `SsmParameter-batch_job_definition-${props.workflowName}`, {
      parameterName: `/nextflow_stack/${props.workflowName}/batch_job_definition_arn`,
      stringValue: pipelineJobDefinition.jobDefinitionArn,
    });

    new ssm.StringParameter(this, `SsmParameter-batch_instance_task_role-${props.workflowName}`, {
      parameterName: `/nextflow_stack/${props.workflowName}/batch_instance_task_role_arn`,
      stringValue: stackRoles.taskRole.roleArn,
    });

    new ssm.StringParameter(this, `SsmParameter-batch_instance_task_profile-${props.workflowName}`, {
      parameterName: `/nextflow_stack/${props.workflowName}/batch_instance_task_profile_arn`,
      stringValue: stackRoles.taskProfile.attrArn,
    });

    new ssm.StringParameter(this, `SsmParameter-submission_lambda-${props.workflowName}`, {
      parameterName: `/nextflow_stack/${props.workflowName}/submission_lambda_arn`,
      stringValue: aws_lambda_function.functionArn,
    });

    // Store SSM parameters from settings
    for (let [key, value] of props.ssmParameters) {
      new ssm.StringParameter(this, `SsmParameter-${key.replace(/^.*\//, '')}-${props.workflowName}`, {
        parameterName: key,
        stringValue: value,
      });
    }
  }
}


export class DockerImageBuildStack extends cdk.Stack {
  public readonly image: ecs.EcrImage;

  constructor(scope: Construct, id: string, props: IDockerImageBuild) {
    super(scope, id, props);

    const dockerTag = props.dockerTag || 'latest';

    const image = new ecrAssets.DockerImageAsset(this, `CDKDockerImage-${props.workflowName}`, {
      buildArgs: { 'PIPELINE_GITHUB_REF': props.gitReference },
      directory: path.join(__dirname, props.workflowName),
    });

    const dockerDestBase = `${props.env.account}.dkr.ecr.${props.env.region}.amazonaws.com`;

    new ecrDeployment.ECRDeployment(this, `DeployDockerImage-${props.workflowName}`, {
      src: new ecrDeployment.DockerImageName(image.imageUri),
      dest: new ecrDeployment.DockerImageName(`${dockerDestBase}/${props.workflowName}:${dockerTag}`),
    });

    const ecrRepository = ecr.Repository.fromRepositoryName(this, `EcrRespository-${props.workflowName}`, props.workflowName);
    this.image = ecs.EcrImage.fromEcrRepository(ecrRepository, dockerTag);
  }
}
