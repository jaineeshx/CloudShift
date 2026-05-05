import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Play, ArrowRight, Database, Server, RefreshCw, CheckCircle, Terminal } from 'lucide-react';
import toast from 'react-hot-toast';
import { startMigration, getMigrationStatus } from '../api/client';
import { useApp } from '../context/AppContext';
import StepIndicator from '../components/StepIndicator';

const STATUS_LABELS = {
  ready: 'Ready to Start',
  starting: 'Starting DMS Task...',
  running: 'Migration Running',
  'load-complete-replication-ongoing': 'Live CDC Replication',
  stopped: 'Completed',
  failed: 'Failed',
};
const STATUS_COLOR = {
  ready: 'var(--text-muted)',
  starting: 'var(--accent)',
  running: 'var(--accent)',
  'load-complete-replication-ongoing': 'var(--green)',
  stopped: 'var(--green)',
  failed: 'var(--red)',
};

export default function LiveMigration() {
  const navigate = useNavigate();
  const { sessionId, migrationStatus, setMigrationStatus } = useApp();
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const logsEndRef = useRef(null);
  const pollRef = useRef(null);

  const addLog = (msg, type = 'info') => {
    setLogs(l => [...l, { msg, type, time: new Date().toLocaleTimeString() }]);
  };

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    return () => clearInterval(pollRef.current);
  }, []);

  const handleStart = async () => {
    if (!sessionId) return toast.error('No session — upload a config first');
    setLoading(true);
    addLog('Connecting to AWS DMS API...', 'info');
    try {
      const result = await startMigration(sessionId);
      setStarted(true);
      addLog(`DMS Task ARN: ${result.taskArn}`, 'info');
      addLog(`Status: ${result.status}`, 'success');
      toast.success('Migration started!');
      startPolling();
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      addLog(`Error: ${msg}`, 'error');
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const startPolling = () => {
    pollRef.current = setInterval(async () => {
      try {
        const status = await getMigrationStatus(sessionId);
        setMigrationStatus(status);
        addLog(`Progress: ${status.progress?.overallPercent || 0}% — Tables: ${status.progress?.tablesLoaded || 0}/${status.progress?.totalTables || 0} loaded`, 'info');

        if (status.isDone) {
          clearInterval(pollRef.current);
          addLog('✅ Migration complete! Data now in Aurora PostgreSQL.', 'success');
          toast.success('Migration complete!');
        }
        if (status.status === 'failed') {
          clearInterval(pollRef.current);
          addLog('❌ Migration failed. Check DMS console.', 'error');
        }
      } catch (err) {
        addLog(`Poll error: ${err.message}`, 'warn');
      }
    }, 4000);
  };

  const progress = migrationStatus?.progress || {};
  const pct = progress.overallPercent || 0;
  const status = migrationStatus?.status || 'ready';
  const isDone = migrationStatus?.isDone || false;

  const tableStats = migrationStatus?.tableStats || [];

  return (
    <div className="animate-fadeUp">
      <StepIndicator current={3} />

      <div className="page-header">
        <h1 className="page-title">Live <span className="gradient-text">Migration</span></h1>
        <p className="page-subtitle">Real AWS DMS task — MySQL on EC2 → Aurora PostgreSQL — tracked in real-time</p>
      </div>

      {/* Pipeline Diagram */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="migration-pipeline">
          <div className={`pipeline-node ${started && !isDone ? 'active' : isDone ? 'done' : ''}`}>
            <Server size={28} style={{ color: started || isDone ? 'var(--accent)' : 'var(--text-muted)' }} />
            <div style={{ fontWeight: 700, fontSize: 13 }}>EC2 MySQL</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Source</div>
            <div style={{ marginTop: 6 }}>
              <span className={`badge ${started ? 'badge-cyan' : 'badge-gray'}`}>
                {started ? 'Streaming' : 'On-Prem'}
              </span>
            </div>
          </div>

          <div className="pipeline-arrow" style={{ background: started ? 'var(--accent)' : 'var(--border)' }} />

          <div className={`pipeline-node ${started && !isDone ? 'active' : ''}`}>
            <RefreshCw size={28} style={{ color: started ? 'var(--accent)' : 'var(--text-muted)', animation: started && !isDone ? 'spin 2s linear infinite' : undefined }} />
            <div style={{ fontWeight: 700, fontSize: 13 }}>AWS DMS</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Replication</div>
            <div style={{ marginTop: 6 }}>
              <span className={`badge ${isDone ? 'badge-green' : started ? 'badge-cyan' : 'badge-gray'}`}>
                {STATUS_LABELS[status] || status}
              </span>
            </div>
          </div>

          <div className="pipeline-arrow" style={{ background: isDone ? 'var(--green)' : 'var(--border)' }} />

          <div className={`pipeline-node ${isDone ? 'done' : ''}`}>
            <Database size={28} style={{ color: isDone ? 'var(--green)' : 'var(--text-muted)' }} />
            <div style={{ fontWeight: 700, fontSize: 13 }}>Aurora PG</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Target</div>
            <div style={{ marginTop: 6 }}>
              <span className={`badge ${isDone ? 'badge-green' : 'badge-gray'}`}>
                {isDone ? 'Migrated' : 'Waiting'}
              </span>
            </div>
          </div>
        </div>

        {/* Overall Progress */}
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Overall Progress</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: isDone ? 'var(--green)' : 'var(--accent)' }}>
              {isDone ? 'Complete ✓' : `${pct}%`}
            </span>
          </div>
          <div className="progress-bar-wrap" style={{ height: 12 }}>
            <div className="progress-bar-fill" style={{ width: `${isDone ? 100 : pct}%`, background: isDone ? 'linear-gradient(90deg,var(--green),#84cc16)' : undefined }} />
          </div>
        </div>
      </div>

      {/* Stats */}
      {started && (
        <div className="stats-grid" style={{ marginBottom: 20 }}>
          {[
            { label: 'Tables Loaded', value: progress.tablesLoaded || 0, color: 'var(--green)' },
            { label: 'Tables Loading', value: progress.tablesLoading || 0, color: 'var(--accent)' },
            { label: 'Tables Queued', value: progress.tablesQueued || 0, color: 'var(--orange)' },
            { label: 'Errors', value: progress.tablesErrored || 0, color: progress.tablesErrored ? 'var(--red)' : 'var(--text-muted)' },
            { label: 'Elapsed', value: progress.elapsedSeconds ? `${Math.floor(progress.elapsedSeconds / 60)}m ${progress.elapsedSeconds % 60}s` : '-', color: 'var(--text-primary)' },
            { label: 'DMS Status', value: STATUS_LABELS[status] || status, color: STATUS_COLOR[status] },
          ].map(({ label, value, color }) => (
            <div className="stat-card" key={label}>
              <div className="stat-label">{label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Table-level stats */}
      {tableStats.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="section-heading"><Database size={16} style={{ color: 'var(--accent)' }} /> Table Migration Status</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Schema</th>
                  <th>State</th>
                  <th>Rows Loaded</th>
                  <th>Inserts</th>
                  <th>Updates</th>
                </tr>
              </thead>
              <tbody>
                {tableStats.map((t, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{t.tableName}</td>
                    <td className="text-muted">{t.schemaName}</td>
                    <td>
                      <span className={`badge ${t.state === 'Table completed' ? 'badge-green' : t.state === 'Table error' ? 'badge-red' : 'badge-cyan'}`}>{t.state}</span>
                    </td>
                    <td>{(t.fullLoadRows || 0).toLocaleString()}</td>
                    <td>{(t.inserts || 0).toLocaleString()}</td>
                    <td>{(t.updates || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Log Terminal */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="section-heading"><Terminal size={16} style={{ color: 'var(--accent)' }} /> Migration Log</div>
        <div className="log-terminal">
          {logs.length === 0 && <div className="log-line">$ Waiting for migration to start...</div>}
          {logs.map((l, i) => (
            <div key={i} className={`log-line ${l.type}`}>
              <span style={{ opacity: 0.5, marginRight: 10 }}>[{l.time}]</span> {l.msg}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>

      {/* CTA */}
      {!started ? (
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {!sessionId && (
            <div className="alert alert-warning" style={{ margin: 0, flex: 1 }}>
              ⚠️ No session active — deploy CDK first to get a real DMS task ARN, then upload a config.
            </div>
          )}
          <button
            className="btn btn-primary btn-lg"
            onClick={handleStart}
            disabled={loading || !sessionId}
            style={{ animation: 'glow 2s infinite' }}
          >
            {loading ? <><RefreshCw size={18} className="animate-spin" /> Starting...</> : <><Play size={18} /> Start Live Migration</>}
          </button>
        </div>
      ) : isDone ? (
        <button className="btn btn-primary btn-lg" onClick={() => navigate('/dashboard')}>
          <CheckCircle size={18} /> View Security Dashboard <ArrowRight size={16} />
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--green)', animation: 'pulse 1.5s infinite' }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Polling DMS every 4 seconds...</span>
        </div>
      )}
    </div>
  );
}
