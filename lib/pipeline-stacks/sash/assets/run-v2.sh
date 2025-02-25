#!/usr/bin/env bash

# Set up to fail
set -euo pipefail

## GLOBALS ##
MAIN_NF_PATH="software/sash/main.nf"
TEMPLATE_CONFIG_PATH="/root/pipeline/assets/nextflow_aws.template.config"
NEXTFLOW_CONFIG_PATH="aws.config"

# BASE REQUIREMENTS
REQUIRED_INPUTS_ARGS=( \
  "subject_id" \
  "tumor_dna_sample_id" \
  "normal_dna_sample_id" \
  "dragen_somatic_uri" \
  "dragen_germline_uri" \
  "oncoanalyser_dna_uri" \
)

REQUIRED_ENGINE_PARAMETER_ARGS=( \
  "portal_run_id" \
  "output_results_dir" \
  "output_scratch_dir" \
)

# INTERMEDIATE FILES
SAMPLESHEET_CSV_PATH="samplesheet.csv"
NEXTFLOW_PARAMS_PATH="nextflow.params.json"
CUSTOM_CONFIG_PATH="custom.config"

## END GLOBALS ##

## FUNCTIONS ##
print_help_text() {
  cat <<EOF
Usage example: run-v2.sh --manifest-json-str '{"inputs": {"mode": "wgts"...}, "engine_parameters": {"portal_run_id": ...}}'

Options:
  --manifest-json-str STR           Manifest json

Documentation:
  Manifest json should look like the following:

{
   "inputs": {
     "subject_id": "<subject_id>", // Required
     "tumor_dna_sample_id": "<tumor_sample_id>",  // Required if analysis_type is set to DNA or DNA/RNA
     "normal_dna_sample_id": "<normal_sample_id>",  // Required if analysis_type is set to DNA or DNA/RNA
     "dragen_somatic_uri": "<dragen_somatic_dir>"  // Required if analysis_type is set to DNA/RNA
     "dragen_germline_uri": "<dragen_germline_dir>"  // Required if analysis_type is set to DNA/RNA
     "oncoanalyser_dna_uri": "<oncoanalyser_dir>"  // Required if analysis_type is set to DNA/RNA
   },
   "engine_parameters": {
     "portal_run_id": "<portal_run_id>",  // Always required
     "output_results_dir": "<output_results_dir>",  // Always required
     "output_scratch_dir": "<output_scratch_dir>",  // Always required
     "custom_config_str":  "<custom_config_str>"  // Optional
     "resume_nextflow_uri": "<resume_nextflow_uri>"  // Optional
   }
}

EOF
}

cleanup(){
  : '
  Upload data to the output results dir and then exit with failure
  '
  local output_results_dir="${1}"
  upload_data "${output_results_dir}"
  exit 1
}

echo_stderr(){
  : '
  Write input to stderr
  '
  echo -e "${@}" 1>&2
}

### JQ FUNCTIONS ###
bash_array_to_jq_list(){
  : '
  Given a bash array, convert the bash array to a list of strings
  '
  printf '%s\n' "${@}" | \
  jq \
    --raw-input --compact-output \
    --slurp \
    --raw-output \
    '
      split("\n")[:-1]
    '
}

jq_to_csv(){
  : '
  Credit to
  https://stackoverflow.com/a/32965227/6946787
  AND
  https://unix.stackexchange.com/a/507625
  '
  jq --raw-output \
   '
      (map(keys) | add | unique) as $cols |
      map(
        . as $row | $cols | map($row[.])
      ) as $rows |
      $cols, $rows[] |
      @tsv |
      gsub("\t"; ",")
    ' < /dev/stdin
}

check_required_input_args(){
  : '
  Check that each of the required inputs args are present in the manifest json
  '
  jq --raw-output \
    --exit-status \
    --argjson required_input_args "$(bash_array_to_jq_list "${REQUIRED_INPUTS_ARGS[@]}")" \
    '
      .inputs as $inputs |
      all($required_input_args[]; in($inputs))
    ' <<< "${1}" 1>/dev/null
}

check_required_engine_parameters_args(){
  : '
  Check that each of the required engine_parameters args are present in the manifest json
  '
  jq --raw-output \
    --exit-status \
    --argjson required_engine_parameters "$(bash_array_to_jq_list "${REQUIRED_ENGINE_PARAMETER_ARGS[@]}")" \
    '
      .engine_parameters as $engine_parameters |
      all($required_engine_parameters[]; in($engine_parameters))
    ' <<< "${1}" 1>/dev/null
}

## Input functions
get_subject_id(){
  : '
  Get the subject id from the manifest json
  '
  jq --raw-output \
    --exit-status \
    '.inputs.subject_id' <<< "${1}"
}

get_tumor_dna_sample_id(){
  : '
  Get the tumor dna sample id from the manifest json
  '
  jq --raw-output \
    --exit-status \
    '.inputs.tumor_dna_sample_id' <<< "${1}"
}

get_normal_dna_sample_id(){
  : '
  Get the normal dna sample id from the manifest json
  '
  jq --raw-output \
    --exit-status \
    '.inputs.normal_dna_sample_id' <<< "${1}"
}

get_dragen_somatic_uri(){
  : '
  Get the dragen somatic uri from the manifest json
  '
  jq --raw-output \
    --exit-status \
    '.inputs.dragen_somatic_uri' <<< "${1}"
}

get_dragen_germline_uri(){
  : '
  Get the dragen germline uri from the manifest json
  '
  jq --raw-output \
    --exit-status \
    '.inputs.dragen_germline_uri' <<< "${1}"
}

get_oncoanalyser_dna_uri(){
  : '
  Get the oncoanalyser dna uri from the manifest json
  '
  jq --raw-output \
    --exit-status \
    '.inputs.oncoanalyser_dna_uri' <<< "${1}"
}

## Engine parameter functions
get_portal_run_id(){
  : '
  Get the portal run id from the manifest json
  '
  jq --raw-output \
    --exit-status \
    '.engine_parameters.portal_run_id' <<< "${1}"
}

get_output_results_dir(){
  : '
  Get the output results dir from the manifest json
  '
  jq --raw-output \
    --exit-status \
    '.engine_parameters.output_results_dir' <<< "${1}"
}

get_output_scratch_dir(){
  : '
  Get the output scratch dir from the manifest json
  '
  jq --raw-output \
    --exit-status \
    '.engine_parameters.output_scratch_dir' <<< "${1}"
}

get_custom_config(){
  : '
  Get the custom config from the manifest json
  '
  jq --raw-output \
    '.engine_parameters.custom_config_str' <<< "${1}"
}

get_resume_nextflow_uri(){
  : '
  Get the custom config from the manifest json
  '
  jq --raw-output \
    '.engine_parameters.resume_nextflow_uri' <<< "${1}"
}

generate_samplesheet(){
  : '
  Given the manifest json, generate the samplesheet for wgts mode / dna analysis type

  We return the following columns

  id,subject_name,sample_name,filetype,filepath
  '
  local manifest_json="${1}"

  jq --raw-output \
    '
      [
        {
          "id": "\(.inputs.tumor_dna_sample_id)_\(.inputs.normal_dna_sample_id)",
          "subject_name": .inputs.subject_id,
          "sample_name": .inputs.tumor_dna_sample_id,
          "filetype": "dragen_somatic_dir",
          "filepath": .inputs.dragen_somatic_uri
        },
        {
          "id": "\(.inputs.tumor_dna_sample_id)_\(.inputs.normal_dna_sample_id)",
          "subject_name": .inputs.subject_id,
          "sample_name": .inputs.normal_dna_sample_id,
          "filetype": "dragen_germline_dir",
          "filepath": .inputs.dragen_germline_uri
        },
        {
          "id": "\(.inputs.tumor_dna_sample_id)_\(.inputs.normal_dna_sample_id)",
          "subject_name": .inputs.subject_id,
          "sample_name": .inputs.tumor_dna_sample_id,
          "filetype": "oncoanalyser_dir",
          "filepath": .inputs.oncoanalyser_dna_uri
        }
      ]
    ' <<< "${manifest_json}" | \
    jq_to_csv > "${SAMPLESHEET_CSV_PATH}"
}

generate_standard_args(){
  : '
  Generate the standard nextflow args
  '
  local output_results_dir="${1}"
  local ref_data_hmf_data_path

  # Set ref data path
  ref_data_hmf_data_path="s3://$(get_refdata_basepath)/"

  jq --null-input --raw-output \
    --arg ref_data_hmf_data_path "${ref_data_hmf_data_path%/}/" \
    --arg output_results_dir "${output_results_dir%/}/" \
    --arg samplesheet_csv "${SAMPLESHEET_CSV_PATH}" \
    '
      {
        "monochrome_logs": true,
        "input": $samplesheet_csv,
        "ref_data_path": $ref_data_hmf_data_path,
        "outdir": $output_results_dir
      }
    '
}

generate_nextflow_params(){
  : '
  Generate the nextflow args specific to the mode / analysis combination
  For sash analysis, simply extend the nextflow args
  '
  local output_results_dir="${1}"

  jq --null-input --raw-output \
      --argjson stdargs "$(generate_standard_args "${output_results_dir%/}/")" \
      '
        $stdargs
      ' \
  > "${NEXTFLOW_PARAMS_PATH}"
}

create_nextflow_config() {
  : '
  Given a portal run id, generate the nextflow config file
  '
  local portal_run_id="${1}"
  local batch_instance_role_arn

  batch_instance_role_arn="$(get_batch_instance_role_arn_from_ssm)"

  sed \
  --regexp-extended \
  --expression \
    "
      s#__BATCH_INSTANCE_ROLE__#${batch_instance_role_arn}#g;
      s#__PORTAL_RUN_ID__#${portal_run_id}#g;
    " \
  "${TEMPLATE_CONFIG_PATH}" > "${NEXTFLOW_CONFIG_PATH}"
}

### END JQ FUNCTIONS ###

### AWS FUNCTIONS ###

get_ssm_parameter_value() {
  aws ssm get-parameter \
    --name "$1" \
    --output json |
  jq --raw-output '.Parameter | .Value'
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

# Final upload data function
upload_data() {
  : '
  Upload the results to the output_results_dir
  '
  local output_results_dir="${1}"

  aws s3 sync \
    --no-progress \
    --no-follow-symlinks \
    --exclude='software/*' \
    --exclude='assets/*' \
    --exclude='work/*' \
    ./ "${output_results_dir%/}/"
}

### END AWS FUNCTIONS ###

## END FUNCTIONS ##

## GET / CHECK ARGS ##

MANIFEST_JSON=""

while [ $# -gt 0 ]; do
  case "$1" in
    --manifest-json)
      MANIFEST_JSON="$2"
      shift 1
    ;;
    -h|--help)
      print_help_text
      exit 0
  esac
  shift
done

# Load manifest json
if ! MANIFEST_JSON="$( \
  jq --raw-output <<< "${MANIFEST_JSON}" \
)"; then
  print_help_text
  echo_stderr "\nERROR: Could not load the manifest json"
  exit 1
fi

# Check required inputs args
if ! check_required_input_args "${MANIFEST_JSON}"; then
  print_help_text
  echo_stderr "\nERROR: Required inputs are missing"
  exit 1
fi

# Check required engine_parameters args
if ! check_required_engine_parameters_args "${MANIFEST_JSON}"; then
  print_help_text
  echo_stderr "\nERROR: Required engine_parameters are missing"
  exit 1
fi

## END GET / CHECK ARGS ##

## MISC SETUP ##

# Get IMDSv2 session token to make metadata requests
IMDS_TOKEN="$( \
  curl -s -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" http://169.254.169.254/latest/api/token \
)"

## END MISC SETUP ##


## SET AWS REGION ##

# Get the current aws region
# https://stackoverflow.com/questions/4249488/find-region-from-within-an-ec2-instance
AWS_REGION=$(curl -s -H "X-aws-ec2-metadata-token: ${IMDS_TOKEN}" http://169.254.169.254/latest/meta-data/placement/region)
export AWS_REGION

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

instance_id=$(curl -s -H "X-aws-ec2-metadata-token: ${IMDS_TOKEN}" http://169.254.169.254/latest/meta-data/instance-id)
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


## START SAMPLESHEET AND NEXTFLOW ARGS ##

generate_samplesheet "${MANIFEST_JSON}"
generate_nextflow_params "$(get_output_results_dir "${MANIFEST_JSON}")"

## END SAMPLESHEET AND NEXTFLOW ARGS  ##

## CREATE NEXTFLOW CONFIGS ##
create_nextflow_config "$(get_portal_run_id "${MANIFEST_JSON}")"

config_args_array=( \
  "-config" "${NEXTFLOW_CONFIG_PATH}" \
)

nf_run_args_array=(
  "-ansi-log" "false" \
  "-profile" "docker" \
  "-work-dir" "$(get_output_scratch_dir "${MANIFEST_JSON}")" \
  "-params-file" "${NEXTFLOW_PARAMS_PATH}"
)


custom_config="$(get_custom_config "${MANIFEST_JSON}")"
if [[ -n "${custom_config}" && ! "${custom_config}" == "null" ]]; then
  base64 -d <<< "${custom_config}" | gunzip > "${CUSTOM_CONFIG_PATH}"
  config_args_array+=( "-config" "${CUSTOM_CONFIG_PATH}" )
fi

## END CREATE NEXTFLOW CONFIG ##


## RESUME BLOCK ##

resume_nextflow_uri="$(get_resume_nextflow_uri "${MANIFEST_JSON}")"
if [[ -n "${resume_nextflow_uri:-}" && ! "${resume_nextflow_uri}" == "null" ]]; then
  aws s3 sync \
    --no-progress \
    "${resume_nextflow_uri}/" ./.nextflow/
  nf_run_args_array+=( "-resume" )
fi

## END RESUME BLOCK ##

## RUN NEXTFLOW ##
output_results_dir="$(get_output_results_dir "${MANIFEST_JSON}")"
trap 'cleanup "${output_results_dir}"' EXIT

nextflow \
  "${config_args_array[@]}" \
  run "${MAIN_NF_PATH}" \
  "${nf_run_args_array[@]}"

# Upload data cleanly
upload_data "${output_results_dir%/}/"

# Then exit cleanly
trap - EXIT

## END RUN NEXTFLOW ##
