import * as cdk from 'aws-cdk-lib';
import {Stack} from 'aws-cdk-lib'
import {CompositePrincipal, ManagedPolicy, Policy, PolicyStatement, Role, ServicePrincipal} from 'aws-cdk-lib/aws-iam'


export function getRoleBatchInstanceTask(args: { context: Stack, namePrefix: string }) {
  return new Role(args.context, `${args.namePrefix}TaskBatchInstanceRole`, {
    assumedBy: new CompositePrincipal(
        new ServicePrincipal('ec2.amazonaws.com'),
        new ServicePrincipal('ecs-tasks.amazonaws.com'),
    ),
    managedPolicies: [
      ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess'),
      ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role'),
    ],
  });
}


export function getBaseBatchInstancePipelineRole(args: { context: Stack, namePrefix: string, jobQueueArns: string[] }) {

  const roleBatchInstance = new Role(args.context, `${args.namePrefix}PipelineBatchInstanceRole`, {
    assumedBy: new CompositePrincipal(
        new ServicePrincipal('ec2.amazonaws.com'),
        new ServicePrincipal('ecs-tasks.amazonaws.com'),
    ),
    managedPolicies: [
      ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess'),
      ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role'),
    ],
  });

  // NOTE(SW): the below policies are mostly those described by the Nextflow documents, some minor changes have been
  // made so that the access is less permissive

  new Policy(args.context, `${args.namePrefix}PipelinePolicyBatchJobs`, {
    roles: [roleBatchInstance],
    statements: [new PolicyStatement({
      actions: [
        'batch:CancelJob',
        'batch:SubmitJob',
        'batch:TerminateJob',
      ],

      resources: [
        ...args.jobQueueArns,
        `arn:aws:batch:${args.context.region}:${args.context.account}:job-definition/nf-*`
      ],
    })],
  });

  new Policy(args.context, `${args.namePrefix}PipelinePolicyBatchGeneral`, {
    roles: [roleBatchInstance],
    statements: [new PolicyStatement({
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


  new Policy(args.context, `${args.namePrefix}PipelinePolicyInstances`, {
    roles: [roleBatchInstance],
    statements: [new PolicyStatement({
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

  new Policy(args.context, `${args.namePrefix}PipelinePolicyECR`, {
    roles: [roleBatchInstance],
    statements: [new PolicyStatement({
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

  return roleBatchInstance;
}
