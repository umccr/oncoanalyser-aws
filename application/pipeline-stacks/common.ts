import {join as pathjoin} from "path";

import {Construct} from 'constructs';

import {Environment, Stack, StackProps} from "aws-cdk-lib";
import {DockerImageAsset} from 'aws-cdk-lib/aws-ecr-assets';
import {Repository} from "aws-cdk-lib/aws-ecr";
import {EcrImage} from 'aws-cdk-lib/aws-ecs';

import {ECRDeployment, DockerImageName} from "cdk-ecr-deployment";


interface IDockerImageBuild extends StackProps {
  env: Environment;
  workflowName: string;
  dockerTag?: string;
}

export class DockerImageBuildStack extends Stack {
  public readonly image: EcrImage;

  constructor(scope: Construct, id: string, props: IDockerImageBuild) {
    super(scope, id, props);

    const dockerTag = props.dockerTag || "latest";

    const image = new DockerImageAsset(this, `CDKDockerImage-${props.workflowName}`, {
      directory: pathjoin(__dirname, props.workflowName),
    });

    const dockerDestBase = `${props.env.account}.dkr.ecr.${props.env.region}.amazonaws.com`;

    new ECRDeployment(this, `DeployDockerImage-${props.workflowName}`, {
      src: new DockerImageName(image.imageUri),
      dest: new DockerImageName(`${dockerDestBase}/${props.workflowName}:${dockerTag}`),
    });

    const ecrRepository = Repository.fromRepositoryName(this, `EcrRespository-${props.workflowName}`, props.workflowName);
    this.image = EcrImage.fromEcrRepository(ecrRepository, dockerTag);
  }
}
