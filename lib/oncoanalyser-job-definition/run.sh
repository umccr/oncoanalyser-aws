#!/usr/bin/env bash
set -euo pipefail

# Get command line arguments
print_help_text() {
  cat <<EOF
Usage example: run.sh --params_fp FILE

Options:
  --params_fp FILE    S3 path to the Nextflow JSON params file
  --stub_run          Enable stub run
EOF
}

while [ $# -gt 0 ]; do
  case ${1} in
    --params_fp)
      params_fp=${2};
      shift 1;
    ;;

    --stub_run)
      stub_run='true';
    ;;

    -h|--help)
      print_help_text;
      exit 0;
  esac;
  shift;
done

if [[ -z ${params_fp:-} ]]; then
  print_help_text;
  echo -e '\nERROR: --params_fp is required' 1>&2;
  exit 1;
fi

# Download params file and get output directory base
aws s3 cp ${params_fp} params.json
output_base=$(jq -r .outdir params.json)

# Nextflow config is generated by the CDK at build time
# however - due to the size of it - we cannot pass in down via Batch Job Definition/Parameter Store
# instead we store it in AppConfig and fetch it
# for the moment appconfig is overkill - but it does open up the possibility of things
# like feature flags etc
appconfig_token=$(aws appconfigdata start-configuration-session \
                    --application-identifier "$ONCOANALYSER_NEXTFLOW_CONFIG_APPCONFIG_APPLICATION" \
                    --environment-identifier "$ONCOANALYSER_NEXTFLOW_CONFIG_APPCONFIG_ENVIRONMENT" \
                    --configuration-profile-identifier "$ONCOANALYSER_NEXTFLOW_CONFIG_APPCONFIG_CONFIGURATION_PROFILE" \
                    --query InitialConfigurationToken --output text)

aws appconfigdata get-latest-configuration --configuration-token "$appconfig_token" aws.config

# Set additional Nextflow arguments
nf_arg_stub=''
if [[ -n ${stub_run:-} ]]; then
  nf_arg_stub='-stub'
fi

# Run oncoanalyser
upload_data() {
  aws s3 sync \
    --no-progress \
    --no-follow-symlinks \
    --exclude='software/*' \
    --exclude='other/*' \
    --exclude='work/*' \
    ./ ${output_base%/}/
}

trap upload_data EXIT

nextflow run software/oncoanalyser/main.nf \
  -config aws.config \
  -params-file params.json \
  -profile docker \
  ${nf_arg_stub} \
  -work-dir ${output_base%/}/work/ \
  -ansi-log false \
  --monochrome_logs \

# Upload data then exit cleanly
upload_data
trap - EXIT
