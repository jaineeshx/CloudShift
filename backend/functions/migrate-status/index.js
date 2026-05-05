const { DatabaseMigrationServiceClient, DescribeReplicationTasksCommand, DescribeTableStatisticsCommand } = require('@aws-sdk/client-database-migration-service');
const { getSession, updateSession, respond } = require('../../shared/utils');

const dms = new DatabaseMigrationServiceClient({ region: process.env.AWS_REGION || 'us-east-1' });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  try {
    const { sessionId } = event.queryStringParameters || {};
    if (!sessionId) return respond(400, { error: 'Missing sessionId' });

    const session = await getSession(sessionId);
    if (!session) return respond(404, { error: 'Session not found' });

    const taskArn = session.dmsTaskArn || process.env.DMS_TASK_ARN;
    if (!taskArn) return respond(400, { error: 'No DMS task started for this session' });

    // Get task status
    const taskRes = await dms.send(new DescribeReplicationTasksCommand({
      Filters: [{ Name: 'replication-task-arn', Values: [taskArn] }]
    }));
    const task = taskRes.ReplicationTasks?.[0];
    if (!task) return respond(404, { error: 'DMS task not found' });

    // Get table-level stats
    let tableStats = [];
    try {
      const statsRes = await dms.send(new DescribeTableStatisticsCommand({
        ReplicationTaskArn: taskArn
      }));
      tableStats = (statsRes.TableStatistics || []).map(t => ({
        schemaName: t.SchemaName,
        tableName: t.TableName,
        inserts: t.Inserts || 0,
        updates: t.Updates || 0,
        deletes: t.Deletes || 0,
        fullLoadRows: t.FullLoadRows || 0,
        fullLoadCondtnlChkFailedRows: t.FullLoadCondtnlChkFailedRows || 0,
        state: t.TableState || 'unknown',
        lastUpdated: t.LastUpdateTime
      }));
    } catch (e) {
      // tableStats may not be available immediately
    }

    const stats = task.ReplicationTaskStats || {};
    const overallPct = stats.FullLoadProgressPercent || 0;
    const elapsedSec = stats.ElapsedTimeMillis ? Math.round(stats.ElapsedTimeMillis / 1000) : 0;
    const tablesLoaded = stats.TablesLoaded || 0;
    const tablesLoading = stats.TablesLoading || 0;
    const tablesQueued = stats.TablesQueued || 0;
    const tablesErrored = stats.TablesErrored || 0;

    const status = task.Status?.toLowerCase();
    const isDone = status === 'load-complete-replication-ongoing' || status === 'stopped' || overallPct >= 100;

    if (isDone) {
      await updateSession(sessionId, { status: 'migrated', migrationCompletedAt: new Date().toISOString() });
    }

    return respond(200, {
      sessionId,
      taskArn,
      status,
      progress: {
        overallPercent: overallPct,
        elapsedSeconds: elapsedSec,
        tablesLoaded,
        tablesLoading,
        tablesQueued,
        tablesErrored,
        totalTables: tablesLoaded + tablesLoading + tablesQueued + tablesErrored
      },
      tableStats: tableStats.slice(0, 50),
      isDone,
      lastChecked: new Date().toISOString()
    });
  } catch (err) {
    console.error('Migrate-status error:', err);
    return respond(500, { error: err.message });
  }
};
