// NOTE(SW): anti-pattern? regardless, taking this further would be to have a class with methods for each setting that
// returns based on state i.e. uses envName, workflowName, etc passed at init
export function getSettings(envName: string, workflowName: string) {

  const s3Data = new Map<string, string>([
    // Shared
    ["nfCacheBucket", `umccr-temp-${envName}`],
    ["nfCachePrefix", `${workflowName}/scratch`],
    ["nfStagingBucket", `umccr-temp-${envName}`],
    ["nfStagingPrefix", `${workflowName}/staging`],
    ["nfOutputBucket", `umccr-temp-${envName}`],
    ["nfOutputPrefix", `${workflowName}/output`],
    ["refdataBucket", `umccr-refdata-${envName}`],
    ["refdataPrefix", "workflow_data"],
    // oncoanalyser
    ["refdataGenomesPath", "genomes"],
    ["refdataHmfPath", "hmf_reference_data/repacks/5.32+dev1_38_0.0.2/"],
    ["refDataVirusbreakendDbPath", "virusbreakend/virusbreakenddb_20210401/"],
    // star-align-nf
    ["refdataStarIndexPath", "genomes/GRCh38_umccr/star_index/gencode_38/2.7.3a/"],
  ]);

  const refdataBasePath = `${s3Data.get("refdataBucket")}/${s3Data.get("refdataPrefix")}`;

  const ssmParametersShared = new Map<string, string>([
    [`/nextflow_stack/${workflowName}/cache_bucket`, s3Data.get("nfCacheBucket")!],
    [`/nextflow_stack/${workflowName}/cache_prefix`, s3Data.get("nfCachePrefix")!],
    [`/nextflow_stack/${workflowName}/staging_bucket`, s3Data.get("nfStagingBucket")!],
    [`/nextflow_stack/${workflowName}/staging_prefix`, s3Data.get("nfStagingPrefix")!],
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
