import { Construct } from "constructs";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  IBucket,
} from "aws-cdk-lib/aws-s3";
import { IGrantable, IRole } from "aws-cdk-lib/aws-iam";

/**
 * Bucket props for the oncoanalyser workflow inputs.
 */
export interface InputBucketProps {
  /**
   * The bucket name, creates a new bucket if unspecified.
   */
  readonly name?: string;
  /**
   * The bucket prefix for inputs, defaults to no prefix.
   */
  readonly prefix?: string;
  /**
   * Whether to import an existing bucket.
   */
  readonly importExisting?: boolean;
}

/**
 * Bucket props for the oncoanalyser workflow outputs.
 */
export interface OutputBucketProps {
  /**
   * The bucket name, creates a new bucket if unspecified.
   */
  readonly name?: string;
  /**
   * The bucket prefix for outputs, defaults to no prefix.
   */
  readonly prefix?: string;
  /**
   * Whether to import an existing bucket.
   */
  readonly importExisting?: boolean;
}

/**
 * Props for configuring the reference data bucket.
 */
export interface RefDataBucketProps {
  /**
   * The bucket name, creates a new bucket if unspecified.
   */
  readonly name?: string;
  /**
   * The bucket prefix for reference data, defaults to no prefix.
   */
  readonly prefix?: string;
  /**
   * Whether the Batch execution should have read only access to the bucket.
   * Enabling this will mean that running oncoanalyser with `--prepare_reference_only` will
   * fail.
   */
  readonly readOnly?: boolean;
  /**
   * Whether to import an existing bucket.
   */
  readonly importExisting?: boolean;
}

/**
 * Configurable values for the oncoanalyser workflow buckets.
 */
export interface OncoanalyserWorkflowBucketsConfig {
  /**
   * The S3 bucket to use for oncoanalyser inputs.
   */
  readonly inputBucket: InputBucketProps;
  /**
   * The S3 bucket to use for oncoanalyser outputs.
   */
  readonly outputBucket: OutputBucketProps;
  /**
   * Configuration for the reference data bucket.
   */
  readonly referenceBucket: RefDataBucketProps;
}

/**
 * Props for the oncoanalyser workflow buckets.
 */
export interface OncoanalyserWorkflowBucketsProps
  extends OncoanalyserWorkflowBucketsConfig {
  /**
   * The role for the task compute.
   */
  readonly taskComputeEnvRole: IRole;
  /**
   * The role for the pipeline compute.
   */
  readonly pipelineComputeEnvRole: IRole;
}

/**
 * The set of bucket configurations for oncoanalyser. This construct allows creating or importing buckets for inputs,
 * outputs and reference data.
 */
export class OncoanalyserWorkflowBuckets extends Construct {
  readonly inputBucket: OncoanalyserBucket;
  readonly outputBucket: OncoanalyserBucket;
  readonly referenceDataBucket: OncoanalyserBucket;

  constructor(
    scope: Construct,
    id: string,
    props: OncoanalyserWorkflowBucketsProps,
  ) {
    super(scope, id);

    this.inputBucket = new OncoanalyserBucket(this, "InputBucket", {
      name: props.inputBucket.name,
      importBucket: props.inputBucket.importExisting,
      grantRead: [props.taskComputeEnvRole, props.pipelineComputeEnvRole],
      prefix: props.inputBucket.prefix,
    });

    this.outputBucket = new OncoanalyserBucket(this, "OutputBucket", {
      name: props.outputBucket.name,
      importBucket: props.outputBucket.importExisting,
      grantRead: [props.taskComputeEnvRole, props.pipelineComputeEnvRole],
      grantWrite: [props.taskComputeEnvRole, props.pipelineComputeEnvRole],
      prefix: props.outputBucket.prefix,
    });

    this.referenceDataBucket = new OncoanalyserBucket(
      this,
      "ReferenceDataBucket",
      {
        name: props.referenceBucket.name,
        importBucket: props.referenceBucket.importExisting,
        grantRead: [props.taskComputeEnvRole, props.pipelineComputeEnvRole],
        ...((props.referenceBucket.readOnly === undefined ||
          !props.referenceBucket.readOnly) && {
          grantWrite: [props.taskComputeEnvRole, props.pipelineComputeEnvRole],
        }),
        prefix: props.referenceBucket.prefix,
      },
    );
  }
}

/**
 * Props for the oncoanalyser bucket.
 */
export interface OncoanalyserBucketProps {
  /**
   * Specify the bucket name.
   */
  readonly name?: string;
  /**
   * Whether to import the bucket. This requires `name` to be set.
   */
  readonly importBucket?: boolean;
  /**
   * Grant the principal read access to the bucket.
   */
  readonly grantRead?: IGrantable[];
  /**
   * Grant the principal write access to the bucket.
   */
  readonly grantWrite?: IGrantable[];
  /**
   * The key prefix to grant permission in the bucket.
   */
  readonly prefix?: string;
}

/**
 * A bucket used for oncoanalyser. This construct allows creating a new bucket or using an existing bucket.
 */
export class OncoanalyserBucket extends Construct {
  /**
   * The configured bucket.
   */
  readonly bucket: IBucket;
  /**
   * The prefix if it was configured.
   */
  readonly prefix?: string;

  constructor(scope: Construct, id: string, props: OncoanalyserBucketProps) {
    super(scope, id);

    if (props.importBucket) {
      if (props.name === undefined) {
        throw new Error(
          "the bucket name should be specified if importing a bucket",
        );
      } else {
        this.bucket = Bucket.fromBucketName(this, "Bucket", props.name);
      }
    } else {
      this.bucket = new Bucket(this, "Bucket", {
        bucketName: props.name,
        enforceSSL: true,
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        encryption: BucketEncryption.S3_MANAGED,
      });
    }

    this.prefix = props.prefix;

    const keyPattern =
      props.prefix !== undefined ? `${this.prefix}/*` : undefined;
    if (props.grantRead !== undefined) {
      this.grantRead(props.grantRead, keyPattern);
    }
    if (props.grantWrite !== undefined) {
      this.grantWrite(props.grantWrite, keyPattern);
    }
  }

  /**
   * Grant the principals read access to the bucket.
   */
  grantRead(grantables: IGrantable[], keyPattern?: string) {
    grantables.forEach((grantable) =>
      this.bucket.grantRead(grantable, keyPattern),
    );
  }

  /**
   * Grant the principals write access to the bucket.
   */
  grantWrite(grantables: IGrantable[], keyPattern?: string) {
    grantables.forEach((grantable) =>
      this.bucket.grantWrite(grantable, keyPattern),
    );
  }

  /**
   * Format an S3 URI using the bucket and prefix, i.e. outputs `s3://bucketName/prefix`.
   */
  formatS3Uri(): string {
    let uri = this.bucket.bucketName;
    if (this.prefix !== undefined) {
      uri = `${uri}/${this.prefix}`;
    }

    return `s3://${uri}`;
  }
}
