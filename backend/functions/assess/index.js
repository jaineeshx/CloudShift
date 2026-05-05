const { getSession, updateSession, respond } = require('../../shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  try {
    const { sessionId } = event.body ? JSON.parse(event.body) : (event.queryStringParameters || {});
    if (!sessionId) return respond(400, { error: 'Missing sessionId' });

    const session = await getSession(sessionId);
    if (!session) return respond(404, { error: 'Session not found' });

    const { config, metadata } = session;
    const score = runHeuristicAssessment(config, metadata);

    await updateSession(sessionId, { status: 'assessed', assessment: score });

    return respond(200, { sessionId, assessment: score });
  } catch (err) {
    console.error('Assess error:', err);
    return respond(500, { error: err.message });
  }
};

function runHeuristicAssessment(config, meta) {
  const categories = {};

  // ─── SECURITY (0–20) ────────────────────────────────────────────────────────
  let security = 0;
  if (meta.hasSSL) security += 6;
  if (meta.hasAuth) security += 5;
  if (config.encryption?.atRest) security += 3;
  if (config.encryption?.inTransit) security += 3;
  if (config.vpc || config.network?.isolated) security += 3;
  categories.security = {
    score: Math.min(security, 20),
    label: 'Security',
    issues: buildSecurityIssues(config, meta),
    color: '#ef4444'
  };

  // ─── COMPATIBILITY (0–20) ────────────────────────────────────────────────────
  let compat = 20;
  const dbType = (meta.dbType || '').toLowerCase();
  if (!['mysql', 'postgresql', 'postgres', 'mariadb', 'oracle', 'sqlserver'].includes(dbType)) compat -= 8;
  if (meta.framework && isLegacyFramework(meta.framework)) compat -= 5;
  if (config.dependencies?.some(d => isLegacyDep(d))) compat -= 4;
  if (config.server?.os?.toLowerCase().includes('windows server 2003')) compat -= 6;
  categories.compatibility = {
    score: Math.max(compat, 0),
    label: 'Compatibility',
    issues: buildCompatIssues(config, meta),
    color: '#f97316'
  };

  // ─── COST (0–20) ─────────────────────────────────────────────────────────────
  let cost = 10;
  const gb = meta.estimatedDataGB || 10;
  if (gb < 50) cost += 5;
  else if (gb > 500) cost -= 5;
  if (meta.isMonolith) cost += 3;
  if (meta.serviceCount > 5) cost -= 2;
  categories.cost = {
    score: Math.min(Math.max(cost, 0), 20),
    label: 'Cost Efficiency',
    estimatedMonthlySavings: Math.round(gb * 0.8 + meta.serviceCount * 12),
    issues: buildCostIssues(config, meta),
    color: '#22c55e'
  };

  // ─── COMPLEXITY (0–20) ───────────────────────────────────────────────────────
  let complexity = 20;
  if (meta.serviceCount > 10) complexity -= 8;
  else if (meta.serviceCount > 5) complexity -= 4;
  if (!meta.isMonolith) complexity -= 2;
  if (meta.dbType?.toLowerCase().includes('oracle')) complexity -= 4;
  if ((config.dependencies || []).length > 20) complexity -= 3;
  categories.complexity = {
    score: Math.max(complexity, 0),
    label: 'Complexity',
    issues: buildComplexityIssues(config, meta),
    color: '#a855f7'
  };

  // ─── READINESS (0–20) ────────────────────────────────────────────────────────
  let readiness = 10;
  if (config.ci_cd || config.cicd) readiness += 4;
  if (config.containerized || config.docker) readiness += 4;
  if (config.monitoring) readiness += 2;
  categories.readiness = {
    score: Math.min(readiness, 20),
    label: 'Cloud Readiness',
    issues: buildReadinessIssues(config, meta),
    color: '#3b82f6'
  };

  const total = Object.values(categories).reduce((s, c) => s + c.score, 0);
  const grade = total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 55 ? 'C' : total >= 40 ? 'D' : 'F';
  const risk = total >= 70 ? 'LOW' : total >= 50 ? 'MEDIUM' : 'HIGH';

  return {
    totalScore: total,
    grade,
    risk,
    categories,
    recommendations: buildTopRecommendations(categories, config, meta),
    estimatedMigrationWeeks: riskToWeeks(risk, meta),
    assessedAt: new Date().toISOString()
  };
}

function isLegacyFramework(fw) {
  return ['struts', 'jsf', 'webforms', 'asp classic', 'coldfusion', 'perl'].some(l => fw.toLowerCase().includes(l));
}
function isLegacyDep(dep) {
  const name = (typeof dep === 'string' ? dep : dep.name || '').toLowerCase();
  return ['log4j', 'struts', 'commons-collections:3', 'spring:3'].some(l => name.includes(l));
}

function buildSecurityIssues(config, meta) {
  const issues = [];
  if (!meta.hasSSL) issues.push({ severity: 'HIGH', message: 'No SSL/TLS configured — data in transit is unencrypted' });
  if (!meta.hasAuth) issues.push({ severity: 'HIGH', message: 'No authentication layer detected' });
  if (!config.encryption?.atRest) issues.push({ severity: 'MEDIUM', message: 'Encryption at rest not configured' });
  if (!config.vpc) issues.push({ severity: 'MEDIUM', message: 'No VPC isolation defined — workload is publicly exposed' });
  return issues;
}
function buildCompatIssues(config, meta) {
  const issues = [];
  if (isLegacyFramework(meta.framework || '')) issues.push({ severity: 'HIGH', message: `${meta.framework} is a legacy framework with limited AWS support` });
  if (meta.dbType?.toLowerCase().includes('oracle')) issues.push({ severity: 'HIGH', message: 'Oracle → PostgreSQL requires schema conversion (AWS SCT recommended)' });
  if ((config.dependencies || []).some(isLegacyDep)) issues.push({ severity: 'MEDIUM', message: 'Vulnerable legacy dependencies detected' });
  return issues;
}
function buildCostIssues(config, meta) {
  const issues = [];
  if (meta.estimatedDataGB > 1000) issues.push({ severity: 'MEDIUM', message: 'Large dataset (>1TB) may incur significant DMS transfer costs' });
  if (meta.serviceCount > 10) issues.push({ severity: 'LOW', message: 'High service count — review consolidation opportunities' });
  return issues;
}
function buildComplexityIssues(config, meta) {
  const issues = [];
  if (!meta.isMonolith && meta.serviceCount > 5) issues.push({ severity: 'MEDIUM', message: 'Microservices architecture requires coordinated migration waves' });
  if (meta.dbType?.toLowerCase().includes('oracle')) issues.push({ severity: 'HIGH', message: 'Oracle migration requires AWS Schema Conversion Tool (SCT)' });
  return issues;
}
function buildReadinessIssues(config, meta) {
  const issues = [];
  if (!config.ci_cd && !config.cicd) issues.push({ severity: 'MEDIUM', message: 'No CI/CD pipeline detected — add CodePipeline post-migration' });
  if (!config.monitoring) issues.push({ severity: 'LOW', message: 'No monitoring configured — enable CloudWatch after migration' });
  if (!config.containerized) issues.push({ severity: 'LOW', message: 'Application is not containerized — consider ECS/Fargate for future scalability' });
  return issues;
}
function buildTopRecommendations(categories, config, meta) {
  return [
    { priority: 1, action: 'Enable SSL/TLS + encryption at rest before migration', impact: 'HIGH', effort: 'LOW' },
    { priority: 2, action: `Use AWS DMS to migrate ${meta.dbType?.toUpperCase() || 'MySQL'} → Aurora PostgreSQL`, impact: 'HIGH', effort: 'MEDIUM' },
    { priority: 3, action: 'Apply IAM least-privilege roles to all services post-migration', impact: 'HIGH', effort: 'LOW' },
    { priority: 4, action: 'Enable CloudWatch monitoring + alarms on RDS and Lambda', impact: 'MEDIUM', effort: 'LOW' },
    { priority: 5, action: 'Set up VPC with private subnets for DB isolation', impact: 'HIGH', effort: 'MEDIUM' }
  ];
}
function riskToWeeks(risk, meta) {
  const base = risk === 'LOW' ? 2 : risk === 'MEDIUM' ? 4 : 8;
  return base + Math.floor(meta.serviceCount / 3);
}
