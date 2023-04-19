import 'source-map-support/register';

import {OncoanalyserStack} from './oncoanalyser-stack';
import {SharedStack} from './shared-stack';
import {Environment, Stack, StackProps, Tags, Stage} from "aws-cdk-lib";
import {Construct} from "constructs"
import {StringParameter} from "aws-cdk-lib/aws-ssm";

interface NextflowApplicationBuildStackProps extends StackProps {
    env: Environment,
    docker_tag?: string,
    stack_name: string,
    cache_bucket: string,
    cache_prefix: string,
    staging_bucket: string,
    staging_prefix: string,
    refdata_bucket: string,
    refdata_prefix: string,
    ssm_parameters: Map<string, string>
}


export class NextflowApplicationStack extends Stack {
    constructor(
        scope: Construct,
        id: string,
        props: NextflowApplicationBuildStackProps,
    ) {
        super(scope, id, props);

        // Add in docker tag that we've collected from the inputs
        if (props.docker_tag !== undefined){
            new StringParameter(
                this,
                `ssm-parameter-docker-tag`,
                {
                    parameterName: "/oncoanalyser/docker/tag",
                    stringValue: props.docker_tag
                }
            )
        }


        const shared = new SharedStack(this, 'NextflowSharedStack', {
            env: props.env,
        });

        const oncoanalyser = new OncoanalyserStack(this, 'OncoanalyserStack', {
            jobQueueTaskArns: shared.jobQueueTaskArns,
            env: props.env,
            cache_bucket: props.cache_bucket,
            cache_prefix: props.cache_prefix,
            staging_bucket: props.staging_bucket,
            staging_prefix: props.staging_prefix,
            refdata_bucket: props.refdata_bucket,
            refdata_prefix: props.refdata_prefix
        });

        // Add tags
        Tags.of(shared).add("Stack", props.stack_name);
        Tags.of(oncoanalyser).add("Stack", props.stack_name);

        // Add in SSM Parameters
        props.ssm_parameters.forEach((value: string, key: string) => {
            new StringParameter(
                this,
                `ssm-parameter-${key.split("/").pop()}`,
                {
                    parameterName: key,
                    stringValue: value,
                }
            )
        });

        // Add in ssm parameters for batch instance role name
        new StringParameter(
            this,
            `ssm-parameter-batch-instance-role`,
            {
                parameterName: "/oncoanalyser/iam/batch-instance-role-name",
                stringValue: oncoanalyser.roleBatchInstanceTaskName.toString()
            }
        )
    }
}

interface NextflowApplicationBuildStageProps extends StackProps {
    env: Environment,
    docker_tag: string,
    stack_name: string,
    cache_bucket: string,
    cache_prefix: string,
    staging_bucket: string,
    staging_prefix: string,
    refdata_bucket: string,
    refdata_prefix: string,
    ssm_parameters: Map<string, string>
}

export class NextflowApplicationBuildStage extends Stage {
    constructor(
        scope: Construct,
        id: string,
        props: NextflowApplicationBuildStageProps
    ) {
        super(scope, id, props);

        const application_stack = new NextflowApplicationStack(this, "ApplicationStack", props);

        Tags.of(application_stack).add("Stack", props.stack_name);
    }
}
