#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import * as settings from '../lib/settings';
import * as stack from '../lib/application-stack';

const app = new cdk.App()
const oncoanalyserStack = new stack.ApplicationStack(app, 'OncoanalyserStack', {
  env: {
    account: settings.AWS_ACCOUNT,
    region: settings.AWS_REGION,
  },
});

cdk.Tags.of(oncoanalyserStack).add('Stack', 'OncoanalyserStack');
