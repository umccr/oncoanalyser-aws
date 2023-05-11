#!/usr/bin/env node
import 'source-map-support/register';

import {App} from "aws-cdk-lib";

import {AWS_ENV_DEV, AWS_ENV_BUILD} from './settings-umccr';
import {ApplicationStack} from "../application/application-stack";
import {CodePipelineStack} from "./codepipeline-stack";


const app = new App()

const devApplicationSatck = new ApplicationStack(app, 'NextflowApplicationDevStack', {
  env: AWS_ENV_DEV,
  envName: AWS_ENV_DEV.name!,
  envBuild: AWS_ENV_DEV,
});

const buildStack = new CodePipelineStack(app, "NextflowBuildStack", {
  env: AWS_ENV_BUILD
})
