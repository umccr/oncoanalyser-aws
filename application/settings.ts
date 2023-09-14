class Shared {

  constructor(public envName: string, public workflowName: string) {};

  getNfBucket() {
    return this.envName == "prod" ? "org.umccr.data.oncoanalyser" : `umccr-temp-${this.envName}`;
  }

  getRefdataBasePath() {
    return `${this.getS3Data().get("refdataBucketName")}/${this.getS3Data().get("refdataPrefix")}`;
  }

  getS3Data() {
    return new Map<string, string>([
      ["nfBucketName", this.getNfBucket()],
      ["nfPrefixTemp", "temp_data"],
      ["nfPrefixOutput", "analysis_data"],
      ["refdataBucketName", `umccr-refdata-${this.envName}`],
      ["refdataPrefix", "workflow_data"],
    ]);
  }

  getSsmParameters() {
    return new Map<string, string>([
      [`/nextflow_stack/${this.workflowName}/nf_bucket_name`, this.getS3Data().get("nfBucketName")!],
      [`/nextflow_stack/${this.workflowName}/nf_bucket_temp_prefix`, this.getS3Data().get("nfPrefixTemp")!],
      [`/nextflow_stack/${this.workflowName}/nf_bucket_output_prefix`, this.getS3Data().get("nfPrefixOutput")!],
    ]);
  }

}


export class StarAlignNf extends Shared {

  readonly versionTag = "v0.1.0"

  getS3Data() {
    return new Map<string, string>([
      ...super.getS3Data().entries(),
      ["refdataStarIndexPath", "genomes/GRCh38_umccr/star_index/gencode_38/2.7.3a"],
    ]);
  }

  getSsmParameters() {
    return new Map<string, string>([
      ...super.getSsmParameters().entries(),
      [`/nextflow_stack/${this.workflowName}/refdata_star_index`, `${this.getRefdataBasePath()}/${this.getS3Data().get("refdataStarIndexPath")!}`],
      [`/nextflow_stack/${this.workflowName}/pipeline_version_tag`, this.versionTag],
    ]);
  }

}


export class Oncoanalyser extends Shared {

  readonly versionTag = "v0.1.1";

  getS3Data() {
    return new Map<string, string>([
      ...super.getS3Data().entries(),
      ["refdataGenomesPath", "genomes"],
      ["refdataHmfPath", "hmf_reference_data/hmftools/5.33_38--0"],
      ["refDataVirusbreakendDbPath", "virusbreakend/virusbreakenddb_20210401"],
    ]);
  }

  getSsmParameters() {
    return new Map<string, string>([
      ...super.getSsmParameters().entries(),
      [`/nextflow_stack/${this.workflowName}/refdata_genomes`, `${this.getRefdataBasePath()}/${this.getS3Data().get("refdataGenomesPath")!}`],
      [`/nextflow_stack/${this.workflowName}/refdata_hmf`, `${this.getRefdataBasePath()}/${this.getS3Data().get("refdataHmfPath")!}`],
      [`/nextflow_stack/${this.workflowName}/refdata_virusbreakend`, `${this.getRefdataBasePath()}/${this.getS3Data().get("refDataVirusbreakendDbPath")!}`],
      [`/nextflow_stack/${this.workflowName}/pipeline_version_tag`, this.versionTag],
    ]);
  }

}


export class Sash extends Shared {

  readonly versionTag = "v0.1.7";

  getSsmParameters() {
    return new Map<string, string>([
      ...super.getSsmParameters().entries(),
      [`/nextflow_stack/${this.workflowName}/refdata_basepath`, `${this.getRefdataBasePath()}`],
      [`/nextflow_stack/${this.workflowName}/pipeline_version_tag`, this.versionTag],
    ]);
  }

}
