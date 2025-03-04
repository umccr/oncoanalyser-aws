/**
 * Define the required Nextflow plugins.
 */
export const NEXTFLOW_PLUGINS: string[] = [
  "nf-amazon@2.9.2",
  "nf-schema@2.3.0",
  "nf-wave@1.7.4",
];

/**
 * Define the master location of the AWS CLI for Nextflow
 */
export const AWS_CLI_BASE_PATH = "/mounted-aws-cli/awscliv2";

/**
 * Define the location (inside tasks) of the scratch area. The underlying
 * batch instances and container setup will need to set this up. For instance
 * they might mount in a NVME etc.
 */
export const SCRATCH_BASE_PATH = "/scratch";
