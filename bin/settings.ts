import { OncoanalyserProps } from "../lib/oncoanalyser";
import * as ec2 from "aws-cdk-lib/aws-ec2";

/**
 * Configurable settings for the oncoanalyser construct.
 */
export const SETTINGS: OncoanalyserProps = {
  // use the default VPC of the account
  vpc: undefined,
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
    InstanceType.of(InstanceClass.R6A, InstanceSize.LARGE),
  ],
  pipelineQueueName: "oncoanalyser-pipeline",
  pipelineJobDefinitionName: "oncoanalyser-job-definition",
  taskInstanceTypes: [InstanceType.of(InstanceClass.R6I, InstanceSize.XLARGE)],
  gitRepo: "https://github.com/scwatts/oncoanalyser-aws-stack-testing",
  gitBranch: "aws-stack-testing",
};
