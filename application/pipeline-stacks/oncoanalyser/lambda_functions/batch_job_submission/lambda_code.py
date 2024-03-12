#!/usr/bin/env python3
import json
import logging


import boto3


LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)


CLIENT_BATCH = boto3.client('batch')
CLIENT_SSM = boto3.client('ssm')


def main(event, context):
    """Lambda entry point.

    Event dict payload example:
    {
        "mode": "wgts_existing_both",
        "portal_run_id": "20230530abcdefgh",
        "subject_id": "SBJ00001",
        "tumor_wgs_sample_id": "PRJ230001",
        "tumor_wgs_library_id": "L2300001",
        "tumor_wgs_bam": "gds://production/analysis_data/SBJ00001/wgs_tumor_normal/20230515zyxwvuts/L2300001_L2300003/PRJ230001_tumor.bam",
        "tumor_wts_sample_id": "PRJ230002",
        "tumor_wts_library_id": "L2300002",
        "tumor_wts_bam": "s3://org.umccr.data.oncoanalyser/analysis_data/SBJ00001/star-align-nf/20230515qwertyui/L2300002/PRJ230002/PRJ230002.md.bam",
        "normal_wgs_sample_id": "PRJ230003",
        "normal_wgs_library_id": "L2300003",
        "normal_wgs_bam": "gds://production/analysis_data/SBJ00001/wgs_tumor_normal/20230515zyxwvuts/L2300001_L2300002_dragen_somatic/PRJ230003_normal.bam",
        "existing_wgs_dir": "s3://org.umccr.data.oncoanalyser/analysis_data/SBJ00001/oncoanalyser/20230515asdfghjk/wgs/L2300001__L2300003/",
        "existing_wts_dir": "s3://org.umccr.data.oncoanalyser/analysis_data/SBJ00001/oncoanalyser/20230515zzxcvbnm/wts/L2300002/",
    }

    :params dict event: Event payload
    :params LambdaContext context: Lambda context
    :returns: Status code and message
    :rtype: dict
    """

    LOGGER.info(f'Received event: {json.dumps(event)}')

    validate_response = validate_event_data(event)
    if validate_response['returncode'] != 0:
        return validate_response['message']

    job_data = get_job_data(event)

    output_directory = get_output_results_dir(
        event['subject_id'],
        get_library_id_string(event),
        event['portal_run_id'],
        event['mode'],
    )

    LOGGER.info(f'Compiled job data: {job_data}')

    response_job = CLIENT_BATCH.submit_job(
        jobName=job_data['name'],
        jobQueue=job_data['queue_name'],
        jobDefinition=job_data['definition_arn'],
        containerOverrides={
            'command': job_data['command'],
            'resourceRequirements': [
                {'type': 'MEMORY', 'value': '15000'},
                {'type': 'VCPU', 'value': '2'},
            ],
        },
        parameters={
            'portal_run_id': event['portal_run_id'],
            'workflow': f'oncoanalyser_{event["mode"]}',
            'version': get_ssm_parameter_value('/nextflow_stack/oncoanalyser/pipeline_version_tag'),
            'output': json.dumps({'output_directory': output_directory}),
        },
        tags={
            'Stack': 'NextflowStack',
            'SubStack': 'OncoanalyserStack',
            'RunId': event['portal_run_id'],
        },
        propagateTags=True
    )

    LOGGER.info(f'Received job submission response: {response_job}')

    return {'statusCode': 200, 'body': json.dumps(f'Submitted job with ID {response_job["jobId"]}')}


def get_job_data(event):

    library_id_str = get_library_id_string(event)

    job_name = f'oncoanalyser__{event["mode"]}__{event["subject_id"]}__{library_id_str}__{event["portal_run_id"]}'
    job_definition_arn = get_ssm_parameter_value('/nextflow_stack/oncoanalyser/batch_job_definition_arn')
    job_queue_name = 'nextflow-pipeline'

    command = get_job_command(event)

    return {
        'name': job_name,
        'definition_arn': job_definition_arn,
        'queue_name': job_queue_name,
        'command': command,
    }


def get_ssm_parameter_value(name):

    response = CLIENT_SSM.get_parameter(Name=name)
    return response['Parameter']['Value']


def get_library_id_string(event):

    library_id_names = ['tumor_wgs_library_id', 'normal_wgs_library_id', 'tumor_wts_library_id']
    library_ids = [event.get(lname) for lname in library_id_names]
    return '__'.join(lid for lid in library_ids if lid)


def get_output_results_dir(subject_id, library_id_str, portal_run_id, mode):

    bucket_name = get_ssm_parameter_value('/nextflow_stack/oncoanalyser/nf_bucket_name')
    return f's3://{bucket_name}/analysis_data/{subject_id}/oncoanalyser/{portal_run_id}/{mode}/{library_id_str}'


def get_output_scratch_dir(subject_id, portal_run_id):

    bucket_name = get_ssm_parameter_value('/nextflow_stack/oncoanalyser/nf_bucket_name')
    return f's3://{bucket_name}/temp_data/{subject_id}/oncoanalyser/{portal_run_id}/scratch'


def get_output_staging_dir(subject_id, portal_run_id):

    bucket_name = get_ssm_parameter_value('/nextflow_stack/oncoanalyser/nf_bucket_name')
    return f's3://{bucket_name}/temp_data/{subject_id}/oncoanalyser/{portal_run_id}/staging'


def get_job_command(event):

    output_results_dir = get_output_results_dir(
        event['subject_id'],
        get_library_id_string(event),
        event['portal_run_id'],
        event['mode'],
    )
    output_scratch_dir = get_output_scratch_dir(event['subject_id'], event['portal_run_id'])
    output_staging_dir = get_output_staging_dir(event['subject_id'], event['portal_run_id'])

    command_components = [
        './assets/run.sh',
        f'--portal_run_id {event["portal_run_id"]}',
        f'--mode {event["mode"]}',
        f'--subject_id {event["subject_id"]}',
        f'--output_results_dir {output_results_dir}',
        f'--output_staging_dir {output_staging_dir}',
        f'--output_scratch_dir {output_scratch_dir}',
    ]

    command_components_wgs = [
        f'--tumor_wgs_sample_id {event.get("tumor_wgs_sample_id")}',
        f'--tumor_wgs_library_id {event.get("tumor_wgs_library_id")}',
        f'--tumor_wgs_bam {event.get("tumor_wgs_bam")}',
        f'--normal_wgs_sample_id {event.get("normal_wgs_sample_id")}',
        f'--normal_wgs_library_id {event.get("normal_wgs_library_id")}',
        f'--normal_wgs_bam {event.get("normal_wgs_bam")}',
    ]

    command_components_wts = [
        f'--tumor_wts_sample_id {event.get("tumor_wts_sample_id")}',
        f'--tumor_wts_library_id {event.get("tumor_wts_library_id")}',
        f'--tumor_wts_bam {event.get("tumor_wts_bam")}',
    ]

    command_components_wgts = [
        *command_components_wgs,
        *command_components_wts,
    ]

    if event["mode"] == 'wgs':
        command_components.extend(command_components_wgs)
    elif event["mode"] == 'wts':
        command_components.extend(command_components_wts)
    elif event["mode"] == 'wgts':
        command_components.extend(command_components_wgts)
    elif event["mode"] == 'wgts_existing_wgs':
        command_components.extend(command_components_wgts)
        command_components.append(f'--existing_wgs_dir {get_wgs_existing_dir(event)}')
    elif event["mode"] == 'wgts_existing_wts':
        command_components.extend(command_components_wgts)
        command_components.append(f'--existing_wts_dir {get_wts_existing_dir(event)}')
    elif event["mode"] == 'wgts_existing_both':
        command_components.extend(command_components_wgts)
        command_components.append(f'--existing_wgs_dir {get_wgs_existing_dir(event)}')
        command_components.append(f'--existing_wts_dir {get_wts_existing_dir(event)}')
    else:
        assert False

    return ['bash', '-o', 'pipefail', '-c', ' '.join(command_components)]


def get_wgs_existing_dir(event):
    return event['existing_wgs_dir'].rstrip('/') + f'/{event["subject_id"]}_{event["tumor_wgs_sample_id"]}/'


def get_wts_existing_dir(event):
    return event['existing_wts_dir'].rstrip('/') + f'/{event["subject_id"]}_{event["tumor_wts_sample_id"]}/'


def validate_event_data(event):

    modes_allowed = (
        'wgs',
        'wts',
        'wgts',
        'wgts_existing_wgs',
        'wgts_existing_wts',
        'wgts_existing_both',
    )

    if not (mode := event.get('mode')):
        return get_error_response('Missing required parameter: mode')
    elif mode not in modes_allowed:
        modes_allowed_str = ', '.join(modes_allowed)
        message = f'Received an unexpected mode: {mode}. Available modes are: {modes_allowed_str}'
        return get_error_response(message)

    required_params = [
        'mode',
        'portal_run_id',
        'subject_id',
    ]

    required_params_wgs = (
        'tumor_wgs_sample_id',
        'tumor_wgs_library_id',
        'tumor_wgs_bam',
        'normal_wgs_sample_id',
        'normal_wgs_library_id',
        'normal_wgs_bam',
    )

    required_params_wts = (
        'tumor_wts_sample_id',
        'tumor_wts_library_id',
        'tumor_wts_bam',
    )

    required_params_wgts = (
        *required_params_wgs,
        *required_params_wts,
    )

    if mode == 'wgs':
        required_params.extend(required_params_wgs)
    elif mode == 'wts':
        required_params.extend(required_params_wts)
    elif mode == 'wgts':
        required_params.extend(required_params_wgts)
    elif mode == 'wgts_existing_wgs':
        required_params.extend(required_params_wgts)
        required_params.append('existing_wgs_dir')
    elif mode == 'wgts_existing_wts':
        required_params.extend(required_params_wgts)
        required_params.append('existing_wts_dir')
    elif mode == 'wgts_existing_both':
        required_params.extend(required_params_wgts)
        required_params.append('existing_wgs_dir')
        required_params.append('existing_wts_dir')
    else:
        assert False

    missing_params = set(required_params) - set(event)
    if missing_params:
        plurality = 'parameters' if len(missing_params) > 1 else 'parameter'
        message = f'Missing required {plurality}: {", ".join(missing_params)}'
        return get_error_response(message)

    extra_params = set(event) - set(required_params)
    if extra_params:
        plurality = 'parameters' if len(extra_params) > 1 else 'parameter'
        message = f'Found unexpected {plurality}: {", ".join(extra_params)}'
        return get_error_response(message)

    return {'returncode': 0, 'message': dict()}


def get_error_response(message):

    LOGGER.error(message)
    message_response = {'statusCode': 400, 'body': json.dumps(message)}
    return {'returncode': 1, 'message': message_response}
