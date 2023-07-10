#!/usr/bin/env bash

set -euo pipefail

## GLOBALS ##

ICA_BASE_URL="https://aps2.platform.illumina.com"
MAIN_NF_PATH="software/oncoanalyser/main.nf"
TEMPLATE_CONFIG_PATH="/root/pipeline/assets/nextflow_aws.template.config"
NEXTFLOW_CONFIG_PATH="nextflow.config"

## END GLOBALS ##

## USAGE / ARGS ##

print_help_text() {
  cat <<EOF
Usage example: run.sh --mode wgs --subject_id STR --tumor_wgs_id STR --normal_wgs_id STR --tumor_wgs_bam FILE --normal_wgs_bam FILE

Options:
  --mode STR                    Mode to run [wgs, wts, wgts, wgts_existing_wgs, wgts_existing_wts, wgts_existing_both]

  --subject_id STR              Subject identifier

  --tumor_wgs_id STR            Tumor WGS identifier
  --normal_wgs_id STR           Normal WGS identifier
  --tumor_wgs_bam FILE          Input tumor WGS BAM
  --normal_wgs_bam FILE         Input normal WGS BAM

  --tumor_wts_id STR            Tumor WTS identifier
  --tumor_wts_bam FILE          Input tumor WTS BAM

  --existing_wgs_dir DIR        Existing WGS run directory (expected to be S3 URI)
  --existing_wts_dir DIR        Existing WGS run directory (expected to be S3 URI)

  --resume_nextflow_dir FILE    Previous .nextflow/ directory used to resume a run (S3 URI)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --mode)
      mode="$2"
      shift 1
    ;;

    --subject_id)
      subject_id="$2"
      shift 1
    ;;
    --tumor_wgs_id)
      tumor_wgs_id="$2"
      shift 1
    ;;
    --normal_wgs_id)
      normal_wgs_id="$2"
      shift 1
    ;;
    --tumor_wts_id)
      tumor_wts_id="$2"
      shift 1
    ;;

    --tumor_wgs_bam)
      tumor_wgs_bam="$2"
      shift 1
    ;;
    --normal_wgs_bam)
      normal_wgs_bam="$2"
      shift 1
    ;;

    --tumor_wts_bam)
      tumor_wts_bam="$2"
      shift 1
    ;;

    --existing_wgs_dir)
      existing_wgs_dir="${2%/}"
      shift 1
    ;;
    --existing_wts_dir)
      existing_wts_dir="${2%/}"
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

if [[ -z "${mode:-}" ]]; then
  print_help_text
  echo -e "\nERROR: --mode is required" 1>&2
  exit 1
fi

required_args='
subject_id
'

required_args_wgts='
tumor_wgs_id
normal_wgs_id
tumor_wgs_bam
normal_wgs_bam
tumor_wts_id
tumor_wts_bam
'

if [[ ${mode} == 'wgs' ]]; then
  required_args+='
  tumor_wgs_id
  normal_wgs_id
  tumor_wgs_bam
  normal_wgs_bam
  '
elif [[ ${mode} == 'wts' ]]; then
  required_args+='
  tumor_wts_id
  tumor_wts_bam
  '
elif [[ ${mode} == 'wgts' ]]; then
  required_args+="${required_args_wgts}"
elif [[ ${mode} == 'wgts_existing_wgs' ]]; then
  required_args+="
  ${required_args_wgts}
  existing_wgs_dir
  "
elif [[ ${mode} == 'wgts_existing_wts' ]]; then
  required_args+="
  ${required_args_wgts}
  existing_wts_dir
  "
elif [[ ${mode} == 'wgts_existing_both' ]]; then
  required_args+="
  ${required_args_wgts}
  existing_wgs_dir
  existing_wts_dir
  "
else
  print_help_text
  echo "--mode got unexpected value: ${mode}" 1>&2
  exit 1
fi

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
  local -a sample_ids

  if [[ -n "${tumor_wgs_id:-}" ]]; then
    sample_ids+=(${tumor_wgs_id})
  fi;

  if [[ -n "${normal_wgs_id:-}" ]]; then
    sample_ids+=(${normal_wgs_id})
  fi;

  if [[ -n "${tumor_wts_id:-}" ]]; then
    sample_ids+=(${tumor_wts_id})
  fi;

  sample_ids_str=$(sed 's/ /__/g' <<< ${sample_ids[@]})

  echo "$(get_nf_bucket_name_from_ssm)/analysis_data/${subject_id}/oncoanalyser/${portal_id}/${mode}/${sample_ids_str}"
}

get_staging_directory() {
  echo "$(get_nf_bucket_name_from_ssm)/temp_data/${subject_id}/oncoanalyser/${portal_id}/staging"
}

get_scratch_directory() {
  echo "$(get_nf_bucket_name_from_ssm)/temp_data/${subject_id}/oncoanalyser/${portal_id}/scratch"
}

generate_portal_id() {
  echo $(date '+%Y%m%d')$(openssl rand -hex 4)
}

get_ssm_parameter_value() {
  aws ssm get-parameter \
    --name "$1" \
    --output json |
  jq --raw-output '.Parameter | .Value'
}

get_nf_bucket_name_from_ssm() {
  get_ssm_parameter_value "/nextflow_stack/oncoanalyser/nf_bucket_name"
}

get_nf_bucket_temp_prefix_from_ssm() {
  get_ssm_parameter_value "/nextflow_stack/oncoanalyser/nf_bucket_temp_prefix"
}

get_nf_bucket_output_prefix_from_ssm() {
  get_ssm_parameter_value "/nextflow_stack/oncoanalyser/nf_bucket_output_prefix"
}

get_hmf_refdata_from_ssm() {
  get_ssm_parameter_value "/nextflow_stack/oncoanalyser/refdata_hmf"
}

get_virusbreakend_db_from_ssm() {
  get_ssm_parameter_value "/nextflow_stack/oncoanalyser/refdata_virusbreakend"
}

get_genomes_path_from_ssm() {
  get_ssm_parameter_value "/nextflow_stack/oncoanalyser/refdata_genomes"
}

get_batch_instance_role_arn_from_ssm() {
  get_ssm_parameter_value "/nextflow_stack/oncoanalyser/batch_instance_task_role_arn"
}

get_batch_instance_profile_arn_from_ssm() {
  get_ssm_parameter_value "/nextflow_stack/oncoanalyser/batch_instance_task_profile_arn"
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


  dst_dp="$(get_staging_directory)"
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

  src_fp="$( \
    jq --raw-output \
      --arg gds_fp "${gds_fp##*/}" \
      '"\(.bucketName)/\(.keyPrefix)\($gds_fp)"' \
      <<< "${creds}" \
  )"

  echo "staging ${gds_fp}.bai to s3://${dst_fp}.bai" 1>&2
  rclone copy --s3-upload-concurrency 8 \
    "ica:${src_fp}.bai" "aws:${dst_dp}/"

  echo "staging ${gds_fp} to s3://${dst_fp}" 1>&2
  rclone copy --s3-upload-concurrency 8 \
    "ica:${src_fp}" "aws:${dst_dp}/"
}

samplesheet_wgs_entries() {
  echo "${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,bam,${input_fps['tumor_wgs_bam']}"
  echo "${subject_id}_${tumor_wgs_id},${subject_id},${normal_wgs_id},normal,wgs,bam,${input_fps['normal_wgs_bam']}"
}

samplesheet_wts_entries() {
  echo "${subject_id}_${1},${subject_id},${tumor_wts_id},tumor,wts,bam,${input_fps['tumor_wts_bam']}"
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

portal_id="$(generate_portal_id)"
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

## SAMPLESHEET PREP ##

input_file_args='
tumor_wgs_bam
normal_wgs_bam
tumor_wts_bam
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
id,subject_name,sample_name,sample_type,sequence_type,filetype,filepath
EOF

if [[ ${mode} == 'wgs' ]]; then

  cat <<EOF >> samplesheet.csv
$(samplesheet_wgs_entries)
EOF

elif [[ ${mode} == 'wts' ]]; then

  cat <<EOF >> samplesheet.csv
$(samplesheet_wts_entries "${tumor_wts_id}")
EOF

elif [[ ${mode} == 'wgts' ]]; then

  cat <<EOF >> samplesheet.csv
$(samplesheet_wgs_entries)
$(samplesheet_wts_entries "${tumor_wgs_id}")
EOF

elif [[ ${mode} == 'wgts_existing_wts' ]]; then

  cat <<EOF >> samplesheet.csv
$(samplesheet_wgs_entries)
$(samplesheet_wts_entries "${tumor_wgs_id}")
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wts_id},tumor,wts,isofox_dir,${existing_wts_dir}/isofox/
EOF

elif [[ ${mode} == 'wgts_existing_wgs' ]]; then

  cat <<EOF >> samplesheet.csv
$(samplesheet_wgs_entries)
$(samplesheet_wts_entries "${tumor_wgs_id}")
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,bamtools,${existing_wgs_dir}/bamtools/${tumor_wgs_id}.wgsmetrics
${subject_id}_${tumor_wgs_id},${subject_id},${normal_wgs_id},normal,wgs,bamtools,${existing_wgs_dir}/bamtools/${normal_wgs_id}.wgsmetrics
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,flagstat,${existing_wgs_dir}/flagstats/${tumor_wgs_id}.flagstat
${subject_id}_${tumor_wgs_id},${subject_id},${normal_wgs_id},normal,wgs,flagstat,${existing_wgs_dir}/flagstats/${normal_wgs_id}.flagstat
${subject_id}_${tumor_wgs_id},${subject_id},${normal_wgs_id},normal,wgs,sage_bqr,${existing_wgs_dir}/sage/somatic/${normal_wgs_id}.sage.bqr.png
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,sage_bqr,${existing_wgs_dir}/sage/somatic/${tumor_wgs_id}.sage.bqr.png
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,sage_coverage,${existing_wgs_dir}/sage/somatic/${tumor_wgs_id}.sage.gene.coverage.tsv
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,linx_anno_dir,${existing_wgs_dir}/linx/somatic_annotations/
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,linx_plot_dir,${existing_wgs_dir}/linx/somatic_plots/
${subject_id}_${tumor_wgs_id},${subject_id},${normal_wgs_id},normal,wgs,linx_anno_dir,${existing_wgs_dir}/linx/germline_annotations/
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor_normal,wgs,purple_dir,${existing_wgs_dir}/purple/
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,virusinterpreter_tsv,${existing_wgs_dir}/virusinterpreter/${tumor_wgs_id}.virus.annotated.tsv
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,chord_prediction,${existing_wgs_dir}/chord/${subject_id}_${tumor_wgs_id}_chord_prediction.txt
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,sigs_dir,${existing_wgs_dir}/sigs/
EOF

elif [[ ${mode} == 'wgts_existing_both' ]]; then

  cat <<EOF >> samplesheet.csv
$(samplesheet_wgs_entries)
$(samplesheet_wts_entries "${tumor_wgs_id}")
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,bamtools,${existing_wgs_dir}/bamtools/${tumor_wgs_id}.wgsmetrics
${subject_id}_${tumor_wgs_id},${subject_id},${normal_wgs_id},normal,wgs,bamtools,${existing_wgs_dir}/bamtools/${normal_wgs_id}.wgsmetrics
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,flagstat,${existing_wgs_dir}/flagstats/${tumor_wgs_id}.flagstat
${subject_id}_${tumor_wgs_id},${subject_id},${normal_wgs_id},normal,wgs,flagstat,${existing_wgs_dir}/flagstats/${normal_wgs_id}.flagstat
${subject_id}_${tumor_wgs_id},${subject_id},${normal_wgs_id},normal,wgs,sage_bqr,${existing_wgs_dir}/sage/somatic/${normal_wgs_id}.sage.bqr.png
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,sage_bqr,${existing_wgs_dir}/sage/somatic/${tumor_wgs_id}.sage.bqr.png
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,sage_coverage,${existing_wgs_dir}/sage/somatic/${tumor_wgs_id}.sage.gene.coverage.tsv
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,linx_anno_dir,${existing_wgs_dir}/linx/somatic_annotations/
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,linx_plot_dir,${existing_wgs_dir}/linx/somatic_plots/
${subject_id}_${tumor_wgs_id},${subject_id},${normal_wgs_id},normal,wgs,linx_anno_dir,${existing_wgs_dir}/linx/germline_annotations/
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor_normal,wgs,purple_dir,${existing_wgs_dir}/purple/
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,virusinterpreter_tsv,${existing_wgs_dir}/virusinterpreter/${tumor_wgs_id}.virus.annotated.tsv
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,chord_prediction,${existing_wgs_dir}/chord/${subject_id}_${tumor_wgs_id}_chord_prediction.txt
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,sigs_dir,${existing_wgs_dir}/sigs/
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wts_id},tumor,wts,isofox_dir,${existing_wts_dir}/isofox/
EOF

fi

## END SAMPLESHEET PREP ##

## NEXTFLOW ARGS ##

# NOTE(SW): using new conditional block to separate functionality
nextflow_args=''
if [[ ${mode} == 'wgs' ]]; then
  nextflow_args='--run_mode wgs --run_type tumor_normal'
elif [[ ${mode} == 'wts' ]]; then
  nextflow_args='--run_mode wts'
elif [[ ${mode} == 'wgts' ]]; then
  nextflow_args='--run_mode wgts --run_type tumor_normal'
elif [[ ${mode} == 'wgts_existing_wts' ]]; then
  nextflow_args='--run_mode wgts --run_type tumor_normal --processes_exclude isofox'
elif [[ ${mode} == 'wgts_existing_wgs' ]]; then
  nextflow_args='--run_mode wgts --run_type tumor_normal --processes_manual --processes_include isofox,lilac,cuppa,orange'
elif [[ ${mode} == 'wgts_existing_both' ]]; then
  nextflow_args='--run_mode wgts --run_type tumor_normal --processes_manual --processes_include lilac,cuppa,orange'
fi

if [[ -n "${resume_nextflow_dir:-}" ]]; then
  nextflow_args+=' -resume'
fi

## END NEXFLOW ARGS ##

## CREATE NEXTFLOW CONFIG ##
sed \
  --regexp-extended \
  --expression \
    "
      s#__S3_GENOMES_DATA_PATH__#s3://$(get_genomes_path_from_ssm)#g;
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
    --genome "GRCh38_umccr" \
    --genome_version "38" \
    --genome_type "alt" \
    --force_genome \
    --ref_data_hmf_data_path "s3://$(get_hmf_refdata_from_ssm)/" \
    --ref_data_virusbreakenddb_path "s3://$(get_virusbreakend_db_from_ssm)/" \
    --outdir "${output_dir}/"

# Upload data cleanly
upload_data

# Then exit cleanly
trap - EXIT
