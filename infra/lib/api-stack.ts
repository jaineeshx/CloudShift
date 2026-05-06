import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as path from 'path';
import { Construct } from 'constructs';

interface ApiStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  dmsTaskArn: string;
}

export class ApiStack extends cdk.Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { vpc, dmsTaskArn } = props;

    // ─── DynamoDB Table ──────────────────────────────────────────────────────────
    const table = new dynamodb.Table(this, 'SessionTable', {
      tableName: 'cloudshift-sessions',
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl'
    });
    cdk.Tags.of(table).add('Project', 'CloudShift');

    // ─── S3 Bucket ────────────────────────────────────────────────────────────────
    // SECURITY: Frontend origin stored in SSM / env. Falls back to localhost for dev.
    // Set ALLOWED_ORIGIN env var to your deployed frontend URL (e.g. https://cloudshift.example.com)
    const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';
    const bucket = new s3.Bucket(this, 'ConfigsBucket', {
      bucketName: `cloudshift-configs-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      // SECURITY: Restrict CORS to the known frontend origin — not wildcard
      cors: [{
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
        allowedOrigins: [allowedOrigin],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        maxAge: 3000
      }]
    });
    cdk.Tags.of(bucket).add('Project', 'CloudShift');

    // ─── Lambda Execution Role ───────────────────────────────────────────────────
    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      roleName: 'cloudshift-lambda-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });
    // Scoped permissions — least privilege
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
      resources: [table.tableArn]
    }));
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:GetObject'],
      resources: [`${bucket.bucketArn}/*`]
    }));
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['dms:StartReplicationTask', 'dms:StopReplicationTask', 'dms:DescribeReplicationTasks', 'dms:DescribeTableStatistics'],
      resources: [dmsTaskArn]
    }));
    // SECURITY: Scope IAM list actions to CloudShift and DMS roles only — not all roles in account
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['iam:ListRoles', 'iam:ListAttachedRolePolicies'],
      resources: [
        `arn:aws:iam::${this.account}:role/cloudshift-*`,
        `arn:aws:iam::${this.account}:role/dms-*`
      ]
    }));
    // SECURITY: Scope RDS describe to CloudShift instances only (by tag condition)
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['rds:DescribeDBInstances'],
      resources: [`arn:aws:rds:${this.region}:${this.account}:db:*`],
      conditions: {
        StringEquals: { 'aws:ResourceTag/Project': 'CloudShift' }
      }
    }));
    // SECURITY: Scope CloudTrail lookups to DMS events only
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['cloudtrail:LookupEvents'],
      resources: ['*'],  // CloudTrail LookupEvents does not support resource-level restrictions
      conditions: {
        StringEquals: { 'cloudtrail:eventSource': 'dms.amazonaws.com' }
      }
    }));
    // SECURITY: ce:GetCostAndUsage has no resource-level scope — removed to follow least-privilege.
    // Re-add only if the dashboard genuinely needs cost data.
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ec2:DescribeVpcs', 'ec2:DescribeSecurityGroups', 'ec2:DescribeSubnets'],
      resources: ['*']  // EC2 Describe actions do not support resource-level restrictions
    }));

    // ─── Common Lambda Config ────────────────────────────────────────────────────
    const commonEnv = {
      DYNAMODB_TABLE: table.tableName,
      S3_BUCKET: bucket.bucketName,
      DMS_TASK_ARN: dmsTaskArn,
      AWS_REGION_NAME: this.region,  // avoid overriding reserved AWS_REGION
      // SECURITY: Propagate the allowed origin so Lambda CORS headers match S3
      ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || 'http://localhost:5173'
    };

    const lambdaDefaults = {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      role: lambdaRole,
      environment: commonEnv as any
    };

    // Point directly to backend logic
    const backendPath = path.join(__dirname, '../../backend');

    // ─── Lambda Functions ────────────────────────────────────────────────────────
    const uploadFn = new NodejsFunction(this, 'UploadFn', {
      ...lambdaDefaults,
      functionName: 'cloudshift-upload',
      entry: path.join(backendPath, 'functions/upload/index.js'),
    });

    const assessFn = new NodejsFunction(this, 'AssessFn', {
      ...lambdaDefaults,
      functionName: 'cloudshift-assess',
      entry: path.join(backendPath, 'functions/assess/index.js'),
    });

    const planFn = new NodejsFunction(this, 'PlanFn', {
      ...lambdaDefaults,
      functionName: 'cloudshift-plan',
      entry: path.join(backendPath, 'functions/plan/index.js'),
    });

    const migrateStartFn = new NodejsFunction(this, 'MigrateStartFn', {
      ...lambdaDefaults,
      functionName: 'cloudshift-migrate-start',
      entry: path.join(backendPath, 'functions/migrate-start/index.js'),
    });

    const migrateStatusFn = new NodejsFunction(this, 'MigrateStatusFn', {
      ...lambdaDefaults,
      functionName: 'cloudshift-migrate-status',
      entry: path.join(backendPath, 'functions/migrate-status/index.js'),
    });

    const dashboardFn = new NodejsFunction(this, 'DashboardFn', {
      ...lambdaDefaults,
      functionName: 'cloudshift-dashboard',
      timeout: cdk.Duration.seconds(60),
      entry: path.join(backendPath, 'functions/dashboard/index.js'),
    });

    // ─── API Gateway ──────────────────────────────────────────────────────────────
    // SECURITY: Restrict CORS to known frontend origin — not wildcard
    const allowedOriginForCors = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';
    const api = new apigateway.RestApi(this, 'CloudShiftApi', {
      restApiName: 'CloudShift API',
      description: 'CloudShift Migration Intelligence API',
      defaultCorsPreflightOptions: {
        allowOrigins: [allowedOriginForCors],
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: true
      }
    });

    // SECURITY: Use API key + usage plan for rate-limiting on top of IAM auth
    const apiKey = api.addApiKey('CloudShiftApiKey', {
      apiKeyName: 'cloudshift-api-key',
      description: 'CloudShift API key for rate limiting'
    });

    const usagePlan = api.addUsagePlan('CloudShiftUsagePlan', {
      name: 'CloudShift Standard Plan',
      throttle: { rateLimit: 100, burstLimit: 200 },
      quota: { limit: 10000, period: apigateway.Period.DAY }
    });
    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({ stage: api.deploymentStage });

    // SECURITY: IAM authorizer — all callers must use AWS Signature V4
    const iamAuthMethod: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.IAM,
      apiKeyRequired: true
    };

    const uploadResource = api.root.addResource('upload');
    uploadResource.addMethod('POST', new apigateway.LambdaIntegration(uploadFn), iamAuthMethod);

    const assessResource = api.root.addResource('assess');
    assessResource.addMethod('POST', new apigateway.LambdaIntegration(assessFn), iamAuthMethod);

    const planResource = api.root.addResource('plan');
    planResource.addMethod('POST', new apigateway.LambdaIntegration(planFn), iamAuthMethod);

    const migrateResource = api.root.addResource('migrate');
    migrateResource.addResource('start').addMethod('POST', new apigateway.LambdaIntegration(migrateStartFn), iamAuthMethod);
    migrateResource.addResource('status').addMethod('GET', new apigateway.LambdaIntegration(migrateStatusFn), iamAuthMethod);

    const dashboardResource = api.root.addResource('dashboard');
    dashboardResource.addMethod('GET', new apigateway.LambdaIntegration(dashboardFn), iamAuthMethod);

    this.apiUrl = api.url;

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url, exportName: 'CloudShiftApiUrl' });
    new cdk.CfnOutput(this, 'DynamoTable', { value: table.tableName, exportName: 'CloudShiftDynamoTable' });
    new cdk.CfnOutput(this, 'S3Bucket', { value: bucket.bucketName, exportName: 'CloudShiftS3Bucket' });
  }
}
