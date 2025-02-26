import { Construct } from "constructs";

import * as path from "path";
import * as fs from "fs";

import * as batch from "aws-cdk-lib/aws-batch";
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ssm from "aws-cdk-lib/aws-ssm";

import * as Handlebars from "handlebars";
import * as ecrDeployment from "cdk-ecr-deployment";
import { Aws } from "aws-cdk-lib";
import {ContainerImage} from "aws-cdk-lib/aws-ecs";
import {Platform} from "aws-cdk-lib/aws-ecr-assets";

const BATCH_VOLUME_MOUNT_POINT = "/mnt/local_ephemeral/"

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
  docker: DockerImageBuildProps;
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

    const launchTemplateTask = this.getLaunchTemplateTask({
      securityGroup: securityGroup,
    });

    const computeEnvironmentTask = new batch.ManagedEc2EcsComputeEnvironment(
      this,
      "ComputeEnvironmentTask",
      {
        allocationStrategy: batch.AllocationStrategy.BEST_FIT,
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

    const launchTemplatePipeline = this.getLaunchTemplatePipeline({
      securityGroup: securityGroup,
    });

    const computeEnvironmentPipeline =
      new batch.ManagedEc2EcsComputeEnvironment(
        this,
        "ComputeEnvironmentPipeline",
        {
          allocationStrategy: batch.AllocationStrategy.BEST_FIT,
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

    // Create Docker image and deploy
    const image = new ecrAssets.DockerImageAsset(this, 'DockerImage', {
      directory: path.join(__dirname, 'resources'),
      platform: Platform.LINUX_AMD64
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

    const createProcessImageAsset = (env: any, envName: string, cdkId: string, imageName: string) => {
      const imageAsset = new ecrAssets.DockerImageAsset(this, cdkId, {
        directory: path.join(__dirname, 'process_docker_images'),
        platform: Platform.LINUX_AMD64,
        // because the image base name is passed into Docker - the actual Docker checksum
        // itself won't change even when the image base does... so we need to add it into the hash
        extraHash: imageName,
        buildArgs: {
          // pass this through to Docker forming the base of the image we are constructing
          BASE_IMAGE: imageName,
        }
      });

      env[envName] = imageAsset.imageUri;
    }

    const env: Record<string,string> = {
      BATCH_INSTANCE_TASK_ROLE_ARN: roleBatchInstanceTask.roleArn,
      BATCH_JOB_QUEUE_NAME: jobQueueTask.jobQueueName,
      S3_BUCKET_NAME: props.bucket.bucket,
      S3_BUCKET_REFDATA_PREFIX: props.bucket.refDataPrefix,
      BATCH_VOLUME_MOUNT_POINT: BATCH_VOLUME_MOUNT_POINT,
    };

      // modules/local/neo/annotate_fusions/main.nf:                   'biocontainers/hmftools-isofox:1.7.1--hdfd78af_1'
    // modules/local/neo/scorer/main.nf:                             'biocontainers/hmftools-neo:1.2--hdfd78af_1'
    // modules/local/neo/finder/main.nf:                             'biocontainers/hmftools-neo:1.2--hdfd78af_1'
    // modules/local/bamtools/main.nf:                               'biocontainers/hmftools-bam-tools:1.3--hdfd78af_0'
    // modules/local/linxreport/main.nf:                             'biocontainers/r-linxreport:1.0.0--r43hdfd78af_0'
    // modules/local/pave/germline/main.nf:                          'biocontainers/hmftools-pave:1.7--hdfd78af_0'
    // modules/local/pave/somatic/main.nf:                           'biocontainers/hmftools-pave:1.7--hdfd78af_0'

    createProcessImageAsset(env, "ESVEE_DOCKER_IMAGE_URI", "EsveeImageAsset", "quay.io/biocontainers/hmftools-esvee:1.0--hdfd78af_0")
    createProcessImageAsset(env, "SAMBAMBA_DOCKER_IMAGE_URI", "SambambaImageAsset", "quay.io/biocontainers/sambamba:1.0.1--h6f6fda4_0")
    createProcessImageAsset(env, "COBALT_DOCKER_IMAGE_URI", "CobaltImageAsset", "quay.io/biocontainers/hmftools-cobalt:2.0--hdfd78af_0")
    createProcessImageAsset(env, "LINX_DOCKER_IMAGE_URI", "LinxImageAsset", "quay.io/biocontainers/hmftools-linx:2.0--hdfd78af_0")
    createProcessImageAsset(env, "ISOFOX_DOCKER_IMAGE_URI", "IsofoxImageAsset", "quay.io/biocontainers/hmftools-isofox:1.7.1--hdfd78af_1")
    createProcessImageAsset(env, "AMBER_DOCKER_IMAGE_URI", "AmberImageAsset", "quay.io/biocontainers/hmftools-amber:4.1.1--hdfd78af_0")
    createProcessImageAsset(env, "LILAC_DOCKER_IMAGE_URI", "LilacImageAsset", "quay.io/biocontainers/hmftools-lilac:1.6--hdfd78af_1")
    createProcessImageAsset(env, "STAR_DOCKER_IMAGE_URI", "StarImageAsset", "quay.io/biocontainers/star:2.7.3a--0")
    createProcessImageAsset(env, "PURPLE_DOCKER_IMAGE_URI", "PurpleImageAsset", "quay.io/biocontainers/hmftools-purple:4.1--hdfd78af_0")
    createProcessImageAsset(env, "VIRUSBREAKEND_DOCKER_IMAGE_URI", "VirusBreakendImageAsset", "quay.io/nf-core/gridss:2.13.2--1")
    createProcessImageAsset(env, "GRIDSS_DOCKER_IMAGE_URI", "GridssImageAsset", "quay.io/biocontainers/gridss:2.13.2--h50ea8bc_3")
    createProcessImageAsset(env, "CHORD_DOCKER_IMAGE_URI", "ChordImageAsset", "quay.io/biocontainers/hmftools-chord:2.1.0--hdfd78af_0")
    // modules/local/custom/lilac_extract_and_index_contig/main.nf:  'biocontainers/mulled-v2-4dde50190ae599f2bb2027cb2c8763ea00fb5084:4163e62e1daead7b7ea0228baece715bec295c22-0'
    // modules/local/custom/lilac_realign_reads_lilac/main.nf:       'biocontainers/mulled-v2-4dde50190ae599f2bb2027cb2c8763ea00fb5084:4163e62e1daead7b7ea0228baece715bec295c22-0'
    // modules/local/custom/lilac_slice/main.nf:                     'biocontainers/samtools:1.19.2--h50ea8bc_0'
    // modules/local/bwa-mem2/mem/main.nf:                           'biocontainers/mulled-v2-4dde50190ae599f2bb2027cb2c8763ea00fb5084:4163e62e1daead7b7ea0228baece715bec295c22-0'
    createProcessImageAsset(env, "REDUX_DOCKER_IMAGE_URI", "ReduxImageAsset", "quay.io/biocontainers/hmftools-redux:1.1--hdfd78af_1")
    createProcessImageAsset(env, "VIRUSINTERPRETER_DOCKER_IMAGE_URI", "VirusInterpreterImageAsset", "quay.io/biocontainers/hmftools-virus-interpreter:1.7--hdfd78af_0")
    createProcessImageAsset(env, "SAGE_DOCKER_IMAGE_URI", "SageImageAsset", "quay.io/biocontainers/hmftools-sage:4.0--hdfd78af_0")
    createProcessImageAsset(env, "CUPPA_DOCKER_IMAGE_URI", "CuppaImageAsset", "quay.io/biocontainers/hmftools-cuppa:2.3.1--py311r42hdfd78af_0")
    createProcessImageAsset(env, "ORANGE_DOCKER_IMAGE_URI", "OrangeImageAsset", "quay.io/biocontainers/hmftools-orange:3.7.1--hdfd78af_0")
    createProcessImageAsset(env, "FASTP_DOCKER_IMAGE_URI", "FastpImageAsset", "quay.io/biocontainers/fastp:0.23.4--hadf994f_2")
    createProcessImageAsset(env, "SIGS_DOCKER_IMAGE_URI", "SigsImageAsset", "quay.io/biocontainers/hmftools-sigs:1.2.1--hdfd78af_1")

    const nextflowConfigTemplate = fs.readFileSync(path.join(__dirname, "resources/nextflow_aws.template.config"), { encoding: "utf-8"});
    const nextflowConfigTemplateCompiled = Handlebars.compile(nextflowConfigTemplate);
    const nextflowConfig = nextflowConfigTemplateCompiled(env, { });

    if (nextflowConfig.includes("DOCKER_IMAGE_URI"))
      throw new Error("a docker image substitution was missed in the nextflow config presumably because of a simple name mismatch");

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
          memory: cdk.Size.mebibytes(1000),
          jobRole: roleBatchInstancePipeline,
          environment: {
            ONCOANALYSER_NEXTFLOW_CONFIG: nextflowConfig
          }
        },
      ),
    });
  }

  getLaunchTemplateTask(args: { securityGroup: ec2.ISecurityGroup }) {
    const userData = ec2.UserData.custom(
      `MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="==BOUNDARY=="

--==BOUNDARY==
Content-Type: text/x-shellscript; charset="us-ascii"

#!/bin/bash
mkdir -p ${BATCH_VOLUME_MOUNT_POINT}
mkfs.ext4 /dev/nvme1n1
mount /dev/nvme1n1 ${BATCH_VOLUME_MOUNT_POINT}
chmod 777 ${BATCH_VOLUME_MOUNT_POINT}

--==BOUNDARY==--`,
    );

    const launchTemplate = new ec2.LaunchTemplate(this, "LaunchTemplateTask", {
      launchTemplateName: "oncoanalyser-task",
      associatePublicIpAddress: true,
      userData: userData,
      securityGroup: args.securityGroup,
    });

    cdk.Tags.of(launchTemplate).add("Name", "nextflow-task");
    return launchTemplate;
  }

  getLaunchTemplatePipeline(args: { securityGroup: ec2.ISecurityGroup }) {
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

    const launchTemplate = new ec2.LaunchTemplate(
      this,
      "LaunchTemplatePipeline",
      {
        launchTemplateName: "oncoanalyser-pipeline",
        associatePublicIpAddress: true,
        userData: userData,
        securityGroup: args.securityGroup,
      },
    );

    cdk.Tags.of(launchTemplate).add("Name", "nextflow-pipeline");
    return launchTemplate;
  }
}

export type DockerImageBuildProps = {
  ecrRepo: string;
  dockerImageTag: string;
};

export class DockerImageBuild extends Construct {
  public readonly image: ecs.EcrImage;

  constructor(scope: Construct, id: string, props: DockerImageBuildProps) {
    super(scope, id);

    const image = new ecrAssets.DockerImageAsset(this, "DockerImage", {
      directory: path.join(__dirname, "resources"),
    });

    const dockerDestBase = `${Aws.ACCOUNT_ID}.dkr.ecr.${Aws.REGION}.amazonaws.com`;

    new ecrDeployment.ECRDeployment(this, "DeployDockerImage", {
      src: new ecrDeployment.DockerImageName(image.imageUri),
      dest: new ecrDeployment.DockerImageName(
        `${dockerDestBase}/${props.ecrRepo}:${props.dockerImageTag}`,
      ),
    });

    const ecrRepository = ecr.Repository.fromRepositoryName(
      this,
      "EcrRespository",
      props.ecrRepo,
    );
    this.image = ecs.EcrImage.fromEcrRepository(
      ecrRepository,
      props.dockerImageTag,
    );
  }
}
