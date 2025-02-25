#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import * as settings from '../settings';
import { ApplicationStack } from '../lib/application-stack';

const app = new cdk.App()
const stack = new ApplicationStack(app, 'OncoanalyserStack', {
  env: {
    account: settings.AWS_ACCOUNT,
    region: settings.AWS_REGION,
  },
});

cdk.Tags.of(stack).add('Stack', 'OncoanalyserStack');
