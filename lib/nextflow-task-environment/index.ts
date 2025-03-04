import { Construct } from "constructs";
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
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { createLaunchTemplate } from "../utils";
import { IBucket } from "aws-cdk-lib/aws-s3";

export interface NextflowTaskEnvironmentProps {
  /**
   * VPC to run the Nextflow batch environment in.
   */
  readonly vpc: IVpc;
  /**
   * The security group to use for the task jobs.
   */
  readonly securityGroup: SecurityGroup;
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
   * The launch template content for the underlying batch instances
   */
  readonly launchTemplateContent: string;
}

/**
 * Create a Nextflow batch compute environment for **tasks** jobs.
 */
export class NextflowTaskEnvironment extends Construct {
  /**
   * The compute environment task that is created.
   */
  computeEnvironmentTask: ManagedEc2EcsComputeEnvironment;
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
    props: NextflowTaskEnvironmentProps,
  ) {
    super(scope, id);

    this.instanceRole = new Role(this, "BatchInstanceRoleTask", {
      assumedBy: new CompositePrincipal(
        new ServicePrincipal("ec2.amazonaws.com"),
        new ServicePrincipal("ecs-tasks.amazonaws.com"),
      ),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonEC2ContainerServiceforEC2Role",
        ),
      ],
    });

    this.computeEnvironmentTask = new ManagedEc2EcsComputeEnvironment(
      this,
      "ComputeEnvironmentTask",
      {
        allocationStrategy: AllocationStrategy.BEST_FIT_PROGRESSIVE,
        instanceRole: this.instanceRole,
        instanceTypes: props.instanceTypes,
        launchTemplate: createLaunchTemplate(this, {
          content: props.launchTemplateContent,
          securityGroup: props.securityGroup,
          launchTemplateName: "oncoanalyser-task",
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

    this.jobQueue = new JobQueue(this, "JobQueueTask", {
      computeEnvironments: [
        { computeEnvironment: this.computeEnvironmentTask, order: 1 },
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
}
