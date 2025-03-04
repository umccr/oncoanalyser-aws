import { Construct } from "constructs";
import { Tags } from "aws-cdk-lib";
import { ISecurityGroup, LaunchTemplate, UserData } from "aws-cdk-lib/aws-ec2";

export function createLaunchTemplate(
  construct: Construct,
  {
    content,
    securityGroup,
    launchTemplateName,
  }: {
    content: string;
    securityGroup: ISecurityGroup;
    launchTemplateName?: string;
  },
) {
  const userData = UserData.custom(content);

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
