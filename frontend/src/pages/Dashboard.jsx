import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ShieldCheck, RefreshCw, Lock, Eye, DollarSign, FileText, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { getDashboard } from '../api/client';
import { useApp } from '../context/AppContext';
import StepIndicator from '../components/StepIndicator';

export default function Dashboard() {
  const navigate = useNavigate();
  const { sessionId, dashboard, setDashboard } = useApp();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (sessionId && !dashboard) fetchDashboard();
  }, [sessionId]);

  const fetchDashboard = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const result = await getDashboard(sessionId);
      setDashboard(result);
      toast.success('Dashboard loaded');
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const costData = dashboard?.cost?.services?.slice(0, 6).map(s => ({
    name: s.service.replace('Amazon ', '').replace('AWS ', '').slice(0, 12),
    cost: parseFloat(s.cost)
  })) || [];

  const secScore = dashboard?.securityScore?.score || 0;
  const secGrade = dashboard?.securityScore?.grade || 'UNKNOWN';
  const checks = dashboard?.securityScore?.checks || [];

  return (
    <div className="animate-fadeUp">
      <StepIndicator current={4} />

      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Security & Cost <span className="gradient-text">Dashboard</span></h1>
          <p className="page-subtitle">Post-migration security posture, IAM audit, and cost analysis — live from AWS APIs</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={fetchDashboard} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <p className="text-muted">Querying IAM, RDS, CloudTrail, Cost Explorer...</p>
        </div>
      )}

      {!sessionId && !loading && (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <ShieldCheck size={48} style={{ color: 'var(--text-muted)', opacity: 0.4, marginBottom: 16 }} />
          <p className="text-muted" style={{ marginBottom: 20 }}>Deploy CDK and complete a migration to view the real dashboard</p>
          <button className="btn btn-primary" onClick={() => navigate('/upload')}>Start Migration Flow</button>
        </div>
      )}

      {dashboard && !loading && (
        <>
          {/* Security Score */}
          <div className="grid-2" style={{ gap: 20, marginBottom: 20 }}>
            <div className="card">
              <div className="section-heading"><ShieldCheck size={16} style={{ color: 'var(--green)' }} /> Security Posture</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 20 }}>
                <div style={{
                  width: 80, height: 80, borderRadius: '50%',
                  background: `conic-gradient(${secScore >= 75 ? 'var(--green)' : secScore >= 50 ? 'var(--orange)' : 'var(--red)'} ${secScore * 3.6}deg, rgba(255,255,255,0.06) 0deg)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                }}>
                  <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: secScore >= 75 ? 'var(--green)' : 'var(--orange)' }}>{secScore}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>/ 100</div>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4, color: secScore >= 75 ? 'var(--green)' : 'var(--orange)' }}>{secGrade}</div>
                  <div className="text-muted text-sm">Security status post-migration</div>
                </div>
              </div>
              {checks.map((c, i) => (
                <div key={i} className="security-check">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 18 }}>{c.icon}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{c.check}</span>
                  </div>
                  <span className={`badge ${c.status === 'PASS' ? 'badge-green' : 'badge-red'}`}>
                    {c.status === 'PASS' ? <CheckCircle size={10} /> : <XCircle size={10} />}
                    {c.status}
                  </span>
                </div>
              ))}
            </div>

            {/* RDS Security */}
            <div className="card">
              <div className="section-heading"><Lock size={16} style={{ color: 'var(--accent)' }} /> RDS Security Config</div>
              {dashboard.rds?.error ? (
                <div className="alert alert-warning">{dashboard.rds.error}</div>
              ) : (Array.isArray(dashboard.rds) ? dashboard.rds : []).length === 0 ? (
                <div className="alert alert-info">No CloudShift RDS instances found. Deploy CDK first.</div>
              ) : (
                (Array.isArray(dashboard.rds) ? dashboard.rds : []).map((db, i) => (
                  <div key={i} style={{ padding: '14px 0', borderBottom: i < dashboard.rds.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>{db.identifier}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {[
                        { label: 'Engine', value: `${db.engine} ${db.engineVersion}` },
                        { label: 'Status', value: db.status, ok: db.status === 'available' },
                        { label: 'Encryption', value: db.encryptedAtRest ? '✓ Encrypted' : '✗ Not encrypted', ok: db.encryptedAtRest },
                        { label: 'Public', value: db.publiclyAccessible ? '⚠ Yes' : '✓ Private', ok: !db.publiclyAccessible },
                        { label: 'Multi-AZ', value: db.multiAZ ? '✓ Yes' : 'No', ok: db.multiAZ },
                        { label: 'Storage', value: `${db.allocatedStorage} GB` },
                      ].map(({ label, value, ok }) => (
                        <div key={label} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: '8px 12px', border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{label}</div>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: ok === true ? 'var(--green)' : ok === false ? 'var(--red)' : 'var(--text-primary)' }}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* IAM Roles + Cost */}
          <div className="grid-2" style={{ gap: 20, marginBottom: 20 }}>
            {/* IAM */}
            <div className="card">
              <div className="section-heading"><Eye size={16} style={{ color: 'var(--purple)' }} /> IAM Roles Applied</div>
              {dashboard.iam?.error ? (
                <div className="alert alert-warning">{dashboard.iam.error}</div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                    <div style={{ background: 'rgba(168,85,247,0.1)', borderRadius: 10, padding: '12px 16px', border: '1px solid rgba(168,85,247,0.2)', flex: 1, textAlign: 'center' }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--purple)' }}>{dashboard.iam?.totalRoles || 0}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total Roles</div>
                    </div>
                    <div style={{ background: 'rgba(34,197,94,0.1)', borderRadius: 10, padding: '12px 16px', border: '1px solid rgba(34,197,94,0.2)', flex: 1, textAlign: 'center' }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green)' }}>{dashboard.iam?.cloudshiftRoles?.length || 0}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>CloudShift Roles</div>
                    </div>
                    <div style={{ background: dashboard.iam?.leastPrivilegeApplied ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', borderRadius: 10, padding: '12px 16px', border: `1px solid ${dashboard.iam?.leastPrivilegeApplied ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`, flex: 1, textAlign: 'center' }}>
                      <div style={{ fontSize: 22, color: dashboard.iam?.leastPrivilegeApplied ? 'var(--green)' : 'var(--red)' }}>
                        {dashboard.iam?.leastPrivilegeApplied ? '✓' : '⚠'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Least Priv</div>
                    </div>
                  </div>
                  {(dashboard.iam?.cloudshiftRoles || []).slice(0, 5).map((role, i) => (
                    <div key={i} style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 8 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{role.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{role.policies.join(', ') || 'No attached policies'}</div>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Cost */}
            <div className="card">
              <div className="section-heading"><DollarSign size={16} style={{ color: 'var(--green)' }} /> Cost Analysis (Last 30 Days)</div>
              {dashboard.cost?.error ? (
                <div className="alert alert-warning">{dashboard.cost.error}</div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                    {[
                      { label: 'AWS (Cloud)', value: `$${dashboard.cost?.totalMonthlyUSD || '0'}`, color: 'var(--accent)' },
                      { label: 'Est. On-Prem', value: `$${dashboard.cost?.estimatedOnPremMonthlyUSD || '0'}`, color: 'var(--orange)' },
                      { label: 'Savings', value: `${dashboard.cost?.savingsPercent || '0'}%`, color: 'var(--green)' },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ flex: 1, background: 'rgba(255,255,255,0.02)', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)', textAlign: 'center' }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
                      </div>
                    ))}
                  </div>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={costData} margin={{ left: -20 }}>
                      <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }} formatter={(v) => [`$${v}`, 'Cost']} />
                      <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                        {costData.map((_, i) => <Cell key={i} fill={i % 2 === 0 ? '#6366f1' : '#06b6d4'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}
            </div>
          </div>

          {/* CloudTrail Events */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="section-heading"><FileText size={16} style={{ color: 'var(--accent-secondary)' }} /> CloudTrail Audit Log (Last 24h)</div>
            {dashboard.cloudtrail?.error ? (
              <div className="alert alert-warning">{dashboard.cloudtrail.error}</div>
            ) : dashboard.cloudtrail?.events?.length === 0 ? (
              <div className="alert alert-info">No DMS events in the last 24 hours</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Time</th>
                      <th>User</th>
                      <th>Source IP</th>
                      <th>Resources</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(dashboard.cloudtrail?.events || []).map((ev, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{ev.eventName}</td>
                        <td className="text-muted text-xs">{new Date(ev.eventTime).toLocaleString()}</td>
                        <td>{ev.username || '—'}</td>
                        <td className="font-mono text-xs">{ev.sourceIP || '—'}</td>
                        <td className="text-muted text-xs truncate">{ev.resources.slice(0, 2).join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* VPC */}
          {dashboard.vpc && !dashboard.vpc.error && (
            <div className="card">
              <div className="section-heading">🔒 VPC Isolation</div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1, background: 'rgba(255,255,255,0.02)', borderRadius: 10, padding: '14px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>VPCs</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)' }}>{dashboard.vpc.vpcs?.length || 0}</div>
                </div>
                <div style={{ flex: 1, background: 'rgba(255,255,255,0.02)', borderRadius: 10, padding: '14px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Security Groups</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--purple)' }}>{dashboard.vpc.securityGroups?.length || 0}</div>
                </div>
                <div style={{ flex: 2, background: dashboard.vpc.isolated ? 'rgba(34,197,94,0.05)' : 'rgba(249,115,22,0.05)', borderRadius: 10, padding: '14px', border: `1px solid ${dashboard.vpc.isolated ? 'rgba(34,197,94,0.2)' : 'rgba(249,115,22,0.2)'}` }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Isolation Status</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: dashboard.vpc.isolated ? 'var(--green)' : 'var(--orange)' }}>
                    {dashboard.vpc.isolated ? '✓ Non-default VPC (Isolated)' : '⚠ Using default VPC'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {sessionId && !dashboard && !loading && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <button className="btn btn-primary btn-lg" onClick={fetchDashboard}>
            <ShieldCheck size={18} /> Load Security Dashboard
          </button>
        </div>
      )}
    </div>
  );
}
