import {Construct} from "constructs"

import {
  Environment,
  Stack,
  StackProps,
  Stage,
  Tags,
} from "aws-cdk-lib";

import * as settings from './settings';
import {BasePipelineStack} from './base-pipeline-stack';

import {OncoanalyserStack} from './pipeline-stacks/oncoanalyser/stack';
import {SashStack} from './pipeline-stacks/sash/stack';
import {StarAlignNfStack} from './pipeline-stacks/star-align-nf/stack';


interface IApplicationBuildStackProps extends StackProps {
  env: Environment;
  envName: string;
  envBuild: Environment;
  dockerTag?: string;
}

interface IBuildStack extends IApplicationBuildStackProps {
  workflowName: string;
  jobQueuePipelineArn: string;
  jobQueueTaskArns: Map<string, string>;
}

export class ApplicationStack extends Stack {
  constructor(scope: Construct, id: string, props: IApplicationBuildStackProps) {
    super(scope, id, props);

    // Create shared resources and add tags
    const stackPipelineBase = new BasePipelineStack(this, 'BasePipelineStack', {
      env: props.env,
    });
    Tags.of(stackPipelineBase).add("Stack", "NextflowStack");

    // Create individual pipeline stacks
    this.buildOncoanalyserStack({
      workflowName: 'oncoanalyser',
      jobQueuePipelineArn: stackPipelineBase.jobQueuePipelineArn,
      jobQueueTaskArns: stackPipelineBase.jobQueueTaskArns,
      ...props,
    });

    this.buildSashStack({
      workflowName: 'sash',
      jobQueuePipelineArn: stackPipelineBase.jobQueuePipelineArn,
      jobQueueTaskArns: stackPipelineBase.jobQueueTaskArns,
      ...props,
    });

    this.buildStarAlignNfStack({
      workflowName: 'star-align-nf',
      jobQueuePipelineArn: stackPipelineBase.jobQueuePipelineArn,
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
    Tags.of(pipelineStack).add('Stack', 'OncoanalyserStack');
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
    Tags.of(pipelineStack).add('Stack', 'SashStack');
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
    Tags.of(pipelineStack).add('Stack', 'StarAlignNfStack');
  }
}

export class ApplicationBuildStage extends Stage {
  constructor(scope: Construct, id: string, props: IApplicationBuildStackProps) {
    super(scope, id, props);

    const applicationStack = new ApplicationStack(this, 'NextflowApplicationStack', props);

    Tags.of(applicationStack).add("Stack", "NextflowStack");
  }
}
