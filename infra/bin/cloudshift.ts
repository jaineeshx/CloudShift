#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { VpcStack } from '../lib/vpc-stack';
import { DatabaseStack } from '../lib/database-stack';
import { DmsStack } from '../lib/dms-stack';
import { ApiStack } from '../lib/api-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
};

const vpcStack = new VpcStack(app, 'CloudShiftVpc', { env });

const dbStack = new DatabaseStack(app, 'CloudShiftDb', {
  env,
  vpc: vpcStack.vpc,
  sourceSecurityGroup: vpcStack.sourceSecurityGroup,
  targetSecurityGroup: vpcStack.targetSecurityGroup
});
dbStack.addDependency(vpcStack);

const dmsStack = new DmsStack(app, 'CloudShiftDms', {
  env,
  vpc: vpcStack.vpc,
  dmsSecurityGroup: vpcStack.dmsSecurityGroup,
  sourceEndpoint: dbStack.mysqlPrivateEndpoint,
  targetEndpoint: dbStack.postgresEndpoint,
  sourceInstance: dbStack.ec2Instance,
  targetDb: dbStack.rdsInstance
});
dmsStack.addDependency(dbStack);

const apiStack = new ApiStack(app, 'CloudShiftApi', {
  env,
  vpc: vpcStack.vpc,
  dmsTaskArn: dmsStack.replicationTaskArn
});
apiStack.addDependency(dmsStack);

app.synth();
