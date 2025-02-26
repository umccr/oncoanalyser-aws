export const AWS_ACCOUNT = '843407916570';
export const AWS_REGION = 'ap-southeast-2';

export const VPC_NAME = 'main-vpc';
export const SECURITY_GROUP_NAME = 'main-vpc-sg-outbound';

export const S3_BUCKET_NAME = 'umccr-temp-dev';
export const S3_BUCKET_INPUT_PREFIX = 'inputs';
export const S3_BUCKET_OUTPUT_PREFIX = 'outputs';
export const S3_BUCKET_REFDATA_PREFIX = 'refdata';

export const PIPELINE_INSTANCE_TYPES = ['r6a.large'];
export const TASK_INSTANCE_TYPES = ['r6id.large'];

export const ECR_REPO = 'oncoanalyser';
export const DOCKER_IMAGE_TAG = 'latest-pmcc';

export const MAX_PIPELINE_CE_VCPUS = 64;
export const MAX_TASK_CE_VCPUS = 256;
