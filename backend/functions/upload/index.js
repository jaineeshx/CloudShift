const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const yaml = require('js-yaml');
const { putSession, uploadToS3, respond } = require('../../shared/utils');

// Medium #3: Max payload size — 1 MB
const MAX_PAYLOAD_BYTES = 1024 * 1024;

// Medium #4: Config schema — validated on every upload
const ALLOWED_DB_TYPES = ['mysql', 'postgresql', 'postgres', 'mariadb', 'oracle', 'sqlserver', 'mongodb', 'redis'];

// Low #11: Block private/SSRF-risk IP ranges in database host fields
const PRIVATE_IP_RE = /^(10\.|127\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)/;
function isPrivateOrMetadataIP(host) {
  if (!host || typeof host !== 'string') return false;
  return PRIVATE_IP_RE.test(host) || host === '169.254.169.254';
}

// Low #7: Sanitize strings to prevent stored XSS
function sanitizeString(val, maxLen = 200) {
  return String(val || '').replace(/[<>"';&$`]/g, '').slice(0, maxLen);
}

function validateConfig(configObj) {
  const errors = [];

  if (typeof configObj !== 'object' || configObj === null || Array.isArray(configObj)) {
    return ['Config must be a JSON/YAML object'];
  }

  // appName: string, max 100 chars
  if (configObj.appName !== undefined && typeof configObj.appName !== 'string') {
    errors.push('appName must be a string');
  }

  // database.type: must be in allowlist
  const dbType = configObj.database?.type || configObj.dbType;
  if (dbType && !ALLOWED_DB_TYPES.includes(String(dbType).toLowerCase())) {
    errors.push(`database.type must be one of: ${ALLOWED_DB_TYPES.join(', ')}`);
  }

  // database.sizeGB: number 0–100000
  const sizeGB = configObj.database?.sizeGB ?? configObj.dbSizeGB;
  if (sizeGB !== undefined && (typeof sizeGB !== 'number' || sizeGB < 0 || sizeGB > 100000)) {
    errors.push('database.sizeGB must be a number between 0 and 100000');
  }

  // Low #11: Block SSRF via database host fields
  const dbHost = configObj.database?.host || configObj.db?.host;
  if (dbHost && isPrivateOrMetadataIP(dbHost)) {
    errors.push('database.host must not be a private or link-local IP address');
  }

  // dependencies: max 100 items
  if (configObj.dependencies !== undefined) {
    if (!Array.isArray(configObj.dependencies)) errors.push('dependencies must be an array');
    else if (configObj.dependencies.length > 100) errors.push('dependencies must have at most 100 items');
  }

  return errors;
}

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin;
  if (event.httpMethod === 'OPTIONS') return respond(200, {}, origin);

  const requestId = event.requestContext?.requestId || 'local';

  try {
    // Medium #4: Enforce max payload size before any parsing
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf-8')
      : (event.body || '');

    if (Buffer.byteLength(rawBody, 'utf-8') > MAX_PAYLOAD_BYTES) {
      return respond(413, { errorCode: 'PAYLOAD_TOO_LARGE', error: 'Request body exceeds 1 MB limit' }, origin);
    }

    const parsed = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    const { config, filename = 'config.json' } = parsed;

    if (!config) return respond(400, { errorCode: 'MISSING_CONFIG', error: 'Missing config field in request body' }, origin);

    // Parse config — support JSON string or object or YAML string
    let configObj = config;
    if (typeof config === 'string') {
      try { configObj = JSON.parse(config); }
      catch {
        // SECURITY: SAFE_SCHEMA prevents arbitrary JS object instantiation via YAML
        configObj = yaml.load(config, { schema: yaml.SAFE_SCHEMA });
      }
    }

    // Medium #4 + Low #7: Schema validation and sanitization
    const validationErrors = validateConfig(configObj);
    if (validationErrors.length > 0) {
      return respond(400, { errorCode: 'INVALID_CONFIG', errors: validationErrors }, origin);
    }

    // Low #7: Sanitize string metadata fields
    if (configObj.appName) configObj.appName = sanitizeString(configObj.appName, 100);
    if (configObj.framework) configObj.framework = sanitizeString(configObj.framework, 100);

    // Medium #3: HMAC-signed session ID — prevents enumeration/forgery
    const rawId = uuidv4();
    const hmac = crypto.createHmac('sha256', process.env.SESSION_HMAC_SECRET || 'dev-secret-rotate-in-prod')
      .update(rawId).digest('hex');
    const sessionId = `${rawId}.${hmac.substring(0, 16)}`;

    const s3Key = `configs/${rawId}/${filename}`;
    await uploadToS3(s3Key, configObj);

    const meta = extractMetadata(configObj);

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
    // Low #3: Never return raw error messages — log internally, return generic response
    console.error('[upload] Error:', { message: err.message, code: err.code, requestId });
    return respond(500, { errorCode: 'INTERNAL_ERROR', error: 'An error occurred. Please try again.', requestId }, origin);
  }
};

function extractMetadata(config) {
  return {
    appName: sanitizeString(config.appName || config.name || 'Legacy Application', 100),
    framework: sanitizeString(config.framework || config.runtime || 'unknown', 100),
    dbType: config.database?.type || config.db?.type || config.dbType || 'mysql',
    dbVersion: config.database?.version || config.db?.version || 'unknown',
    serverType: sanitizeString(config.server?.type || config.serverType || 'EC2', 50),
    os: sanitizeString(config.server?.os || config.os || 'Linux', 50),
    dependencies: config.dependencies || [],
    portCount: config.ports?.length || 0,
    hasSSL: !!(config.ssl || config.tls || config.https),
    hasAuth: !!(config.auth || config.authentication),
    estimatedDataGB: config.database?.sizeGB || config.dbSizeGB || 10,
    serviceCount: (config.services || []).length || 1,
    isMonolith: !(config.services?.length > 1),
    environment: sanitizeString(config.environment || 'production', 50)
  };
}
