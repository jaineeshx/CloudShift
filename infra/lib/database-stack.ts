import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as dms from 'aws-cdk-lib/aws-dms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

interface DatabaseStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  sourceSecurityGroup: ec2.SecurityGroup;
  targetSecurityGroup: ec2.SecurityGroup;
}

export class DatabaseStack extends cdk.Stack {
  public readonly ec2Instance: ec2.Instance;
  public readonly rdsInstance: rds.DatabaseInstance;
  public readonly mysqlEndpoint: string;
  public readonly mysqlPrivateEndpoint: string;
  public readonly postgresEndpoint: string;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { vpc, sourceSecurityGroup, targetSecurityGroup } = props;

    // ─── EC2 MySQL Source ("On-Prem") ─────────────────────────────────────────

    // SECURITY: MySQL DMS user credential stored in Secrets Manager, not hardcoded
    const mysqlDmsSecret = new secretsmanager.Secret(this, 'MysqlDmsSecret', {
      secretName: 'cloudshift/mysql/dms-user',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'dms_user' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\\'' // Characters that break MySQL IDENTIFIED BY syntax
      }
    });

    const userData = ec2.UserData.forLinux();
    // Retrieve password at runtime from Secrets Manager so it is never baked into UserData
    userData.addCommands(
      'yum update -y',
      'yum install -y mariadb-server jq aws-cli',
      'systemctl start mariadb',
      'systemctl enable mariadb',
      // Fetch password from Secrets Manager at runtime
      `DMS_PASS=$(aws secretsmanager get-secret-value --secret-id cloudshift/mysql/dms-user --region ${cdk.Aws.REGION} --query SecretString --output text | jq -r .password)`,
      // Seed Database
      "cat << 'EOF' > /tmp/setup.sql",
      "CREATE DATABASE IF NOT EXISTS cloudshift_legacy;",
      "USE cloudshift_legacy;",
      "CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(100), email VARCHAR(200), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);",
      "CREATE TABLE IF NOT EXISTS products (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(200), price DECIMAL(10,2), stock INT, category VARCHAR(100));",
      "CREATE TABLE IF NOT EXISTS orders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, total DECIMAL(10,2), status VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);",
      "CREATE TABLE IF NOT EXISTS sessions (id VARCHAR(36) PRIMARY KEY, user_id INT, data TEXT, expires_at TIMESTAMP);",
      "CREATE TABLE IF NOT EXISTS audit_log (id INT AUTO_INCREMENT PRIMARY KEY, action VARCHAR(100), entity VARCHAR(100), entity_id INT, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP);",
      "INSERT INTO users (username, email) VALUES ('alice','alice@legacy.com'),('bob','bob@legacy.com'),('carol','carol@legacy.com');",
      "INSERT INTO products (name, price, stock, category) VALUES ('Widget A',9.99,100,'Electronics'),('Gadget B',24.99,50,'Electronics'),('Tool C',4.99,200,'Hardware');",
      "INSERT INTO orders (user_id, total, status) VALUES (1,34.98,'completed'),(2,9.99,'pending'),(3,49.98,'completed');",
      "EOF",
      // SECURITY: GRANT uses shell-interpolated $DMS_PASS fetched from Secrets Manager — not hardcoded
      "echo \"GRANT ALL PRIVILEGES ON *.* TO 'dms_user'@'%' IDENTIFIED BY '$DMS_PASS'; FLUSH PRIVILEGES;\" >> /tmp/setup.sql",
      'mysql -u root < /tmp/setup.sql || true',
      // Securely remove setup script to prevent credential exposure in filesystem
      'shred -u /tmp/setup.sql',
      // Enable binary logging for CDC
      'echo "[mysqld]" >> /etc/my.cnf',
      'echo "log_bin=mysql-bin" >> /etc/my.cnf',
      'echo "binlog_format=ROW" >> /etc/my.cnf',
      'echo "expire_logs_days=1" >> /etc/my.cnf',
      'echo "server_id=1" >> /etc/my.cnf',
      'systemctl restart mariadb'
    );

    // SECURITY: EC2 placed in PRIVATE subnet — not publicly reachable from internet.
    // Access via AWS Systems Manager Session Manager only (no SSH, no public IP).
    this.ec2Instance = new ec2.Instance(this, 'MySQLSource', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }, // SECURITY: private subnet
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux2(),
      securityGroup: sourceSecurityGroup,
      userData,
      userDataCausesReplacement: true,
      // SECURITY: no key pair — use SSM Session Manager for console access
      ssmSessionPermissions: true,
      // SECURITY: IMDSv2 required — prevents SSRF attacks from stealing instance credentials
      requireImdsv2: true
    });

    // SECURITY: Grant EC2 instance access to read its own Secrets Manager secret
    mysqlDmsSecret.grantRead(this.ec2Instance);
    cdk.Tags.of(this.ec2Instance).add('Name', 'CloudShift-MySQL-Source');
    cdk.Tags.of(this.ec2Instance).add('Project', 'CloudShift');

    this.mysqlEndpoint = this.ec2Instance.instancePrivateIp;  // SECURITY: private IP only
    this.mysqlPrivateEndpoint = this.ec2Instance.instancePrivateIp;

    // ─── RDS PostgreSQL Target ──────────────────────────────────────────────────
    const dbSubnetGroup = new rds.SubnetGroup(this, 'DBSubnetGroup', {
      vpc,
      description: 'CloudShift RDS subnet group',
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }
    });

    this.rdsInstance = new rds.DatabaseInstance(this, 'PostgresTarget', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16_3 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [targetSecurityGroup],
      subnetGroup: dbSubnetGroup,
      databaseName: 'cloudshift_target',
      credentials: rds.Credentials.fromGeneratedSecret('postgres', { secretName: 'cloudshift/rds/postgres' }),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      multiAz: false,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      backupRetention: cdk.Duration.days(1),
      // SECURITY: IAM database authentication — short-lived tokens instead of long-lived passwords
      iamAuthentication: true
    });
    cdk.Tags.of(this.rdsInstance).add('Project', 'CloudShift');

    this.postgresEndpoint = this.rdsInstance.dbInstanceEndpointAddress;

    // SECURITY: Export private IP only — no public IP exposed
    new cdk.CfnOutput(this, 'MySQLSourcePrivateIP', { value: this.ec2Instance.instancePrivateIp });
    new cdk.CfnOutput(this, 'PostgresEndpoint', { value: this.rdsInstance.dbInstanceEndpointAddress, exportName: 'CloudShiftPostgresEndpoint' });
    new cdk.CfnOutput(this, 'PostgresSecretArn', { value: this.rdsInstance.secret?.secretArn || '', exportName: 'CloudShiftPostgresSecretArn' });
    new cdk.CfnOutput(this, 'MysqlDmsSecretArn', { value: mysqlDmsSecret.secretArn, exportName: 'CloudShiftMysqlDmsSecretArn' });

    // Low #15: Stack-wide tagging for cost allocation, compliance, and incident ownership
    const stackTags: Record<string, string> = {
      'Project': 'CloudShift',
      'ManagedBy': 'CDK',
      'Stack': 'CloudShiftDb'
    };
    Object.entries(stackTags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    // Explicitly keep the private IP export alive to prevent CloudFormation cross-stack deadlock during transition
    this.exportValue(this.ec2Instance.instancePrivateIp);
  }
}
