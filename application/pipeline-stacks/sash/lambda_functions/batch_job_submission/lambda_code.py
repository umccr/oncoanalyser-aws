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
        "portal_run_id": "20230530abcdefgh",
        "subject_id": "SBJ00001",
        "tumor_sample_id": "PRJ230001",
        "tumor_library_id": "L2300001",
        "normal_sample_id": "PRJ230002",
        "normal_library_id": "L2300002",
        "dragen_somatic_dir": "gds://production/analysis_data/SBJ00001/wgs_tumor_normal/20230515zyxwvuts/L2300001_L2300002/",
        "dragen_germline_dir": "gds://production/analysis_data/SBJ00001/wgs_tumor_normal/20230515zyxwvuts/L2300002_dragen_germline/",
        "oncoanalyser_dir": "s3://org.umccr.data.oncoanalyser/analysis_data/SBJ00001/oncoanalyser/20230518poiuytre/wgs/L2300001__L2300002/SBJ00001_PRJ230001/"
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
    )

    LOGGER.info(f'Received job submission response: {response_job}')

    return {'statusCode': 200, 'body': json.dumps(f'Submitted job with ID {response_job["jobId"]}')}


def get_job_data(event):

    job_name = f'sash__{event["subject_id"]}__{event["tumor_library_id"]}__{event["normal_library_id"]}__{event["portal_run_id"]}'
    job_definition_arn = get_ssm_parameter_value('/nextflow_stack/sash/batch_job_definition_arn')
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


def get_job_command(event):

    command_components = [
        './assets/run.sh',
        f'--portal_run_id {event["portal_run_id"]}',
        f'--subject_id {event["subject_id"]}',
        f'--tumor_sample_id {event["tumor_sample_id"]}',
        f'--tumor_library_id {event["tumor_library_id"]}',
        f'--normal_sample_id {event["normal_sample_id"]}',
        f'--normal_library_id {event["normal_library_id"]}',
        f'--dragen_somatic_dir {event["dragen_somatic_dir"]}',
        f'--dragen_germline_dir {event["dragen_germline_dir"]}',
        f'--oncoanalyser_dir {event["oncoanalyser_dir"]}',
    ]

    return ['bash', '-o', 'pipefail', '-c', ' '.join(command_components)]


def validate_event_data(event):

    required_params = [
        'portal_run_id',
        'subject_id',
        'tumor_sample_id',
        'tumor_library_id',
        'normal_sample_id',
        'normal_library_id',
        'dragen_somatic_dir',
        'dragen_germline_dir',
        'oncoanalyser_dir',
    ]

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
