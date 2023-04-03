import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';


export function getRoleBatchInstanceTask(args: { context: cdk.Stack, namePrefix: string }) {
  return new iam.Role(args.context, `${args.namePrefix}TaskBatchInstanceRole`, {
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
};


export function getBaseBatchInstancePipelineRole(args: { context: cdk.Stack, namePrefix: string, jobQueueArns: string[] }) {

  const roleBatchInstance = new iam.Role(args.context, `${args.namePrefix}PipelineBatchInstanceRole`, {
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

  new iam.Policy(args.context, `${args.namePrefix}PipelinePolicyBatchJobs`, {
    roles: [roleBatchInstance],
    statements: [new iam.PolicyStatement({
      actions: [
        'batch:CancelJob',
        'batch:SubmitJob',
        'batch:TerminateJob',
      ],

      // TODO(SW): generalise for AWS environment; account id can probably be obtained args.context

      resources: [
        ...args.jobQueueArns,
        'arn:aws:batch:ap-southeast-2:843407916570:job-definition/*'
      ],
    })],
  });

  new iam.Policy(args.context, `${args.namePrefix}PipelinePolicyBatchGeneral`, {
    roles: [roleBatchInstance],
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


  new iam.Policy(args.context, `${args.namePrefix}PipelinePolicyInstances`, {
    roles: [roleBatchInstance],
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

  new iam.Policy(args.context, `${args.namePrefix}PipelinePolicyECR`, {
    roles: [roleBatchInstance],
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

  return roleBatchInstance;
}
