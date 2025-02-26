#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";

import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { Oncoanalyser, OncoanalyserProps } from "../lib/oncoanalyser";

export class OncoanalyserStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    settings: cdk.StackProps & OncoanalyserProps,
  ) {
    super(scope, id, settings);

    new Oncoanalyser(this, "Oncoanalyser", settings);
  }
}

const app = new cdk.App();
const oncoanalyserStack = new OncoanalyserStack(app, "OncoanalyserStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  bucket: {
    bucket: "umccr-temp-dev",
    inputPrefix: "inputs",
    outputPrefix: "outputs",
    refDataPrefix: "refdata",
  },
  docker: {
    ecrRepo: "oncoanalyser",
    dockerImageTag: "latest-pmcc",
  },
  maxPipelineCpus: 64,
  maxTaskCpus: 256,
  pipelineInstanceTypes: [
    ec2.InstanceType.of(ec2.InstanceClass.R6A, ec2.InstanceSize.LARGE),
  ],
  taskInstanceTypes: [
    ec2.InstanceType.of(ec2.InstanceClass.R6ID, ec2.InstanceSize.LARGE),
  ],
  vpc: undefined,
});

cdk.Tags.of(oncoanalyserStack).add("Stack", "OncoanalyserStack");
