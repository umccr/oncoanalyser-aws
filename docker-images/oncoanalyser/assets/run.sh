#!/usr/bin/env bash
set -euo pipefail

print_help_text() {
    cat <<EOF
Usage example: run.sh --subject_id STR --tumor_wgs_id STR --normal_wgs_id STR --tumor_wgs_bam S3_FILE --normal_wgs_bam S3_FILE --output_dir S3_PREFIX

Options:
  --mode STR                    Mode to run (relative to CUPPA) [wgs, wts, wgts, wgts_existing_wgs, wgts_existing_wts]

  --subject_id STR              Subject identifier

  --tumor_wgs_id STR            Tumor WGS identifier
  --normal_wgs_id STR           Normal WGS identifier
  --tumor_wgs_bam FILE          Input tumor WGS BAM
  --normal_wgs_bam FILE         Input normal WGS BAM

  --tumor_wts_id STR            Tumor WTS identifier
  --tumor_wts_fastq_fwd FILE    Input tumor WTS FASTQ forward
  --tumor_wts_fastq_rev FILE    Input tumor WTS FASTQ reverse

  --previous_run_dir FILE       Previous run directory to use inputs (expected to be S3 URI)

  --resume_nextflow_dir FILE    Resume run using this .nextflow/ directory (S3 URI)

  --output_dir S3_PREFIX        Output S3 prefix
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

        --tumor_wts_fastq_fwd)
            tumor_wts_fastq_fwd="$2"
            shift 1
        ;;
        --tumor_wts_fastq_rev)
            tumor_wts_fastq_rev="$2"
            shift 1
        ;;

        --previous_run_dir)
            previous_run_dir="${2%/}"
            shift 1
        ;;

        --resume_nextflow_dir)
            resume_nextflow_dir="${2%/}"
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

if [[ -z "${mode:-}" ]]; then
    print_help_text
    echo -e "\nERROR: --mode is required"
    exit 1
fi;

required_args='
subject_id
output_dir
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
  tumor_wts_fastq_fwd
  tumor_wts_fastq_rev
  '
elif [[ ${mode} == 'wgts' ]]; then
  required_args+='
  tumor_wgs_id
  normal_wgs_id
  tumor_wgs_bam
  normal_wgs_bam
  tumor_wts_id
  tumor_wts_fastq_fwd
  tumor_wts_fastq_rev
  '
elif [[ ${mode} == 'wgts_existing_wgs' ]]; then
  required_args+='
  tumor_wgs_id
  normal_wgs_id
  tumor_wts_id
  tumor_wts_fastq_fwd
  tumor_wts_fastq_rev
  previous_run_dir
  '
elif [[ ${mode} == 'wgts_existing_wts' ]]; then
  required_args+='
  tumor_wgs_id
  normal_wgs_id
  tumor_wgs_bam
  normal_wgs_bam
  tumor_wts_id
  previous_run_dir
  '
fi;

missing_args=()
for argname in ${required_args}; do
  if [[ -z "${!argname:-}" ]]; then
    missing_args+=(${argname});
  fi;
done

if [[ ${#missing_args[@]} -gt 0 ]]; then
    print_help_text
    missing_arg_str=$(echo -n "--${missing_args[0]}"; for arg in ${missing_args[@]:1}; do echo -n ", --${arg}"; done);
    plurality=$(if [[ ${#missing_args[@]} -gt 1 ]]; then echo are; else echo is; fi);
    echo -e "\nERROR: ${missing_arg_str} ${plurality} required"
    exit 1
fi;

# When Nextflow runs a job using the local executor with Docker enabled, I have configured behaviour such that that a
# new Docker container from the host service is launched. This means that all local Nextflow processes inherit the EC2
# instance IAM profile, which can only be set prior at the Batch compute environment creation; in this case that is the
# non-permissive Nextflow pipeline role. This means to run Nextflow processes locally that can r/w to S3 (e.g. when
# using fusion), we must set the EC2 instance IAM role to a profile with these permissions. Here I associate the
# instance with the Oncoanalyser task role - ideally this could be done via job definition.

# NOTE(SW): this is to be updated manually for now and once in CodePipeline

instance_id=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
association_id=$(
  aws ec2 describe-iam-instance-profile-associations | \
    jq -r '
      .IamInstanceProfileAssociations[] |
        select(.InstanceId == "'${instance_id}'") |
        .AssociationId
    '
)
aws ec2 replace-iam-instance-profile-association 1>/dev/null \
  --association-id ${association_id} \
  --iam-instance-profile Name='OncoanalyserStack-OncoanalyserTaskBatchInstanceProfile-Eq6HgOiK5G71'

if [[ ! -z ${resume_nextflow_dir:-} ]]; then
  aws s3 sync \
    --no-progress \
    ${resume_nextflow_dir}/ ./.nextflow/
fi;

stage_gds_fp() {
  gds_fp=${1};
  gds_dp=${gds_fp%/*}/;

  dst_bucket=umccr-temp-dev;
  dst_key_base=stephen/gds_staging_dev;

  dst_dp=${dst_bucket}/${dst_key_base};
  dst_fp=${dst_dp}/${gds_fp##*/};

  echo s3://${dst_fp};

  if [[ -z "${ICA_ACCESS_TOKEN:-}" ]]; then
    AWS_DEFAULT_REGION=ap-southeast-2 aws lambda invoke \
      --function-name arn:aws:lambda:ap-southeast-2:472057503814:function:IcaSecretsPortalProvider \
      response.json 1>/dev/null;

    export ICA_ACCESS_TOKEN=$(jq -r < response.json);
    shred -u response.json;
  fi;

  resp=$(ica folders update --with-access ${gds_dp} -o json);
  creds=$(jq -r '.objectStoreAccess.awsS3TemporaryUploadCredentials' <<< ${resp});

  mkdir -p ~/.config/rclone/;

  cat <<EOF > ~/.config/rclone/rclone.conf
[ica]
type = s3
provider = AWS
access_key_id = $(jq -r '.access_Key_Id' <<< ${creds})
secret_access_key = $(jq -r '.secret_Access_Key' <<< ${creds})
session_token = $(jq -r '.session_Token' <<< ${creds})
region = ap-southeast-2

[aws]
type = s3
provider = AWS
env_auth = true
region = ap-southeast-2
no_check_bucket = true
EOF

  src_fp=$(jq -r '.bucketName + "/" + .keyPrefix + "'${gds_fp##*/}'"' <<< ${creds});
  src_fp=$(jq -r '.bucketName + "/" + .keyPrefix + "'${gds_fp##*/}'"' <<< ${creds});

  if [[ ${gds_fp} =~ .*bam$ ]]; then
    echo "staging ${gds_fp}.bai to s3://${dst_fp}.bai" 1>&2;
    rclone copy --s3-upload-concurrency 8 ica:${src_fp}.bai aws:${dst_dp}/;
  fi;

  echo "staging ${gds_fp} to s3://${dst_fp}" 1>&2;
  rclone copy --s3-upload-concurrency 8 ica:${src_fp} aws:${dst_dp}/;
}

input_file_args='
tumor_wgs_bam
normal_wgs_bam
tumor_wts_fastq_fwd
tumor_wts_fastq_rev
'

declare -A input_fps
for fp_name in ${input_file_args}; do
  fp=${!fp_name:-};
  if [[ -z ${fp} ]]; then
    continue;
  fi;

  if [[ ${fp} =~ ^gds://.* ]]; then
    input_fps[${fp_name}]=$(stage_gds_fp ${fp});
  else
    input_fps[${fp_name}]=${fp};
  fi;
done

samplesheet_wgs_entries() {
  echo ${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,bam,${input_fps['tumor_wgs_bam']}
  echo ${subject_id}_${tumor_wgs_id},${subject_id},${normal_wgs_id},normal,wgs,bam,${input_fps['normal_wgs_bam']}
}

samplesheet_wts_entries() {
  echo ${subject_id}_${1},${subject_id},${tumor_wts_id},tumor,wts,fastq_fwd,${input_fps['tumor_wts_fastq_fwd']}
  echo ${subject_id}_${1},${subject_id},${tumor_wts_id},tumor,wts,fastq_rev,${input_fps['tumor_wts_fastq_rev']}
}

cat <<EOF > samplesheet.csv
id,subject_name,sample_name,sample_type,sequence_type,filetype,filepath
EOF

if [[ ${mode} == 'wgs' ]]; then
  cat <<EOF >> samplesheet.csv
$(samplesheet_wgs_entries)
EOF
elif [[ ${mode} == 'wts' ]]; then
  cat <<EOF >> samplesheet.csv
$(samplesheet_wts_entries ${tumor_wts_id})
EOF
elif [[ ${mode} == 'wgts' ]]; then
  cat <<EOF >> samplesheet.csv
$(samplesheet_wgs_entries)
$(samplesheet_wts_entries ${tumor_wgs_id})
EOF
elif [[ ${mode} == 'wgts_existing_wts' ]]; then
  cat <<EOF >> samplesheet.csv
$(samplesheet_wgs_entries)
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wts_id},tumor,wts,isofox_dir,${previous_run_dir}/isofox/
EOF
elif [[ ${mode} == 'wgts_existing_wgs' ]]; then
  cat <<EOF >> samplesheet.csv
$(samplesheet_wts_entries ${tumor_wgs_id})
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor_normal,wgs,purple_dir,${previous_run_dir}/purple/
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,linx_anno_dir,${previous_run_dir}/linx/somatic_annotations/
${subject_id}_${tumor_wgs_id},${subject_id},${tumor_wgs_id},tumor,wgs,virusinterpreter_tsv,${previous_run_dir}/virusinterpreter/${tumor_wgs_id}.virus.annotated.tsv
EOF
fi

# NOTE(SW): using new conditional block to separate functionality
nextflow_args=''
if [[ ${mode} == 'wgs' ]]; then
  nextflow_args='--processes_exclude star,isofox,chord,lilac,orange,peach,protect,sigs';
elif [[ ${mode} == 'wts' ]]; then
  nextflow_args='--mode manual --processes_include star,isofox,cuppa';
elif [[ ${mode} == 'wgts' ]]; then
  nextflow_args='--processes_exclude chord,lilac,orange,peach,protect,sigs';
elif [[ ${mode} == 'wgts_existing_wts' ]]; then
  nextflow_args='--processes_exclude star,isofox,chord,lilac,orange,peach,protect,sigs';
elif [[ ${mode} == 'wgts_existing_wgs' ]]; then
  nextflow_args='--mode manual --processes_include star,isofox,cuppa';
fi

if [[ ! -z ${resume_nextflow_dir:-} ]]; then
  nextflow_args+=' -resume'
fi

upload_data() {
  aws s3 sync \
    --no-progress \
    --no-follow-symlinks \
    --exclude='software/*' \
    --exclude='assets/*' \
    --exclude='work/*' \
    ./ ${output_dir}/
}
trap upload_data EXIT

nextflow \
  -config assets/nextflow_aws.config \
  run software/oncoanalyser/main.nf \
    -ansi-log false \
    -profile docker \
    -work-dir s3://umccr-temp-dev/stephen/oncoanalyser-awsbatch/scratch/ \
    --input samplesheet.csv \
    --outdir ${output_dir}/output/ \
    --genome GRCh38_umccr \
    ${nextflow_args} \
    --ref_data_virusbreakenddb_path s3://umccr-research-dev/stephen/oncoanalyser_data/virusbreakend/virusbreakenddb_20210401/ \
    --ref_data_hmf_data_path s3://umccr-research-dev/stephen/oncoanalyser_data/hmf_reference_data/repacks/5.32+dev1_38_0.0.1/
