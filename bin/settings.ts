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
    //maxPipelineCpus: 64,
    //maxTaskCpus: 256,
    maxPipelineCpus: 2,
    maxTaskCpus: 4,
    pipelineInstanceTypes: [
        ec2.InstanceType.of(ec2.InstanceClass.R6A, ec2.InstanceSize.LARGE),
    ],
    taskInstanceTypes: [
        ec2.InstanceType.of(ec2.InstanceClass.R6I, ec2.InstanceSize.XLARGE),
    ],
    vpc: undefined,
};
