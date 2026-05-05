require('dotenv').config();
const { Client } = require('pg');
const { SecretsManagerClient, ListSecretsCommand, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const creds = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
};

async function getDbPassword() {
  // Try Secrets Manager first
  try {
    const sm = new SecretsManagerClient({ region: 'us-east-1', credentials: creds });
    const secrets = await sm.send(new ListSecretsCommand({}));
    console.log('=== SECRETS MANAGER ===');
    for (const s of secrets.SecretList || []) {
      console.log('Secret:', s.Name);
      if (s.Name.toLowerCase().includes('postgres') || s.Name.toLowerCase().includes('rds') || s.Name.toLowerCase().includes('cloudshift')) {
        try {
          const val = await sm.send(new GetSecretValueCommand({ SecretId: s.ARN }));
          const parsed = JSON.parse(val.SecretString || '{}');
          console.log('  Keys:', Object.keys(parsed).join(', '));
          if (parsed.password) return parsed.password;
          if (parsed.Password) return parsed.Password;
        } catch (e) {
          console.log('  Could not read:', e.message);
        }
      }
    }
  } catch (e) {
    console.log('Secrets Manager error:', e.message);
  }
  return null;
}

async function checkSchema(password) {
  const client = new Client({
    host: 'cloudshiftdb-postgrestarget96e16d83-rbc7forsevhu.cslscmmgy43n.us-east-1.rds.amazonaws.com',
    port: 5432,
    database: 'cloudshift_target',
    user: 'postgres',
    password: password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });

  try {
    await client.connect();
    console.log('\n✅ Connected to Aurora PostgreSQL!');

    // Check schemas
    const schemas = await client.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY schema_name`);
    console.log('\n=== SCHEMAS ===');
    schemas.rows.forEach(r => console.log(' -', r.schema_name));

    // Check tables in public schema
    const tables = await client.query(`SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema, table_name`);
    console.log('\n=== TABLES ===');
    if (tables.rows.length === 0) {
      console.log('  ❌ NO TABLES FOUND! This is why DMS failed - target tables must be pre-created.');
    } else {
      tables.rows.forEach(r => console.log(' -', r.table_schema + '.' + r.table_name));
    }

    await client.end();
  } catch (err) {
    console.log('❌ Connection failed:', err.message);
    await client.end().catch(() => {});
  }
}

async function main() {
  const password = await getDbPassword();
  if (!password) {
    console.log('\n❌ Could not find DB password in Secrets Manager');
    console.log('Trying with empty password...');
    await checkSchema('');
  } else {
    console.log('\nFound password, connecting...');
    await checkSchema(password);
  }
}

main().catch(console.error);
