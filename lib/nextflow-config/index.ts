import { join } from "path";
import { readFileSync } from "fs";
import * as Handlebars from "handlebars";
import { Construct } from "constructs";
import * as appconfig from "aws-cdk-lib/aws-appconfig";
import { DeletionProtectionCheck } from "aws-cdk-lib/aws-appconfig";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import { IRole } from "aws-cdk-lib/aws-iam";
import { IJobQueue } from "aws-cdk-lib/aws-batch";
import { Duration } from "aws-cdk-lib";
import {
  AWS_CLI_BASE_PATH,
  NEXTFLOW_PLUGINS,
  SCRATCH_BASE_PATH,
} from "../dependencies";
import { OncoanalyserWorkflowBuckets } from "../oncoanalyser-bucket";

export interface NextflowConfigProps {
  /**
   * The S3 bucket to use for the Nextflow environment.
   */
  readonly buckets: OncoanalyserWorkflowBuckets;
  /**
   * The role to use for the tasks instance.
   */
  readonly tasksInstanceRole: IRole;
  /**
   * The job queue to use for the tasks.
   */
  readonly tasksJobQueue: IJobQueue;
  /**
   * If true, instructs the construct to make local ECR assets mirroring the standard task Docker images.
   * otherwise, the pipeline will launch Docker images directly from their public repository (like quay.io or dockerhub)
   */
  readonly copyToLocalEcr?: boolean;
}

/**
 * Construct that creates an AppConfig configuration for the Nextflow pipeline environment.
 */
export class NextflowConfigConstruct extends Construct {
  /**
   * The AppConfig application that is created.
   */
  private readonly application: appconfig.Application;
  /**
   * The AppConfig environment that is created.
   */
  private readonly environment: appconfig.Environment;
  /**
   * The AppConfig hosted configuration that is created.
   */
  private readonly hostedConfiguration: appconfig.HostedConfiguration;
  /**
   * The substitutions dictionary that is used for various templating.
   */
  private readonly substitutions: Record<string, any>;

  constructor(scope: Construct, id: string, props: NextflowConfigProps) {
    super(scope, id);

    this.substitutions = this.createSubstitutions(props);

    const nextflowConfig = this.processTemplate(
      join(__dirname, "nextflow-aws.template.config"),
    );

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
  }

  public retrieveEnvironmentVariables(): Record<string, string> {
    return {
      ONCOANALYSER_NEXTFLOW_CONFIG_APPCONFIG_APPLICATION:
        this.application.applicationId,
      ONCOANALYSER_NEXTFLOW_CONFIG_APPCONFIG_ENVIRONMENT:
        this.environment.environmentId,
      ONCOANALYSER_NEXTFLOW_CONFIG_APPCONFIG_CONFIGURATION_PROFILE:
        this.hostedConfiguration.configurationProfileId,
    };
  }

  private createSubstitutions(props: NextflowConfigProps): Record<string, any> {
    // we build a dictionary of substitution values that can be inserted into the config by handlebars
    // we first insert here the AWS values like role ARN etc that are needed by the Nextflow
    // pipeline engine
    const subs: Record<string, any> = {
      BATCH_INSTANCE_TASK_ROLE_ARN: props.tasksInstanceRole.roleArn,
      BATCH_JOB_QUEUE_NAME: props.tasksJobQueue.jobQueueName,
      S3_BUCKET_NAME: props.buckets.inputBucket.bucket.bucketName,
      // S3_BUCKET_REFDATA_PREFIX: props.buckets.referenceDataBucket.,
      PLUGINS: NEXTFLOW_PLUGINS,
      AWS_CLI_BASE_PATH: AWS_CLI_BASE_PATH,
      SCRATCH_BASE_PATH: SCRATCH_BASE_PATH,
    };

    // Makes the insertion into the nextflow config of the Docker image URI
    // for each task.
    const fixConfigSectionForTask = (
      configName: string,
      dockerImageUri: string,
    ) => {
      if (props.copyToLocalEcr) {
        // we create a "thin" Docker image that essentially is exactly the same layers as the source
        // docker image - but is maintained as an asset within the CDK setup
        // this means CDK will handle deploying it to ECR for us
        const imageAsset = new DockerImageAsset(this, configName, {
          directory: join(__dirname, "thin-docker"),
          platform: Platform.LINUX_AMD64,
          // because the image base name is passed into Docker - the actual Docker checksum
          // itself won't change even when the image base does... so we need to add the name/tag into the hash
          extraHash: dockerImageUri,
          buildArgs: {
            // pass this through to Docker forming the base of the image we are constructing
            BASE_IMAGE: dockerImageUri,
          },
        });

        subs[configName] = imageAsset.imageUri;
      } else {
        // we will just directly reference the Docker image in quay.io etc
        subs[configName] = dockerImageUri;
      }
    };

    fixConfigSectionForTask(
      "NEO_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-neo:1.2--hdfd78af_1",
    );
    fixConfigSectionForTask(
      "BAMTOOLS_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-bam-tools:1.3--hdfd78af_0",
    );
    fixConfigSectionForTask(
      "LINXREPORT_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/r-linxreport:1.0.0--r43hdfd78af_0",
    );
    fixConfigSectionForTask(
      "PAVE_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-pave:1.7--hdfd78af_0",
    );
    fixConfigSectionForTask(
      "ESVEE_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-esvee:1.0--hdfd78af_0",
    );
    fixConfigSectionForTask(
      "SAMBAMBA_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/sambamba:1.0.1--h6f6fda4_0",
    );
    fixConfigSectionForTask(
      "SAMTOOLS_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/samtools:1.18--h50ea8bc_",
    );
    fixConfigSectionForTask(
      "STAR_ALIGN_IMAGE_URI",
      "quay.io/biocontainers/star:2.7.3a--0",
    );
    fixConfigSectionForTask(
      "GRIPSS_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-gripss:2.4--hdfd78af_00",
    );
    fixConfigSectionForTask(
      "COBALT_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-cobalt:2.0--hdfd78af_0",
    );
    fixConfigSectionForTask(
      "LINX_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-linx:2.0--hdfd78af_0",
    );
    fixConfigSectionForTask(
      "ISOFOX_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-isofox:1.7.1--hdfd78af_1",
    );
    fixConfigSectionForTask(
      "AMBER_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-amber:4.1.1--hdfd78af_0",
    );
    fixConfigSectionForTask(
      "LILAC_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-lilac:1.6--hdfd78af_1",
    );
    fixConfigSectionForTask(
      "STAR_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/star:2.7.3a--0",
    );
    fixConfigSectionForTask(
      "PURPLE_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-purple:4.1--hdfd78af_0",
    );
    fixConfigSectionForTask(
      "VIRUSBREAKEND_DOCKER_IMAGE_URI",
      "quay.io/nf-core/gridss:2.13.2--1",
    );
    fixConfigSectionForTask(
      "GRIDSS_INDEX_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/gridss:2.13.2--h50ea8bc_3",
    );
    fixConfigSectionForTask(
      "GATK4_MARKDUPLICATES_IMAGE_URI",
      "quay.io/biocontainers/gatk4:4.4.0.0--py36hdfd78af_0",
    );
    fixConfigSectionForTask(
      "CHORD_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-chord:2.1.0--hdfd78af_0",
    );
    fixConfigSectionForTask(
      "LILAC_EXTRACT_INDEX_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/mulled-v2-4dde50190ae599f2bb2027cb2c8763ea00fb5084:4163e62e1daead7b7ea0228baece715bec295c22-0",
    );
    fixConfigSectionForTask(
      "LILAC_REALIGN_READS_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/mulled-v2-4dde50190ae599f2bb2027cb2c8763ea00fb5084:4163e62e1daead7b7ea0228baece715bec295c22-0",
    );
    fixConfigSectionForTask(
      "LILAC_SLICE_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/samtools:1.19.2--h50ea8bc_0",
    );
    fixConfigSectionForTask(
      "BWAMEM2_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/mulled-v2-4dde50190ae599f2bb2027cb2c8763ea00fb5084:4163e62e1daead7b7ea0228baece715bec295c22-0",
    );
    fixConfigSectionForTask(
      "REDUX_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-redux:1.1--hdfd78af_1",
    );
    fixConfigSectionForTask(
      "VIRUSINTERPRETER_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-virus-interpreter:1.7--hdfd78af_0",
    );
    fixConfigSectionForTask(
      "SAGE_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-sage:4.0--hdfd78af_0",
    );
    fixConfigSectionForTask(
      "CUPPA_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-cuppa:2.3.1--py311r42hdfd78af_0",
    );
    fixConfigSectionForTask(
      "ORANGE_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-orange:3.7.1--hdfd78af_0",
    );
    fixConfigSectionForTask(
      "FASTP_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/fastp:0.23.4--hadf994f_2",
    );
    fixConfigSectionForTask(
      "SIGS_DOCKER_IMAGE_URI",
      "quay.io/biocontainers/hmftools-sigs:1.2.1--hdfd78af_1",
    );

    return subs;
  }

  /**
   * Takes a path to a template/text file in Handlebars format and returns the
   * content of the file with substitutions made.
   *
   * @param templatePath
   */
  private processTemplate(templatePath: string): string {
    const templateContent = readFileSync(templatePath, { encoding: "utf-8" });
    const templateCompiled = Handlebars.compile(templateContent, {
      strict: true,
    });
    return templateCompiled(this.substitutions, {});
  }
}
