const { getSession, updateSession, respond } = require('../../shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  try {
    const { sessionId } = event.body ? JSON.parse(event.body) : (event.queryStringParameters || {});
    if (!sessionId) return respond(400, { error: 'Missing sessionId' });

    const session = await getSession(sessionId);
    if (!session) return respond(404, { error: 'Session not found' });

    const { metadata, assessment } = session;
    const plan = generateWavePlan(metadata, assessment);

    await updateSession(sessionId, { status: 'planned', wavePlan: plan });

    return respond(200, { sessionId, wavePlan: plan });
  } catch (err) {
    console.error('Plan error:', err);
    return respond(500, { error: err.message });
  }
};

function generateWavePlan(meta, assessment) {
  const risk = assessment?.risk || 'MEDIUM';
  const dbType = (meta?.dbType || 'mysql').toLowerCase();
  const isOracle = dbType.includes('oracle');

  const waves = [
    {
      waveNumber: 1,
      name: 'Foundation & Stateless Services',
      description: 'Migrate stateless compute, IAM setup, VPC provisioning',
      duration: '3-5 days',
      risk: 'LOW',
      riskColor: '#22c55e',
      services: [
        {
          name: 'VPC & Networking',
          type: 'infrastructure',
          action: 'Provision VPC with public/private subnets, NAT Gateway, Security Groups',
          awsService: 'Amazon VPC',
          status: 'pending',
          dependencies: [],
          estimatedHours: 4
        },
        {
          name: 'IAM Roles & Policies',
          type: 'security',
          action: 'Create least-privilege IAM roles for all services',
          awsService: 'AWS IAM',
          status: 'pending',
          dependencies: [],
          estimatedHours: 2
        },
        {
          name: 'Static Assets / CDN',
          type: 'compute',
          action: 'Migrate static assets to S3, configure CloudFront distribution',
          awsService: 'Amazon S3 + CloudFront',
          status: 'pending',
          dependencies: ['VPC & Networking'],
          estimatedHours: 3
        },
        {
          name: 'Application Servers (Stateless)',
          type: 'compute',
          action: `Containerize ${meta?.framework || 'application'} and deploy to ECS Fargate or EC2`,
          awsService: 'Amazon ECS / EC2',
          status: 'pending',
          dependencies: ['VPC & Networking', 'IAM Roles & Policies'],
          estimatedHours: 8
        }
      ],
      riskFlags: [
        { flag: 'Security group misconfiguration', mitigation: 'Use CDK/Terraform security group templates', severity: 'LOW' }
      ]
    },
    {
      waveNumber: 2,
      name: 'Stateful Services & Caching',
      description: 'Migrate session state, caching layers, message queues',
      duration: '3-5 days',
      risk: 'MEDIUM',
      riskColor: '#f97316',
      services: [
        {
          name: 'Session / Cache Layer',
          type: 'cache',
          action: 'Migrate Redis/Memcached to Amazon ElastiCache',
          awsService: 'Amazon ElastiCache',
          status: 'pending',
          dependencies: ['VPC & Networking'],
          estimatedHours: 4
        },
        {
          name: 'Message Queue',
          type: 'messaging',
          action: 'Replace on-prem MQ with Amazon SQS / SNS',
          awsService: 'Amazon SQS',
          status: 'pending',
          dependencies: ['IAM Roles & Policies'],
          estimatedHours: 3
        },
        {
          name: 'File Storage',
          type: 'storage',
          action: 'Migrate file system to Amazon EFS or S3',
          awsService: 'Amazon EFS / S3',
          status: 'pending',
          dependencies: ['VPC & Networking'],
          estimatedHours: 4
        }
      ],
      riskFlags: [
        { flag: 'Data consistency during cache migration', mitigation: 'Implement dual-write strategy during cutover', severity: 'MEDIUM' },
        { flag: 'Message ordering guarantees', mitigation: 'Use SQS FIFO queues if ordering is critical', severity: 'LOW' }
      ]
    },
    {
      waveNumber: 3,
      name: 'Database Migration (Live DMS)',
      description: `Live migration of ${dbType.toUpperCase()} → Aurora PostgreSQL via AWS DMS`,
      duration: risk === 'HIGH' ? '5-7 days' : '2-3 days',
      risk: risk === 'HIGH' ? 'HIGH' : 'MEDIUM',
      riskColor: risk === 'HIGH' ? '#ef4444' : '#f97316',
      services: [
        ...(isOracle ? [{
          name: 'Schema Conversion (SCT)',
          type: 'migration',
          action: 'Run AWS Schema Conversion Tool to convert Oracle DDL → PostgreSQL',
          awsService: 'AWS SCT',
          status: 'pending',
          dependencies: ['VPC & Networking'],
          estimatedHours: 16
        }] : []),
        {
          name: 'RDS Aurora PostgreSQL',
          type: 'database',
          action: 'Provision Aurora PostgreSQL cluster in private subnet',
          awsService: 'Amazon Aurora PostgreSQL',
          status: 'pending',
          dependencies: ['VPC & Networking', 'IAM Roles & Policies'],
          estimatedHours: 2
        },
        {
          name: 'DMS Replication Instance',
          type: 'migration',
          action: 'Create DMS replication instance (dms.t3.micro)',
          awsService: 'AWS DMS',
          status: 'pending',
          dependencies: ['RDS Aurora PostgreSQL'],
          estimatedHours: 1
        },
        {
          name: 'Full-Load Migration',
          type: 'migration',
          action: `Migrate all tables from ${dbType.toUpperCase()} source to PostgreSQL target`,
          awsService: 'AWS DMS',
          status: 'pending',
          dependencies: ['DMS Replication Instance'],
          estimatedHours: Math.ceil((meta?.estimatedDataGB || 10) / 5)
        },
        {
          name: 'CDC (Change Data Capture)',
          type: 'migration',
          action: 'Enable ongoing replication for zero-downtime cutover',
          awsService: 'AWS DMS (CDC)',
          status: 'pending',
          dependencies: ['Full-Load Migration'],
          estimatedHours: 2
        },
        {
          name: 'DNS Cutover',
          type: 'cutover',
          action: 'Update application connection strings, validate, cut over traffic',
          awsService: 'Amazon Route 53',
          status: 'pending',
          dependencies: ['CDC (Change Data Capture)'],
          estimatedHours: 1
        }
      ],
      riskFlags: [
        { flag: 'Data loss during cutover window', mitigation: 'Keep CDC running until all connections drained', severity: 'HIGH' },
        { flag: 'Schema incompatibility', mitigation: isOracle ? 'Run SCT first, fix conversion errors manually' : 'Run DMS pre-migration assessment report', severity: 'MEDIUM' },
        { flag: 'Replication lag under load', mitigation: 'Monitor CloudWatch DMS metrics, scale replication instance if > 30s lag', severity: 'MEDIUM' }
      ]
    }
  ];

  const totalHours = waves.reduce((sum, w) => sum + w.services.reduce((s, svc) => s + svc.estimatedHours, 0), 0);

  return {
    planId: `plan-${Date.now()}`,
    totalWaves: 3,
    estimatedTotalHours: totalHours,
    estimatedWeeks: Math.ceil(totalHours / 40),
    waves,
    generatedAt: new Date().toISOString(),
    awsRegion: process.env.AWS_REGION || 'us-east-1',
    targetArchitecture: {
      compute: 'Amazon ECS Fargate',
      database: 'Aurora PostgreSQL',
      cache: 'ElastiCache Redis',
      storage: 'Amazon S3',
      cdn: 'CloudFront',
      networking: 'VPC with private subnets'
    }
  };
}
