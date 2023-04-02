# nextflow-stack

An AWS stack for running Nextflow pipelines on Batch using shared resources.

🚧

Highlight key aspects

* Precise resource allocation requests under SPOT pricing model
* No EBS costs and local SSD discounted via SPOT pricing
* No duplication of Batch queues
* Fusion, Wave
* Improved resume experience compared to use of ephermal workdir disk
* Ability to highly optimise instances for individual processes

Future work

* Dynamic queue selection
* Retry on SPOT pre-emption X times
* BYO bucket
* CodePipeline for deployment
* Improve configuration and data handling

## Table of contents

🚧

## Deployment

🚧

## Pipelines

🚧

### oncoanalyser

🚧

UMCCR-specific branch ([link](https://github.com/scwatts/oncoanalyser/tree/umccr))

> set to be separated into a different repo under a different name

#### Design

🚧

Diagram (avoid overlap with Overview diagram) including reference data etc

Section detailing current compromises

* GDS token access
* Migrating data from GDS to S3 for execution
* Manual Docker image build process
* Not fully optimised for speed; show timeline or similar
* Many Docker images on DockerHub, ideally would be on ECR
  * Must resolve 502 errors in Wave when pulling from grch.io or ECR
* Only broad control over processes run currently
* Passing run configuration by CLI args is somewhat clumsy
  * Alternative: JSON on remote (S3, API call); could be extended to general config

Items that need to be addressed

* **Important**: Isofox takes an expected count file that is dependent of read length
  * So we **must** be sure that we're using expected counts for the correct read length
* STAR currently does **not** accept multiple forward/reverse FASTQs [*unlikely to be needed*]
* Extra arguments for `run.sh` are ignored, error should be raised
* Job cancellation is difficult when the pipeline crashes
* I have observed a rare issue with unexpected Fusion shutdown that interrupts processing
* No resource tagging; TBD in CDK stack and have instances self-assign `Name` appropriately
* Staging data from GDS to S3 suffers significant slow down after ~one hour (bursting related?)
  * Could spin out multiple instances or high capacity instance improve transfer speed

Other notes

* Nextflow config `nextflow_aws.config` could be split into processes and input
* Include other parameters in config: HMF refdata path, VBE path, genome version, workdir
* To discuss staged data location, sorting, structure, retention
* Lifecycle of data in Nextflow S3 workdir; single workdir or per run/sample/etc

#### Usage

🚧

Diagram describing common run modes with correponding commands

Run modes (relative to CUPPA)

* WGTS
* WGS only
* WTS only
* WGTS with existing WGS
* WGTS with existing WTS
* WGTS with existing WGS and WTS

> include run resuming and use of this as an alternative to providing existing data

> note how to run any individual process/stage with the appropriate inputs

#### Notes

🚧

Other important items to note

* Fusion usually gives much better performance but not always
