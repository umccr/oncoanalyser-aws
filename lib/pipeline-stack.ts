import {Environment, pipelines, Stack, StackProps} from "aws-cdk-lib";

import {Construct} from "constructs";

import {StringParameter} from "aws-cdk-lib/aws-ssm";

import {Effect, PolicyStatement} from "aws-cdk-lib/aws-iam";

import {LinuxBuildImage} from "aws-cdk-lib/aws-codebuild";

import * as moment from 'moment';

import {
    AWS_ENV_BUILD,
    AWS_ENV_PROD,
    AWS_ENV_STG,
    NXF_CACHE_BUCKET_STG,
    NXF_CACHE_BUCKET_PROD,
    NXF_CACHE_PREFIX_STG,
    NXF_CACHE_PREFIX_PROD,
    REFDATA_BUCKET_STG,
    REFDATA_BUCKET_PROD,
    NXF_REFDATA_PREFIX_STG,
    NXF_REFDATA_PREFIX_PROD,
    NXF_STAGING_BUCKET_STG,
    NXF_STAGING_BUCKET_PROD,
    NXF_STAGING_PREFIX_STG,
    NXF_STAGING_PREFIX_PROD,
    SSM_PARAMETERS
} from "../constants";
import {DockerBuildStage} from "./docker-build-stack";
import {NextflowApplicationBuildStage} from "./application-stack";

interface INextflowBuildPipelineStackStackProps extends StackProps {
    env: Environment
}

export class NextflowBuildPipelineStack extends Stack {
    constructor(
        scope: Construct,
        id: string,
        props: INextflowBuildPipelineStackStackProps,
    ) {
        super(scope, id, props);

        // The pipeline initialisation has been copied verbatim from https://github.com/umccr/holmes/blob/main/holmes-pipeline-stack.ts
        // Credit Andrew Patterson

        // these are *build* parameters that we either want to re-use across lots of stacks, or are
        // 'sensitive' enough we don't want them checked into Git - but not sensitive enough to record as a Secret
        const codeStarArn = StringParameter.valueFromLookup(
            this,
            "codestar_github_arn"
        );

        const input_source = pipelines.CodePipelineSource.connection("umccr/nextflow-stack", "main", {
            connectionArn: codeStarArn,
            codeBuildCloneOutput: true
        })

        const pipeline = new pipelines.CodePipeline(this, "NextFlowBuildPipeline", {
            // should normally be commented out - only use when debugging pipeline itself
            // selfMutation: false,
            // turned on because our stack makes docker assets
            dockerEnabledForSynth: true,
            dockerEnabledForSelfMutation: true,
            synth: new pipelines.CodeBuildStep("Synth", {
                // Use a connection created using the AWS console to authenticate to GitHub
                // Other sources are available.
                input: input_source,
                commands: [
                    "npm ci",
                    // our cdk is configured to use ts-node - so we don't need any build step - just synth
                    "npx cdk synth",
                ],
                env: {
                    // See https://github.com/aws/aws-cdk/issues/20643#issuecomment-1219565988 for more info as to how this works
                    // We need to call this source attribute then we use it below to generate the tag name
                    "COMMIT_ID":  input_source.sourceAttribute("CommitId"),
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


        // Build docker image (shared stack between staging and dev)
        const tag_date = (moment(new Date())).format('YYYYMMDDHHmmSS')
        const dockerStage = new DockerBuildStage(this, "BuildDockerImage", {
            env: AWS_ENV_BUILD,
            stack_name: "oncoanalyser",
            // See https://github.com/aws/aws-cdk/issues/20643#issuecomment-1219565988 for more info as to how this works
            tag: tag_date + "--" + "#{Source@umccr_nextflow-stack.CommitId}"
        })

        // Add Docker stage to pipeline
        pipeline.addStage(
            dockerStage
        )

        // staging
        {
            // Testing coming
            const stgStage = new NextflowApplicationBuildStage(this, "BuildStg", {
                env: AWS_ENV_STG,
                stack_name: "oncoanalyser",
                cache_bucket: NXF_CACHE_BUCKET_STG,
                cache_prefix: NXF_CACHE_PREFIX_STG,
                staging_bucket: NXF_STAGING_BUCKET_STG,
                staging_prefix: NXF_STAGING_PREFIX_STG,
                refdata_bucket: REFDATA_BUCKET_STG,
                refdata_prefix: NXF_REFDATA_PREFIX_STG,
                ssm_parameters: SSM_PARAMETERS["STG"]
            });

            pipeline.addStage(stgStage);
        }

        // production
        {
            const prodStage = new NextflowApplicationBuildStage(this, "BuildProd", {
                env: AWS_ENV_PROD,
                stack_name: "oncoanalyser",
                cache_bucket: NXF_CACHE_BUCKET_PROD,
                cache_prefix: NXF_CACHE_PREFIX_PROD,
                staging_bucket: NXF_STAGING_BUCKET_PROD,
                staging_prefix: NXF_STAGING_PREFIX_PROD,
                refdata_bucket: REFDATA_BUCKET_PROD,
                refdata_prefix: NXF_REFDATA_PREFIX_PROD,
                ssm_parameters: SSM_PARAMETERS["PROD"]
            });

            pipeline.addStage(prodStage, {
                pre: [new pipelines.ManualApprovalStep("PromoteToProd")],
            });
        }

        // Build pipeline
        pipeline.buildPipeline()
    }
}
