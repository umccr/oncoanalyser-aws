#!/usr/bin/env node
import 'source-map-support/register';

import * as cdk from 'aws-cdk-lib';

import { OncoanalyserStack } from '../lib/oncoanalyser-stack';
import { SharedStack } from '../lib/shared-stack';

import { AWS_DEV_ACCOUNT, AWS_DEV_REGION } from '../constants';


const envDev = {
  account: AWS_DEV_ACCOUNT,
  region: AWS_DEV_REGION,
}

const app = new cdk.App();
const shared = new SharedStack(app, 'NextflowSharedStack', {
  env: envDev,
});

const oncoanalyser = new OncoanalyserStack(app, 'OncoanalyserStack', {
  jobQueueTaskArns: shared.jobQueueTaskArns,
  env: envDev,
});
