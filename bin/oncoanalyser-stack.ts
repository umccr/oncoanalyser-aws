#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";

import { Construct } from "constructs";
import { Oncoanalyser, OncoanalyserProps } from "../lib/oncoanalyser";
import { SETTINGS } from "./settings";

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
  ...SETTINGS,
});

cdk.Tags.of(oncoanalyserStack).add("Stack", "OncoanalyserStack");
