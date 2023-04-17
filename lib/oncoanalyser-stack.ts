import { Construct } from 'constructs';

import * as common from './common'
import {CfnOutput, Stack, StackProps} from "aws-cdk-lib";
import {JobDefinition} from "@aws-cdk/aws-batch-alpha";
import { ContainerImage } from 'aws-cdk-lib/aws-ecs';
import {CfnInstanceProfile, IRole, Policy, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {Bucket, IBucket} from "aws-cdk-lib/aws-s3";
import {StringParameter} from "aws-cdk-lib/aws-ssm";

interface IPermissionsPrefixes {
  keyPattern: string,
  action: string,
}

interface IBucketPermissions {
  name: string,
  prefixes: IPermissionsPrefixes[],
}

interface IOncoanalyserStackProps extends StackProps {
  jobQueueTaskArns: Map<string, string>,
  cache_bucket: string,
  cache_prefix: string,
  staging_bucket: string,
  staging_prefix: string,
  refdata_bucket: string,
  refdata_prefix: string,
}


export class OncoanalyserStack extends Stack {

  public readonly roleBatchInstanceTaskName: CfnOutput;

  constructor(scope: Construct, id: string, props: IOncoanalyserStackProps) {
    super(scope, id, props);

    // Task role
    const roleBatchInstanceTask = common.getRoleBatchInstanceTask({
      context: this,
      namePrefix: 'Oncoanalyser',
    });

    // Pipeline role; grant the follow in addition to base permissions:
    //
    //  * iam:PassRole
    //     - role ID: OncoanalyserTaskBatchInstanceRole
    //     - Nextflow requirement for Batch job submission
    //
    //  * ec2:DescribeIamInstanceProfileAssociations
    //     - required for locally launched Docker containers
    //     - these containers inherit instance role, which is the SharedStack pipeline role
    //     - usually need at least S3 write permissions hence require setting the correct role to inherit at runtime
    //
    const jobQueueTaskArnsArray = Array.from(props.jobQueueTaskArns.values());
    const roleBatchInstancePipeline = common.getBaseBatchInstancePipelineRole({
      context: this,
      namePrefix: 'Oncoanalyser',
      jobQueueArns: jobQueueTaskArnsArray,
    });

    roleBatchInstancePipeline.attachInlinePolicy(
        new Policy(this, 'OncoanalyserPipelinePolicyPassRole', {
          statements: [
            new PolicyStatement({
              actions: ['iam:PassRole'],
              resources: [roleBatchInstanceTask.roleArn],
            })
          ],
        })
    );

    roleBatchInstancePipeline.attachInlinePolicy(
        new Policy(this, 'OncoanalyserPipelinePolicySetInstanceRole', {
          statements: [
            new PolicyStatement({
              actions: [
                'ec2:DescribeIamInstanceProfileAssociations',
                // NOTE(SW): this /only/ allows passing the OncoanalyserStack task role, which is set above
                'ec2:ReplaceIamInstanceProfileAssociation',
              ],
              resources: ['*'],
            })
          ],
        })
    );

    roleBatchInstancePipeline.attachInlinePolicy(
        new Policy(this, 'OncoanalyserPipelinePolicyGetIcaSecretsPortal', {
          statements: [
            new PolicyStatement({
              actions: [
                "secretsmanager:GetSecretValue"
              ],
              resources: [
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:IcaSecretsPortal`
              ]
            })
          ]
        })
    )

    const profileBatchInstanceTask = new CfnInstanceProfile(this, 'OncoanalyserTaskBatchInstanceProfile', {
      roles: [roleBatchInstanceTask.roleName],
    });
    // NOTE(SW): create a profile for manually launched EC2 instances; unclear if otherwise required
    const profileBatchInstancePipeline = new CfnInstanceProfile(this, 'OncoanalyserPipelineBatchInstanceProfile', {
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
        name: props.refdata_bucket,
        prefixes: [
          { keyPattern: `${props.refdata_prefix}/*`, action: 'r' }
        ],
      }
    ]

    bucketPermissionsSpecs.forEach((bucketPermissionsSpec, index) => {
      const bucket = Bucket.fromBucketName(this, `OncoanalyserS3Bucket-${bucketPermissionsSpec.name}-${index}`,
          bucketPermissionsSpec.name,
      );
      this.grantS3BucketPermissions(bucketPermissionsSpec, bucket, roleBatchInstancePipeline);
      this.grantS3BucketPermissions(bucketPermissionsSpec, bucket, roleBatchInstanceTask);
    });

    // Set the docker image
    const docker_tag = StringParameter.valueForStringParameter(
        this, '/oncoanalyser/docker/tag'
    )

    // Create job definition for pipeline execution
    new JobDefinition(this, 'OncoanalyserJobDefinition', {
      container: {
        image: ContainerImage.fromRegistry(docker_tag),
        command: ["/root/oncoanalyser/assets/run.sh"],
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

    // Return the batch instance task arn as an output
    this.roleBatchInstanceTaskName = new CfnOutput(this, "BatchInstanceTaskRoleArn", {
      value: roleBatchInstanceTask.roleName,
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
