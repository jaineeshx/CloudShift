const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const REGION = process.env.AWS_REGION || 'us-east-1';
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'cloudshift-sessions';
const BUCKET_NAME = process.env.S3_BUCKET || 'cloudshift-configs';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const s3 = new S3Client({ region: REGION });

async function putSession(sessionId, data) {
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { sessionId, updatedAt: new Date().toISOString(), ...data }
  }));
}

async function getSession(sessionId) {
  const res = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { sessionId }
  }));
  return res.Item;
}

async function updateSession(sessionId, updates) {
  const updateParts = Object.entries(updates);
  const expr = 'SET ' + updateParts.map((_, i) => `#k${i} = :v${i}`).join(', ') + ', #ua = :ua';
  const names = { '#ua': 'updatedAt' };
  const values = { ':ua': new Date().toISOString() };
  updateParts.forEach(([k, v], i) => {
    names[`#k${i}`] = k;
    values[`:v${i}`] = v;
  });
  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { sessionId },
    UpdateExpression: expr,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values
  }));
}

async function uploadToS3(key, body, contentType = 'application/json') {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: typeof body === 'string' ? body : JSON.stringify(body),
    ContentType: contentType
  }));
}

async function getFromS3(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

// SECURITY: Never use wildcard CORS. Read the allowed origin from env (set at deploy time).
// Falls back to localhost for local development only.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

function corsHeaders(requestOrigin) {
  // Reflect the origin back only if it is in the allowlist
  const origin = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin'  // Required so CDN/browser caches correctly per origin
  };
}

function respond(statusCode, body, requestOrigin) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(requestOrigin) },
    body: JSON.stringify(body)
  };
}

module.exports = { putSession, getSession, updateSession, uploadToS3, getFromS3, respond, TABLE_NAME, BUCKET_NAME, REGION };
