import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' }
});

export const uploadConfig = async (config, filename = 'config.json') => {
  const res = await api.post('/upload', { config, filename });
  return res.data;
};

export const runAssessment = async (sessionId) => {
  const res = await api.post('/assess', { sessionId });
  return res.data;
};

export const generatePlan = async (sessionId) => {
  const res = await api.post('/plan', { sessionId });
  return res.data;
};

export const startMigration = async (sessionId) => {
  const res = await api.post('/migrate/start', { sessionId });
  return res.data;
};

export const getMigrationStatus = async (sessionId) => {
  const res = await api.get(`/migrate/status?sessionId=${sessionId}`);
  return res.data;
};

export const getDashboard = async (sessionId) => {
  const res = await api.get(`/dashboard?sessionId=${sessionId}`);
  return res.data;
};

export default api;
