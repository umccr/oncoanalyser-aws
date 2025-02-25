import * as constants from './constants'
import {data} from "aws-cdk/lib/logging";


export const taskQueueTypes = [
  constants.QueueType.Ondemand,
  //constants.QueueType.Spot,
];

export const taskInstanceStorageTypes = [
  constants.InstanceStorageType.EbsOnly,
  constants.InstanceStorageType.NvmeSsdOnly,
];

export const maxvCpusDefault = 128;

export const dataAccountId = '503977275616';
export const defaultRegion = 'ap-southeast-2';

class Shared {
  constructor(public envName: string, public workflowName: string) {};

  getNfBucket() {
    return this.envName == 'prod' ? 'org.umccr.data.oncoanalyser' : `umccr-temp-${this.envName}`;
  }

  getOrcabusDataBucket() {
    return `pipeline-${this.envName}-cache-${dataAccountId}-${defaultRegion}`
  }

  getOrcabusDataPrefix(): string {
    if (this.envName == 'dev'){
      return 'byob-icav2/development/'
    }
    if (this.envName == 'stg'){
      return 'byob-icav2/staging/'
    }
    if (this.envName == 'prod'){
      return 'byob-icav2/production/'
    }
    throw new Error("Don't know how to handle envName: " + this.envName);
  }

  getRefdataBasePath() {
    return `${this.getS3Data().get('refdataBucketName')}/${this.getS3Data().get('refdataPrefix')}`;
  }

  getS3Data() {
    return new Map<string, string>([
      ['nfBucketName', this.getNfBucket()],
      ['nfPrefixTemp', 'temp_data'],
      ['nfPrefixOutput', 'analysis_data'],
      ['orcabusS3BucketName', this.getOrcabusDataBucket()],
      ['orcabusS3ByobPrefix', this.getOrcabusDataPrefix()],
      ['orcabusS3PrefixTemp', `${this.getOrcabusDataPrefix()}cache/${this.workflowName}`],
      ['orcabusS3PrefixOutput', `${this.getOrcabusDataPrefix()}analysis/${this.workflowName}`],
      ['refdataBucketName', `umccr-refdata-${this.envName}`],
      ['refdataPrefix', 'workflow_data'],
    ]);
  }

  getSsmParameters() {
    return new Map<string, string>([
      [`/nextflow_stack/${this.workflowName}/nf_bucket_name`, this.getS3Data().get('nfBucketName')!],
      [`/nextflow_stack/${this.workflowName}/nf_bucket_temp_prefix`, this.getS3Data().get('nfPrefixTemp')!],
      [`/nextflow_stack/${this.workflowName}/nf_bucket_output_prefix`, this.getS3Data().get('nfPrefixOutput')!],
    ]);
  }
}


export class StarAlignNf extends Shared {
  readonly versionTag = 'v0.1.0'

  getS3Data() {
    return new Map<string, string>([
      ...super.getS3Data().entries(),
      ['refdataStarIndexPath', 'genomes/GRCh38_umccr/star_index/gencode_38/2.7.3a'],
    ]);
  }

  getSsmParameters() {
    return new Map<string, string>([
      ...super.getSsmParameters().entries(),
      [`/nextflow_stack/${this.workflowName}/refdata_star_index`, `${this.getRefdataBasePath()}/${this.getS3Data().get('refdataStarIndexPath')!}`],
      [`/nextflow_stack/${this.workflowName}/pipeline_version_tag`, this.versionTag],
    ]);
  }
}


export class Oncoanalyser extends Shared {
  readonly versionTag = '42ee926'

  getS3Data() {
    return new Map<string, string>([
      ...super.getS3Data().entries(),
      ['refdataGenomesPath', 'genomes'],
      ['refdataHmfPath', 'hmf_reference_data/hmftools/5.34_38--2'],
      ['refDataVirusbreakendDbPath', 'databases/virusbreakend/virusbreakenddb_20210401'],
    ]);
  }

  getSsmParameters() {
    return new Map<string, string>([
      ...super.getSsmParameters().entries(),
      [`/nextflow_stack/${this.workflowName}/refdata_genomes`, `${this.getRefdataBasePath()}/${this.getS3Data().get('refdataGenomesPath')!}`],
      [`/nextflow_stack/${this.workflowName}/refdata_hmf`, `${this.getRefdataBasePath()}/${this.getS3Data().get('refdataHmfPath')!}`],
      [`/nextflow_stack/${this.workflowName}/refdata_virusbreakend`, `${this.getRefdataBasePath()}/${this.getS3Data().get('refDataVirusbreakendDbPath')!}`],
      [`/nextflow_stack/${this.workflowName}/pipeline_version_tag`, this.versionTag],
    ]);
  }
}


export class Sash extends Shared {
  readonly versionTag = 'v0.5.0'

  getSsmParameters() {
    return new Map<string, string>([
      ...super.getSsmParameters().entries(),
      [`/nextflow_stack/${this.workflowName}/refdata_basepath`, `${this.getRefdataBasePath()}`],
      [`/nextflow_stack/${this.workflowName}/pipeline_version_tag`, this.versionTag],
    ]);
  }
}
