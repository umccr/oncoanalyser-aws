import {Environment} from "aws-cdk-lib";

export const AWS_DEV_ACCOUNT = "843407916570";
export const AWS_DEV_REGION = "ap-southeast-2";

export const AWS_BUILD_ACCOUNT = "383856791668"
export const AWS_BUILD_REGION = "ap-southeast-2"

export const AWS_STG_ACCOUNT = "455634345446"
export const AWS_STG_REGION = "ap-southeast-2"

export const AWS_ENV_DEV: Environment = {
    account: AWS_DEV_ACCOUNT,
    region: AWS_DEV_REGION,
}

export const AWS_ENV_BUILD: Environment = {
    account: AWS_BUILD_ACCOUNT,
    region: AWS_BUILD_REGION
}

export const AWS_ENV_STG: Environment = {
    account: AWS_STG_ACCOUNT,
    region: AWS_STG_REGION
}

export const AWS_ENV_PROD: Environment = {
    account: AWS_STG_ACCOUNT,
    region: AWS_STG_REGION
}

export const NXF_CACHE_BUCKET_DEV = "umccr-temp-dev"
export const NXF_CACHE_BUCKET_STG = "umccr-temp-staging"
export const NXF_CACHE_BUCKET_PROD = "umccr-temp-prod"

export const NXF_CACHE_PREFIX_DEV = "stephen/oncoanalyser-awsbatch/scratch/"
export const NXF_CACHE_PREFIX_STG = "stephen/oncoanalyser-awsbatch/scratch/"  // FIXME
export const NXF_CACHE_PREFIX_PROD = "stephen/oncoanalyser-awsbatch/scratch/" // FIXME

export const NXF_STAGING_BUCKET_DEV = "umccr-temp-dev"
export const NXF_STAGING_BUCKET_STG = "umccr-temp-staging"  // FIXME
export const NXF_STAGING_BUCKET_PROD = "umccr-temp-prod" // FIXME

export const NXF_STAGING_PREFIX_DEV = "stephen/gds_staging_dev"
export const NXF_STAGING_PREFIX_STG = "stephen/gds_staging_dev"  // FIXME
export const NXF_STAGING_PREFIX_PROD = "stephen/gds_staging_dev" // FIXME

export const REFDATA_BUCKET_DEV = "umccr-research-dev"
export const REFDATA_BUCKET_STG = "umccr-research-staging"
export const REFDATA_BUCKET_PROD = "umccr-research-prod"

export const NXF_REFDATA_PREFIX_DEV = "stephen/oncoanalyser_data/"
export const NXF_REFDATA_PREFIX_STG = "stephen/oncoanalyser_data/"  // FIXME
export const NXF_REFDATA_PREFIX_PROD = "stephen/oncoanalyser_data/"  // FIXME

export const HMF_REFDATA_PATH_DEV = `s3://${REFDATA_BUCKET_DEV}/${NXF_REFDATA_PREFIX_DEV}/hmf_reference_data/repacks/5.32+dev1_38_0.0.1/`
export const HMF_REFDATA_PATH_STG = `s3://${REFDATA_BUCKET_STG}/${NXF_REFDATA_PREFIX_STG}/hmf_reference_data/repacks/5.32+dev1_38_0.0.1/`  // FIXME
export const HMF_REFDATA_PATH_PROD = `s3://${REFDATA_BUCKET_PROD}/${NXF_REFDATA_PREFIX_PROD}/hmf_reference_data/repacks/5.32+dev1_38_0.0.1/` // FIXME

export const VIRUSBREAKEND_DB_PATH_DEV = `s3://${REFDATA_BUCKET_DEV}/${NXF_REFDATA_PREFIX_DEV}/virusbreakend/virusbreakenddb_20210401/`
export const VIRUSBREAKEND_DB_PATH_STG = `s3://${REFDATA_BUCKET_STG}/${NXF_REFDATA_PREFIX_STG}/virusbreakend/virusbreakenddb_20210401/`  // FIXME
export const VIRUSBREAKEND_DB_PATH_PROD = `s3://${REFDATA_BUCKET_PROD}/${NXF_REFDATA_PREFIX_PROD}/virusbreakend/virusbreakenddb_20210401/`  // FIXME

export const GENOMES_PATH_DEV = `s3://${REFDATA_BUCKET_DEV}/${NXF_REFDATA_PREFIX_DEV}/genomes/`
export const GENOMES_PATH_STG = `s3://${REFDATA_BUCKET_STG}/${NXF_REFDATA_PREFIX_STG}/genomes/`  // FIXME
export const GENOMES_PATH_PROD = `s3://${REFDATA_BUCKET_PROD}/${NXF_REFDATA_PREFIX_PROD}/genomes/` // FIXME

// SSM Parameters
export const SSM_PARAMETERS = {
    "DEV": new Map<string, string>([
            ["/oncoanalyser/nxf/cache_bucket", NXF_CACHE_BUCKET_DEV],
            ["/oncoanalyser/nxf/cache_prefix", NXF_CACHE_PREFIX_DEV],
            ["/oncoanalyser/nxf/staging_bucket", NXF_STAGING_BUCKET_DEV],
            ["/oncoanalyser/nxf/staging_prefix", NXF_STAGING_PREFIX_DEV],
            ["/oncoanalyser/reference_data/hmf", HMF_REFDATA_PATH_DEV],
            ["/oncoanalyser/reference_data/genomes", GENOMES_PATH_DEV],
            ["/oncoanalyser/reference_data/virusbreakend", VIRUSBREAKEND_DB_PATH_DEV]
        ]
    ),
    "STG": new Map<string, string>([
            ["/oncoanalyser/nxf/cache_bucket", NXF_CACHE_BUCKET_STG],
            ["/oncoanalyser/nxf/cache_prefix", NXF_CACHE_PREFIX_STG],
            ["/oncoanalyser/nxf/staging_bucket", NXF_STAGING_BUCKET_STG],
            ["/oncoanalyser/nxf/staging_prefix", NXF_STAGING_PREFIX_STG],
            ["/oncoanalyser/reference_data/hmf", HMF_REFDATA_PATH_STG],
            ["/oncoanalyser/reference_data/genomes", GENOMES_PATH_STG],
            ["/oncoanalyser/reference_data/virusbreakend", VIRUSBREAKEND_DB_PATH_STG]
        ]
    ),
    "PROD": new Map<string, string>([
            ["/oncoanalyser/nxf/cache_bucket", NXF_CACHE_BUCKET_PROD],
            ["/oncoanalyser/nxf/cache_prefix", NXF_CACHE_PREFIX_PROD],
            ["/oncoanalyser/nxf/staging_bucket", NXF_STAGING_BUCKET_PROD],
            ["/oncoanalyser/nxf/staging_prefix", NXF_STAGING_PREFIX_PROD],
            ["/oncoanalyser/reference_data/hmf", HMF_REFDATA_PATH_PROD],
            ["/oncoanalyser/reference_data/genomes", GENOMES_PATH_PROD],
            ["/oncoanalyser/reference_data/virusbreakend", VIRUSBREAKEND_DB_PATH_PROD]
        ]
    )
}
