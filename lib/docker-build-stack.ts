import { Construct } from 'constructs';
import {
    CfnOutput,
    Environment,
    Stack,
    StackProps,
    Stage,
    Tags
} from "aws-cdk-lib";

import {join as pathjoin} from "path";

import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';

import {
    ECRDeployment,
    DockerImageName
} from "cdk-ecr-deployment";
import {
    StringParameter
} from "aws-cdk-lib/aws-ssm";

interface IDockerBuildStackProps extends StackProps {
    env: Environment
    tag_date: string
    commit_id: string
}

// The Docker Build Stack deploys
// The docker image into the appropriate account under
// <account_id>.dkr.ecr.<region>.amazonaws.com/oncoanalyser:<tag>

export class DockerBuildStack extends Stack {

    public readonly dockerTag: CfnOutput;

    constructor(scope: Construct, id: string, props: IDockerBuildStackProps) {
        super(scope, id, props);

        const image = new DockerImageAsset(this, 'CDKDockerImage', {
            directory: pathjoin(__dirname, '../', 'docker-images', 'oncoanalyser'),
        });

        const docker_dest = new DockerImageName(`${props.env.account}.dkr.ecr.${props.env.region}.amazonaws.com/oncoanalyser:${props.tag_date}--${props.commit_id}`)

        new ECRDeployment(this, 'DeployDockerImage', {
            src: new DockerImageName(image.imageUri),
            dest: docker_dest,
        });

        this.dockerTag = new CfnOutput(this, "DockerURI", {
            value: docker_dest.uri,
        });

        // Add in ssm parameters for batch instance role name
        new StringParameter(
            this,
            `ssm-parameter-docker-tag`,
            {
                parameterName: "/oncoanalyser/docker/tag",
                stringValue: docker_dest.toString()
            }
        )

    }
}

interface DockerBuildStageProps extends StackProps {
    env: Environment,
    tag_date: string,
    commit_id: string
    stack_name: string
}

export class DockerBuildStage extends Stage {

    constructor(
        scope: Construct,
        id: string,
        props: DockerBuildStageProps
    ) {
        super(scope, id, props);

        const docker_build_stack = new DockerBuildStack(this, "DockerBuild", props);

        Tags.of(docker_build_stack).add("Stack", props.stack_name);
    }
}
