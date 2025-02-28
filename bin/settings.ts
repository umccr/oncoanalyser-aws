import { OncoanalyserProps } from "../lib/application-stack";
import * as ec2 from "aws-cdk-lib/aws-ec2";

/**
 * Configurable settings for the oncoanalyser construct.
 */
export const SETTINGS: OncoanalyserProps = {
  bucket: {
    bucket: "umccr-temp-dev",
    inputPrefix: "inputs",
    outputPrefix: "outputs",
    refDataPrefix: "refdata",
  },
  // NOTE(SW): temporary reduction for testing during dev
  //pipelineMaxCpus: 64,
  //taskMaxCpus: 256,
  pipelineMaxCpus: 2,
  taskMaxCpus: 4,
  pipelineInstanceTypes: [
    ec2.InstanceType.of(ec2.InstanceClass.R6A, ec2.InstanceSize.LARGE),
  ],
  pipelineQueueName:  "oncoanalyser-pipeline",
  pipelineJobDefinitionName: "oncoanalyser-job-definition",
  taskInstanceTypes: [
    ec2.InstanceType.of(ec2.InstanceClass.R6I, ec2.InstanceSize.XLARGE),
  ],
  vpc: undefined,
  gitRepo: "https://github.com/scwatts/oncoanalyser-aws-stack-testing",
  gitBranch: "aws-stack-testing"
};
