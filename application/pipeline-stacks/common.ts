import {join as pathjoin} from "path";

import {Construct} from 'constructs';

import {Environment, Stack, StackProps} from "aws-cdk-lib";
import {JobDefinition} from "@aws-cdk/aws-batch-alpha";
import {DockerImageAsset} from 'aws-cdk-lib/aws-ecr-assets';
import {Repository} from "aws-cdk-lib/aws-ecr";
import {EcrImage} from 'aws-cdk-lib/aws-ecs';
import {Bucket} from "aws-cdk-lib/aws-s3";
import {StringParameter} from "aws-cdk-lib/aws-ssm";

import {ECRDeployment, DockerImageName} from "cdk-ecr-deployment";

import {createPipelineRoles} from "../base-roles";


interface IDockerImageBuild extends StackProps {
  env: Environment;
  workflowName: string;
  dockerTag?: string;
}

export interface IPipelineStack extends StackProps {
  env: Environment;
  envBuild: Environment;
  workflowName: string;
  dockerTag?: string;
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
    new JobDefinition(this, `Nextflow-${props.workflowName}`, {
      container: {
        image: dockerStack.image,
        command: ['true'],
        memoryLimitMiB: 1000,
        vcpus: 1,
        jobRole: stackRoles.pipelineRole,
        // NOTE(SW): host Docker socket is mounted in the container to launch Docker containers for local processes
        // NOTE(SW): when not using Fusion we must also mount the Nextflow workdir with a host path
        mountPoints: [
          {
            sourceVolume: 'docker_socket',
            containerPath: '/var/run/docker.sock',
            readOnly: false,
          },
        ],
        volumes: [
          {
            name: 'docker_socket',
            host: { 'sourcePath': '/var/run/docker.sock' }
          },
        ],
      },
    });

    // Add SSM parameters for Batch task role and profile ARN
    new StringParameter(this, `SsmParameter-batch_instance_task_role-${props.workflowName}`, {
      parameterName: `/nextflow_stack/${props.workflowName}/batch_instance_task_role_arn`,
      stringValue: stackRoles.taskRole.roleArn,
    });
    new StringParameter(this, `SsmParameter-batch_instance_task_profile-${props.workflowName}`, {
      parameterName: `/nextflow_stack/${props.workflowName}/batch_instance_task_profile_arn`,
      stringValue: stackRoles.taskProfile.attrArn,
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
