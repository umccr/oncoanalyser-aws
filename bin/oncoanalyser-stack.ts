#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import * as settings from '../settings';
import { ApplicationStack } from '../lib/application-stack';

const app = new App()
new ApplicationStack(app, 'ApplicationStack', {
  env: {
    account: settings.AWS_ACCOUNT,
    region: settings.AWS_REGION,
  },
});

cdk.Tags.of(ApplicationStack).add('Stack', 'OncoanalyserStack');
