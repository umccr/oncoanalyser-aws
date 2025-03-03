import { Construct } from "constructs";
import { Tags } from "aws-cdk-lib";
import { ISecurityGroup, LaunchTemplate, UserData } from "aws-cdk-lib/aws-ec2";
import { readFileSync } from "fs";
import * as path from "path";

export function createLaunchTemplate(
  construct: Construct,
  {
    securityGroup,
    launchTemplateName,
  }: {
    securityGroup: ISecurityGroup;
    launchTemplateName?: string;
  },
) {
  const userDataFilePath = path.resolve(__dirname, "ec2-user-data.txt");
  const userDataContent = readFileSync(path.resolve(userDataFilePath), "utf-8");
  const userData = UserData.custom(userDataContent);

  const ltName = launchTemplateName ?? "oncoanalyser";
  const constructId = `LaunchTemplate-${ltName}`;
  const launchTemplate = new LaunchTemplate(construct, constructId, {
    associatePublicIpAddress: true,
    userData: userData,
    securityGroup: securityGroup,
  });

  Tags.of(launchTemplate).add("Name", ltName);
  return launchTemplate;
}
