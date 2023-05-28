// NOTE(SW): anti-pattern? regardless, taking this further would be to have a class with methods for each setting that
// returns based on state i.e. uses envName, workflowName, etc passed at init
export function getSettings(envName: string, workflowName: string) {

  const nfBucket = envName == "prod" ? "org.umccr.data.oncoanalyser" :  `umccr-temp-${envName}`;

  const s3Data = new Map<string, string>([
    // Shared
    ["nfBucketName", nfBucket],
    ["nfPrefixTemp", "temp_data"],
    ["nfPrefixOutput", "analysis_data"],
    ["refdataBucketName", `umccr-refdata-${envName}`],
    ["refdataPrefix", "workflow_data"],
    // oncoanalyser
    ["refdataGenomesPath", "genomes"],
    ["refdataHmfPath", "hmf_reference_data/repacks/5.32_38_0.0.2"],
    ["refDataVirusbreakendDbPath", "virusbreakend/virusbreakenddb_20210401"],
    // star-align-nf
    ["refdataStarIndexPath", "genomes/GRCh38_umccr/star_index/gencode_38/2.7.3a"],
  ]);

  const refdataBasePath = `${s3Data.get("refdataBucketName")}/${s3Data.get("refdataPrefix")}`;

  const ssmParametersShared = new Map<string, string>([
    [`/nextflow_stack/${workflowName}/nf_bucket_name`, s3Data.get("nfBucketName")!],
    [`/nextflow_stack/${workflowName}/nf_bucket_temp_prefix`, s3Data.get("nfPrefixTemp")!],
    [`/nextflow_stack/${workflowName}/nf_bucket_output_prefix`, s3Data.get("nfPrefixOutput")!],
  ]);

  let ssmParameters: Map<string, string>;
  if (workflowName == 'oncoanalyser') {
    ssmParameters = new Map([
      ...ssmParametersShared.entries(),
      [`/nextflow_stack/${workflowName}/refdata_genomes`, `${refdataBasePath}/${s3Data.get("refdataGenomesPath")!}`],
      [`/nextflow_stack/${workflowName}/refdata_hmf`, `${refdataBasePath}/${s3Data.get("refdataHmfPath")!}`],
      [`/nextflow_stack/${workflowName}/refdata_virusbreakend`, `${refdataBasePath}/${s3Data.get("refDataVirusbreakendDbPath")!}`],
    ]);
  } else if (workflowName == 'star-align-nf') {
    ssmParameters = new Map([
      ...ssmParametersShared.entries(),
      [`/nextflow_stack/${workflowName}/refdata_star_index`, `${refdataBasePath}/${s3Data.get("refdataStarIndexPath")!}`],
    ]);
  } else {
    throw new Error('Got bad workflow name');
  }

  return {
    s3Data: s3Data,
    ssmParameters: ssmParameters,
  }
}
