#!/usr/bin/env bash

set -euo pipefail

## GLOBALS ##

ICA_BASE_URL="https://aps2.platform.illumina.com"
MAIN_NF_PATH="software/sash/main.nf"
TEMPLATE_CONFIG_PATH="/root/pipeline/assets/nextflow_aws.template.config"
NEXTFLOW_CONFIG_PATH="nextflow.config"

## END GLOBALS ##

## USAGE / ARGS ##

print_help_text() {
  cat <<EOF
Usage example: run.sh --subject_id STR --tumor_sample_id STR --tumor_library_id STR --normal_sample_id STR --normal_library_id STR --dragen_somatic_dir DIR --dragen_normal_dir DIR --oncoanalyser_dir DIR

Options:
  --portal_run_id STR           Portal run ID (out-of-band Portal run ID will be generated if not provided)

  --subject_id STR              Subject identifier

  --tumor_sample_id STR         Tumor WGS sample id
  --tumor_library_id STR        Tumor WGS library id

  --normal_sample_id STR        Normal WGS sample id
  --normal_library_id STR       Normal WGS library id

  --dragen_somatic_dir DIR      Input DRAGEN somatic directory
  --dragen_germline_dir DIR     Input DRAGEN germline directory
  --oncoanalyser_dir DIR        Input oncoanalyser directory

  --resume_nextflow_dir FILE    Previous .nextflow/ directory used to resume a run (S3 URI)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in

    --portal_run_id)
      portal_run_id="$2"
      shift 1
    ;;

    --subject_id)
      subject_id="$2"
      shift 1
    ;;

    --tumor_sample_id)
      tumor_sample_id="$2"
      shift 1
    ;;
    --tumor_library_id)
      tumor_library_id="$2"
      shift 1
    ;;

    --normal_sample_id)
      normal_sample_id="$2"
      shift 1
    ;;
    --normal_library_id)
      normal_library_id="$2"
      shift 1
    ;;

    --dragen_somatic_dir)
      dragen_somatic_dir="$2"
      shift 1
    ;;
    --dragen_germline_dir)
      dragen_germline_dir="$2"
      shift 1
    ;;
    --oncoanalyser_dir)
      oncoanalyser_dir="$2"
      shift 1
    ;;

    --resume_nextflow_dir)
      resume_nextflow_dir="${2%/}"
      shift 1
    ;;

    -h|--help)
      print_help_text
      exit 0
  esac
  shift
done

required_args='
subject_id
tumor_sample_id
tumor_library_id
normal_sample_id
normal_library_id
dragen_somatic_dir
dragen_germline_dir
oncoanalyser_dir
'

missing_args=()
for argname in ${required_args}; do
  if [[ -z "${!argname:-}" ]]; then
    missing_args+=( "${argname}" )
  fi
done

if [[ ${#missing_args[@]} -gt 0 ]]; then
  print_help_text

  # Get missing arguments
  missing_arg_str="$( \
    echo -n "--${missing_args[0]}";
    for arg in "${missing_args[@]:1}"; do
      echo -n ", --${arg}";
    done \
  )"

  # More than one missing arg?
  # Lets make sure our grammar is right
  plurality="$( \
    if [[ "${#missing_args[@]}" -gt 1 ]]; then
      echo are;
      else echo is;
    fi \
  )"
  echo -e "\nERROR: ${missing_arg_str} ${plurality} required" 1>&2
  exit 1
fi

## END USAGE / ARGS ##

## FUNCTIONS ##

get_output_directory() {
  echo "$(get_nf_bucket_name_from_ssm)/analysis_data/${subject_id}/sash/${portal_run_id}/${tumor_library_id}_${normal_library_id}"
}

get_staging_directory() {
  echo "$(get_nf_bucket_name_from_ssm)/temp_data/${subject_id}/sash/${portal_run_id}/staging"
}

get_scratch_directory() {
  echo "$(get_nf_bucket_name_from_ssm)/temp_data/${subject_id}/sash/${portal_run_id}/scratch"
}

generate_portal_run_id() {
  echo $(date '+%Y%m%d')$(openssl rand -hex 4)
}

get_ssm_parameter_value() {
  aws ssm get-parameter \
    --name "$1" \
    --output json |
  jq --raw-output '.Parameter | .Value'
}

get_nf_bucket_name_from_ssm() {
  get_ssm_parameter_value "/nextflow_stack/sash/nf_bucket_name"
}

get_nf_bucket_temp_prefix_from_ssm() {
  get_ssm_parameter_value "/nextflow_stack/sash/nf_bucket_temp_prefix"
}

get_nf_bucket_output_prefix_from_ssm() {
  get_ssm_parameter_value "/nextflow_stack/sash/nf_bucket_output_prefix"
}

get_refdata_basepath() {
  get_ssm_parameter_value "/nextflow_stack/sash/refdata_basepath"
}

get_batch_instance_role_arn_from_ssm() {
  get_ssm_parameter_value "/nextflow_stack/sash/batch_instance_task_role_arn"
}

get_batch_instance_profile_arn_from_ssm() {
  get_ssm_parameter_value "/nextflow_stack/sash/batch_instance_task_profile_arn"
}

get_ica_access_token_from_secrets_manager() {
  aws secretsmanager get-secret-value \
    --secret-id IcaSecretsPortal \
    --output json | \
  jq --raw-output \
    '
      .SecretString
    '
}

stage_gds_fp() {

  # NOTE(SW): this expects only DRAGEN directories

  local gds_dp="${1%/}/"
  local gds_dn="$(sed 's#^.*/##' <<< ${gds_dp%/})/"

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

  dst_dp_base="$(get_staging_directory)"
  dst_dp="${dst_dp_base}/${gds_dn%/}"

  echo s3://${dst_dp}/

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
      --url "${ICA_BASE_URL}/v1/folders?volume.name=${gds_volume_name}&path=${gds_path}" | \
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
      --url "${ICA_BASE_URL}/v1/folders/${gds_folder_id}?include=ObjectStoreAccess" \
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

  src_dp="$( \
    jq --raw-output \
      '"\(.bucketName)/\(.keyPrefix)"' \
      <<< "${creds}" \
  )"

  echo "staging ${gds_dp} to s3://${dst_dp}/" 1>&2
  rclone copy \
    --s3-upload-concurrency 8 \
    --filter='+ /*.csv'  \
    --filter='+ /*hard-filtered.vcf.gz'  \
    --filter='+ /*hard-filtered.vcf.gz.tbi'  \
    --filter='- *'  \
    "ica:${src_dp}" "aws:${dst_dp}/"
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

if [[ -z "${portal_run_id:-}" ]]; then
  portal_run_id="$(generate_portal_run_id)"
fi

output_dir="s3://$(get_output_directory)"

## SET AWS REGION ##

# Get the current aws region
# https://stackoverflow.com/questions/4249488/find-region-from-within-an-ec2-instance
export AWS_REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)

## END SET AWS REGION ##

## LOCAL EXECUTOR WORKAROUND ##

# This stack runs the main Nextflow pipeline process as a Batch job and therefore the pipeline process is executed
# within a Docker container. Individual pipeline tasks are generally submitted as Batch jobs but can also be run
# locally. Running a process locally is useful for very short jobs. In order to run a process locally, the pipeline must
# execute the task within a Docker container. I have configured the Docker container that executes the Nextflow pipeline
# process to use the host Docker service for local jobs.
#
# A consequence of this set up is that that all task run locally using Docker containers inherit the EC2 instance IAM
# profile, which can only be set at creation of the Batch compute environment during stack deployment. In this case the
# Batch compute environment uses the non-permissive Nextflow pipeline role. This means to run Nextflow processes locally
# that can r/w to S3 (e.g. when using Fusion, S3 output directory, etc) we must manually set the EC2 instance IAM role
# at runtime to a profile with the required permissions. Here I associate the instance with the OncoanalyserStack task
# role. There may be better approaches to achieve this.

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

## RESUME BLOCK ##

if [[ -n "${resume_nextflow_dir:-}" ]]; then
  aws s3 sync \
    --no-progress \
    "${resume_nextflow_dir}/" ./.nextflow/
fi

## END RESUME BLOCK ##

## STAGE DATA ##

input_file_args='
dragen_somatic_dir
dragen_germline_dir
oncoanalyser_dir
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

## END STAGE DATA ##

## SAMPLESHEET PREP ##

cat <<EOF > samplesheet.csv
id,subject_name,sample_name,filetype,filepath
${subject_id}_${tumor_sample_id},${subject_id},${tumor_sample_id},dragen_somatic_dir,${input_fps['dragen_somatic_dir']}
${subject_id}_${tumor_sample_id},${subject_id},${normal_sample_id},dragen_germline_dir,${input_fps['dragen_germline_dir']}
${subject_id}_${tumor_sample_id},${subject_id},${tumor_sample_id},oncoanalyser_dir,${input_fps['oncoanalyser_dir']}
EOF

## END SAMPLESHEET PREP ##

## NEXTFLOW ARGS ##

nextflow_args=''
if [[ -n "${resume_nextflow_dir:-}" ]]; then
  nextflow_args+=' -resume'
fi

## END NEXFLOW ARGS ##

## CREATE NEXTFLOW CONFIG ##
sed \
  --regexp-extended \
  --expression \
    "
      s#__BATCH_INSTANCE_ROLE__#$(get_batch_instance_role_arn_from_ssm)#g
    " \
  "${TEMPLATE_CONFIG_PATH}" > "${NEXTFLOW_CONFIG_PATH}"

## END CREATE NEXTFLOW CONFIG ##
trap upload_data EXIT

nextflow \
  -config "${NEXTFLOW_CONFIG_PATH}" \
  run "${MAIN_NF_PATH}" \
    -ansi-log "false" \
    --monochrome_logs \
    -profile "docker" \
    -work-dir "s3://$(get_scratch_directory)/" \
    ${nextflow_args} \
    --input "samplesheet.csv" \
    --ref_data_path "s3://$(get_refdata_basepath)/" \
    --outdir "${output_dir}/"

# Upload data cleanly
upload_data

# Then exit cleanly
trap - EXIT
