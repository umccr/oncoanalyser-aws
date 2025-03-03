import { Construct } from "constructs";
import { Aws } from "aws-cdk-lib";

import {
  IVpc,
  SecurityGroup,
  SubnetType,
  InstanceType,
} from "aws-cdk-lib/aws-ec2";
import {
  AllocationStrategy,
  JobQueue,
  ManagedEc2EcsComputeEnvironment,
} from "aws-cdk-lib/aws-batch";
import {
  CompositePrincipal,
  ManagedPolicy,
  Policy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { createLaunchTemplate } from "../utils";
import { IBucket } from "aws-cdk-lib/aws-s3";

export interface NextflowPipelineEnvironmentProps {
  /**
   * VPC to run the Nextflow batch environment in.
   */
  readonly vpc: IVpc;
  /**
   * The security group to use for the task jobs.
   */
  readonly securityGroup: SecurityGroup;
  /**
   * The name of the pipeline job queue.
   */
  readonly pipelineQueueName: string;
  /**
   * The ec2 instance types to use for the task jobs.
   */
  readonly instanceTypes: InstanceType[];
  /**
   * The maximum number of vCPUs that can be used by the compute environment.
   */
  readonly taskMaxCpus: number;
  /**
   * The S3 bucket to use for the Nextflow environment.
   */
  readonly nfBucket: IBucket;
  /**
   * The patterns to grant read access to the bucket.
   */
  readonly nfBucketGrantRead?: string[];
  /**
   * The patterns to grant read-write access to the bucket.
   */
  readonly nfBucketGrantReadWrite?: string[];
  /**
   * Additional policies to attach to the instance role.
   */
  readonly additionalInstanceRolePolicies?: Policy[];
}

/**
 * Create a Nextflow batch compute environment for **Pipeline** jobs.
 */
export class NextflowPipelineEnvironment extends Construct {
  /**
   * The compute environment task that is created.
   */
  computeEnvironmentPipeline: ManagedEc2EcsComputeEnvironment;
  /**
   * The instance role that is created.
   */
  instanceRole: Role;
  /**
   * The job queue that is created for the compute environment.
   */
  jobQueue: JobQueue;

  constructor(
    scope: Construct,
    id: string,
    props: NextflowPipelineEnvironmentProps,
  ) {
    super(scope, id);

    this.instanceRole = this.createInitInstanceRole();

    if (props.additionalInstanceRolePolicies) {
      this.addAdditionalPolicies(props.additionalInstanceRolePolicies);
    }

    this.computeEnvironmentPipeline = new ManagedEc2EcsComputeEnvironment(
      this,
      "ComputeEnvironmentPipeline",
      {
        allocationStrategy: AllocationStrategy.BEST_FIT_PROGRESSIVE,
        instanceRole: this.instanceRole,
        instanceTypes: props.instanceTypes,
        launchTemplate: createLaunchTemplate(this, {
          securityGroup: props.securityGroup,
          launchTemplateName: "oncoanalyser-pipeline",
        }),
        maxvCpus: props.taskMaxCpus,
        securityGroups: [],
        useOptimalInstanceClasses: false,
        vpc: props.vpc,
        vpcSubnets: {
          subnetType: SubnetType.PUBLIC,
        },
      },
    );

    this.jobQueue = new JobQueue(this, "JobQueuePipeline", {
      jobQueueName: props.pipelineQueueName,
      computeEnvironments: [
        { computeEnvironment: this.computeEnvironmentPipeline, order: 1 },
      ],
    });
    if (props.nfBucketGrantRead) {
      for (const pattern of props.nfBucketGrantRead) {
        props.nfBucket.grantRead(this.instanceRole, pattern);
      }
    }

    if (props.nfBucketGrantReadWrite) {
      for (const pattern of props.nfBucketGrantReadWrite) {
        props.nfBucket.grantReadWrite(this.instanceRole, pattern);
      }
    }
  }

  private addAdditionalPolicies(policies: Policy[]) {
    for (const policy of policies) {
      policy.attachToRole(this.instanceRole);
    }
  }

  private createInitInstanceRole(): Role {
    const instanceRole = new Role(this, "BatchInstanceRolePipeline", {
      assumedBy: new CompositePrincipal(
        new ServicePrincipal("ec2.amazonaws.com"),
        new ServicePrincipal("ecs-tasks.amazonaws.com"),
      ),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AmazonS3ReadOnlyAccess"),
        ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonEC2ContainerServiceforEC2Role",
        ),
      ],
    });

    // NOTE(SW): the below policies are mostly those described by the Nextflow documents, some minor changes have been
    // made so that the access is less permissive
    new Policy(this, "PipelinePolicyBatchGeneral", {
      roles: [instanceRole],
      statements: [
        new PolicyStatement({
          actions: [
            "batch:ListJobs",
            "batch:DescribeJobs",
            "batch:DescribeJobQueues",
            "batch:DescribeComputeEnvironments",
            "batch:RegisterJobDefinition",
            "batch:DescribeJobDefinitions",
          ],
          resources: ["*"],
        }),
      ],
    });

    new Policy(this, "PipelinePolicyInstances", {
      roles: [instanceRole],
      statements: [
        new PolicyStatement({
          actions: [
            "ecs:DescribeTasks",
            "ec2:DescribeInstances",
            "ec2:DescribeInstanceTypes",
            "ec2:DescribeInstanceAttribute",
            "ecs:DescribeContainerInstances",
            "ec2:DescribeInstanceStatus",
          ],
          resources: ["*"],
        }),
      ],
    });

    new Policy(this, "PipelinePolicyECR", {
      roles: [instanceRole],
      statements: [
        new PolicyStatement({
          actions: [
            "ecr:GetAuthorizationToken",
            "ecr:BatchCheckLayerAvailability",
            "ecr:GetDownloadUrlForLayer",
            "ecr:GetRepositoryPolicy",
            "ecr:DescribeRepositories",
            "ecr:ListImages",
            "ecr:DescribeImages",
            "ecr:BatchGetImage",
            "ecr:GetLifecyclePolicy",
            "ecr:GetLifecyclePolicyPreview",
            "ecr:ListTagsForResource",
            "ecr:DescribeImageScanFindings",
          ],
          resources: ["*"],
        }),
      ],
    });

    new Policy(this, "PipelinePolicyCloudWatchLogEvents", {
      roles: [instanceRole],
      statements: [
        new PolicyStatement({
          actions: ["logs:GetLogEvents"],
          resources: [
            `arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:/aws/batch/job/:nf-*`,
          ],
        }),
      ],
    });

    new Policy(this, "PipelinePolicyAppConfig", {
      roles: [instanceRole],
      statements: [
        new PolicyStatement({
          actions: [
            "appconfig:GetLatestConfiguration",
            "appconfig:StartConfigurationSession",
          ],
          // should be tightened
          resources: [`*`],
        }),
      ],
    });

    return instanceRole;
  }
}
