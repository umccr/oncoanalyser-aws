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
  name: string;
  costModel: ComputeResourceType;
  instances: string[];
  maxvCpus?: number;
}

// NOTE(SW): allowing only exactly one pipeline queue/env for now
const batchComputePipeline: IBatchComputeData = {
  name: 'pipeline',
  costModel: ComputeResourceType.ON_DEMAND,
  instances: [
   'r6i.large',
  ],
};

const batchComputeTask: IBatchComputeData[] = [

  {
    name: 'unrestricted',
    costModel: ComputeResourceType.ON_DEMAND,
    instances: ['optimal'],
  },

  {
    name: '2cpu_16gb',
    costModel: ComputeResourceType.ON_DEMAND,
    instances: [
     'r5.large',
     'r5n.large',
     'r6i.large',
    ],
  },

  {
    name: '4cpu_16gb',
    costModel: ComputeResourceType.ON_DEMAND,
    instances: [
      'm5.xlarge',
      'm6i.xlarge',
    ],
  },

  {
    name: '4cpu_32gb',
    costModel: ComputeResourceType.ON_DEMAND,
    instances: [
      'r5.xlarge',
      'r5n.xlarge',
      'r6i.xlarge',
    ],
  },

  {
    name: '8cpu_32gb',
    costModel: ComputeResourceType.ON_DEMAND,
    instances: [
      'm5.2xlarge',
      'm6i.2xlarge',
    ],
  },

  {
    name: '8cpu_64gb',
    costModel: ComputeResourceType.ON_DEMAND,
    instances: [
      'r5.2xlarge',
      'r5n.2xlarge',
      'r6i.2xlarge',
    ],
  },

  {
    name: '16cpu_32gb',
    costModel: ComputeResourceType.ON_DEMAND,
    instances: [
      'c5.4xlarge',
      'c6i.4xlarge',
    ],
    // Allow up to 16 concurrent jobs
    maxvCpus: 256,
  },

  {
    name: '16cpu_64gb',
    costModel: ComputeResourceType.ON_DEMAND,
    instances: [
      'm5.4xlarge',
      'm6i.4xlarge',
    ],
    // Allow up to 16 concurrent jobs
    maxvCpus: 256,
  },

  {
    name: '16cpu_128gb',
    costModel: ComputeResourceType.ON_DEMAND,
    instances: [
      'r5.4xlarge',
      'r6i.4xlarge',
    ],
    // Allow up to 16 concurrent jobs
    maxvCpus: 256,
  },

];


export class BasePipelineStack extends Stack {
  public readonly jobQueuePipelineArn: string;
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
      workflowName: 'base',
    });
    const profileBatchInstanceTask = new CfnInstanceProfile(this, 'BaseTaskBatchInstanceProfile', {
      roles: [roleBatchInstanceTask.roleName],
    });

    // NOTE(SW): only required when using SPOT compute environment type, leaving here regardless
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
      workflowName: 'base',
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

    this.jobQueuePipelineArn = jobQueuePipeline.jobQueueArn;
  }


  getLaunchTemplateSpec(args: { namespace: string, volumeSize: number }) {

    // Required packages for Amazon Elastic Block Store Autoscale set in the Cloud Config block

    // NOTE(SW): The AWS CLIv2 install must not clobber Docker paths otherwise the corresponding
    // paths in the Docker container will be mounted over. The Amazon Elastic Block Store Autoscale
    // install and daemon also require AWS CLIv2 to be in path, so I symlink it into /usr/local/bin

    // NOTE(SW): using UserData.addCommands does not render with a MIME block when passed to the
    // batch-alpha.ComputeEnvironment, which then results in an invalid compute environment

    const userDataTask = UserData.custom(
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

git clone -b v2.4.7 https://github.com/awslabs/amazon-ebs-autoscale /tmp/amazon-ebs-autoscale/
bash /tmp/amazon-ebs-autoscale/install.sh

rm -rf /tmp/awscliv2.zip /tmp/aws/ /tmp/amazon-ebs-autoscale/
--==BOUNDARY==--`
    );

    return new LaunchTemplate(this, `${args.namespace}LaunchTemplate`, {
      launchTemplateName: `nextflow-${args.namespace.toLowerCase()}-launch-template`,
      userData: (args.namespace == 'BaseTask') ? userDataTask : undefined,
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
    switch (args.batchComputeData.costModel) {
      case ComputeResourceType.ON_DEMAND:
        allocationStrategy = AllocationStrategy.BEST_FIT;
        break;
      case ComputeResourceType.SPOT:
        allocationStrategy = AllocationStrategy.SPOT_CAPACITY_OPTIMIZED;
        break;
      default:
        throw new Error('Got bad allocation strategy');
    }

    let cname;
    switch (args.serviceType) {
      case ('Task'):
        cname = `task-${categoryName}`;
        break;
      case ('Pipeline'):
        cname = categoryName;
        break;
      default:
        throw new Error('Got bad serviceType');
    }

    const computeEnvId = `Base{args.serviceType}${categoryName}ComputeEnvironment`;
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
        maxvCpus: args.batchComputeData.maxvCpus ?? 128,
        securityGroups: [args.securityGroup],
        spotFleetRole: args.roleBatchSpotfleet,
        vpcSubnets: {
          subnetType: SubnetType.PUBLIC,
        },
        type: args.batchComputeData.costModel,
      },
    });


    const jobQueueId = `Base{args.serviceType}${categoryName}JobQueue`;
    const jobQueue = new JobQueue(this, jobQueueId, {
      jobQueueName: `nextflow-${cname}`,
      computeEnvironments: [
        { computeEnvironment: computeEnvironment, order: 1 },
      ],
    });

  return [computeEnvironment, jobQueue];
  }
}
