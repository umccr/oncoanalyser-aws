#!/usr/bin/env node
import 'source-map-support/register';
import {App} from "aws-cdk-lib";

import {
  AWS_ENV_DEV,
  AWS_ENV_BUILD,
  SSM_PARAMETERS,
  NXF_CACHE_BUCKET_DEV,
  NXF_CACHE_PREFIX_DEV,
  NXF_STAGING_BUCKET_DEV,
  NXF_STAGING_PREFIX_DEV,
  REFDATA_BUCKET_DEV,
  NXF_REFDATA_PREFIX_DEV
} from '../constants';
import {NextflowApplicationStack} from "../lib/application-stack";
import {NextflowBuildPipelineStack} from "../lib/pipeline-stack";
import {DockerBuildStack} from "../lib/docker-build-stack";

const app = new App()



const dev_dockerbuild_stack = new DockerBuildStack(app, "DockerDevStack", {
  env: AWS_ENV_DEV,
  stackName: "DockerBuild",
  tag_date: "19700101",
  commit_id: "abcdefg"
});

const dev_application_stack = new NextflowApplicationStack(app, 'NextflowApplicationDevStack', {
  env: AWS_ENV_DEV,
  stack_name: "NextflowStack",
  ssm_parameters: SSM_PARAMETERS["DEV"],
  cache_bucket: NXF_CACHE_BUCKET_DEV,
  cache_prefix: NXF_CACHE_PREFIX_DEV,
  staging_bucket: NXF_STAGING_BUCKET_DEV,
  staging_prefix: NXF_STAGING_PREFIX_DEV,
  refdata_bucket: REFDATA_BUCKET_DEV,
  refdata_prefix: NXF_REFDATA_PREFIX_DEV,
});

const build_pipeline_stack = new NextflowBuildPipelineStack(app, "NextflowBuildPipelineStack", {
  env: AWS_ENV_BUILD
})
