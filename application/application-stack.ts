import { Construct } from 'constructs'

import * as cdk from 'aws-cdk-lib';

import * as baseStack from './base-pipeline-stack';
import * as settings from './settings';

import { OncoanalyserStack } from './pipeline-stacks/oncoanalyser/stack';
import { SashStack } from './pipeline-stacks/sash/stack';
import { StarAlignNfStack } from './pipeline-stacks/star-align-nf/stack';


interface IApplicationBuildStackProps extends cdk.StackProps {
  env: cdk.Environment;
  envName: string;
  envBuild: cdk.Environment;
  dockerTag?: string;
}

interface IBuildStack extends IApplicationBuildStackProps {
  workflowName: string;
  jobQueuePipelineArns: string[];
  jobQueueTaskArns: string[];
}


export class ApplicationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IApplicationBuildStackProps) {
    super(scope, id, props);

    // Create shared resources and add tags
    const stackPipelineBase = new baseStack.BasePipelineStack(this, 'BasePipelineStack', {
      env: props.env,
    });
    cdk.Tags.of(stackPipelineBase).add('Stack', 'NextflowStack');

    // Create individual pipeline stacks
    this.buildOncoanalyserStack({
      workflowName: 'oncoanalyser',
      jobQueuePipelineArns: stackPipelineBase.jobQueuePipelineArns,
      jobQueueTaskArns: stackPipelineBase.jobQueueTaskArns,
      ...props,
    });

    this.buildSashStack({
      workflowName: 'sash',
      jobQueuePipelineArns: stackPipelineBase.jobQueuePipelineArns,
      jobQueueTaskArns: stackPipelineBase.jobQueueTaskArns,
      ...props,
    });

    this.buildStarAlignNfStack({
      workflowName: 'star-align-nf',
      jobQueuePipelineArns: stackPipelineBase.jobQueuePipelineArns,
      jobQueueTaskArns: stackPipelineBase.jobQueueTaskArns,
      ...props,
    });
  }

  buildOncoanalyserStack(args: IBuildStack) {
    const stackSettings = new settings.Oncoanalyser(args.envName, args.workflowName);
    const s3Data = stackSettings.getS3Data();

    const pipelineStack = new OncoanalyserStack(this, 'OncoanalyserStack', {
      ...args,
      pipelineVersionTag: stackSettings.versionTag,
      nfBucketName: s3Data.get('nfBucketName')!,
      nfPrefixTemp: s3Data.get('nfPrefixTemp')!,
      nfPrefixOutput: s3Data.get('nfPrefixOutput')!,
      refdataBucketName: s3Data.get('refdataBucketName')!,
      refdataPrefix: s3Data.get('refdataPrefix')!,
      ssmParameters: stackSettings.getSsmParameters(),
    });
    cdk.Tags.of(pipelineStack).add('Stack', 'OncoanalyserStack');
  }

  buildSashStack(args: IBuildStack) {
    const stackSettings = new settings.Sash(args.envName, args.workflowName);
    const s3Data = stackSettings.getS3Data();

    const pipelineStack = new StarAlignNfStack(this, 'SashStack', {
      ...args,
      pipelineVersionTag: stackSettings.versionTag,
      nfBucketName: s3Data.get('nfBucketName')!,
      nfPrefixTemp: s3Data.get('nfPrefixTemp')!,
      nfPrefixOutput: s3Data.get('nfPrefixOutput')!,
      refdataBucketName: s3Data.get('refdataBucketName')!,
      refdataPrefix: s3Data.get('refdataPrefix')!,
      ssmParameters: stackSettings.getSsmParameters(),
    });
    cdk.Tags.of(pipelineStack).add('Stack', 'SashStack');
  }

  buildStarAlignNfStack(args: IBuildStack) {
    const stackSettings = new settings.StarAlignNf(args.envName, args.workflowName);
    const s3Data = stackSettings.getS3Data();

    const pipelineStack = new StarAlignNfStack(this, 'StarAlignNfStack', {
      ...args,
      pipelineVersionTag: stackSettings.versionTag,
      nfBucketName: s3Data.get('nfBucketName')!,
      nfPrefixTemp: s3Data.get('nfPrefixTemp')!,
      nfPrefixOutput: s3Data.get('nfPrefixOutput')!,
      refdataBucketName: s3Data.get('refdataBucketName')!,
      refdataPrefix: s3Data.get('refdataPrefix')!,
      ssmParameters: stackSettings.getSsmParameters(),
    });
    cdk.Tags.of(pipelineStack).add('Stack', 'StarAlignNfStack');
  }
}


export class ApplicationBuildStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props: IApplicationBuildStackProps) {
    super(scope, id, props);

    const applicationStack = new ApplicationStack(this, 'NextflowApplicationStack', props);

    cdk.Tags.of(applicationStack).add('Stack', 'NextflowStack');
  }
}
