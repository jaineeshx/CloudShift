require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });
const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Lambda shim — wraps Lambda handler as Express route
function lambdaRoute(handler) {
  return async (req, res) => {
    const event = {
      httpMethod: req.method,
      headers: req.headers,
      queryStringParameters: req.query,
      body: JSON.stringify(req.body),
      isBase64Encoded: false
    };
    try {
      const result = await handler(event);
      const body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
      res.status(result.statusCode).json(body);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };
}

// Load Lambda handlers
const uploadHandler = require('../functions/upload/index');
const assessHandler = require('../functions/assess/index');
const planHandler = require('../functions/plan/index');
const migrateStartHandler = require('../functions/migrate-start/index');
const migrateStatusHandler = require('../functions/migrate-status/index');
const dashboardHandler = require('../functions/dashboard/index');

// Routes
app.post('/upload', lambdaRoute(uploadHandler.handler));
app.post('/assess', lambdaRoute(assessHandler.handler));
app.post('/plan', lambdaRoute(planHandler.handler));
app.post('/migrate/start', lambdaRoute(migrateStartHandler.handler));
app.get('/migrate/status', lambdaRoute(migrateStatusHandler.handler));
app.get('/dashboard', lambdaRoute(dashboardHandler.handler));

// Health check
app.get('/health', (req, res) => res.json({
  status: 'ok',
  region: process.env.AWS_REGION || 'us-east-1',
  timestamp: new Date().toISOString()
}));

app.listen(PORT, () => {
  console.log(`\n🚀 CloudShift local API server running on http://localhost:${PORT}`);
  console.log(`   AWS Region: ${process.env.AWS_REGION || 'us-east-1'}`);
  console.log(`   DMS Task ARN: ${process.env.DMS_TASK_ARN || '(not set — deploy CDK first)'}\n`);
});
