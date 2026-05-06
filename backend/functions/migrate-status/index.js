const { DatabaseMigrationServiceClient, DescribeReplicationTasksCommand, DescribeTableStatisticsCommand } = require('@aws-sdk/client-database-migration-service');
const { getSession, updateSession, respond, REGION } = require('../../shared/utils');

const dms = new DatabaseMigrationServiceClient({ region: REGION });

// Medium #9: CDC lag threshold — warn operators before cutover if lag is high
const CDC_LAG_WARN_SECONDS = 60;
const CDC_LAG_CRITICAL_SECONDS = 300;

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin;
  if (event.httpMethod === 'OPTIONS') return respond(200, {}, origin);

  const requestId = event.requestContext?.requestId || 'local';

  try {
    const { sessionId } = event.queryStringParameters || {};
    if (!sessionId) return respond(400, { errorCode: 'MISSING_SESSION_ID', error: 'Missing sessionId' }, origin);

    const session = await getSession(sessionId);
    if (!session) return respond(404, { errorCode: 'SESSION_NOT_FOUND', error: 'Session not found' }, origin);

    const taskArn = session.dmsTaskArn || process.env.DMS_TASK_ARN;
    if (!taskArn) return respond(400, { errorCode: 'NO_TASK', error: 'No DMS task started for this session' }, origin);

    // Get task status
    const taskRes = await dms.send(new DescribeReplicationTasksCommand({
      Filters: [{ Name: 'replication-task-arn', Values: [taskArn] }]
    }));
    const task = taskRes.ReplicationTasks?.[0];
    if (!task) return respond(404, { errorCode: 'TASK_NOT_FOUND', error: 'DMS task not found' }, origin);

    // Get table-level stats
    let tableStats = [];
    try {
      const statsRes = await dms.send(new DescribeTableStatisticsCommand({ ReplicationTaskArn: taskArn }));
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
    } catch (_) {
      // tableStats may not be available immediately after task start
    }

    const stats = task.ReplicationTaskStats || {};
    const overallPct = stats.FullLoadProgressPercent || 0;
    const elapsedSec = stats.ElapsedTimeMillis ? Math.round(stats.ElapsedTimeMillis / 1000) : 0;
    const tablesLoaded = stats.TablesLoaded || 0;
    const tablesLoading = stats.TablesLoading || 0;
    const tablesQueued = stats.TablesQueued || 0;
    const tablesErrored = stats.TablesErrored || 0;

    // Medium #9: CDC replication lag monitoring
    const cdcLatencySource = stats.CDCLatencySource || 0;  // seconds source is behind
    const cdcLatencyTarget = stats.CDCLatencyTarget || 0;  // seconds target is behind source
    const cdcIncomingChanges = stats.CDCIncomingChanges || 0;

    // Build lag warnings — critical for cutover readiness
    const warnings = [];
    if (cdcLatencySource > CDC_LAG_CRITICAL_SECONDS) {
      warnings.push(`CRITICAL: Source CDC lag is ${cdcLatencySource}s. Do NOT cut over — data loss risk is HIGH.`);
    } else if (cdcLatencySource > CDC_LAG_WARN_SECONDS) {
      warnings.push(`WARNING: Source CDC lag is ${cdcLatencySource}s. Wait for lag to drop below ${CDC_LAG_WARN_SECONDS}s before cutover.`);
    }
    if (cdcLatencyTarget > CDC_LAG_WARN_SECONDS) {
      warnings.push(`WARNING: Target CDC lag is ${cdcLatencyTarget}s. Target is falling behind source.`);
    }
    if (tablesErrored > 0) {
      warnings.push(`WARNING: ${tablesErrored} table(s) in error state. Review DMS task logs before proceeding.`);
    }

    const cutoverReady = cdcLatencySource <= CDC_LAG_WARN_SECONDS &&
                         cdcLatencyTarget <= CDC_LAG_WARN_SECONDS &&
                         tablesErrored === 0 &&
                         overallPct >= 100;

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
      // Medium #9: CDC lag metrics for informed cutover decisions
      cdc: {
        latencySourceSeconds: cdcLatencySource,
        latencyTargetSeconds: cdcLatencyTarget,
        incomingChanges: cdcIncomingChanges,
        cutoverReady,
        lagStatus: cdcLatencySource === 0 ? 'SYNCED'
          : cdcLatencySource <= CDC_LAG_WARN_SECONDS ? 'LOW_LAG'
          : cdcLatencySource <= CDC_LAG_CRITICAL_SECONDS ? 'HIGH_LAG' : 'CRITICAL_LAG'
      },
      warnings,
      tableStats: tableStats.slice(0, 50),
      isDone,
      lastChecked: new Date().toISOString()
    }, origin);

  } catch (err) {
    // Low #3: Sanitized error response
    console.error('[migrate-status] Error:', { message: err.message, code: err.code, requestId });
    return respond(500, { errorCode: 'INTERNAL_ERROR', error: 'An error occurred. Please try again.', requestId }, origin);
  }
};
