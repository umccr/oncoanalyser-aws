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
        "sample_id": "PRJ230002",
        "library_id": "L2300002",
        "fastq_fwd": "gds://production/primary_data/230430_A00001_0001_AH1VLHDSX1/20230430qazwsxed/WTS_NebRNA/PRJ230002_L2300002_S1_L001_R1_001.fastq.gz",
        "fastq_rev": "gds://production/primary_data/230430_A00001_0001_AH1VLHDSX1/20230430qazwsxed/WTS_NebRNA/PRJ230002_L2300002_S1_L001_R2_001.fastq.gz",
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

    job_name = f'star-align-nf__{event["subject_id"]}__{event["library_id"]}'
    job_definition_arn = get_ssm_parameter_value('/nextflow_stack/star-align-nf/batch_job_definition_arn')
    job_queue_name = 'nextflow-pipeline-ondemand'

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
        f'--sample_id {event["sample_id"]}',
        f'--library_id {event["library_id"]}',
        f'--fastq_fwd {event["fastq_fwd"]}',
        f'--fastq_rev {event["fastq_rev"]}',
    ]

    return ['bash', '-o', 'pipefail', '-c', ' '.join(command_components)]


def validate_event_data(event):

    required_params = [
        'portal_run_id',
        'subject_id',
        'sample_id',
        'library_id',
        'fastq_fwd',
        'fastq_rev',
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
