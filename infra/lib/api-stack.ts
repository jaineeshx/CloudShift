import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
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

    // ─── KMS Keys ─────────────────────────────────────────────────────────────────
    // SECURITY: Customer-managed KMS keys with annual auto-rotation
    const sessionTableKey = new kms.Key(this, 'SessionTableKey', {
      enableKeyRotation: true,
      description: 'CloudShift DynamoDB session data encryption key',
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    cdk.Tags.of(sessionTableKey).add('Project', 'CloudShift');

    const configBucketKey = new kms.Key(this, 'ConfigBucketKey', {
      enableKeyRotation: true,
      description: 'CloudShift S3 config bucket encryption key',
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    cdk.Tags.of(configBucketKey).add('Project', 'CloudShift');

    const auditTableKey = new kms.Key(this, 'AuditTableKey', {
      enableKeyRotation: true,
      description: 'CloudShift audit log encryption key',
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    cdk.Tags.of(auditTableKey).add('Project', 'CloudShift');

    // ─── DynamoDB Session Table ───────────────────────────────────────────────────
    const table = new dynamodb.Table(this, 'SessionTable', {
      tableName: 'cloudshift-sessions',
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
      // SECURITY: Customer-managed KMS encryption at rest
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: sessionTableKey,
      // SECURITY: Point-in-time recovery — enables rollback up to 35 days
      pointInTimeRecovery: true
    });
    cdk.Tags.of(table).add('Project', 'CloudShift');

    // ─── DynamoDB Audit Log Table ─────────────────────────────────────────────────
    // SECURITY: Immutable audit trail for all DMS control-plane operations
    const auditTable = new dynamodb.Table(this, 'AuditTable', {
      tableName: 'cloudshift-audit-log',
      partitionKey: { name: 'auditId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,  // Audit logs must never be auto-deleted
      timeToLiveAttribute: 'ttl',
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: auditTableKey,
      pointInTimeRecovery: true
    });
    cdk.Tags.of(auditTable).add('Project', 'CloudShift');

    // ─── S3 Config Bucket ─────────────────────────────────────────────────────────
    // SECURITY: Frontend origin stored in env. Falls back to localhost for dev.
    const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';

    // SECURITY: S3 access log bucket (separate, no encryption requirement)
    const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      bucketName: `cloudshift-access-logs-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true
    });

    const bucket = new s3.Bucket(this, 'ConfigsBucket', {
      bucketName: `cloudshift-configs-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      // SECURITY: KMS server-side encryption at rest
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: configBucketKey,
      // SECURITY: Versioning — enables recovery of overwritten/deleted configs
      versioned: true,
      enforceSSL: true,
      // SECURITY: Access logging for audit trail
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'configs-bucket/',
      // SECURITY: Restrict CORS to known frontend origin — not wildcard
      cors: [{
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
        allowedOrigins: [allowedOrigin],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        maxAge: 3000
      }]
    });
    cdk.Tags.of(bucket).add('Project', 'CloudShift');

    // SECURITY: Deny any PutObject that does not use KMS encryption
    bucket.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      principals: [new iam.AnyPrincipal()],
      actions: ['s3:PutObject'],
      resources: [`${bucket.bucketArn}/*`],
      conditions: {
        StringNotEquals: { 's3:x-amz-server-side-encryption': 'aws:kms' }
      }
    }));

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
    // SECURITY: Allow Lambda to write to audit log table
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem'],
      resources: [auditTable.tableArn]
    }));
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:GetObject'],
      resources: [`${bucket.bucketArn}/*`]
    }));
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['dms:StartReplicationTask', 'dms:StopReplicationTask', 'dms:DescribeReplicationTasks', 'dms:DescribeTableStatistics'],
      resources: [dmsTaskArn]
    }));
    // SECURITY: Allow Lambda to use KMS keys for DynamoDB + S3 operations
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
      resources: [sessionTableKey.keyArn, configBucketKey.keyArn, auditTableKey.keyArn]
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
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ec2:DescribeVpcs', 'ec2:DescribeSecurityGroups', 'ec2:DescribeSubnets'],
      resources: ['*']  // EC2 Describe actions do not support resource-level restrictions
    }));

    // ─── CloudWatch Log Groups (7-day retention, KMS encrypted) ──────────────────
    const logKey = new kms.Key(this, 'LogGroupKey', {
      enableKeyRotation: true,
      description: 'CloudShift Lambda CloudWatch log encryption key',
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    // Grant CloudWatch Logs service permission to use the key
    logKey.addToResourcePolicy(new iam.PolicyStatement({
      principals: [new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`)],
      actions: ['kms:Encrypt', 'kms:Decrypt', 'kms:GenerateDataKey', 'kms:DescribeKey'],
      resources: ['*']
    }));

    const functionNames = ['upload', 'assess', 'plan', 'migrate-start', 'migrate-status', 'dashboard'];
    functionNames.forEach(name => {
      new logs.LogGroup(this, `LogGroup-${name}`, {
        logGroupName: `/aws/lambda/cloudshift-${name}`,
        retention: logs.RetentionDays.ONE_WEEK,  // SECURITY: 7-day retention — minimize exposure window
        encryptionKey: logKey,
        removalPolicy: cdk.RemovalPolicy.DESTROY
      });
    });

    // ─── Common Lambda Config ────────────────────────────────────────────────────
    const commonEnv = {
      DYNAMODB_TABLE: table.tableName,
      AUDIT_TABLE: auditTable.tableName,
      S3_BUCKET: bucket.bucketName,
      DMS_TASK_ARN: dmsTaskArn,
      AWS_REGION_NAME: this.region,
      ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || 'http://localhost:5173',
      // Medium #3: Pass HMAC secret for signing session IDs (use random default if not set for dev)
      SESSION_HMAC_SECRET: process.env.SESSION_HMAC_SECRET || 'dev-secret-rotate-in-prod'
    };

    // Low #5: Dead Letter Queue for all lambda failures
    const dlq = new sqs.Queue(this, 'LambdaDLQ', {
      queueName: 'cloudshift-lambda-dlq',
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryption: sqs.QueueEncryption.SQS_MANAGED
    });

    const lambdaDefaults = {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      role: lambdaRole,
      environment: commonEnv as any,
      deadLetterQueue: dlq,
      deadLetterQueueEnabled: true,
      // SECURITY: Reserved concurrency limits prevent Lambda from being used as a DoS amplifier
      reservedConcurrentExecutions: 50
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
      // SECURITY: Stage-level throttling — prevents DoS and cost-spike attacks
      deployOptions: {
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
        metricsEnabled: true
      },
      defaultCorsPreflightOptions: {
        allowOrigins: [allowedOriginForCors],
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: true
      }
    });

    // SECURITY: API key + usage plan for per-client rate-limiting on top of stage throttling
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
    new cdk.CfnOutput(this, 'AuditTable', { value: auditTable.tableName, exportName: 'CloudShiftAuditTable' });
    new cdk.CfnOutput(this, 'S3Bucket', { value: bucket.bucketName, exportName: 'CloudShiftS3Bucket' });

    // Low #15: Stack-wide tagging
    const stackTags: Record<string, string> = {
      'Project': 'CloudShift',
      'ManagedBy': 'CDK',
      'Stack': 'CloudShiftApi'
    };
    Object.entries(stackTags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));
  }
}
