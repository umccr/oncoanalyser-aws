import { Construct } from "constructs";

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { Aws } from "aws-cdk-lib";
import { NextflowConfigConstruct } from "./nextflow-config";
import { OncoanalyserJobDefinition } from "./oncoanalyser-job-definition";
import { IVpc, Vpc } from "aws-cdk-lib/aws-ec2";
import { NextflowTaskEnvironment } from "./nextflow-task-environment";
import { NextflowPipelineEnvironment } from "./nextflow-pipeline-environment";
import * as Handlebars from "handlebars";
import { AWS_CLI_BASE_PATH, SCRATCH_BASE_PATH } from "./dependencies";
import {
  OncoanalyserWorkflowBuckets,
  OncoanalyserWorkflowBucketsConfig,
} from "./oncoanalyser-bucket";
import { readFileSync } from "fs";
import { join } from "path";

export interface OncoanalyserProps {
  /**
   * The VPC to run the Oncoanalyser environment in.
   */
  readonly vpc?: ec2.IVpc | string;
  /**
   * The name of the Nextflow pipeline job queue.
   */
  readonly pipelineQueueName: string;
  /**
   * The name of the job definition for Oncoanalyser to run.
   */
  readonly pipelineJobDefinitionName: string;
  /**
   * The instance types to use for the pipeline jobs.
   */
  readonly pipelineInstanceTypes: ec2.InstanceType[];
  /**
   * The maximum number of vCPUs that can be used for the batch pipeline.
   */
  readonly pipelineMaxCpus: number;
  /**
   * The instance types to use for the Nextflow task jobs.
   */
  readonly taskInstanceTypes: ec2.InstanceType[];
  /**
   * The maximum number of vCPUs that can be used for the batch tasks.
   */
  readonly taskMaxCpus: number;
  /**
   * Bucket configuration.
   */
  readonly buckets: OncoanalyserWorkflowBucketsConfig;
  /**
   * The git repository of oncoanalyser to launch from nextflow.
   */
  readonly gitRepo: string;
  /**
   * The git branch of oncoanalyser to launch from nextflow.
   */
  readonly gitBranch: string;
  /**
   * If true, instructs the construct to re-deploy all Task images from
   * their normal source (quay.io etc) to ECR. This will make
   * the initial build much slower, but will then use the Docker cache
   * and will make all executions of the tasks entirely local to AWS.
   * If absent or false, then the default docker task URIs will be used
   * and pulled from the remote sources at runtime.
   */
  readonly copyToLocalEcr?: boolean;
}

/**
 * In general you would only need this construct to create the Oncoanalyser environment.
 */
export class Oncoanalyser extends Construct {
  /**
   * The VPC that the Oncoanalyser batch environment is running in.
   */
  readonly vpc: ec2.IVpc;
  /**
   * The security group that the Oncoanalyser batch environment is running in.
   */
  readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: OncoanalyserProps) {
    super(scope, id);

    this.vpc = this.lookupVpc(props.vpc);

    // Allows all outbound connections.
    this.securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
      allowAllOutbound: true,
      description: "oncoanalyser security group",
      vpc: this.vpc,
    });

    const launchTemplateTemplate = readFileSync(
      join(__dirname, "ec2-user-data.template.txt"),
      { encoding: "utf-8" },
    );
    const launchTemplateCompiled = Handlebars.compile(launchTemplateTemplate, {
      strict: true,
    });
    const launchTemplateContent = launchTemplateCompiled(
      {
        AWS_CLI_BASE_PATH: AWS_CLI_BASE_PATH,
        SCRATCH_BASE_PATH: SCRATCH_BASE_PATH,
      },
      {},
    );

    const nfTaskComputeEnv = new NextflowTaskEnvironment(
      this,
      "NextflowTaskComputeEnvironment",
      {
        vpc: this.vpc,
        securityGroup: this.securityGroup,
        instanceTypes: props.taskInstanceTypes,
        taskMaxCpus: props.taskMaxCpus,
        launchTemplateContent: launchTemplateContent,
      },
    );

    const nfPipelineComputeEnv = new NextflowPipelineEnvironment(
      this,
      "NextflowPipelineEnvironment",
      {
        vpc: this.vpc,
        securityGroup: this.securityGroup,
        pipelineQueueName: props.pipelineQueueName,
        instanceTypes: props.pipelineInstanceTypes,
        taskMaxCpus: props.pipelineMaxCpus,
        additionalInstanceRolePolicies: [
          new iam.Policy(this, "PipelinePolicyBatchJobs", {
            statements: [
              new iam.PolicyStatement({
                actions: [
                  "batch:CancelJob",
                  "batch:SubmitJob",
                  "batch:TagResource",
                  "batch:TerminateJob",
                ],

                resources: [
                  nfTaskComputeEnv.jobQueue.jobQueueArn,
                  // this is the naming format of the job definitions made by the pipeline node
                  `arn:aws:batch:${Aws.REGION}:${Aws.ACCOUNT_ID}:job-definition/nf-*`,
                ],
              }),
            ],
          }),
          new iam.Policy(this, "PipelinePolicyPassRole", {
            statements: [
              new iam.PolicyStatement({
                actions: ["iam:PassRole"],
                resources: [nfTaskComputeEnv.instanceRole.roleArn],
              }),
            ],
          }),
        ],
        launchTemplateContent: launchTemplateContent,
      },
    );

    const buckets = new OncoanalyserWorkflowBuckets(this, "Buckets", {
      ...props.buckets,
      taskComputeEnvRole: nfTaskComputeEnv.instanceRole,
      pipelineComputeEnvRole: nfPipelineComputeEnv.instanceRole,
    });

    const config = new NextflowConfigConstruct(this, "NextflowConfig", {
      buckets,
      tasksInstanceRole: nfTaskComputeEnv.instanceRole,
      tasksJobQueue: nfTaskComputeEnv.jobQueue,
      copyToLocalEcr: props.copyToLocalEcr,
    });

    new OncoanalyserJobDefinition(this, "OncoanalyserJobDefinition", {
      jobRole: nfPipelineComputeEnv.instanceRole,
      pipelineJobDefinitionName: props.pipelineJobDefinitionName,
      environment: config.retrieveEnvironmentVariables(),
      gitRepo: props.gitRepo,
      gitBranch: props.gitBranch,
      buckets,
    });
  }

  /**
   * Lookup the VPC to use for the Oncoanalyser environment.
   */
  private lookupVpc(vpc?: IVpc | string): IVpc {
    if (vpc === undefined) {
      return Vpc.fromLookup(this, "VPC", {
        isDefault: true,
      });
    } else if (typeof vpc == "string") {
      return Vpc.fromLookup(this, "VPC", {
        vpcName: vpc,
      });
    } else {
      return vpc;
    }
  }
}
