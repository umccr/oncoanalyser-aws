import 'source-map-support/register';

import {Construct} from "constructs"

import {
  Environment,
  Stack,
  StackProps,
  Stage,
  Tags,
} from "aws-cdk-lib";
import {StringParameter} from "aws-cdk-lib/aws-ssm";

import {getSettings} from './settings';
import {BasePipelineStack} from './base-pipeline-stack';
import {OncoanalyserStack} from './pipeline-stacks/oncoanalyser/stack';
import {StarAlignNfStack} from './pipeline-stacks/star-align-nf/stack';


interface IApplicationBuildStackProps extends StackProps {
  env: Environment;
  envName: string;
  envBuild: Environment;
  dockerTag?: string;
}

export class ApplicationStack extends Stack {
  constructor(scope: Construct, id: string, props: IApplicationBuildStackProps) {
    super(scope, id, props);

    // Create shared resources and add atgs
    const stackPipelineBase = new BasePipelineStack(this, 'BasePipelineStack', {
      env: props.env,
    });
    Tags.of(stackPipelineBase).add("Stack", "NextflowStack");

    // Create individual workflow stacks
    this.buildOncoanalyserStack(
      props.env,
      props.envName,
      props.envBuild,
      stackPipelineBase.jobQueueTaskArns,
    );

    this.buildStarAlignNfStack(
      props.env,
      props.envName,
      props.envBuild,
      stackPipelineBase.jobQueueTaskArns,
    );
  }

  buildOncoanalyserStack(
    env: Environment,
    envName: string,
    envBuild: Environment,
    jobQueueTaskArns: Map<string, string>,
  ) {
    // Get settings
    const workflowName = 'oncoanalyser';
    const settings = getSettings(envName, workflowName);

    // Create stack and add tags
    const pipelineStack = new OncoanalyserStack(this, 'OncoanalyserStack', {
      workflowName: workflowName,
      jobQueueTaskArns: jobQueueTaskArns,
      env: env,
      envBuild: envBuild,
      cache_bucket: settings.s3Data.get('nfCacheBucket')!,
      cache_prefix: settings.s3Data.get('nfCachePrefix')!,
      staging_bucket: settings.s3Data.get('nfStagingBucket')!,
      staging_prefix: settings.s3Data.get('nfStagingPrefix')!,
      output_bucket: settings.s3Data.get('nfOutputBucket')!,
      output_prefix: settings.s3Data.get('nfOutputPrefix')!,
      refdata_bucket: settings.s3Data.get('refdataBucket')!,
      refdata_prefix: settings.s3Data.get('refdataPrefix')!,
    });
    Tags.of(pipelineStack).add('Stack', 'OncoanalyserStack');

    // Store SSM parameters
    for (let [key, value] of settings.ssmParameters) {
      new StringParameter(this, `SsmParameter-${workflowName}-${key.replace(/^.*\//, '')}`, {
        parameterName: key,
        stringValue: value,
      });
    }
  }

  buildStarAlignNfStack(
    env: Environment,
    envName: string,
    envBuild: Environment,
    jobQueueTaskArns: Map<string, string>,
  ) {
    // Get settings
    const workflowName = 'star-align-nf';
    const settings = getSettings(envName, workflowName);

    // Create stack and add tags
    const pipelineStack = new StarAlignNfStack(this, 'StarAlignNfStack', {
      workflowName: workflowName,
      jobQueueTaskArns: jobQueueTaskArns,
      env: env,
      envBuild: envBuild,
      cache_bucket: settings.s3Data.get('nfCacheBucket')!,
      cache_prefix: settings.s3Data.get('nfCachePrefix')!,
      staging_bucket: settings.s3Data.get('nfStagingBucket')!,
      staging_prefix: settings.s3Data.get('nfStagingPrefix')!,
      output_bucket: settings.s3Data.get('nfOutputBucket')!,
      output_prefix: settings.s3Data.get('nfOutputPrefix')!,
      refdata_bucket: settings.s3Data.get('refdataBucket')!,
      refdata_prefix: settings.s3Data.get('refdataPrefix')!,
    });
    Tags.of(pipelineStack).add('Stack', 'StarAlignNfStack');

    // Store SSM parameters
    for (let [key, value] of settings.ssmParameters) {
      new StringParameter(this, `SsmParameter-${workflowName}-${key.replace(/^.*\//, '')}`, {
        parameterName: key,
        stringValue: value,
      });
    }
  }
}

export class ApplicationBuildStage extends Stage {
  constructor(scope: Construct, id: string, props: IApplicationBuildStackProps) {
    super(scope, id, props);

    const applicationStack = new ApplicationStack(this, 'NextflowApplicationStack', props);

    Tags.of(applicationStack).add("Stack", "NextflowStack");
  }
}
