export const PIPELINE_BATCH_QUEUE_BASENAME: string = 'pipeline'


export enum ServiceType {
  Task = 'TASK',
  Pipeline = 'PIPELINE',
}

export enum QueueType {
  Ondemand = 'ONDEMAND',
  Spot = 'SPOT',
}

export enum InstanceStorageType {
  EbsOnly = 'EBS',
  NvmeSsdOnly = 'NVME_SSD',
}
