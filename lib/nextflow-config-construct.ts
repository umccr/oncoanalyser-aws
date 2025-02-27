import { join } from "path";
import { readFileSync } from "fs";
import * as Handlebars from "handlebars";
import { Construct } from "constructs";
import { BucketProps } from "./application-stack";
import * as appconfig from "aws-cdk-lib/aws-appconfig";
import { DeletionProtectionCheck } from "aws-cdk-lib/aws-appconfig";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import { IRole } from "aws-cdk-lib/aws-iam";
import { IJobQueue } from "aws-cdk-lib/aws-batch";
import { Duration } from "aws-cdk-lib";
import { NEXTFLOW_PLUGINS } from "./dependencies";

export type NextflowConfigProps = {
  bucket: BucketProps;
  tasksInstanceRole: IRole;
  tasksJobQueue: IJobQueue;

  // if present and true, instructs the construct to make local ECR assets mirroring
  // the standard task Docker images
  // otherwise, the pipeline will launch Docker images directly from their
  // public repository (like quay.io or dockerhub)
  readonly copyToLocalEcr?: boolean;
};

export class NextflowConfigConstruct extends Construct {
  private readonly application: appconfig.Application;
  private readonly environment: appconfig.Environment;
  private readonly hostedConfiguration: appconfig.HostedConfiguration;

  constructor(scope: Construct, id: string, props: NextflowConfigProps) {
    super(scope, id);

    /**
     * Makes the insertion into the nextflow config of the Docker image URI
     * for each task.
     *
     * @param substitutions a dictionary mapping name->value
     * @param configName
     * @param dockerImageUri
     */
    const fixConfigSectionForTask = (
      substitutions: Record<string, string>,
      configName: string,
      dockerImageUri: string,
    ) => {
      if (props.copyToLocalEcr) {
        // we create a "thin" Docker image that essentially is exactly the same layers as the source
        // docker image - but is maintained as an asset within the CDK setup
        // this means CDK will handle deploying it to ECR for us
        const imageAsset = new DockerImageAsset(this, configName, {
          directory: join(__dirname, "task_docker_images"),
          platform: Platform.LINUX_AMD64,
          // because the image base name is passed into Docker - the actual Docker checksum
          // itself won't change even when the image base does... so we need to add the name/tag into the hash
          extraHash: dockerImageUri,
          buildArgs: {
            // pass this through to Docker forming the base of the image we are constructing
            BASE_IMAGE: dockerImageUri,
          },
        });

        substitutions[configName] = imageAsset.imageUri;
      } else {
        // we will just directly reference the Docker image in quay.io etc
        substitutions[configName] = dockerImageUri;
      }
    };

    // we build a dictionary of substitution values that can be inserted into the config by handlebars
    // we first insert here the AWS values like role ARN etc that are needed by the Nextflow
    // pipeline engine
    const substitutions: Record<string, any> = {
      BATCH_INSTANCE_TASK_ROLE_ARN: props.tasksInstanceRole.roleArn,
      BATCH_JOB_QUEUE_NAME: props.tasksJobQueue.jobQueueName,
      S3_BUCKET_NAME: props.bucket.bucket,
      S3_BUCKET_REFDATA_PREFIX: props.bucket.refDataPrefix,
      PLUGINS: NEXTFLOW_PLUGINS,
    };

    // modules/local/neo/annotate_fusions/main.nf:                   'biocontainers/hmftools-isofox:1.7.1--hdfd78af_1'

    fixConfigSectionForTask(
      substitutions,
      "NEO_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-neo:1.2--hdfd78af_1",
    );
    fixConfigSectionForTask(
      substitutions,
      "BAMTOOLS_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-bam-tools:1.3--hdfd78af_0",
    );
    fixConfigSectionForTask(
      substitutions,
      "LINXREPORT_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/r-linxreport:1.0.0--r43hdfd78af_0",
    );
    fixConfigSectionForTask(
      substitutions,
      "PAVE_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-pave:1.7--hdfd78af_0",
    );
    fixConfigSectionForTask(
      substitutions,
      "ESVEE_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-esvee:1.0--hdfd78af_0",
    );
    fixConfigSectionForTask(
      substitutions,
      "SAMBAMBA_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/sambamba:1.0.1--h6f6fda4_0",
    );
    fixConfigSectionForTask(
      substitutions,
      "COBALT_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-cobalt:2.0--hdfd78af_0",
    );
    fixConfigSectionForTask(
      substitutions,
      "LINX_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-linx:2.0--hdfd78af_0",
    );
    fixConfigSectionForTask(
      substitutions,
      "ISOFOX_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-isofox:1.7.1--hdfd78af_1",
    );
    fixConfigSectionForTask(
      substitutions,
      "AMBER_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-amber:4.1.1--hdfd78af_0",
    );
    fixConfigSectionForTask(
      substitutions,
      "LILAC_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-lilac:1.6--hdfd78af_1",
    );
    fixConfigSectionForTask(
      substitutions,
      "STAR_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/star:2.7.3a--0",
    );
    fixConfigSectionForTask(
      substitutions,
      "PURPLE_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-purple:4.1--hdfd78af_0",
    );
    fixConfigSectionForTask(
      substitutions,
      "VIRUSBREAKEND_DOCKER_IMAGE_URI",
      "quay.io/nf-core/gridss:2.13.2--1",
    );
    fixConfigSectionForTask(
      substitutions,
      "GRIDSS_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/gridss:2.13.2--h50ea8bc_3",
    );
    fixConfigSectionForTask(
      substitutions,
      "CHORD_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-chord:2.1.0--hdfd78af_0",
    );
    fixConfigSectionForTask(
      substitutions,
      "LILAC_EXTRACT_INDEX_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/mulled-v2-4dde50190ae599f2bb2027cb2c8763ea00fb5084:4163e62e1daead7b7ea0228baece715bec295c22-0",
    );
    fixConfigSectionForTask(
      substitutions,
      "LILAC_REALIGN_READS_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/mulled-v2-4dde50190ae599f2bb2027cb2c8763ea00fb5084:4163e62e1daead7b7ea0228baece715bec295c22-0",
    );
    fixConfigSectionForTask(
      substitutions,
      "LILAC_SLICE_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/samtools:1.19.2--h50ea8bc_0",
    );
    fixConfigSectionForTask(
      substitutions,
      "BWAMEM2_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/mulled-v2-4dde50190ae599f2bb2027cb2c8763ea00fb5084:4163e62e1daead7b7ea0228baece715bec295c22-0",
    );
    fixConfigSectionForTask(
      substitutions,
      "REDUX_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-redux:1.1--hdfd78af_1",
    );
    fixConfigSectionForTask(
      substitutions,
      "VIRUSINTERPRETER_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-virus-interpreter:1.7--hdfd78af_0",
    );
    fixConfigSectionForTask(
      substitutions,
      "SAGE_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-sage:4.0--hdfd78af_0",
    );
    fixConfigSectionForTask(
      substitutions,
      "CUPPA_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-cuppa:2.3.1--py311r42hdfd78af_0",
    );
    fixConfigSectionForTask(
      substitutions,
      "ORANGE_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-orange:3.7.1--hdfd78af_0",
    );
    fixConfigSectionForTask(
      substitutions,
      "FASTP_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/fastp:0.23.4--hadf994f_2",
    );
    fixConfigSectionForTask(
      substitutions,
      "SIGS_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-sigs:1.2.1--hdfd78af_1",
    );

    const nextflowConfigTemplate = readFileSync(
      join(__dirname, "resources/nextflow_aws.template.config"),
      { encoding: "utf-8" },
    );
    const nextflowConfigTemplateCompiled = Handlebars.compile(
      nextflowConfigTemplate,
    );
    const nextflowConfig = nextflowConfigTemplateCompiled(substitutions, {});

    this.application = new appconfig.Application(
      this,
      "AppConfigApplication",
      {},
    );
    this.environment = new appconfig.Environment(this, "AppConfigEnvironment", {
      description: "Default environment for this deployment of Oncoanalyser",
      application: this.application,
      // the configurations are templated and deployed via CDK - it is not expected that
      // users will edit, so we can aggressively delete
      deletionProtectionCheck: DeletionProtectionCheck.BYPASS,
    });

    const deploymentStrategy = new appconfig.DeploymentStrategy(
      this,
      "AppConfigDeploymentStrategy",
      {
        deploymentStrategyName: "AllAtOnceAsQuickAsWeCan",
        rolloutStrategy: {
          growthFactor: 100,
          deploymentDuration: Duration.minutes(0),
          // given our nextflow only runs on demand (and only picks up the config on startup),
          // there is no point waiting when we roll out configs
          finalBakeTime: Duration.minutes(0),
        },
      },
    );

    this.hostedConfiguration = new appconfig.HostedConfiguration(
      this,
      "AppConfigHostedConfiguration",
      {
        description:
          "Default configuration for this deployment of Oncoanalyser - this config is autogenerated from a template and should not be edited",
        application: this.application,
        deployTo: [this.environment],
        deploymentStrategy: deploymentStrategy,
        content: appconfig.ConfigurationContent.fromInlineText(nextflowConfig),
      },
    );

    // if a substitution of something like REDUX_DOCKER_IMAGE_URI does not happen - then we will be left with an empty string in the nextflow config
    // as we don't have any real empty strings - we use this to detect missed subs
    //if (nextflowConfig.includes("''"))
    //  throw new Error(
    //    "a docker image substitution was missed in the nextflow config presumably because of a simple name mismatch",
    //  );
  }

  public getEnvironmentVariables(): Record<string, string> {
    return {
      ONCOANALYSER_NEXTFLOW_CONFIG_APPCONFIG_APPLICATION:
        this.application.applicationId,
      ONCOANALYSER_NEXTFLOW_CONFIG_APPCONFIG_ENVIRONMENT:
        this.environment.environmentId,
      ONCOANALYSER_NEXTFLOW_CONFIG_APPCONFIG_CONFIGURATION_PROFILE:
        this.hostedConfiguration.configurationProfileId,
    };
  }
}
