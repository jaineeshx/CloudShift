require('dotenv').config();
const { 
  DatabaseMigrationServiceClient, 
  ModifyReplicationTaskCommand,
  StopReplicationTaskCommand,
  StartReplicationTaskCommand,
  DescribeReplicationTasksCommand
} = require('@aws-sdk/client-database-migration-service');

const dms = new DatabaseMigrationServiceClient({ region: 'us-east-1' });
const taskArn = process.env.DMS_TASK_ARN;

async function waitForStatus(targetStatus, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await dms.send(new DescribeReplicationTasksCommand({
      Filters: [{ Name: 'replication-task-arn', Values: [taskArn] }]
    }));
    const status = res.ReplicationTasks?.[0]?.Status;
    console.log('  Current status:', status);
    if (status === targetStatus) return status;
    if (status === 'failed') throw new Error('Task failed!');
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error(`Timeout waiting for status: ${targetStatus}`);
}

async function main() {
  console.log('Task ARN:', taskArn);

  // 1. Get current status
  const descRes = await dms.send(new DescribeReplicationTasksCommand({
    Filters: [{ Name: 'replication-task-arn', Values: [taskArn] }]
  }));
  const task = descRes.ReplicationTasks?.[0];
  const currentStatus = task?.Status;
  const currentSettings = JSON.parse(task?.ReplicationTaskSettings || '{}');
  
  console.log('Current status:', currentStatus);
  console.log('Current TargetTablePrepMode:', currentSettings.TargetMetadata?.TargetTablePrepMode);

  // 2. Stop if running
  if (currentStatus === 'running') {
    console.log('\nStopping task...');
    await dms.send(new StopReplicationTaskCommand({ ReplicationTaskArn: taskArn }));
    console.log('Waiting for task to stop...');
    await waitForStatus('stopped');
    console.log('✅ Task stopped');
  }

  // 3. Modify settings to DROP_AND_CREATE so DMS will create the tables
  console.log('\nModifying task settings to DROP_AND_CREATE...');
  currentSettings.TargetMetadata = currentSettings.TargetMetadata || {};
  currentSettings.TargetMetadata.TargetTablePrepMode = 'DROP_AND_CREATE';
  
  // Also enable full LOB mode to avoid truncation issues
  currentSettings.FullLoadSettings = currentSettings.FullLoadSettings || {};
  currentSettings.FullLoadSettings.TargetTablePrepMode = 'DROP_AND_CREATE';

  await dms.send(new ModifyReplicationTaskCommand({
    ReplicationTaskArn: taskArn,
    ReplicationTaskSettings: JSON.stringify(currentSettings),
    MigrationType: 'full-load-and-cdc'
  }));
  
  console.log('Waiting for task to be ready after modification...');
  await waitForStatus('stopped', 60000);
  console.log('✅ Task modified');

  // 4. Restart the task from scratch
  console.log('\nStarting task (full reload)...');
  await dms.send(new StartReplicationTaskCommand({
    ReplicationTaskArn: taskArn,
    StartReplicationTaskType: 'start-replication'  // Fresh start, not resume
  }));
  
  console.log('✅ Task restarted! DMS will now CREATE tables + load all data fresh.');
  console.log('\nMonitor at: https://console.aws.amazon.com/dms/v2/home?region=us-east-1#taskDetails/' + taskArn);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
