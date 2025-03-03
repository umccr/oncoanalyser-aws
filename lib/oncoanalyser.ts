import { Construct } from "constructs";

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Aws } from "aws-cdk-lib";
import { NextflowConfigConstruct } from "./nextflow-config";
import { OncoanalyserJobDefinition } from "./oncoanalyser-job-definition";
import { IVpc, Vpc } from "aws-cdk-lib/aws-ec2";
import { NextflowTaskEnvironment } from "./nextflow-task-environment";
import { NextflowPipelineEnvironment } from "./nextflow-pipeine-environment";
export interface BucketProps {
  readonly bucket: string;
  readonly inputPrefix: string;
  readonly outputPrefix: string;
  readonly refDataPrefix: string;
}

export interface OncoanalyserProps {
  readonly vpc?: ec2.IVpc | string;
  readonly pipelineQueueName: string;
  readonly pipelineJobDefinitionName: string;
  readonly pipelineInstanceTypes: ec2.InstanceType[];
  readonly pipelineMaxCpus: number;
  readonly taskInstanceTypes: ec2.InstanceType[];
  readonly taskMaxCpus: number;
  readonly bucket: BucketProps;

  // the Git repo of oncoanalyser to launch from nextflow
  readonly gitRepo: string;
  readonly gitBranch: string;
}

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

    const nfBucket = s3.Bucket.fromBucketName(
      this,
      "S3Bucket",
      props.bucket.bucket,
    );

    const nfTaskComputeEnv = new NextflowTaskEnvironment(
      this,
      "nfTaskComputeEnvironment",
      {
        vpc: this.vpc,
        securityGroup: this.securityGroup,
        instanceTypes: props.taskInstanceTypes,
        taskMaxCpus: props.taskMaxCpus,
        nfBucket: nfBucket,
        nfBucketGrantRead: [
          `${props.bucket.inputPrefix}/*`,
          `${props.bucket.refDataPrefix}/*`,
        ],
        nfBucketGrantReadWrite: [`${props.bucket.outputPrefix}/*`],
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
        nfBucket: nfBucket,
        nfBucketGrantRead: [
          `${props.bucket.inputPrefix}/*`,
          `${props.bucket.refDataPrefix}/*`,
        ],
        nfBucketGrantReadWrite: [`${props.bucket.outputPrefix}/*`],
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
      },
    );

    const config = new NextflowConfigConstruct(this, "NextflowConfig", {
      bucket: props.bucket,
      tasksInstanceRole: nfTaskComputeEnv.instanceRole,
      tasksJobQueue: nfTaskComputeEnv.jobQueue,
      copyToLocalEcr: false,
    });

    new OncoanalyserJobDefinition(this, "OncoanalyserJobDefinition", {
      jobRole: nfPipelineComputeEnv.instanceRole,
      pipelineJobDefinitionName: props.pipelineJobDefinitionName,
      environment: config.getEnvironmentVariables(),
      gitRepo: props.gitRepo,
      gitBranch: props.gitBranch,
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
