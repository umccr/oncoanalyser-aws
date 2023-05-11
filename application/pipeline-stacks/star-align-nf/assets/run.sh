#!/usr/bin/env bash
set -euo pipefail

print_help_text() {
  cat <<EOF
Usage example: run.sh --sample_id STR --fastq_fwd FILE --fastq_rev FILE --output_dir S3_PREFIX

Options:
  --sample_id STR               Tumor WTS identifier

  --fastq_fwd FILE              Input tumor WTS forward FASTQ
  --fastq_rev FILE              Input tumor WTS reverse FASTQ

  --output_dir S3_PREFIX        Output S3 prefix
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in

    --sample_id)
      sample_id="$2"
      shift 1
    ;;

    --fastq_fwd)
      fastq_fwd="$2"
      shift 1
    ;;
    --fastq_rev)
      fastq_rev="$2"
      shift 1
    ;;

    --output_dir)
      output_dir="${2%/}"
      shift 1
    ;;

    -h|--help)
      print_help_text
      exit 0
  esac
  shift
done

required_args='
sample_id
fastq_fwd
fastq_rev
output_dir
'

missing_args=()
for argname in ${required_args}; do
  if [[ -z "${!argname:-}" ]]; then
    missing_args+=( "${argname}" )
  fi
done

if [[ ${#missing_args[@]} -gt 0 ]]; then
  print_help_text

  missing_arg_str="$( \
    echo -n "--${missing_args[0]}";
    for arg in "${missing_args[@]:1}"; do
      echo -n ", --${arg}";
    done \
  )"

  plurality="$( \
    if [[ "${#missing_args[@]}" -gt 1 ]]; then
      echo are;
      else echo is;
    fi \
  )"
  echo -e "\nERROR: ${missing_arg_str} ${plurality} required" 1>&2
  exit 1
fi

## SSM Parameter functions
get_ssm_parameter_value(){
  aws ssm get-parameter \
    --name "$1" \
    --output json |
  jq --raw-output '.Parameter | .Value'
}

get_cache_bucket_from_ssm(){
  get_ssm_parameter_value "/nextflow_stack/star-align-nf/cache_bucket"
}

get_cache_prefix_from_ssm(){
  get_ssm_parameter_value "/nextflow_stack/star-align-nf/cache_prefix"
}

get_dest_bucket_from_ssm(){
  get_ssm_parameter_value "/nextflow_stack/star-align-nf/staging_bucket"
}

get_dest_prefix_from_ssm(){
  get_ssm_parameter_value "/nextflow_stack/star-align-nf/staging_prefix"
}

get_batch_instance_role_arn_from_ssm(){
  get_ssm_parameter_value "/nextflow_stack/star-align-nf/batch_task_instance_role_arn"
}

get_batch_instance_profile_arn_from_ssm(){
  get_ssm_parameter_value "/nextflow_stack/star-align-nf/batch_task_instance_profile_arn"
}

get_ica_access_token_from_secrets_manager(){
  aws secretsmanager get-secret-value \
    --secret-id IcaSecretsPortal \
    --output json | \
  jq --raw-output \
    '
      .SecretString
    '
}

get_star_index_from_ssm(){
  get_ssm_parameter_value "/nextflow_stack/star-align-nf/refdata_star_index"
}

stage_gds_fp() {
  local gds_fp="${1}"
  local gds_dp="${gds_fp%/*}/"

  # Local vars
  local dst_bucket
  local dst_key_base
  local dst_dp
  local dst_fp
  local gds_volume_name
  local gds_path
  local gds_folder_id
  local creds
  local src_fp


  dst_bucket="$(get_dest_bucket_from_ssm)"
  dst_key_base="$(get_dest_prefix_from_ssm)"

  dst_dp="${dst_bucket}/${dst_key_base}"
  dst_fp="${dst_dp}/${gds_fp##*/}"

  echo s3://${dst_fp}

  if [[ -z "${ICA_ACCESS_TOKEN:-}" ]]; then
    ICA_ACCESS_TOKEN="$(get_ica_access_token_from_secrets_manager)"
    export ICA_ACCESS_TOKEN
  fi

  # Get gds folder id from data path
  gds_volume_name="$( \
    python3 -c "from urllib.parse import urlparse; print(urlparse('${gds_dp}').netloc)" \
  )"
  gds_path="$( \
    python3 -c "from urllib.parse import urlparse; print(urlparse('${gds_dp}').path)" \
  )"
  gds_folder_id="$( \
    curl --fail --silent --location --show-error \
      --request "GET" \
      --header "Accept: application/json" \
      --header "Authorization: Bearer ${ICA_ACCESS_TOKEN}" \
      --url "https://aps2.platform.illumina.com/v1/folders?volume.name=${gds_volume_name}&path=${gds_path}" | \
    jq --raw-output \
      '
        .items |
        map(.id) |
        .[]
      ' \
  )"

  # Get ICA credentials for folder
  creds="$( \
    curl --fail --silent --location --show-error \
      --request "PATCH" \
      --header 'Accept: application/json' \
      --header "Authorization: Bearer ${ICA_ACCESS_TOKEN}" \
      --header "Content-Type: application/json-patch+json" \
      --url "https://aps2.platform.illumina.com/v1/folders/${gds_folder_id}?include=ObjectStoreAccess" \
      --data '{}' | \
    jq --raw-output \
      '.objectStoreAccess.awsS3TemporaryUploadCredentials' \
  )"


  mkdir -p ~/.config/rclone/

  cat <<EOF > ~/.config/rclone/rclone.conf
[ica]
type = s3
provider = AWS
access_key_id = $(jq --raw-output '.access_Key_Id' <<< "${creds}")
secret_access_key = $(jq --raw-output '.secret_Access_Key' <<< "${creds}")
session_token = $(jq --raw-output '.session_Token' <<< "${creds}")
region = ap-southeast-2

[aws]
type = s3
provider = AWS
env_auth = true
region = ap-southeast-2
no_check_bucket = true
EOF

  src_fp="$( \
    jq --raw-output \
      --arg gds_fp "${gds_fp##*/}" \
      '"\(.bucketName)/\(.keyPrefix)\($gds_fp)"' \
      <<< "${creds}" \
  )"

  echo "staging ${gds_fp} to s3://${dst_fp}" 1>&2
  rclone copy --s3-upload-concurrency 8 \
    "ica:${src_fp}" "aws:${dst_dp}/"
}

# Final upload data function
upload_data() {
  aws s3 sync \
    --no-progress \
    --no-follow-symlinks \
    --exclude='software/*' \
    --exclude='assets/*' \
    --exclude='work/*' \
    ./ "${output_dir}/"
}

## END FUNCTIONS ##

# Get the current aws region
# https://stackoverflow.com/questions/4249488/find-region-from-within-an-ec2-instance
export AWS_REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)

## LOCAL EXECUTOR WORKAROUND ##

# When Nextflow runs a job using the local executor with Docker enabled, I have configured behaviour such that that a
# new Docker container from the host service is launched. This means that all local Nextflow processes inherit the EC2
# instance IAM profile, which can only be set prior at the Batch compute environment creation; in this case that is the
# non-permissive Nextflow pipeline role. This means to run Nextflow processes locally that can r/w to S3 (e.g. when
# using Fusion, S3 output directory, etc), we must set the EC2 instance IAM role to a profile with such permissions.
# Here I associate the instance with the OncoanalyserStack task role. There may be better approaches to achieve this.

instance_id=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
association_id=$(
  aws ec2 describe-iam-instance-profile-associations | \
    jq --raw-output \
      --arg instance_id "${instance_id}" \
      '
        .IamInstanceProfileAssociations |
        map(
          select(.InstanceId == $instance_id)
        ) |
        map(
          .AssociationId
        ) |
        .[]
      '
)
aws ec2 replace-iam-instance-profile-association 1>/dev/null \
  --association-id "${association_id}" \
  --iam-instance-profile "Arn=$(get_batch_instance_profile_arn_from_ssm)"

## END LOCAL EXECUTOR WORKAROUND ##

## SAMPLESHEET PREP ##

input_file_args='
fastq_fwd
fastq_rev
'

declare -A input_fps
for fp_name in ${input_file_args}; do
  fp=${!fp_name:-}
  if [[ -z ${fp} ]]; then
    continue
  fi

  if [[ ${fp} =~ ^gds://.* ]]; then
    input_fps[${fp_name}]=$(stage_gds_fp "${fp}")
  else
    input_fps[${fp_name}]=${fp}
  fi
done


cat <<EOF > samplesheet.csv
sample_id,fastq_fwd,fastq_rev
${sample_id},${input_fps['fastq_fwd']},${input_fps['fastq_rev']}
EOF

## END SAMPLESHEET PREP ##

## CREATE NEXTFLOW CONFIG ##

TEMPLATE_CONFIG_PATH="/root/pipeline/assets/nextflow_aws.template.config"
NEXTFLOW_CONFIG_PATH="nextflow.config"

sed \
  --regexp-extended \
  --expression "s#__BATCH_INSTANCE_ROLE__#$(get_batch_instance_role_arn_from_ssm)#g" \
  "${TEMPLATE_CONFIG_PATH}" > "${NEXTFLOW_CONFIG_PATH}"

## END CREATE NEXTFLOW CONFIG ##

## RUN NEXTFLOW ##

trap upload_data EXIT

nextflow \
  -config ${NEXTFLOW_CONFIG_PATH} \
  run software/star-align-nf/main.nf \
    -ansi-log false \
    -profile docker \
    -work-dir s3://$(get_cache_bucket_from_ssm)/$(get_cache_prefix_from_ssm)/ \
    --monochrome_logs \
    --input samplesheet.csv \
    --star_index_path s3://$(get_star_index_from_ssm)/ \
    --outdir ${output_dir%/}/output/

# Upload data cleanly
upload_data

## END RUN NEXTFLOW ##

# Then exit cleanly
trap - EXIT
