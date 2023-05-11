// TODO(SW): VPC, security group, etc

import {Environment} from "aws-cdk-lib";

interface IEnvironmentExtra extends Environment {
  name?: string;
}

export const AWS_ENV_DEV: IEnvironmentExtra = {
  name: "dev",
  account: "843407916570",
  region: "ap-southeast-2",
};

export const AWS_ENV_BUILD: IEnvironmentExtra = {
  account: "383856791668",
  region: "ap-southeast-2",
};

export const AWS_ENV_STG: IEnvironmentExtra = {
  name: "staging",
  account: "455634345446",
  region: "ap-southeast-2",
};

export const AWS_ENV_PROD: IEnvironmentExtra = {
  name: "prod",
  account: "472057503814",
  region: "ap-southeast-2",
};
