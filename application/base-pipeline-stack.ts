import {Construct} from 'constructs';

import {Stack, StackProps} from "aws-cdk-lib";
import {
  AllocationStrategy,
  ComputeEnvironment,
  ComputeResourceType,
  JobQueue,
  LaunchTemplateSpecification,
} from "@aws-cdk/aws-batch-alpha";
import {
  ISecurityGroup,
  IVpc,
  InstanceType,
  LaunchTemplate,
  SecurityGroup,
  SubnetType,
  UserData,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import {EcsOptimizedImage} from "aws-cdk-lib/aws-ecs";
import {
  CfnInstanceProfile,
  ManagedPolicy,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";

import {getBaseBatchInstancePipelineRole, getRoleBatchInstanceTask} from "./base-roles";


interface IBatchComputeData {
  name: string,
  costModel: ComputeResourceType,
  instances: string[],
}

// NOTE(SW): allowing only exactly one pipeline queue/env for now
const batchComputePipeline: IBatchComputeData = {
  name: 'pipeline',
  costModel: ComputeResourceType.ON_DEMAND,
  instances: [
   'r5dn.large',
  ],
};

const batchComputeTask: IBatchComputeData[] = [

  // TODO(SW): if the on-demand queue is used, restrict to instances with SSD for Fusion

  {
    name: 'unrestricted',
    costModel: ComputeResourceType.ON_DEMAND,
    instances: ['optimal'],
  },

  {
    name: '2cpu_16gb',
    costModel: ComputeResourceType.SPOT,
    instances: [
     'r5d.large',
     'r5dn.large',
     'r6id.large',
    ],
  },

  /*

  {
    name: '4cpu_8gb',
    costModel: ComputeResourceType.SPOT,
    instances: [
     'c5.xlarge',
     'c6i.xlarge',
    ],
  },

  */

  {
    name: '4cpu_16gb',
    costModel: ComputeResourceType.SPOT,
    instances: [
      'm4.xlarge',
      'm5.xlarge',
      'm6i.xlarge',
    ],
  },

  {
    name: '4cpu_32gb',
    costModel: ComputeResourceType.SPOT,
    instances: [
      'r5d.xlarge',
      'r5dn.xlarge',
      'r6id.xlarge',
    ],
  },

  {
    name: '8cpu_32gb',
    costModel: ComputeResourceType.SPOT,
    instances: [
      'm5d.2xlarge',
      'm6id.2xlarge',
    ],
  },

  {
    name: '8cpu_64gb',
    costModel: ComputeResourceType.SPOT,
    instances: [
      'r5d.2xlarge',
      'r5dn.2xlarge',
      'r6id.2xlarge',
    ],
  },

  {
    name: '16cpu_32gb',
    costModel: ComputeResourceType.SPOT,
    instances: [
      'c5d.4xlarge',
      'c6id.4xlarge',
    ],
  },

  /*

  {
    name: '16cpu_64gb',
    costModel: ComputeResourceType.SPOT,
    instances: [
      'm4.4xlarge',
      'm5.4xlarge',
      'm6i.4xlarge',
    ],
  },

 */

];


export class BasePipelineStack extends Stack {
  public readonly jobQueueTaskArns: Map<string, string> = new Map();

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);


    // General resources
    const vpc = Vpc.fromLookup(this, 'MainVPC', {
      vpcName: 'main-vpc',
    });

    const securityGroup = SecurityGroup.fromLookupByName(
      this,
      'SecurityGroupOutBoundOnly',
      'main-vpc-sg-outbound',
      vpc,
    );


    // Task Batch compute environment and job queue
    const launchTemplateTask = this.getLaunchTemplateSpec({ namespace: 'BaseTask', volumeSize: 500 });

    // NOTE(SW): default job role and should be overridden by a custom job role defined in an individual stack
    const roleBatchInstanceTask = getRoleBatchInstanceTask({
      context: this,
      namePrefix: 'Base',
    });
    const profileBatchInstanceTask = new CfnInstanceProfile(this, 'BaseTaskBatchInstanceProfile', {
      roles: [roleBatchInstanceTask.roleName],
    });

    const roleBatchSpotfleetTask = new Role(this, 'BaseTaskBatchSpotFleetRole', {
      assumedBy: new ServicePrincipal('spotfleet.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2SpotFleetTaggingRole'),
      ],
    });

    let jobQueueTaskArns: Map<string, string> = new Map();
    for (let batchComputeData of batchComputeTask) {
      let [computeEnvironment, jobQueue] = this.getComputeEnvironment({
        batchComputeData: batchComputeData,
        vpc: vpc,
        profileBatchInstance: profileBatchInstanceTask,
        launchTemplate: launchTemplateTask,
        securityGroup: securityGroup,
        roleBatchSpotfleet: roleBatchSpotfleetTask,
        serviceType: 'Task',
      });

      if (this.jobQueueTaskArns.has(batchComputeData.name)) {
        throw new Error('Got duplicate instance categories');
      } else {
        this.jobQueueTaskArns.set(batchComputeData.name, jobQueue.jobQueueArn);
      }
    }


    // Pipeline Batch compute environment and job queue
    const launchTemplatePipeline = this.getLaunchTemplateSpec({ namespace: 'BasePipeline', volumeSize: 50 });

    const jobQueueTaskArnsArray = Array.from(this.jobQueueTaskArns.values());
    const roleBatchInstancePipeline = getBaseBatchInstancePipelineRole({
      context: this,
      namePrefix: 'Base',
      jobQueueArns: jobQueueTaskArnsArray,
    });
    const profileBatchInstancePipeline = new CfnInstanceProfile(this, 'BasePipelineBatchInstanceProfile', {
      roles: [roleBatchInstancePipeline.roleName],
    });

    const [computeEnvironmentPipeline, jobQueuePipeline] = this.getComputeEnvironment({
      batchComputeData: batchComputePipeline,
      vpc: vpc,
      profileBatchInstance: profileBatchInstancePipeline,
      launchTemplate: launchTemplatePipeline,
      securityGroup: securityGroup,
      serviceType: 'Pipeline',
    });
  }


  getLaunchTemplateSpec(args: { namespace: string, volumeSize: number }) {
    // NOTE(SW): using UserData.addCommands does not render with a MIME block when passed to the
    // batch-alpha.ComputeEnvironment, which then results in an invalid compute environment

    // NOTE(SW): using 777 mode for Fusion NVMe SSD mount since I'm not certain whether different Docker users will
    // impact ability to access e.g. Docker containers can run as either be root or mamberuser in oncoanalyser but Batch
    // might run with elevate privileges

    const userData = UserData.custom(
`MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="==MYBOUNDARY=="

--==MYBOUNDARY==
Content-Type: text/x-shellscript; charset="us-ascii"

#!/bin/bash
mkdir -p /mnt/local_ephemeral/
mkfs.ext4 /dev/nvme1n1
mount /dev/nvme1n1 /mnt/local_ephemeral/
chmod 777 /mnt/local_ephemeral/

--==MYBOUNDARY==--`
    );

    return new LaunchTemplate(this, `${args.namespace}LaunchTemplate`, {
      launchTemplateName: `nextflow-${args.namespace.toLowerCase()}-launch-template`,
      userData: userData,
    });
  }

  getComputeEnvironment(args: {
    batchComputeData: IBatchComputeData,
    vpc: IVpc,
    profileBatchInstance: CfnInstanceProfile,
    launchTemplate: LaunchTemplateSpecification,
    securityGroup: ISecurityGroup,
    roleBatchSpotfleet?: Role,
    serviceType: string,
  }): [ComputeEnvironment, JobQueue] {
    const categoryName = args.batchComputeData.name;
    const instanceTypes = args.batchComputeData.instances.map((name) => {
      return new InstanceType(name);
    });

    let allocationStrategy;
    let queueNameSuffix;
    switch (args.batchComputeData.costModel) {
      case ComputeResourceType.ON_DEMAND:
        allocationStrategy = AllocationStrategy.BEST_FIT;
        queueNameSuffix = 'ondemand';
        break;
      case ComputeResourceType.SPOT:
        allocationStrategy = AllocationStrategy.SPOT_CAPACITY_OPTIMIZED;
        queueNameSuffix = 'spot';
        break;
      default:
        throw new Error('Got bad allocation strategy');
    }

    let cname = `${categoryName}-${queueNameSuffix}`;
    if (args.serviceType === 'Task') {
      cname = `task-${cname}`;
    } else if (args.serviceType !== 'Pipeline') {
      throw new Error('Got bad serviceType');
    }

    const computeEnvId = `Base{args.serviceType}${categoryName}${queueNameSuffix}ComputeEnvironment`;
    const computeEnvironment = new ComputeEnvironment(this, computeEnvId, {
      computeResources: {
        vpc: args.vpc,
        allocationStrategy: allocationStrategy,
        desiredvCpus: 0,
        image: EcsOptimizedImage.amazonLinux2(),
        instanceRole: args.profileBatchInstance.attrArn,
        instanceTypes: instanceTypes,
        launchTemplate: {
          launchTemplateId: args.launchTemplate.launchTemplateId as string,
          version: '$Latest',
        },
        maxvCpus: 128,
        securityGroups: [args.securityGroup],
        spotFleetRole: args.roleBatchSpotfleet,
        vpcSubnets: {
          subnetType: SubnetType.PUBLIC,
        },
        type: args.batchComputeData.costModel,
      },
    });


    const jobQueueId = `Base{args.serviceType}${categoryName}${queueNameSuffix}JobQueue`;
    const jobQueue = new JobQueue(this, jobQueueId, {
      jobQueueName: `nextflow-${cname}`,
      computeEnvironments: [
        { computeEnvironment: computeEnvironment, order: 1 },
      ],
    });

  return [computeEnvironment, jobQueue];
  }
}

