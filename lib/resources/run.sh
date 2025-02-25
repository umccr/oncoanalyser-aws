#!/usr/bin/env bash
set -euo pipefail

# Get command line arguments
print_help_text() {
  cat <<EOF
Usage example: run.sh --params_fp FILE

Options:
  --params_fp FILE    S3 path to the Nextflow JSON params file
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --params_fp)
      params_fp="$2"
      shift 1
    ;;

    -h|--help)
      print_help_text
      exit 0
  esac
  shift
done

if [[ -z "${params_fp:-}" ]]; then
  print_help_text
  echo -e "\nERROR: --params_fp is required" 1>&2
  exit 1
fi

# Download params file and get output directory base
aws s3 cp ${params_fp} params.json
output_base=$(jq -r .outdir params.json)

# Prepare AWS configuration file
get_ssm_parameter_value() {
  aws ssm get-parameter \
    --name "$1" \
    --output json |
  jq --raw-output '.Parameter | .Value'
}

sed \
  --regexp-extended \
  --expression \
    "
      s#__S3_GENOMES_DATA_PATH__#s3://$(get_genomes_path_from_ssm)#g;
      s#__BATCH_INSTANCE_ROLE__#$(get_batch_instance_role_arn_from_ssm)#g;
      s#__PORTAL_RUN_ID__#${portal_run_id}#g;
    " \
  /root/pipeline/other/nextflow_aws.template.config > aws.config


# Run oncoanalyser
upload_data() {
  aws s3 sync \
    --no-progress \
    --no-follow-symlinks \
    --exclude='software/*' \
    --exclude='assets/*' \
    --exclude='work/*' \
    ./ ${output_base%/}/;
}

trap upload_data EXIT

nextflow run software/oncoanalyser/main.nf \
    -config aws.config \
    -params-file params.json \
    -profile docker \
    -work-dir ${output_base}/work/ \
    -ansi-log false \
    --monochrome_logs \

# Upload data then exit cleanly
upload_data
trap - EXIT
