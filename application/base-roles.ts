import {Stack} from 'aws-cdk-lib'
import {
  CfnInstanceProfile,
  CompositePrincipal,
  IRole,
  ManagedPolicy,
  Policy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam'
import {Secret} from "aws-cdk-lib/aws-secretsmanager";


export function createPipelineRoles(args: { context: Stack, workflowName: string, jobQueueArns: string[] }) {
    // Task and pipeline role
    const roleBatchInstanceTask = getRoleBatchInstanceTask(args);
    const roleBatchInstancePipeline = getBaseBatchInstancePipelineRole(args);

    // Profiles
    const profileBatchInstanceTask = new CfnInstanceProfile(args.context, `TaskBatchInstanceProfile-${args.workflowName}`, {
      roles: [roleBatchInstanceTask.roleName],
    });
    const profileBatchInstancePipeline = new CfnInstanceProfile(args.context, `PipelineBatchInstanceProfile-${args.workflowName}`, {
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
      new Policy(args.context, `PipelinePolicyPassRole-${args.workflowName}`, {
        statements: [
          new PolicyStatement({
            actions: ['iam:PassRole'],
            resources: [roleBatchInstanceTask.roleArn],
          })
        ],
      })
    );

    roleBatchInstancePipeline.attachInlinePolicy(
      new Policy(args.context, `PipelinePolicySetInstanceRole-${args.workflowName}`, {
        statements: [
          new PolicyStatement({
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

    const icaSecret = Secret.fromSecretNameV2(args.context, `IcaSecret-${args.workflowName}`, "IcaSecretsPortal");
    icaSecret.grantRead(roleBatchInstancePipeline);

    return {
      taskRole: roleBatchInstanceTask,
      taskProfile: profileBatchInstanceTask,
      pipelineRole: roleBatchInstancePipeline,
      pipelineProfile: profileBatchInstancePipeline,
    }
}

export function getRoleBatchInstanceTask(args: { context: Stack, workflowName: string }) {
  return new Role(args.context, `TaskBatchInstanceRole-${args.workflowName}`, {
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

export function getBaseBatchInstancePipelineRole(args: { context: Stack, workflowName: string, jobQueueArns: string[] }) {

  const rolePipeline = new Role(args.context, `PipelineBatchInstanceRole-${args.workflowName}`, {
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

  new Policy(args.context, `PipelinePolicyBatchJobs-${args.workflowName}`, {
    roles: [rolePipeline],
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

  new Policy(args.context, `PipelinePolicyBatchGeneral-${args.workflowName}`, {
    roles: [rolePipeline],
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


  new Policy(args.context, `PipelinePolicyInstances-${args.workflowName}`, {
    roles: [rolePipeline],
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

  new Policy(args.context, `PipelinePolicyECR-${args.workflowName}`, {
    roles: [rolePipeline],
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

  return rolePipeline;
}
