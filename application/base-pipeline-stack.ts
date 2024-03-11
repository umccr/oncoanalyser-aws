import { Construct } from 'constructs';

import * as fs from 'fs';
import * as path from 'path';

import * as batch from 'aws-cdk-lib/aws-batch';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs  from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';

import * as baseRoles from './shared/base-roles';
import * as batchQueues from './shared/batch-queues';
import * as constants from './constants';
import * as settings from './settings';


export class BasePipelineStack extends cdk.Stack {
  public readonly jobQueuePipelineArns: string[] = [];
  public readonly jobQueueTaskArns: string[] = [];

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Collect existing misc general resource
    const vpc = ec2.Vpc.fromLookup(this, 'MainVPC', {
      vpcName: 'main-vpc',
    });

    const securityGroup = ec2.SecurityGroup.fromLookupByName(
      this,
      'SecurityGroupOutBoundOnly',
      'main-vpc-sg-outbound',
      vpc,
    );

    // Create resources, store job queue ARNs for reference in other constructs
    this.createTaskResources({
        queueTypes: settings.taskQueueTypes,
        storageTypes: settings.taskInstanceStorageTypes,
        vpc: vpc,
        securityGroup: securityGroup,
    });

    this.createPipelineResources({
        storageTypes: settings.taskInstanceStorageTypes,
        vpc: vpc,
        securityGroup: securityGroup,
    });

  }

  createTaskResources(args: {
    queueTypes: constants.QueueType[],
    storageTypes: constants.InstanceStorageType[],
    vpc: ec2.IVpc,
    securityGroup: ec2.ISecurityGroup,
  }) {
    // NOTE(SW): default job role and should be overridden by a custom job role defined in an individual stack
    const roleBatchInstanceTask = baseRoles.getRoleBatchInstanceTask({
      context: this,
      workflowName: 'base',
    });

    let roleBatchSpotfleetTask;
    if (args.queueTypes.includes(constants.QueueType.Spot)) {

      roleBatchSpotfleetTask = new iam.Role(this, 'BaseTaskBatchSpotFleetRole', {
        assumedBy: new iam.ServicePrincipal('spotfleet.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2SpotFleetTaggingRole'),
        ],
      });

    }

    for (let storageType of args.storageTypes) {
      const launchTemplateTask = this.getLaunchTemplate({
        namespace: 'BaseTask',
        storageType: storageType,
      });

      for (let queueType of args.queueTypes) {

        let jobQueueTaskArns: Map<string, string> = new Map();

        for (let taskQueueData of batchQueues.taskQueues) {

          let [computeEnvironment, jobQueue] = this.getComputeEnvironment({
            queueData: taskQueueData,
            queueType: queueType,
            storageType: storageType,
            vpc: args.vpc,
            securityGroup: args.securityGroup,
            launchTemplate: launchTemplateTask,
            roleBatchInstance: roleBatchInstanceTask,
            roleBatchSpotfleet: roleBatchSpotfleetTask,
            serviceType: constants.ServiceType.Task,
          });

          this.jobQueueTaskArns.push(jobQueue.jobQueueArn);
        }
      }
    }
  }

  createPipelineResources(args: {
    storageTypes: constants.InstanceStorageType[],
    vpc: ec2.IVpc,
    securityGroup: ec2.ISecurityGroup,
  }) {
    // NOTE(SW): default job role and should be overridden by a custom job role defined in an individual stack
    const roleBatchInstance = baseRoles.getBaseBatchInstancePipelineRole({
      context: this,
      workflowName: 'base',
      jobQueueArns: Array.from(this.jobQueueTaskArns.values()),
    });


    // NOTE(SW): here we make a special case for the pipeline queue in the UMCCR environment. This exception is designed
    // to met existing compatibility requirements for the external orchestrator service (single queue, constant queue
    // name) while allowing runs with and without FusionFS. This is done by:
    //   (1) creating a single pipeline queue with a predefined constant name
    //   (2) forcing the pipeline queue storage type to 'NvmeSsdOnly' for FusionFS compatibility
    //
    // One side-effect of this is that pipelines not using FusionFS will still be run on instance with NVMe SSD but
    // won't utilise that resource.
    const queueName = constants.PIPELINE_BATCH_QUEUE_BASENAME;
    const storageType = constants.InstanceStorageType.NvmeSsdOnly;


    const launchTemplate = this.getLaunchTemplate({
      namespace: 'BasePipeline',
      storageType: storageType,
    });

    const [computeEnvironment, jobQueue] = this.getComputeEnvironment({
      queueData: batchQueues.pipelineQueue,
      queueType: constants.QueueType.Ondemand,
      storageType: storageType,
      vpc: args.vpc,
      securityGroup: args.securityGroup,
      launchTemplate: launchTemplate,
      roleBatchInstance: roleBatchInstance,
      serviceType: constants.ServiceType.Pipeline,
      queueName: queueName,
    });

    this.jobQueuePipelineArns.push(jobQueue.jobQueueArn);
  }

  getLaunchTemplate(args: {
    namespace: string,
    storageType: constants.InstanceStorageType,
  }) {

    // NOTE(SW): EBS user data installs required packages for Amazon Elastic Block Store Autoscale
    // set in the Cloud Config block

    // NOTE(SW): The AWS CLIv2 install must not clobber Docker paths otherwise the corresponding
    // paths in the Docker container will be mounted over. The Amazon Elastic Block Store Autoscale
    // install and daemon also require AWS CLIv2 to be in path, so I symlink it into /usr/local/bin

    // NOTE(SW): using UserData.addCommands does not render with a MIME block when passed to the
    // batch-alpha.ComputeEnvironment, which then results in an invalid compute environment

    // Get and apply user data for all task lts and only for the pipeline + FusionFS/NVMeSSD lts. No
    // user data is currently needed for the pipeline + EBS lts.
    let userDataTask
    if (args.namespace == 'BaseTask' || (args.namespace == 'BasePipeline' && args.storageType === constants.InstanceStorageType.NvmeSsdOnly)) {
      let userDataFn: string;
      switch(args.storageType) {
        case(constants.InstanceStorageType.EbsOnly):
          userDataFn = 'ebs.txt';
          break;
        case(constants.InstanceStorageType.NvmeSsdOnly):
          userDataFn = 'nvme.txt';
          break;
        default:
          throw new Error('Got bad storage type');
      }

      const userDataFp: string = path.join(__dirname, 'resources/launch_templates/', userDataFn);
      const userDataString = fs.readFileSync(userDataFp, {encoding: 'utf-8'});
      userDataTask = ec2.UserData.custom(userDataString);
    }

    const launchTemplate = new ec2.LaunchTemplate(this, `${args.namespace}LaunchTemplate-${args.storageType.toLowerCase()}`, {
      launchTemplateName: `nextflow-${args.namespace.toLowerCase()}-${args.storageType.toLowerCase()}-launch-template`,
      userData: userDataTask,
      requireImdsv2: true,
      httpTokens: ec2.LaunchTemplateHttpTokens.REQUIRED,
    });

    let instanceName: string;
    if (args.namespace == 'BaseTask') {
      instanceName = 'nextflow-task';
    } else if (args.namespace == 'BasePipeline') {
      instanceName = 'nextflow-pipeline';
    } else {
      throw new Error('Got bad namespace');
    }
    cdk.Tags.of(launchTemplate).add('Name', instanceName);

    return launchTemplate;
  }

  getComputeEnvironment(args: {
    queueData: batchQueues.IQueueData,
    queueType: constants.QueueType,
    storageType: constants.InstanceStorageType,
    vpc: ec2.IVpc,
    securityGroup: ec2.ISecurityGroup,
    launchTemplate: ec2.ILaunchTemplate,
    roleBatchInstance: iam.Role,
    roleBatchSpotfleet?: iam.Role,
    serviceType: constants.ServiceType,
    queueName?: string,
  }): [batch.ManagedEc2EcsComputeEnvironment, batch.JobQueue] {

    let queueDataInstanceTypeKey: string;
    switch (args.storageType) {
      case constants.InstanceStorageType.EbsOnly:
        queueDataInstanceTypeKey = 'standard';
        break;
      case constants.InstanceStorageType.NvmeSsdOnly:
        queueDataInstanceTypeKey = 'nvme_ssd';
        break;
      default:
        throw new Error('Got bad storage type');
    }

    if (!args.queueData.instances.has(queueDataInstanceTypeKey)) {
      throw new Error(`Got bad instance type key, "${queueDataInstanceTypeKey}"`);
    }

    const instanceTypes = args.queueData.instances.get(queueDataInstanceTypeKey)!
      .map((typeStr) => {
        return new ec2.InstanceType(typeStr);
      });

    let spotMode;
    let allocationStrategy;
    switch (args.queueType) {
      case constants.QueueType.Ondemand:
        spotMode = false;
        allocationStrategy = batch.AllocationStrategy.BEST_FIT;
        break;
      case constants.QueueType.Spot:
        spotMode = false;
        allocationStrategy = batch.AllocationStrategy.SPOT_CAPACITY_OPTIMIZED;
        break;
      default:
        throw new Error('Got bad queue type');
    }

    let queueName: string;
    if (args.queueName) {
      queueName = args.queueName;
    } else {
      queueName = batchQueues.getQueueName({
        queueBaseName: args.queueData.name,
        queueType: args.queueType,
        storageType: args.storageType,
        serviceType: args.serviceType,
      });
    }

    const computeEnvId = `BaseComputeEnvironment-${queueName}`;
    const computeEnvironment = new batch.ManagedEc2EcsComputeEnvironment(this, computeEnvId, {
      allocationStrategy: allocationStrategy,
      instanceRole: args.roleBatchInstance,
      instanceTypes: instanceTypes,
      launchTemplate: args.launchTemplate,
      maxvCpus: args.queueData.maxvCpus ?? settings.maxvCpusDefault,
      securityGroups: [args.securityGroup],
      spot: spotMode,
      spotFleetRole: args.roleBatchSpotfleet,
      useOptimalInstanceClasses: false,
      vpc: args.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    const jobQueueId = `BaseJobQueue-${queueName}`;
    const jobQueue = new batch.JobQueue(this, jobQueueId, {
      jobQueueName: `nextflow-${queueName}`,
      computeEnvironments: [
        { computeEnvironment: computeEnvironment, order: 1 },
      ],
    });

    return [computeEnvironment, jobQueue];
  }
}
