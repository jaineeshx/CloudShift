const { DatabaseMigrationServiceClient, StartReplicationTaskCommand, DescribeReplicationTasksCommand } = require('@aws-sdk/client-database-migration-service');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { getSession, respond, TABLE_NAME, REGION } = require('../../shared/utils');

const dms = new DatabaseMigrationServiceClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// SECURITY: Acquire an atomic "migration lock" using DynamoDB conditional write.
// This prevents race conditions when multiple requests hit /migrate/start concurrently.
// Only one caller will succeed in transitioning status from a non-migrating state.
async function acquireMigrationLock(sessionId, taskArn) {
  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { sessionId },
      // Condition: status must NOT currently be 'migrating' or 'starting'.
      // If it is, another request already won the race — throw ConditionalCheckFailedException.
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

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin;
  if (event.httpMethod === 'OPTIONS') return respond(200, {}, origin);

  try {
    const { sessionId } = JSON.parse(event.body || '{}');
    if (!sessionId) return respond(400, { error: 'Missing sessionId' }, origin);

    const session = await getSession(sessionId);
    if (!session) return respond(404, { error: 'Session not found' }, origin);

    const taskArn = process.env.DMS_TASK_ARN;
    if (!taskArn) return respond(500, { error: 'DMS_TASK_ARN env var not configured. Deploy CDK stack first.' }, origin);

    // SECURITY: Atomic lock acquisition — prevents duplicate DMS task starts
    // from concurrent requests hitting this endpoint simultaneously.
    const locked = await acquireMigrationLock(sessionId, taskArn);
    if (!locked) {
      return respond(409, {
        sessionId,
        taskArn,
        error: 'Migration already in progress for this session. Only one concurrent migration is allowed.'
      }, origin);
    }

    // Check current DMS task status
    const describeRes = await dms.send(new DescribeReplicationTasksCommand({
      Filters: [{ Name: 'replication-task-arn', Values: [taskArn] }]
    }));

    const task = describeRes.ReplicationTasks?.[0];
    if (!task) return respond(404, { error: 'DMS task not found' }, origin);

    const currentStatus = task.Status?.toLowerCase();

    // Guard: if DMS itself is already running, acknowledge without double-starting
    if (currentStatus === 'running') {
      return respond(200, { sessionId, taskArn, status: 'running', message: 'DMS task already running' }, origin);
    }

    if (['starting', 'creating', 'deleting'].includes(currentStatus)) {
      return respond(200, { sessionId, taskArn, status: currentStatus, message: `Task is ${currentStatus}, please wait` }, origin);
    }

    // SECURITY: Re-check DMS task status immediately before issuing StartReplicationTaskCommand
    // to prevent TOCTOU (time-of-check-time-of-use) races at the DMS layer.
    const recheck = await dms.send(new DescribeReplicationTasksCommand({
      Filters: [{ Name: 'replication-task-arn', Values: [taskArn] }]
    }));
    const recheckStatus = recheck.ReplicationTasks?.[0]?.Status?.toLowerCase();
    if (recheckStatus === 'running' || recheckStatus === 'starting') {
      return respond(200, { sessionId, taskArn, status: recheckStatus, message: `Task state is ${recheckStatus}` }, origin);
    }

    // Start the DMS task
    const startType = currentStatus === 'stopped' ? 'resume-processing' : 'start-replication';
    await dms.send(new StartReplicationTaskCommand({
      ReplicationTaskArn: taskArn,
      StartReplicationTaskType: startType
    }));

    // Update session to confirmed 'migrating' state
    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { sessionId },
      UpdateExpression: 'SET #s = :migrating, migrationStartedAt = :now, updatedAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':migrating': 'migrating',
        ':now': new Date().toISOString()
      }
    }));

    return respond(200, {
      sessionId,
      taskArn,
      status: 'starting',
      message: 'DMS migration task started successfully'
    }, origin);
  } catch (err) {
    console.error('Migrate-start error:', err);
    return respond(500, { error: err.message }, origin);
  }
};
