import { OncoanalyserProps } from "../lib";
import { InstanceClass, InstanceSize, InstanceType } from "aws-cdk-lib/aws-ec2";

/**
 * Configurable settings for the oncoanalyser construct.
 */
export const SETTINGS: OncoanalyserProps = {
  // use the default VPC of the account
  vpc: undefined,
  buckets: {
    inputBucket: {
      name: "umccr-temp-dev",
      prefix: "inputs",
      importExisting: true,
    },
    outputBucket: {
      name: "umccr-temp-dev",
      prefix: "outputs",
      importExisting: true,
    },
    referenceBucket: {
      name: "umccr-temp-dev",
      prefix: "refdata",
      importExisting: true,
      readOnly: false,
    },
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
