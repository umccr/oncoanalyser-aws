import {Construct} from 'constructs';

import {Stack} from "aws-cdk-lib";

import {IPipelineStack, PipelineStack} from "../common";


export class SashStack extends PipelineStack {

  constructor(scope: Construct, id: string, props: IPipelineStack) {
    super(scope, id, props);
  }

}
