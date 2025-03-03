import * as path from "path";

import { Construct } from "constructs";
import { NEXTFLOW_PLUGINS } from "../dependencies";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import {
  EcsEc2ContainerDefinition,
  EcsJobDefinition,
} from "aws-cdk-lib/aws-batch";
import { ContainerImage } from "aws-cdk-lib/aws-ecs";
import { Size } from "aws-cdk-lib";
import { IRole } from "aws-cdk-lib/aws-iam";

export interface OncoanalyserJobDefinitionProps {
  /**
   * The IAM role to use for the pipeline job definition.
   */
  readonly jobRole: IRole;
  /**
   * The name of the pipeline job definition.
   */
  readonly pipelineJobDefinitionName: string;
  /**
   * The environment variables to set in the container.
   */
  readonly environment: Record<string, string>;
  /**
   * The git repository of oncoanalyser to launch from nextflow.
   */
  readonly gitRepo: string;
  /**
   * The git branch of oncoanalyser to launch from nextflow.
   */
  readonly gitBranch: string;
}

export class OncoanalyserJobDefinition extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: OncoanalyserJobDefinitionProps,
  ) {
    super(scope, id);

    // create Docker image for pipeline
    const image = new DockerImageAsset(this, "DockerImage", {
      directory: path.join(__dirname, ".."),
      file: "oncoanalyser-job-definition/Dockerfile",
      platform: Platform.LINUX_AMD64,
      buildArgs: {
        NEXTFLOW_PLUGINS: NEXTFLOW_PLUGINS.join(","),
        SOFTWARE_GIT_REPO: props.gitRepo,
        SOFTWARE_GIT_BRANCH: props.gitBranch,
      },
    });

    // Create job definition for pipeline execution
    new EcsJobDefinition(this, "JobDefinition", {
      jobDefinitionName: props.pipelineJobDefinitionName,
      container: new EcsEc2ContainerDefinition(
        this,
        "EcsEc2ContainerDefinition",
        {
          cpu: 1,
          image: ContainerImage.fromDockerImageAsset(image),
          command: ["true"],
          memory: Size.gibibytes(1),
          jobRole: props.jobRole,
          environment: props.environment,
        },
      ),
    });
  }
}
