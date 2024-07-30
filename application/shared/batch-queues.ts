import * as constants from '../constants';


export function getQueueName(args: {
  queueBaseName: string,
  queueType: constants.QueueType,
  storageType: constants.InstanceStorageType,
  serviceType: constants.ServiceType,
}) {
  let queueName;
  const nameSuffix = `${args.queueType.toLowerCase()}-${args.storageType.toLowerCase()}`;
  switch (args.serviceType) {
    case (constants.ServiceType.Task):
      queueName = `task-${args.queueType.toLowerCase()}-${args.queueBaseName}-${args.storageType.toLowerCase()}`;
      break;
    case (constants.ServiceType.Pipeline):
      queueName = `${args.queueBaseName}-${args.queueType.toLowerCase()}-${args.storageType.toLowerCase()}`;
      break;
    default:
      throw new Error('Got bad service type');
  }

  return queueName
}


export interface IQueueData {
  name: string;
  instances: Map<string, string[]>;
  maxvCpus?: number;
}


export const pipelineQueue : IQueueData = {
  name: 'pipeline',
  instances: new Map([
    ['standard', ['r6i.large']],
    ['nvme_ssd', ['r6id.large']],
  ]),
};

export const taskQueues: IQueueData[] = [

  {
    name: '2cpu_16gb',
    instances: new Map([
      ['standard', ['r5.large', 'r5n.large', 'r6i.large']],
      ['nvme_ssd', ['r5d.large', 'r5dn.large', 'r6id.large']],
    ]),
  },

  {
    name: '4cpu_16gb',
    instances: new Map([
      ['standard', ['m5.xlarge', 'm6i.xlarge']],
      ['nvme_ssd', ['m5d.xlarge', 'm6id.xlarge']],
    ]),
  },

  {
    name: '4cpu_32gb',
    instances: new Map([
      ['standard', ['r5.xlarge', 'r5n.xlarge', 'r6i.xlarge']],
      ['nvme_ssd', ['r5d.xlarge', 'r5dn.xlarge', 'r6id.xlarge']],
    ]),
  },

  {
    name: '8cpu_32gb',
    instances: new Map([
      ['standard', ['m5.2xlarge', 'm6i.2xlarge']],
      ['nvme_ssd', ['m5d.2xlarge', 'm6id.2xlarge']],
    ]),
  },

  {
    name: '8cpu_64gb',
    instances: new Map([
      ['standard', ['r5.2xlarge', 'r5n.2xlarge', 'r6i.2xlarge']],
      ['nvme_ssd', ['r5d.2xlarge', 'r5dn.2xlarge', 'r6id.2xlarge']],
    ]),
  },

  {
    name: '16cpu_32gb',
    instances: new Map([
      ['standard', ['c5.4xlarge', 'c6i.4xlarge']],
      ['nvme_ssd', ['c5d.4xlarge', 'c6id.4xlarge']],
    ]),
    maxvCpus: 256,
  },

  {
    name: '16cpu_64gb',
    instances: new Map([
      ['standard', ['m5.4xlarge', 'm6i.4xlarge']],
      ['nvme_ssd', ['m5d.4xlarge', 'm6id.4xlarge']],
    ]),
    maxvCpus: 256,
  },

  {
    name: '16cpu_128gb',
    instances: new Map([
      ['standard', ['r5.4xlarge', 'r6i.4xlarge']],
      ['nvme_ssd', ['r5d.4xlarge', 'r6id.4xlarge']],
    ]),
    maxvCpus: 256,
  },

  {
    name: '32cpu_64gb',
    instances: new Map([
      ['standard', ['c5a.8xlarge', 'c6a.8xlarge']],
      ['nvme_ssd', ['c5ad.8xlarge', 'c6id.8xlarge']],
    ]),
    maxvCpus: 2048,
  },

];
