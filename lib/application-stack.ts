import { Construct } from 'constructs'

import * as fs from 'fs';
import * as path from 'path';

import * as batch from 'aws-cdk-lib/aws-batch';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';

import * as applicationRoles from './roles';

import * as settings from '../settings';

export class ApplicationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
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
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role'),
      ],
    });

    const launchTemplateTask = this.getTaskLaunchTemplate({
      securityGroup: args.securityGroup,
    });

    const instanceTypes = settings.TASK_INSTANCE_TYPES
      .map((typeStr) => {
        return new ec2.InstanceType(typeStr);
      });

    const computeEnvironmentTask = new batch.ManagedEc2EcsComputeEnvironment(this, 'ComputeEnvironmentTask', {
      allocationStrategy: batch.AllocationStrategy.BEST_FIT,
      instanceRole: roleBatchInstanceTask,
      instanceTypes: instanceTypes,
      launchTemplate: launchTemplateTask,
      maxvCpus: settings.MAX_TASK_CE_VCPUS
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

    const launchTemplatePipeline = this.getPipelineLaunchTemplate({
      securityGroup: args.securityGroup,
    });

    const instanceTypes = settings.PIPELINE_INSTANCE_TYPES
      .map((typeStr) => {
        return new ec2.InstanceType(typeStr);
      });

    const computeEnvironmentPipeline = new batch.ManagedEc2EcsComputeEnvironment(this, 'ComputeEnvironmentPipeline', {
      allocationStrategy: batch.AllocationStrategy.BEST_FIT,
      instanceRole: roleBatchInstancePipeline,
      instanceTypes: instanceTypes,
      launchTemplate: launchTemplatePipeline,
      maxvCpus: settings.MAX_PIPELINE_CE_VCPUS
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


    // Create oncoanalyser resources
    const pipelineStack = new OncoanalyserStack(this, 'OncoanalyserStack', {
      ...args,
      pipelineVersionTag: stackSettings.versionTag,
      nfBucketName: s3Data.get('nfBucketName')!,
      nfPrefixTemp: s3Data.get('nfPrefixTemp')!,
      nfPrefixOutput: s3Data.get('nfPrefixOutput')!,
      orcabusDataS3BucketName: s3Data.get('orcabusS3BucketName')!,
      orcabusDataS3ByobPrefix: s3Data.get('orcabusS3ByobPrefix')!,
      orcabusDataS3PrefixOutput: s3Data.get('orcabusS3PrefixOutput')!,
      orcabusDataS3PrefixTemp: s3Data.get('orcabusS3PrefixTemp')!,
      refdataBucketName: s3Data.get('refdataBucketName')!,
      refdataPrefix: s3Data.get('refdataPrefix')!,
      ssmParameters: stackSettings.getSsmParameters()
    });
    cdk.Tags.of(pipelineStack).add('Stack', 'OncoanalyserStack');
  }
















  getLaunchTemplateTask(args: {
    securityGroup: ec2.ISecurityGroup,
  }) {

    const userDataString = `
      MIME-Version: 1.0
      Content-Type: multipart/mixed; boundary="==BOUNDARY=="

      --==BOUNDARY==
      Content-Type: text/x-shellscript; charset="us-ascii"

      #!/bin/bash
      mkdir -p /mnt/local_ephemeral/
      mkfs.ext4 /dev/nvme1n1
      mount /dev/nvme1n1 /mnt/local_ephemeral/
      chmod 777 /mnt/local_ephemeral/

      --==BOUNDARY==--
    `;

    const launchTemplate = new ec2.LaunchTemplate(this, 'LaunchTemplateTask', {
      launchTemplateName: 'oncoanalyser-task',
      associatePublicIpAddress: true,
      userData: ec2.UserData.custom(userDataString),
      securityGroup: args.securityGroup,
      requireImdsv2: true,
      httpTokens: ec2.LaunchTemplateHttpTokens.REQUIRED,
    });

    cdk.Tags.of(launchTemplate).add('Name', 'nextflow-task');
    return launchTemplate;
  }

  getLaunchTemplatePipeline(args: {
    securityGroup: ec2.ISecurityGroup,
  }) {

    const userDataString = `
      MIME-Version: 1.0
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

      bash /tmp/amazon-ebs-autoscale/install.sh --imdsv2

      rm -rf /tmp/awscliv2.zip /tmp/aws/ /tmp/amazon-ebs-autoscale/
      --==BOUNDARY==--
    `;

    const launchTemplate = new ec2.LaunchTemplate(this, 'LaunchTemplatePipeline', {
      launchTemplateName: 'oncoanalyser-pipeline',
      associatePublicIpAddress: true,
      userData: ec2.UserData.custom(userDataString),
      securityGroup: args.securityGroup,
      requireImdsv2: true,
      httpTokens: ec2.LaunchTemplateHttpTokens.REQUIRED,
    });

    cdk.Tags.of(launchTemplate).add('Name', 'nextflow-pipeline');
    return launchTemplate;
  }
}
