import {Construct} from 'constructs';

import {
  Environment,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import {JobDefinition} from "@aws-cdk/aws-batch-alpha";
import {CfnInstanceProfile, IRole, Policy, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {Bucket, IBucket} from "aws-cdk-lib/aws-s3";
import {StringParameter} from "aws-cdk-lib/aws-ssm";
import {Secret} from "aws-cdk-lib/aws-secretsmanager";

import {DockerImageBuildStack} from "../common";
import {getRoleBatchInstanceTask, getBaseBatchInstancePipelineRole} from "../../base-roles";


interface IPermissionsPrefixes {
  keyPattern: string,
  action: string,
}

interface IBucketPermissions {
  name: string,
  prefixes: IPermissionsPrefixes[],
}

interface IStarAlignNfStackProps extends StackProps {
  env: Environment,
  envBuild: Environment,
  workflowName: string,
  dockerTag?: string,
  jobQueueTaskArns: Map<string, string>,
  cache_bucket: string,
  cache_prefix: string,
  staging_bucket: string,
  staging_prefix: string,
  output_bucket: string,
  output_prefix: string,
  refdata_bucket: string,
  refdata_prefix: string,
}

export class StarAlignNfStack extends Stack {

  constructor(scope: Construct, id: string, props: IStarAlignNfStackProps) {
    super(scope, id, props);

    // Create Docker image and deploy
    const dockerStack = new DockerImageBuildStack(this, `DockerImageBuildStack-${props.workflowName}`, {
      env: props.envBuild,
      workflowName: props.workflowName,
      dockerTag: props.dockerTag,
    });

    // Task role
    const roleBatchInstanceTask = getRoleBatchInstanceTask({
      context: this,
      namePrefix: 'StarAlignNf',
    });

    // Pipeline role; grant the follow in addition to base permissions:
    //
    //  * iam:PassRole
    //     - role ID: StarAlignNfTaskBatchInstanceRole
    //     - Nextflow requirement for Batch job submission
    //
    //  * ec2:DescribeIamInstanceProfileAssociations
    //     - required for locally launched Docker containers
    //     - these containers inherit instance role, which is the SharedStack pipeline role
    //     - usually need at least S3 write permissions hence require setting the correct role to inherit at runtime
    //
    const jobQueueTaskArnsArray = Array.from(props.jobQueueTaskArns.values());
    const roleBatchInstancePipeline = getBaseBatchInstancePipelineRole({
      context: this,
      namePrefix: 'StarAlignNf',
      jobQueueArns: jobQueueTaskArnsArray,
    });

    roleBatchInstancePipeline.attachInlinePolicy(
      new Policy(this, 'StarAlignNfPipelinePolicyPassRole', {
        statements: [
          new PolicyStatement({
            actions: ['iam:PassRole'],
            resources: [roleBatchInstanceTask.roleArn],
          })
        ],
      })
    );

    roleBatchInstancePipeline.attachInlinePolicy(
      new Policy(this, 'StarAlignNfPipelinePolicySetInstanceRole', {
        statements: [
          new PolicyStatement({
            actions: [
              'ec2:DescribeIamInstanceProfileAssociations',
              // NOTE(SW): this /only/ allows passing the StarAlignNfStack task role, which is set above
              'ec2:ReplaceIamInstanceProfileAssociation',
            ],
            resources: ['*'],
          })
        ],
      })
    );

    const icaSecret = Secret.fromSecretNameV2(this, `IcaSecret-${props.workflowName}`, "IcaSecretsPortal");
    icaSecret.grantRead(roleBatchInstancePipeline);

    const profileBatchInstanceTask = new CfnInstanceProfile(this, 'StarAlignNfTaskBatchInstanceProfile', {
      roles: [roleBatchInstanceTask.roleName],
    });
    // NOTE(SW): create a profile for manually launched EC2 instances; unclear if otherwise required
    const profileBatchInstancePipeline = new CfnInstanceProfile(this, 'StarAlignNfPipelineBatchInstanceProfile', {
      roles: [roleBatchInstancePipeline.roleName],
    });

    // Grant stack-specific role permissions
    const bucketPermissionsSpecs: IBucketPermissions[] = [
      {
        name: props.cache_bucket,
        prefixes: [
          { keyPattern: `${props.cache_prefix}/*`, action: 'rw' }
        ],
      },
      {
        name: props.staging_bucket,
        prefixes: [
          { keyPattern: `${props.staging_prefix}/*`, action: 'rw' }
        ],
      },
      {
        name: props.output_bucket,
        prefixes: [
          { keyPattern: `${props.output_prefix}/*`, action: 'rw' }
        ],
      },
      {
        name: props.refdata_bucket,
        prefixes: [
          { keyPattern: `${props.refdata_prefix}/*`, action: 'r' }
        ],
      }
    ]

    bucketPermissionsSpecs.forEach((bucketPermissionsSpec, index) => {
      const bucket = Bucket.fromBucketName(this, `StarAlignNfS3Bucket-${bucketPermissionsSpec.name}-${index}`,
          bucketPermissionsSpec.name,
      );
      this.grantS3BucketPermissions(bucketPermissionsSpec, bucket, roleBatchInstancePipeline);
      this.grantS3BucketPermissions(bucketPermissionsSpec, bucket, roleBatchInstanceTask);
    });

    // Create job definition for pipeline execution
    new JobDefinition(this, 'StarAlignNfJobDefinition', {
      container: {
        image: dockerStack.image,
        command: ['true'],
        memoryLimitMiB: 1000,
        vcpus: 1,
        jobRole: roleBatchInstancePipeline,
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
    new StringParameter(this, 'SsmParameter-star_align_nf-batch_task_instance_role', {
      parameterName: `/nextflow_stack/${props.workflowName}/batch_task_instance_role_arn`,
      stringValue: roleBatchInstanceTask.roleArn,
    });
    new StringParameter(this, 'SsmParameter-star_align_nf-batch_task_instance_profile', {
      parameterName: `/nextflow_stack/${props.workflowName}/batch_task_instance_profile_arn`,
      stringValue: profileBatchInstanceTask.attrArn,
    });
  }

  grantS3BucketPermissions(bpSpec: IBucketPermissions, bucket: IBucket, jobRole: IRole) {
    for (let prefixData of bpSpec.prefixes) {
      switch (prefixData.action) {
        case 'r':
          bucket.grantRead(jobRole, prefixData.keyPattern);
          break;
        case 'w':
          bucket.grantWrite(jobRole, prefixData.keyPattern);
          break;
        case 'rw':
          bucket.grantReadWrite(jobRole, prefixData.keyPattern);
          break;
        default:
          throw new Error('Got bad bucket permission action');
      }
    }
  }
}

