import { Construct } from 'constructs';

import * as batchAlpha from '@aws-cdk/aws-batch-alpha';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';

import * as common from './common'


interface IBatchComputeData {
  name: string,
  costModel: batchAlpha.ComputeResourceType,
  instances: string[],
};

// NOTE(SW): allowing only exactly one pipeline queue/env for now
const batchComputePipeline: IBatchComputeData = {
  name: 'pipeline',
  costModel: batchAlpha.ComputeResourceType.ON_DEMAND,
  instances: [
   'r5dn.large',
  ],
};

const batchComputeTask: IBatchComputeData[] = [

  // TODO(SW): I need a disk-only queue here if on-demand is to be used

  {
    name: 'unrestricted',
    costModel: batchAlpha.ComputeResourceType.ON_DEMAND,
    instances: ['optimal'],
  },

  {
    name: '2cpu_16gb',
    costModel: batchAlpha.ComputeResourceType.SPOT,
    instances: [
     'r5d.large',
     'r5dn.large',
     'r6id.large',
    ],
  },

  /*

  {
    name: '4cpu_8gb',
    costModel: batchAlpha.ComputeResourceType.SPOT,
    instances: [
     'c5.xlarge',
     'c6i.xlarge',
    ],
  },

  {
    name: '4cpu_16gb',
    costModel: batchAlpha.ComputeResourceType.SPOT,
    instances: [
      'm4.xlarge',
      'm5.xlarge',
      'm6i.xlarge',
    ],
  },

  */

  {
    name: '4cpu_32gb',
    costModel: batchAlpha.ComputeResourceType.SPOT,
    instances: [
      'r5d.xlarge',
      'r5dn.xlarge',
      'r6id.xlarge',
    ],
  },

  {
    name: '8cpu_32gb',
    costModel: batchAlpha.ComputeResourceType.SPOT,
    instances: [
      'm5d.2xlarge',
      'm6id.2xlarge',
    ],
  },

  {
    name: '8cpu_64gb',
    costModel: batchAlpha.ComputeResourceType.SPOT,
    instances: [
      'r5d.2xlarge',
      'r5dn.2xlarge',
      'r6id.2xlarge',
    ],
  },

  {
    name: '16cpu_32gb',
    costModel: batchAlpha.ComputeResourceType.SPOT,
    instances: [
      'c5d.4xlarge',
      'c6id.4xlarge',
    ],
  },

  /*

  {
    name: '16cpu_64gb',
    costModel: batchAlpha.ComputeResourceType.SPOT,
    instances: [
      'm4.4xlarge',
      'm5.4xlarge',
      'm6i.4xlarge',
    ],
  },

 */

];


export class SharedStack extends cdk.Stack {
  public readonly jobQueueTaskArns: Map<string, string> = new Map();

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);


    // Shared general resources
    const vpc = ec2.Vpc.fromLookup(this, 'MainVPC', {
        vpcName: 'main-vpc',
    });

    const securityGroup = ec2.SecurityGroup.fromLookupByName(
      this,
      'SecurityGroupOutBoundOnly',
      'main-vpc-sg-outbound',
      vpc,
    );


    // Task Batch compute environment and job queue
    const launchTemplateTask = this.getLaunchTemplateSpec({ namespace: 'SharedTask', volumeSize: 500 });

    // NOTE(SW): default job role and should be overridden by a custom job role defined in an individual stack
    const roleBatchInstanceTask = common.getRoleBatchInstanceTask({
      context: this,
      namePrefix: 'Shared',
    });
    const profileBatchInstanceTask = new iam.CfnInstanceProfile(this, 'SharedTaskBatchInstanceProfile', {
      roles: [roleBatchInstanceTask.roleName],
    });

    const roleBatchSpotfleetTask = new iam.Role(this, 'SharedTaskBatchSpotFleetRole', {
      assumedBy: new iam.ServicePrincipal('spotfleet.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2SpotFleetTaggingRole'),
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
    const launchTemplatePipeline = this.getLaunchTemplateSpec({ namespace: 'SharedPipeline', volumeSize: 50 });

    const jobQueueTaskArnsArray = Array.from(this.jobQueueTaskArns.values());
    const roleBatchInstancePipeline = common.getBaseBatchInstancePipelineRole({
      context: this,
      namePrefix: 'Shared',
      jobQueueArns: jobQueueTaskArnsArray,
    });
    const profileBatchInstancePipeline = new iam.CfnInstanceProfile(this, 'SharedPipelineBatchInstanceProfile', {
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
    // NOTE(SW): using ec2.UserData.addCommands does not render with a MIME block when passed to the
    // batch-alpha.ComputeEnvironment, which then results in an invalid compute environment

    // NOTE(SW): using 777 mode for Fusion NVMe SSD mount since I'm not certain whether different Docker users will
    // impact ability to access - e.g. Docker contains can run as either be root or mamberuser in oncoanalyser but Batch
    // might run with elevate privileges

    const userData = ec2.UserData.custom(
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

    return new ec2.LaunchTemplate(this, `${args.namespace}LaunchTemplate`, {
      launchTemplateName: `nextflow-${args.namespace.toLowerCase()}-launch-template`,
      userData: userData,
    });
  }

  getComputeEnvironment(args: {
    batchComputeData: IBatchComputeData,
    vpc: ec2.IVpc,
    profileBatchInstance: iam.CfnInstanceProfile,
    launchTemplate: batchAlpha.LaunchTemplateSpecification,
    securityGroup: ec2.ISecurityGroup,
    roleBatchSpotfleet?: iam.Role,
    serviceType: string,
  }): [batchAlpha.ComputeEnvironment, batchAlpha.JobQueue] {
    const categoryName = args.batchComputeData.name;
    const instanceTypes = args.batchComputeData.instances.map((name) => {
      return new ec2.InstanceType(name);
    });

    let allocationStrategy;
    let queueNameSuffix;
    switch (args.batchComputeData.costModel) {
      case batchAlpha.ComputeResourceType.ON_DEMAND:
        allocationStrategy = batchAlpha.AllocationStrategy.BEST_FIT;
        queueNameSuffix = 'ondemand';
        break;
      case batchAlpha.ComputeResourceType.SPOT:
        allocationStrategy = batchAlpha.AllocationStrategy.SPOT_CAPACITY_OPTIMIZED;
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

    const computeEnvId = `Shared${args.serviceType}${categoryName}${queueNameSuffix}ComputeEnvironment`;
    const computeEnvironment = new batchAlpha.ComputeEnvironment(this, computeEnvId, {
      computeResources: {
        vpc: args.vpc,
        allocationStrategy: allocationStrategy,
        desiredvCpus: 0,
        image: ecs.EcsOptimizedImage.amazonLinux2(),
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
          subnetType: ec2.SubnetType.PUBLIC,
        },
        type: args.batchComputeData.costModel,
      },
    });


    const jobQueueId = `Shared${args.serviceType}${categoryName}${queueNameSuffix}JobQueue`;
    const jobQueue = new batchAlpha.JobQueue(this, jobQueueId, {
      jobQueueName: `nextflow-${cname}`,
      computeEnvironments: [
        { computeEnvironment: computeEnvironment, order: 1 },
      ],
    });

  return [computeEnvironment, jobQueue];
  }

}
