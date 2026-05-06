const { v4: uuidv4 } = require('uuid');
const yaml = require('js-yaml');
const { putSession, uploadToS3, respond } = require('../../shared/utils');

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin;
  if (event.httpMethod === 'OPTIONS') return respond(200, {}, origin);

  try {
    let body = event.body;
    if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf-8');
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;

    const { config, filename = 'config.json' } = parsed;
    if (!config) return respond(400, { error: 'Missing config field in request body' }, origin);

    // Parse config — support JSON string or object or YAML string
    let configObj = config;
    if (typeof config === 'string') {
      try { configObj = JSON.parse(config); }
      catch {
        // SECURITY: Use SAFE_SCHEMA to prevent arbitrary code execution via YAML deserialization.
        configObj = yaml.load(config, { schema: yaml.SAFE_SCHEMA });
      }
    }

    // SECURITY: Validate that the parsed result is a plain object before processing
    if (typeof configObj !== 'object' || configObj === null || Array.isArray(configObj)) {
      return respond(400, { error: 'Config must be a JSON/YAML object' }, origin);
    }

    const sessionId = uuidv4();
    const s3Key = `configs/${sessionId}/${filename}`;

    // Upload raw config to S3
    await uploadToS3(s3Key, configObj);

    // Extract metadata
    const meta = extractMetadata(configObj);

    // Store in DynamoDB
    await putSession(sessionId, {
      status: 'uploaded',
      filename,
      s3Key,
      config: configObj,
      metadata: meta,
      createdAt: new Date().toISOString()
    });

    return respond(200, {
      sessionId,
      metadata: meta,
      message: 'Config uploaded successfully'
    }, origin);
  } catch (err) {
    console.error('Upload error:', err);
    return respond(500, { error: err.message }, origin);
  }
};

function extractMetadata(config) {
  return {
    appName: config.appName || config.name || 'Legacy Application',
    framework: config.framework || config.runtime || 'unknown',
    dbType: config.database?.type || config.db?.type || config.dbType || 'mysql',
    dbVersion: config.database?.version || config.db?.version || 'unknown',
    serverType: config.server?.type || config.serverType || 'EC2',
    os: config.server?.os || config.os || 'Linux',
    dependencies: config.dependencies || [],
    portCount: config.ports?.length || 0,
    hasSSL: !!(config.ssl || config.tls || config.https),
    hasAuth: !!(config.auth || config.authentication),
    estimatedDataGB: config.database?.sizeGB || config.dbSizeGB || 10,
    serviceCount: (config.services || []).length || 1,
    isMonolith: !(config.services?.length > 1),
    environment: config.environment || 'production'
  };
}
