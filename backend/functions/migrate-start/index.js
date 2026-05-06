const { DatabaseMigrationServiceClient, StartReplicationTaskCommand, DescribeReplicationTasksCommand } = require('@aws-sdk/client-database-migration-service');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const { getSession, respond, writeAuditLog, TABLE_NAME, REGION } = require('../../shared/utils');

const dms = new DatabaseMigrationServiceClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// Medium #2: Atomic distributed lock via DynamoDB conditional write.
// Prevents concurrent /migrate/start calls from double-starting the DMS task.
async function acquireMigrationLock(sessionId, taskArn) {
  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { sessionId },
      ConditionExpression: '#s <> :migrating AND #s <> :starting',
      UpdateExpression: 'SET #s = :starting, dmsTaskArn = :arn, lockAcquiredAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':migrating': 'migrating',
        ':starting': 'starting',
        ':arn': taskArn,
        ':now': new Date().toISOString()
      }
    }));
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

// Medium #7: Run a DMS pre-migration assessment before starting the task.
// Returns null if assessment passes, or a string describing the blocking issue.
async function runPreMigrationCheck(taskArn) {
  const res = await dms.send(new DescribeReplicationTasksCommand({
    Filters: [{ Name: 'replication-task-arn', Values: [taskArn] }]
  }));
  const task = res.ReplicationTasks?.[0];
  if (!task) return 'DMS task not found';

  const status = task.Status?.toLowerCase();
  if (['running', 'starting'].includes(status)) {
    return `Task is already ${status}`;
  }
  if (['deleting', 'failed'].includes(status)) {
    return `Task is in terminal state: ${status}. Please recreate the DMS task.`;
  }
  return null; // Assessment passed
}

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin;
  if (event.httpMethod === 'OPTIONS') return respond(200, {}, origin);

  const requestId = event.requestContext?.requestId || 'local';
  const sourceIp = event.requestContext?.identity?.sourceIp || 'unknown';
  const userAgent = event.requestContext?.identity?.userAgent || 'unknown';

  let sessionId;

  try {
    ({ sessionId } = JSON.parse(event.body || '{}'));
    if (!sessionId) return respond(400, { errorCode: 'MISSING_SESSION_ID', error: 'Missing sessionId' }, origin);

    const session = await getSession(sessionId);
    if (!session) return respond(404, { errorCode: 'SESSION_NOT_FOUND', error: 'Session not found' }, origin);

    const taskArn = process.env.DMS_TASK_ARN;
    if (!taskArn) return respond(500, { errorCode: 'CONFIG_ERROR', error: 'DMS_TASK_ARN not configured. Deploy CDK stack first.' }, origin);

    // Medium #7: Pre-migration assessment check
    const assessmentIssue = await runPreMigrationCheck(taskArn);
    if (assessmentIssue) {
      // Special case: already running is not a failure
      if (assessmentIssue.startsWith('Task is already')) {
        return respond(200, { sessionId, taskArn, status: 'running', message: 'DMS task already running' }, origin);
      }
      await writeAuditLog({ action: 'MIGRATION_START_BLOCKED', sessionId, taskArn, reason: assessmentIssue, sourceIp, userAgent });
      return respond(400, { errorCode: 'PRE_MIGRATION_CHECK_FAILED', error: assessmentIssue }, origin);
    }

    // Medium #2: Atomic lock — only one concurrent caller can proceed
    const locked = await acquireMigrationLock(sessionId, taskArn);
    if (!locked) {
      return respond(409, {
        errorCode: 'MIGRATION_ALREADY_IN_PROGRESS',
        error: 'Migration already in progress for this session.'
      }, origin);
    }

    // TOCTOU double-check after acquiring lock
    const recheck = await dms.send(new DescribeReplicationTasksCommand({
      Filters: [{ Name: 'replication-task-arn', Values: [taskArn] }]
    }));
    const recheckStatus = recheck.ReplicationTasks?.[0]?.Status?.toLowerCase();
    if (recheckStatus === 'running' || recheckStatus === 'starting') {
      return respond(200, { sessionId, taskArn, status: recheckStatus, message: `Task is ${recheckStatus}` }, origin);
    }

    // Start DMS task
    const startType = recheckStatus === 'stopped' ? 'resume-processing' : 'start-replication';
    await dms.send(new StartReplicationTaskCommand({
      ReplicationTaskArn: taskArn,
      StartReplicationTaskType: startType
    }));

    // Update session to confirmed migrating state
    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { sessionId },
      UpdateExpression: 'SET #s = :migrating, migrationStartedAt = :now, updatedAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':migrating': 'migrating', ':now': new Date().toISOString() }
    }));

    // Medium #8: Write audit log entry for DMS start operation
    await writeAuditLog({
      action: 'MIGRATION_START',
      sessionId,
      taskArn,
      startType,
      result: 'SUCCESS',
      sourceIp,
      userAgent
    });

    return respond(200, {
      sessionId,
      taskArn,
      status: 'starting',
      message: 'DMS migration task started successfully'
    }, origin);

  } catch (err) {
    // Low #3: Sanitized error — log internally, return generic message
    console.error('[migrate-start] Error:', { message: err.message, code: err.code, requestId });

    // Attempt audit log for failures
    await writeAuditLog({
      action: 'MIGRATION_START',
      sessionId: sessionId || 'unknown',
      result: 'ERROR',
      errorCode: err.code,
      sourceIp,
      userAgent
    });

    return respond(500, { errorCode: 'INTERNAL_ERROR', error: 'An error occurred. Please try again.', requestId }, origin);
  }
};
