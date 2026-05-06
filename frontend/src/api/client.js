import axios from 'axios';

// Low #13: API URL exposure is acceptable — frontend URLs are public by design.
// Primary security is backend IAM auth + API keys. This comment documents the decision.
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000  // 30s client-side timeout prevents hung requests
});

// Low #8: Client-side validation — UX improvement only, NOT a security control.
// The backend validates all inputs independently. These checks reduce unnecessary API calls.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[0-9a-f]{16}$/i;
const MAX_CONFIG_BYTES = 1024 * 1024; // 1 MB

function assertValidSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') throw new Error('sessionId is required');
  // Accept both plain UUIDs (legacy) and HMAC-signed IDs (new format)
  if (sessionId.length < 36) throw new Error('Invalid sessionId format');
}

function assertValidConfig(config, filename) {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error('Config must be a plain object');
  }
  const size = new Blob([JSON.stringify(config)]).size;
  if (size > MAX_CONFIG_BYTES) throw new Error('Config exceeds 1 MB size limit');
  if (filename && (typeof filename !== 'string' || filename.length > 255)) {
    throw new Error('Filename must be a string of at most 255 characters');
  }
}

export const uploadConfig = async (config, filename = 'config.json') => {
  assertValidConfig(config, filename);
  const res = await api.post('/upload', { config, filename });
  return res.data;
};

export const runAssessment = async (sessionId) => {
  assertValidSessionId(sessionId);
  const res = await api.post('/assess', { sessionId });
  return res.data;
};

export const generatePlan = async (sessionId) => {
  assertValidSessionId(sessionId);
  const res = await api.post('/plan', { sessionId });
  return res.data;
};

export const startMigration = async (sessionId) => {
  assertValidSessionId(sessionId);
  const res = await api.post('/migrate/start', { sessionId });
  return res.data;
};

export const getMigrationStatus = async (sessionId) => {
  assertValidSessionId(sessionId);
  const res = await api.get(`/migrate/status?sessionId=${encodeURIComponent(sessionId)}`);
  return res.data;
};

export const getDashboard = async (sessionId) => {
  assertValidSessionId(sessionId);
  const res = await api.get(`/dashboard?sessionId=${encodeURIComponent(sessionId)}`);
  return res.data;
};

export default api;
