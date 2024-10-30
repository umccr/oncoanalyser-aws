import * as cdk from 'aws-cdk-lib';

import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';


export function createPipelineRoles(args: { context: cdk.Stack, workflowName: string, jobQueueArns: string[] }) {
    // Task and pipeline role
    const roleBatchInstanceTask = getRoleBatchInstanceTask(args);
    const roleBatchInstancePipeline = getBaseBatchInstancePipelineRole(args);

    // Profiles
    const profileBatchInstanceTask = new iam.CfnInstanceProfile(args.context, `TaskBatchInstanceProfile-${args.workflowName}`, {
      instanceProfileName: `nextflow-${args.workflowName}-task-batch-instance-profile`,
      roles: [roleBatchInstanceTask.roleName],
    });
    const profileBatchInstancePipeline = new iam.CfnInstanceProfile(args.context, `PipelineBatchInstanceProfile-${args.workflowName}`, {
      instanceProfileName: `nextflow-${args.workflowName}-pipeline-batch-instance-profile`,
      roles: [roleBatchInstancePipeline.roleName],
    });

    // Additional policies for pipelines
    //   * iam:PassRole
    //      - Nextflow requirement for Batch job submission
    //
    //   * ec2:DescribeIamInstanceProfileAssociations
    //      - required for locally launched Docker containers
    //      - these containers inherit instance role, which is the SharedStack pipeline role
    //      - usually need at least S3 write permissions hence require setting the correct role to inherit at runtime
    //
    //   * secretsmanager:DescribeSecret, secretsmanager:GetSecretValue
    //      - required staging data from GDS
    //
    roleBatchInstancePipeline.attachInlinePolicy(
      new iam.Policy(args.context, `PipelinePolicyPassRole-${args.workflowName}`, {
        statements: [
          new iam.PolicyStatement({
            actions: ['iam:PassRole'],
            resources: [roleBatchInstanceTask.roleArn],
          })
        ],
      })
    );

    roleBatchInstancePipeline.attachInlinePolicy(
      new iam.Policy(args.context, `PipelinePolicySetInstanceRole-${args.workflowName}`, {
        statements: [
          new iam.PolicyStatement({
            actions: [
              'ec2:DescribeIamInstanceProfileAssociations',
              // NOTE(SW): this /only/ allows passing the task role that is defined above
              'ec2:ReplaceIamInstanceProfileAssociation',
            ],
            resources: ['*'],
          })
        ],
      })
    );

    const icaSecret = secretsmanager.Secret.fromSecretNameV2(args.context, `IcaSecret-${args.workflowName}`, 'IcaSecretsPortal');
    icaSecret.grantRead(roleBatchInstancePipeline);

    return {
      taskRole: roleBatchInstanceTask,
      taskProfile: profileBatchInstanceTask,
      pipelineRole: roleBatchInstancePipeline,
      pipelineProfile: profileBatchInstancePipeline,
    }
}


export function getRoleBatchInstanceTask(args: { context: cdk.Stack, workflowName: string }) {
  const roleTask = new iam.Role(args.context, `TaskBatchInstanceRole-${args.workflowName}`, {
    roleName: `nextflow-${args.workflowName}-task-batch-instance-role`,
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

  // TODO(SW): restrict instances this applies to using a condition with some stack-specific value
  // such as instance name (NextflowApplication*), instance profile (defined in stack) or some
  // other tag. Some condition keys: ec2:Attribute/${n}, ec2:ResourceTag/${n}, ec2:InstanceProfile
  new iam.Policy(args.context, `TaskPolicyEbsAutoScale-${args.workflowName}`, {
    roles: [roleTask],
    statements: [new iam.PolicyStatement({
      actions: [
        'ec2:AttachVolume',
        'ec2:CreateTags',
        'ec2:CreateVolume',
        'ec2:DeleteVolume',
        'ec2:DescribeTags',
        'ec2:DescribeVolumeAttribute',
        'ec2:DescribeVolumeStatus',
        'ec2:DescribeVolumes',
        'ec2:ModifyInstanceAttribute',
      ],
      resources: ['*'],
    })],
  });

  return roleTask;
}


export function getBaseBatchInstancePipelineRole(args: { context: cdk.Stack, workflowName: string, jobQueueArns: string[] }) {

  const rolePipeline = new iam.Role(args.context, `PipelineBatchInstanceRole-${args.workflowName}`, {
    roleName: `nextflow-${args.workflowName}-pipeline-batch-instance-role`,
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

  new iam.Policy(args.context, `PipelinePolicyBatchJobs-${args.workflowName}`, {
    roles: [rolePipeline],
    statements: [new iam.PolicyStatement({
      actions: [
        'batch:CancelJob',
        'batch:SubmitJob',
        'batch:TagResource',
        'batch:TerminateJob',
      ],

      resources: [
        ...args.jobQueueArns,
        `arn:aws:batch:${args.context.region}:${args.context.account}:job-definition/nf-*`
      ],
    })],
  });

  new iam.Policy(args.context, `PipelinePolicyBatchGeneral-${args.workflowName}`, {
    roles: [rolePipeline],
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

  new iam.Policy(args.context, `PipelinePolicyInstances-${args.workflowName}`, {
    roles: [rolePipeline],
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

  new iam.Policy(args.context, `PipelinePolicyECR-${args.workflowName}`, {
    roles: [rolePipeline],
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

  new iam.Policy(args.context, `CloudWatchLogEvents-${args.workflowName}`, {
    roles: [rolePipeline],
    statements: [new iam.PolicyStatement({
      actions: [
        'logs:GetLogEvents',
      ],
      resources: [
          `arn:aws:logs:${args.context.region}:${args.context.account}:log-group:/aws/batch/job/:nf-*`
      ],
    })],
  });

  return rolePipeline;
}
