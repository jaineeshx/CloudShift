import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export class VpcStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly sourceSecurityGroup: ec2.SecurityGroup; // EC2 MySQL
  public readonly targetSecurityGroup: ec2.SecurityGroup; // RDS PostgreSQL
  public readonly dmsSecurityGroup: ec2.SecurityGroup;     // DMS replication

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC with public + private subnets across 2 AZs
    this.vpc = new ec2.Vpc(this, 'CloudShiftVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { cidrMask: 24, name: 'Public', subnetType: ec2.SubnetType.PUBLIC },
        { cidrMask: 24, name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }
      ]
    });
    cdk.Tags.of(this.vpc).add('Project', 'CloudShift');

    // EC2 MySQL source security group
    this.sourceSecurityGroup = new ec2.SecurityGroup(this, 'SourceSG', {
      vpc: this.vpc,
      description: 'CloudShift EC2 MySQL source',
      allowAllOutbound: true
    });
    // SECURITY: SSH access restricted to VPC CIDR only. Use AWS SSM Session Manager
    // for interactive access instead of opening SSH to the internet.
    // this.sourceSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'SSH'); // REMOVED: never allow SSH from internet
    this.sourceSecurityGroup.addIngressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.tcp(3306), 'MySQL from VPC');

    // RDS PostgreSQL target security group
    this.targetSecurityGroup = new ec2.SecurityGroup(this, 'TargetSG', {
      vpc: this.vpc,
      description: 'CloudShift RDS PostgreSQL target',
      allowAllOutbound: false
    });
    this.targetSecurityGroup.addIngressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.tcp(5432), 'PostgreSQL from VPC');

    // DMS replication instance security group
    this.dmsSecurityGroup = new ec2.SecurityGroup(this, 'DmsSG', {
      vpc: this.vpc,
      description: 'CloudShift DMS replication instance',
      allowAllOutbound: true
    });

    // Output VPC ID
    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId, exportName: 'CloudShiftVpcId' });
  }
}
