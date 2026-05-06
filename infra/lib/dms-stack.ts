import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as dms from 'aws-cdk-lib/aws-dms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

interface DmsStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  dmsSecurityGroup: ec2.SecurityGroup;
  sourceEndpoint: string;  // EC2 public IP
  targetEndpoint: string;  // RDS endpoint
  sourceInstance: ec2.Instance;
  targetDb: rds.DatabaseInstance;
}

export class DmsStack extends cdk.Stack {
  public readonly replicationTaskArn: string;

  constructor(scope: Construct, id: string, props: DmsStackProps) {
    super(scope, id, props);

    const { vpc, dmsSecurityGroup, sourceEndpoint, targetEndpoint } = props;

    // ─── DMS VPC Role ────────────────────────────────────────────────────────────
    const dmsVpcRole = new iam.Role(this, 'DmsVpcRole', {
      roleName: 'dms-vpc-role',
      assumedBy: new iam.ServicePrincipal('dms.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonDMSVPCManagementRole')]
    });

    // ─── Replication Subnet Group ─────────────────────────────────────────────
    const subnetIds = vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds;
    const subnetGroup = new dms.CfnReplicationSubnetGroup(this, 'DmsSubnetGroup', {
      replicationSubnetGroupDescription: 'CloudShift DMS subnet group',
      subnetIds,
      tags: [{ key: 'Project', value: 'CloudShift' }]
    });
    subnetGroup.node.addDependency(dmsVpcRole);

    // ─── Replication Instance ─────────────────────────────────────────────────
    const replicationInstance = new dms.CfnReplicationInstance(this, 'DmsReplicationInstance', {
      replicationInstanceClass: 'dms.t3.small',
      replicationSubnetGroupIdentifier: subnetGroup.ref,
      vpcSecurityGroupIds: [dmsSecurityGroup.securityGroupId],
      multiAz: false,
      publiclyAccessible: false,
      autoMinorVersionUpgrade: true,
      tags: [{ key: 'Project', value: 'CloudShift' }]
    });
    replicationInstance.addDependency(subnetGroup);

    // ─── Source Endpoint (MySQL on EC2) ──────────────────────────────────────
    const sourceEp = new dms.CfnEndpoint(this, 'SourceEndpoint', {
      endpointType: 'source',
      engineName: 'mysql',
      serverName: sourceEndpoint,
      port: 3306,
      databaseName: 'cloudshift_legacy',
      username: 'dms_user',
      // SECURITY: Credential retrieved from Secrets Manager — never hardcoded
      password: cdk.SecretValue.secretsManager('cloudshift/mysql/dms-user', { jsonField: 'password' }).unsafeUnwrap(),
      tags: [{ key: 'Project', value: 'CloudShift' }]
    });

    // ─── Target Endpoint (PostgreSQL RDS) ─────────────────────────────────────
    const targetEp = new dms.CfnEndpoint(this, 'TargetEndpoint', {
      endpointType: 'target',
      engineName: 'postgres',
      serverName: targetEndpoint,
      port: 5432,
      databaseName: 'cloudshift_target',
      username: 'postgres',
      password: cdk.SecretValue.secretsManager('cloudshift/rds/postgres', { jsonField: 'password' }).unsafeUnwrap(),
      sslMode: 'require',
      tags: [{ key: 'Project', value: 'CloudShift' }]
    });

    // ─── Replication Task ─────────────────────────────────────────────────────
    const replicationTask = new dms.CfnReplicationTask(this, 'DmsReplicationTask', {
      migrationType: 'full-load-and-cdc', // Full load then ongoing CDC
      replicationInstanceArn: replicationInstance.ref,
      sourceEndpointArn: sourceEp.ref,
      targetEndpointArn: targetEp.ref,
      tableMappings: JSON.stringify({
        rules: [{
          'rule-type': 'selection',
          'rule-id': '1',
          'rule-name': 'include-all',
          'object-locator': { 'schema-name': 'cloudshift_legacy', 'table-name': '%' },
          'rule-action': 'include'
        }]
      }),
      replicationTaskSettings: JSON.stringify({
        TargetMetadata: { TargetSchema: 'public', SupportLobs: true, FullLobMode: false, LobChunkSize: 64 },
        FullLoadSettings: { TargetTablePrepMode: 'DO_NOTHING', CreatePkAfterFullLoad: false },
        Logging: {
          EnableLogging: true,
          LogComponents: [
            { Id: 'TASK_MANAGER', Severity: 'LOGGER_SEVERITY_DEFAULT' },
            { Id: 'SOURCE_UNLOAD', Severity: 'LOGGER_SEVERITY_DEFAULT' },
            { Id: 'TARGET_LOAD', Severity: 'LOGGER_SEVERITY_DEFAULT' }
          ]
        }
      }),
      tags: [{ key: 'Project', value: 'CloudShift' }]
    });
    replicationTask.addDependency(replicationInstance);

    this.replicationTaskArn = replicationTask.ref;

    // Outputs
    new cdk.CfnOutput(this, 'DmsTaskArn', { value: replicationTask.ref, exportName: 'CloudShiftDmsTaskArn' });
    new cdk.CfnOutput(this, 'DmsInstanceArn', { value: replicationInstance.ref, exportName: 'CloudShiftDmsInstanceArn' });
  }
}
