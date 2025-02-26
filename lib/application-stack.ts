import { Construct } from 'constructs'

import * as path from 'path';

import * as batch from 'aws-cdk-lib/aws-batch';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';

import * as ecrDeployment from 'cdk-ecr-deployment';

import * as settings from './settings';

export class ApplicationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);


    // Collect existing resources
    const vpc = ec2.Vpc.fromLookup(this, 'VPC', {
      vpcName: settings.VPC_NAME,
    });

    const securityGroup = ec2.SecurityGroup.fromLookupByName(
      this,
      'SecurityGroup',
      settings.SECURITY_GROUP_NAME,
      vpc,
    );


    // Create Batch resources and co for Nextflow ***task*** jobs
    const roleBatchInstanceTask = new iam.Role(this, 'BatchInstanceRoleTask', {
      roleName: 'batch-instance-role-task',
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('ec2.amazonaws.com'),
        new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role'),
      ],
    });

    const launchTemplateTask = this.getLaunchTemplateTask({
      securityGroup: securityGroup,
    });

    const instanceTypesTask = settings.TASK_INSTANCE_TYPES
      .map((typeStr) => {
        return new ec2.InstanceType(typeStr);
      });

    const computeEnvironmentTask = new batch.ManagedEc2EcsComputeEnvironment(this, 'ComputeEnvironmentTask', {
      allocationStrategy: batch.AllocationStrategy.BEST_FIT,
      instanceRole: roleBatchInstanceTask,
      instanceTypes: instanceTypesTask,
      launchTemplate: launchTemplateTask,
      maxvCpus: settings.MAX_TASK_CE_VCPUS,
      securityGroups: [],
      useOptimalInstanceClasses: false,
      vpc: vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    const jobQueueTask = new batch.JobQueue(this, 'JobQueueTask', {
      jobQueueName: 'oncoanalyser-tasks',
      computeEnvironments: [
        { computeEnvironment: computeEnvironmentTask, order: 1 },
      ],
    });


    // Create Batch resources and co for Nextflow ***pipeline*** jobs
    const roleBatchInstancePipeline = new iam.Role(this, 'BatchInstanceRolePipeline', {
      roleName: 'batch-instance-role-pipeline',
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('ec2.amazonaws.com'),
        new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role'),
      ],
    });

    // NOTE(SW): the below policies are mostly those described by the Nextflow documents, some minor changes have been
    // made so that the access is less permissive

    new iam.Policy(this, 'PipelinePolicyBatchJobs', {
      roles: [roleBatchInstancePipeline],
      statements: [new iam.PolicyStatement({
        actions: [
          'batch:CancelJob',
          'batch:SubmitJob',
          'batch:TagResource',
          'batch:TerminateJob',
        ],

        resources: [
          jobQueueTask.jobQueueArn,
          `arn:aws:batch:${this.region}:${this.account}:job-definition/nf-*`
        ],
      })],
    });

    new iam.Policy(this, 'PipelinePolicyBatchGeneral', {
      roles: [roleBatchInstancePipeline],
      statements: [new iam.PolicyStatement({
        actions: [
          'batch:ListJobs',
          'batch:DescribeJobs',
          'batch:DescribeJobQueues',
          'batch:DescribeComputeEnvironments',
          'batch:RegisterJobDefinition',
          'batch:DescribeJobDefinitions',
        ],
        resources: ['*']
      })],
    });

    new iam.Policy(this, 'PipelinePolicyInstances', {
      roles: [roleBatchInstancePipeline],
      statements: [new iam.PolicyStatement({
        actions: [
          'ecs:DescribeTasks',
          'ec2:DescribeInstances',
          'ec2:DescribeInstanceTypes',
          'ec2:DescribeInstanceAttribute',
          'ecs:DescribeContainerInstances',
          'ec2:DescribeInstanceStatus',
        ],
        resources: ['*'],
      })],
    });

    new iam.Policy(this, 'PipelinePolicyECR', {
      roles: [roleBatchInstancePipeline],
      statements: [new iam.PolicyStatement({
        actions: [
          'ecr:GetAuthorizationToken',
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:GetRepositoryPolicy',
          'ecr:DescribeRepositories',
          'ecr:ListImages',
          'ecr:DescribeImages',
          'ecr:BatchGetImage',
          'ecr:GetLifecyclePolicy',
          'ecr:GetLifecyclePolicyPreview',
          'ecr:ListTagsForResource',
          'ecr:DescribeImageScanFindings',
        ],
        resources: ['*'],
      })],
    });

    new iam.Policy(this, 'PipelinePolicyCloudWatchLogEvents', {
      roles: [roleBatchInstancePipeline],
      statements: [new iam.PolicyStatement({
        actions: [
          'logs:GetLogEvents',
        ],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/batch/job/:nf-*`
        ],
      })],
    });

    roleBatchInstancePipeline.attachInlinePolicy(
      new iam.Policy(this, 'PipelinePolicyPassRole', {
        statements: [
          new iam.PolicyStatement({
            actions: ['iam:PassRole'],
            resources: [roleBatchInstanceTask.roleArn],
          })
        ],
      })
    );

    const launchTemplatePipeline = this.getLaunchTemplatePipeline({
      securityGroup: securityGroup,
    });

    const instanceTypesPipeline = settings.PIPELINE_INSTANCE_TYPES
      .map((typeStr) => {
        return new ec2.InstanceType(typeStr);
      });

    const computeEnvironmentPipeline = new batch.ManagedEc2EcsComputeEnvironment(this, 'ComputeEnvironmentPipeline', {
      allocationStrategy: batch.AllocationStrategy.BEST_FIT,
      instanceRole: roleBatchInstancePipeline,
      instanceTypes: instanceTypesPipeline,
      launchTemplate: launchTemplatePipeline,
      maxvCpus: settings.MAX_PIPELINE_CE_VCPUS,
      securityGroups: [],
      useOptimalInstanceClasses: false,
      vpc: vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    const jobQueuePipeline = new batch.JobQueue(this, 'JobQueuePipeline', {
      jobQueueName: 'oncoanalyser-pipeline',
      computeEnvironments: [
        { computeEnvironment: computeEnvironmentPipeline, order: 1 },
      ],
    });


    // Create Docker image and deploy
    const dockerStack = new DockerImageBuildStack(this, 'DockerImageBuildStack', {
      env: props.env,
    });

    // Bucket permissions
    const nfBucket = s3.Bucket.fromBucketName(this, 'S3Bucket',
      settings.S3_BUCKET_NAME,
    );

    nfBucket.grantRead(roleBatchInstancePipeline, `${settings.S3_BUCKET_INPUT_PREFIX}/*`);
    nfBucket.grantRead(roleBatchInstanceTask, `${settings.S3_BUCKET_INPUT_PREFIX}/*`);

    nfBucket.grantRead(roleBatchInstancePipeline, `${settings.S3_BUCKET_REFDATA_PREFIX}/*`);
    nfBucket.grantRead(roleBatchInstanceTask, `${settings.S3_BUCKET_REFDATA_PREFIX}/*`);

    nfBucket.grantReadWrite(roleBatchInstancePipeline, `${settings.S3_BUCKET_OUTPUT_PREFIX}/*`);
    nfBucket.grantReadWrite(roleBatchInstanceTask, `${settings.S3_BUCKET_OUTPUT_PREFIX}/*`);

    // Create job definition for pipeline execution
    const jobDefinition = new batch.EcsJobDefinition(this, 'JobDefinition', {
      jobDefinitionName: 'oncoanalyser-job-definition',
      container: new batch.EcsEc2ContainerDefinition(this, 'EcsEc2ContainerDefinition', {
        cpu: 1,
        image: dockerStack.image,
        command: ['true'],
        memory: cdk.Size.mebibytes(1000),
        jobRole: roleBatchInstancePipeline,
      }),
    });

    // Create SSM parameters
    new ssm.StringParameter(this, 'SsmParameter-batch_job_queue_name', {
      parameterName: '/oncoanalyser_stack/batch_job_queue_name',
      stringValue: jobQueueTask.jobQueueName,
    });

    new ssm.StringParameter(this, 'SsmParameter-batch_instance_task_role_arn', {
      parameterName: '/oncoanalyser_stack/batch_instance_task_role_arn',
      stringValue: roleBatchInstanceTask.roleArn,
    });

    new ssm.StringParameter(this, 'SsmParameter-s3_bucket_name', {
      parameterName: '/oncoanalyser_stack/s3_bucket_name',
      stringValue: settings.S3_BUCKET_NAME,
    });

    new ssm.StringParameter(this, 'SsmParameter-s3_refdata_prefix', {
      parameterName: '/oncoanalyser_stack/s3_refdata_prefix',
      stringValue: settings.S3_BUCKET_REFDATA_PREFIX,
    });
  }

  getLaunchTemplateTask(args: {
    securityGroup: ec2.ISecurityGroup,
  }) {

    const userData = ec2.UserData.custom(
`MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="==BOUNDARY=="

--==BOUNDARY==
Content-Type: text/x-shellscript; charset="us-ascii"

#!/bin/bash
mkdir -p /mnt/local_ephemeral/
mkfs.ext4 /dev/nvme1n1
mount /dev/nvme1n1 /mnt/local_ephemeral/
chmod 777 /mnt/local_ephemeral/

--==BOUNDARY==--`
    );

    const launchTemplate = new ec2.LaunchTemplate(this, 'LaunchTemplateTask', {
      launchTemplateName: 'oncoanalyser-task',
      associatePublicIpAddress: true,
      userData: userData,
      securityGroup: args.securityGroup,
    });

    cdk.Tags.of(launchTemplate).add('Name', 'oncoanalyser-task');
    return launchTemplate;
  }

  getLaunchTemplatePipeline(args: {
    securityGroup: ec2.ISecurityGroup,
  }) {

    const userData = ec2.UserData.custom(
`MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="==BOUNDARY=="

--==BOUNDARY==
Content-Type: text/cloud-config; charset="us-ascii"

packages:
  - btrfs-progs
  - git
  - jq
  - lvm2
  - sed
  - unzip
  - wget

--==BOUNDARY==
Content-Type: text/x-shellscript; charset="us-ascii"

#!/bin/bash
curl https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp/

/tmp/aws/install --install-dir /opt/awscliv2/aws-cli/ --bin-dir /opt/awscliv2/bin/
ln -s /opt/awscliv2/bin/aws /usr/local/bin/

git clone https://github.com/awslabs/amazon-ebs-autoscale /tmp/amazon-ebs-autoscale/
(cd /tmp/amazon-ebs-autoscale/ && git checkout 6db0c70)

bash /tmp/amazon-ebs-autoscale/install.sh

rm -rf /tmp/awscliv2.zip /tmp/aws/ /tmp/amazon-ebs-autoscale/
--==BOUNDARY==--`
    );

    const launchTemplate = new ec2.LaunchTemplate(this, 'LaunchTemplatePipeline', {
      launchTemplateName: 'oncoanalyser-pipeline',
      associatePublicIpAddress: true,
      userData: userData,
      securityGroup: args.securityGroup,
    });

    cdk.Tags.of(launchTemplate).add('Name', 'oncoanalyser-pipeline');
    return launchTemplate;
  }
}


export class DockerImageBuildStack extends cdk.Stack {
  public readonly image: ecs.EcrImage;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const image = new ecrAssets.DockerImageAsset(this, 'DockerImage', {
      directory: path.join(__dirname, 'resources'),
    });

    const dockerDestBase = `${props.env!.account}.dkr.ecr.${props.env!.region}.amazonaws.com`;

    new ecrDeployment.ECRDeployment(this, 'DeployDockerImage', {
      src: new ecrDeployment.DockerImageName(image.imageUri),
      dest: new ecrDeployment.DockerImageName(`${dockerDestBase}/${settings.ECR_REPO}:${settings.DOCKER_IMAGE_TAG}`),
    });

    const ecrRepository = ecr.Repository.fromRepositoryName(this, 'EcrRespository', settings.ECR_REPO);
    this.image = ecs.EcrImage.fromEcrRepository(ecrRepository, settings.DOCKER_IMAGE_TAG);
  }
}
