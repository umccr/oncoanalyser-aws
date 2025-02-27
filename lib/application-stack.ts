import { Construct } from "constructs";

import * as path from "path";

import * as batch from "aws-cdk-lib/aws-batch";
import * as cdk from "aws-cdk-lib";
import { Aws } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import { ContainerImage } from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { NextflowConfigConstruct } from "./nextflow-config-construct";

export type BucketProps = {
  bucket: string;
  inputPrefix: string;
  outputPrefix: string;
  refDataPrefix: string;
};

export type OncoanalyserProps = {
  vpc?: ec2.IVpc | string;
  pipelineInstanceTypes: ec2.InstanceType[];
  taskInstanceTypes: ec2.InstanceType[];
  maxPipelineCpus: number;
  maxTaskCpus: number;
  bucket: BucketProps;
};

export class Oncoanalyser extends Construct {
  constructor(scope: Construct, id: string, props: OncoanalyserProps) {
    super(scope, id);

    let vpc;
    if (props.vpc === undefined) {
      vpc = ec2.Vpc.fromLookup(this, "VPC", {
        isDefault: true,
      });
    } else if (typeof props.vpc == "string") {
      vpc = ec2.Vpc.fromLookup(this, "VPC", {
        vpcName: props.vpc,
      });
    } else {
      vpc = props.vpc;
    }

    /// Allows all outbound connections.
    const securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
      allowAllOutbound: true,
      description: "oncoanalyser security group",
      vpc,
    });

    // Create Batch resources and co for Nextflow ***task*** jobs
    const roleBatchInstanceTask = new iam.Role(this, "BatchInstanceRoleTask", {
      roleName: "batch-instance-role-task",
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal("ec2.amazonaws.com"),
        new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore",
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonEC2ContainerServiceforEC2Role",
        ),
      ],
    });

    const launchTemplateTask = this.getLaunchTemplate({
      securityGroup: securityGroup,
      launchTemplateName: "oncoanalyser-task",
    });

    const computeEnvironmentTask = new batch.ManagedEc2EcsComputeEnvironment(
      this,
      "ComputeEnvironmentTask",
      {
        allocationStrategy: batch.AllocationStrategy.BEST_FIT_PROGRESSIVE,
        instanceRole: roleBatchInstanceTask,
        instanceTypes: props.taskInstanceTypes,
        launchTemplate: launchTemplateTask,
        maxvCpus: props.maxTaskCpus,
        securityGroups: [],
        useOptimalInstanceClasses: false,
        vpc: vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
      },
    );

    const jobQueueTask = new batch.JobQueue(this, "JobQueueTask", {
      jobQueueName: "oncoanalyser-tasks",
      computeEnvironments: [
        { computeEnvironment: computeEnvironmentTask, order: 1 },
      ],
    });

    // Create Batch resources and co for Nextflow ***pipeline*** jobs
    const roleBatchInstancePipeline = new iam.Role(
      this,
      "BatchInstanceRolePipeline",
      {
        roleName: "batch-instance-role-pipeline",
        assumedBy: new iam.CompositePrincipal(
          new iam.ServicePrincipal("ec2.amazonaws.com"),
          new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        ),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3ReadOnlyAccess"),
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "AmazonSSMManagedInstanceCore",
          ),
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AmazonEC2ContainerServiceforEC2Role",
          ),
        ],
      },
    );

    // NOTE(SW): the below policies are mostly those described by the Nextflow documents, some minor changes have been
    // made so that the access is less permissive

    new iam.Policy(this, "PipelinePolicyBatchJobs", {
      roles: [roleBatchInstancePipeline],
      statements: [
        new iam.PolicyStatement({
          actions: [
            "batch:CancelJob",
            "batch:SubmitJob",
            "batch:TagResource",
            "batch:TerminateJob",
          ],

          resources: [
            jobQueueTask.jobQueueArn,
            // this is the naming format of the job definitions made by the pipeline node
            `arn:aws:batch:${Aws.REGION}:${Aws.ACCOUNT_ID}:job-definition/nf-*`,
          ],
        }),
      ],
    });

    new iam.Policy(this, "PipelinePolicyBatchGeneral", {
      roles: [roleBatchInstancePipeline],
      statements: [
        new iam.PolicyStatement({
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

    new iam.Policy(this, "PipelinePolicyInstances", {
      roles: [roleBatchInstancePipeline],
      statements: [
        new iam.PolicyStatement({
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

    new iam.Policy(this, "PipelinePolicyECR", {
      roles: [roleBatchInstancePipeline],
      statements: [
        new iam.PolicyStatement({
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

    new iam.Policy(this, "PipelinePolicyCloudWatchLogEvents", {
      roles: [roleBatchInstancePipeline],
      statements: [
        new iam.PolicyStatement({
          actions: ["logs:GetLogEvents"],
          resources: [
            `arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:/aws/batch/job/:nf-*`,
          ],
        }),
      ],
    });

    new iam.Policy(this, "PipelinePolicyAppConfig", {
      roles: [roleBatchInstancePipeline],
      statements: [
        new iam.PolicyStatement({
          actions: [
            "appconfig:GetLatestConfiguration",
            "appconfig:StartConfigurationSession",
          ],
          // should be tightened
          resources: [`*`],
        }),
      ],
    });

    roleBatchInstancePipeline.attachInlinePolicy(
      new iam.Policy(this, "PipelinePolicyPassRole", {
        statements: [
          new iam.PolicyStatement({
            actions: ["iam:PassRole"],
            resources: [roleBatchInstanceTask.roleArn],
          }),
        ],
      }),
    );

    const launchTemplatePipeline = this.getLaunchTemplate({
      securityGroup: securityGroup,
      launchTemplateName: "oncoanalyser-pipeline",
    });

    const computeEnvironmentPipeline =
      new batch.ManagedEc2EcsComputeEnvironment(
        this,
        "ComputeEnvironmentPipeline",
        {
          allocationStrategy: batch.AllocationStrategy.BEST_FIT_PROGRESSIVE,
          instanceRole: roleBatchInstancePipeline,
          instanceTypes: props.pipelineInstanceTypes,
          launchTemplate: launchTemplatePipeline,
          maxvCpus: props.maxPipelineCpus,
          securityGroups: [],
          useOptimalInstanceClasses: false,
          vpc: vpc,
          vpcSubnets: {
            subnetType: ec2.SubnetType.PUBLIC,
          },
        },
      );

    const jobQueuePipeline = new batch.JobQueue(this, "JobQueuePipeline", {
      jobQueueName: "oncoanalyser-pipeline",
      computeEnvironments: [
        { computeEnvironment: computeEnvironmentPipeline, order: 1 },
      ],
    });

    // create Docker image for pipeline
    const image = new ecrAssets.DockerImageAsset(this, "DockerImage", {
      directory: path.join(__dirname, "resources"),
      platform: Platform.LINUX_AMD64,
    });

    // Bucket permissions
    const nfBucket = s3.Bucket.fromBucketName(
      this,
      "S3Bucket",
      props.bucket.bucket,
    );

    nfBucket.grantRead(
      roleBatchInstancePipeline,
      `${props.bucket.inputPrefix}/*`,
    );
    nfBucket.grantRead(roleBatchInstanceTask, `${props.bucket.inputPrefix}/*`);

    nfBucket.grantRead(
      roleBatchInstancePipeline,
      `${props.bucket.refDataPrefix}/*`,
    );
    nfBucket.grantRead(
      roleBatchInstanceTask,
      `${props.bucket.refDataPrefix}/*`,
    );

    nfBucket.grantReadWrite(
      roleBatchInstancePipeline,
      `${props.bucket.outputPrefix}/*`,
    );
    nfBucket.grantReadWrite(
      roleBatchInstanceTask,
      `${props.bucket.outputPrefix}/*`,
    );

    const config = new NextflowConfigConstruct(this, "NextflowConfig", {
      bucket: props.bucket,
      tasksInstanceRole: roleBatchInstanceTask,
      tasksJobQueue: jobQueueTask,
      copyToLocalEcr: true,
    });

    // Create job definition for pipeline execution
    const jobDefinition = new batch.EcsJobDefinition(this, "JobDefinition", {
      jobDefinitionName: "oncoanalyser-job-definition",
      container: new batch.EcsEc2ContainerDefinition(
        this,
        "EcsEc2ContainerDefinition",
        {
          cpu: 1,
          image: ContainerImage.fromDockerImageAsset(image),
          command: ["true"],
          memory: cdk.Size.gibibytes(1),
          jobRole: roleBatchInstancePipeline,
          environment: config.getEnvironmentVariables(),
        },
      ),
    });
  }

  getLaunchTemplate(args: {
    securityGroup: ec2.ISecurityGroup;
    launchTemplateName?: string;
  }) {
    const userData = ec2.UserData.custom(
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

git clone https://github.com/awslabs/amazon-ebs-autoscale /tmp/amazon-ebs-autoscale/
(cd /tmp/amazon-ebs-autoscale/ && git checkout 6db0c70)

bash /tmp/amazon-ebs-autoscale/install.sh

rm -rf /tmp/awscliv2.zip /tmp/aws/ /tmp/amazon-ebs-autoscale/
--==BOUNDARY==--`,
    );
    const ltName = args.launchTemplateName ?? "oncoanalyser";
    const constructId = `LaunchTemplate-${ltName}`;
    const launchTemplate = new ec2.LaunchTemplate(this, constructId, {
      associatePublicIpAddress: true,
      userData: userData,
      securityGroup: args.securityGroup,
    });

    cdk.Tags.of(launchTemplate).add("Name", ltName);
    return launchTemplate;
  }
}