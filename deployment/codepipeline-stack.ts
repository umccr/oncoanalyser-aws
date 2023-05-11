import {Construct} from "constructs";

import * as moment from 'moment';

import {Environment, pipelines, Stack, StackProps} from "aws-cdk-lib";
import {StringParameter} from "aws-cdk-lib/aws-ssm";
import {Effect, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {ComputeType, LinuxBuildImage} from "aws-cdk-lib/aws-codebuild";

import {AWS_ENV_STG, AWS_ENV_PROD} from './settings-umccr';
import {ApplicationBuildStage} from "../application/application-stack";


interface ICodePipelineStackProps extends StackProps {
    env: Environment
}

export class CodePipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: ICodePipelineStackProps) {
    super(scope, id, props);

    // The pipeline initialisation has been heavily lifted from https://github.com/umccr/holmes/blob/main/holmes-pipeline-stack.ts
    // Credit Andrew Patterson

    // these are *build* parameters that we either want to re-use across lots of stacks, or are
    // 'sensitive' enough we don't want them checked into Git - but not sensitive enough to record as a Secret
    const codeStarArn = StringParameter.valueFromLookup(
      this,
      "codestar_github_arn"
    );

    const inputSource = pipelines.CodePipelineSource.connection("umccr/nextflow-stack", "main", {
      connectionArn: codeStarArn,
      codeBuildCloneOutput: true
    })

    const pipeline = new pipelines.CodePipeline(this, "NextflowBuildPipeline", {
      // should normally be commented out - only use when debugging pipeline itself
      // selfMutation: false,
      // turned on because our stack makes docker assets
      dockerEnabledForSynth: true,
      dockerEnabledForSelfMutation: true,
      synth: new pipelines.CodeBuildStep("Synth", {
        // Use a connection created using the AWS console to authenticate to GitHub
        // Other sources are available.
        input: inputSource,
        commands: [
          "npm ci",
          // our cdk is configured to use ts-node - so we don't need any build step - just synth
          "npx cdk synth",
        ],
        env: {
          // See https://github.com/aws/aws-cdk/issues/20643#issuecomment-1219565988 for more info as to how this works
          // We need to call this source attribute then we use it below to generate the tag name
          "COMMIT_ID":  inputSource.sourceAttribute("CommitId"),
        },
        rolePolicyStatements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["sts:AssumeRole"],
            resources: ["*"],
            //conditions: {
            //  StringEquals: {
            //    "iam:ResourceTag/aws-cdk:bootstrap-role": "lookup",
            //  },
            //},
          }),
        ],
      }),
      codeBuildDefaults: {
          buildEnvironment: {
            buildImage: LinuxBuildImage.STANDARD_6_0,
            computeType: ComputeType.LARGE
          },
          // we need to give the codebuild engines permissions to assume a role in DEV - in order that they
          // can invoke the tests - we don't know the name of the role yet (as it is built by CDK) - so we
          // are quite permissive (it is limited to one non-prod account though)
          rolePolicy: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["sts:AssumeRole"],
              resources: [`arn:aws:iam::${props.env.account}:role/*`],
            }),
          ],
      },
      crossAccountKeys: true,
    });

    // Build Docker images for each workflow with a Wave; images hosted on build account and shared across staging and production
    const tagDate = (moment(new Date())).format('YYYYMMDDHHmmSS')
    // Collect the commit id (use 'latest' if running synth locally)
    const commitId = (process.env.CODEBUILD_RESOLVED_SOURCE_VERSION || "latest").substring(0, 8)
    const dockerTag = tagDate + "--" + commitId

    // Staging account
    {
      const stgStage = new ApplicationBuildStage(this, "BuildStg", {
        env: AWS_ENV_STG,
        envName: AWS_ENV_STG.name!,
        envBuild: props.env,
        dockerTag: dockerTag,
      });

      pipeline.addStage(stgStage);
    }

    // Production account
    {
      const prodStage = new ApplicationBuildStage(this, "BuildProd", {
        env: AWS_ENV_PROD,
        envName: AWS_ENV_PROD.name!,
        envBuild: props.env,
        dockerTag: dockerTag,
      });

      pipeline.addStage(prodStage, {
        pre: [new pipelines.ManualApprovalStep("PromoteToProd")],
      });
    }

    // Build pipeline
    pipeline.buildPipeline()
  }
}
