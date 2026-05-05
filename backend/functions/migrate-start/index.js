const { DatabaseMigrationServiceClient, StartReplicationTaskCommand, DescribeReplicationTasksCommand, CreateReplicationTaskCommand, DescribeEndpointsCommand } = require('@aws-sdk/client-database-migration-service');
const { getSession, updateSession, respond } = require('../../shared/utils');

const dms = new DatabaseMigrationServiceClient({ region: process.env.AWS_REGION || 'us-east-1' });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  try {
    const { sessionId } = JSON.parse(event.body || '{}');
    if (!sessionId) return respond(400, { error: 'Missing sessionId' });

    const session = await getSession(sessionId);
    if (!session) return respond(404, { error: 'Session not found' });

    const taskArn = process.env.DMS_TASK_ARN;
    if (!taskArn) return respond(500, { error: 'DMS_TASK_ARN env var not configured. Deploy CDK stack first.' });

    // Check current task status
    const describeRes = await dms.send(new DescribeReplicationTasksCommand({
      Filters: [{ Name: 'replication-task-arn', Values: [taskArn] }]
    }));

    const task = describeRes.ReplicationTasks?.[0];
    if (!task) return respond(404, { error: 'DMS task not found' });

    const currentStatus = task.Status?.toLowerCase();

    // Only start if not already running
    if (currentStatus === 'running') {
      await updateSession(sessionId, { status: 'migrating', dmsTaskArn: taskArn, migrationStartedAt: new Date().toISOString() });
      return respond(200, { sessionId, taskArn, status: 'running', message: 'DMS task already running' });
    }

    if (['starting', 'creating', 'deleting'].includes(currentStatus)) {
      return respond(200, { sessionId, taskArn, status: currentStatus, message: `Task is ${currentStatus}, please wait` });
    }

    // Start the task
    const startType = currentStatus === 'stopped' ? 'resume-processing' : 'start-replication';
    await dms.send(new StartReplicationTaskCommand({
      ReplicationTaskArn: taskArn,
      StartReplicationTaskType: startType
    }));

    await updateSession(sessionId, {
      status: 'migrating',
      dmsTaskArn: taskArn,
      migrationStartedAt: new Date().toISOString()
    });

    return respond(200, {
      sessionId,
      taskArn,
      status: 'starting',
      message: 'DMS migration task started successfully'
    });
  } catch (err) {
    console.error('Migrate-start error:', err);
    return respond(500, { error: err.message });
  }
};
