# CloudShift — AWS Migration Intelligence Platform

A production-grade, full-stack SaaS migration tool that mirrors what AWS Transform does — at micro scale. **Real AWS DMS** migration, not a simulation.

## Quick Start (Frontend Dev — no AWS needed)

```bash
# 1. Start backend
cd backend
cp .env.example .env
# Fill in your AWS credentials in .env
npm run dev         # → http://localhost:4000

# 2. Start frontend (separate terminal)
cd frontend
npm run dev         # → http://localhost:3001
```

## Full AWS Deployment

### Prerequisites
- Node.js 20+
- AWS CLI configured: `aws configure`
- AWS CDK: `npm install -g aws-cdk`

### Step 1: Configure credentials
```bash
cd backend
cp .env.example .env
# Edit .env:
#   AWS_ACCESS_KEY_ID=YOUR_KEY
#   AWS_SECRET_ACCESS_KEY=YOUR_SECRET
#   AWS_REGION=us-east-1
```

### Step 2: Bootstrap CDK (once per account/region)
```bash
cd infra
npm run bootstrap   # cdk bootstrap
```

### Step 3: Deploy all stacks
```bash
cd infra
npm run deploy      # cdk deploy --all
# Takes ~10-15 min first time
```
After deploy, CDK outputs:
- `ApiUrl` → paste into frontend `VITE_API_URL` env var
- `DmsTaskArn` → paste into backend `.env` as `DMS_TASK_ARN`

### Step 4: Update frontend env
Create `frontend/.env`:
```
VITE_API_URL=https://YOUR_API_GATEWAY_URL.execute-api.us-east-1.amazonaws.com/prod
```

### Step 5: Run
```bash
cd frontend
npm run dev
```

## Architecture

```
User
 │
 ▼
Vite + React (localhost:3001)
 │         ↕ REST
API Gateway
 ├── POST /upload      → Lambda → S3 + DynamoDB
 ├── POST /assess      → Lambda → heuristic engine
 ├── POST /plan        → Lambda → wave plan generator
 ├── POST /migrate/start → Lambda → AWS DMS StartReplicationTask
 ├── GET  /migrate/status → Lambda → DMS DescribeReplicationTasks + DescribeTableStatistics
 └── GET  /dashboard   → Lambda → IAM + RDS + CloudTrail + Cost Explorer + EC2

AWS Infrastructure (CDK):
 VpcStack → DatabaseStack → DmsStack → ApiStack
```

## CDK Stacks

| Stack | Resources |
|-------|-----------|
| CloudShiftVpc | VPC, 2 AZs, NAT Gateway, 3 Security Groups |
| CloudShiftDb | EC2 t2.micro (MySQL + seeded data), RDS PostgreSQL db.t3.micro |
| CloudShiftDms | DMS t3.micro replication instance, source/target endpoints, full-load+CDC task |
| CloudShiftApi | 6 Lambda functions, API Gateway REST, DynamoDB, S3 |

## DMS Migration Details
- **Source**: MySQL on EC2 (seeded with `users`, `products`, `orders`, `sessions`, `audit_log` tables)
- **Target**: Aurora PostgreSQL in private subnet
- **Type**: full-load-and-cdc (zero-downtime)
- **Cost**: ~$0.06/hr for DMS instance — run only during demo

## Free Tier Coverage
| Service | Free Tier |
|---------|-----------|
| EC2 t2.micro | 750 hrs/month ✓ |
| RDS db.t3.micro | 750 hrs/month ✓ |
| Lambda | 1M requests/month ✓ |
| API Gateway | 1M calls/month ✓ |
| S3 | 5 GB ✓ |
| DynamoDB | 25 GB ✓ |
| **DMS t3.micro** | **NOT free — ~$0.06/hr** |

## Destroy (to avoid charges)
```bash
cd infra
npm run destroy     # cdk destroy --all
```
