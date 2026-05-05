import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitBranch, ChevronDown, ChevronRight, ArrowRight, AlertOctagon, Clock, Layers, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { generatePlan } from '../api/client';
import { useApp } from '../context/AppContext';
import StepIndicator from '../components/StepIndicator';

const WAVE_COLORS = ['#6366f1', '#f97316', '#ef4444'];
const WAVE_BG = ['rgba(99,102,241,0.08)', 'rgba(249,115,22,0.08)', 'rgba(239,68,68,0.08)'];
const TYPE_ICONS = { infrastructure: '🏗️', security: '🔐', compute: '⚡', database: '🗄️', migration: '🔄', cutover: '✂️', cache: '⚡', messaging: '💬', storage: '📦' };

export default function WavePlan() {
  const navigate = useNavigate();
  const { sessionId, wavePlan, setWavePlan } = useApp();
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState({ 0: true, 1: false, 2: false });

  useEffect(() => {
    if (sessionId && !wavePlan) fetchPlan();
  }, [sessionId]);

  const fetchPlan = async () => {
    if (!sessionId) return toast.error('No session — upload a config first');
    setLoading(true);
    try {
      const result = await generatePlan(sessionId);
      setWavePlan(result.wavePlan);
      toast.success('Wave plan generated!');
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleWave = (i) => setExpanded(e => ({ ...e, [i]: !e[i] }));

  if (!sessionId) return (
    <div className="animate-fadeUp">
      <StepIndicator current={2} />
      <div className="card" style={{ textAlign: 'center', padding: 60 }}>
        <p className="text-muted" style={{ marginBottom: 20 }}>No session found</p>
        <button className="btn btn-primary" onClick={() => navigate('/upload')}>Start with Upload</button>
      </div>
    </div>
  );

  return (
    <div className="animate-fadeUp">
      <StepIndicator current={2} />

      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Migration <span className="gradient-text">Wave Plan</span></h1>
          <p className="page-subtitle">Phased migration strategy — the same output format AWS Transform generates</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={fetchPlan} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Regenerate
        </button>
      </div>

      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <p className="text-muted">Generating migration waves...</p>
        </div>
      )}

      {wavePlan && !loading && (
        <>
          {/* Summary cards */}
          <div className="stats-grid" style={{ marginBottom: 24 }}>
            {[
              { label: 'Total Waves', value: wavePlan.totalWaves, icon: Layers, color: 'var(--accent)' },
              { label: 'Est. Hours', value: wavePlan.estimatedTotalHours, icon: Clock, color: 'var(--orange)' },
              { label: 'Est. Weeks', value: wavePlan.estimatedWeeks, icon: Clock, color: 'var(--green)' },
              { label: 'Target DB', value: 'Aurora PG', icon: GitBranch, color: 'var(--purple)' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div className="stat-card" key={label}>
                <div className="flex items-center gap-2">
                  <Icon size={16} style={{ color }} />
                  <span className="stat-label">{label}</span>
                </div>
                <div className="stat-value" style={{ color }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Target Architecture */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="section-heading">🎯 Target Architecture (AWS Native)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
              {Object.entries(wavePlan.targetArchitecture).map(([k, v]) => (
                <div key={k} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600, marginBottom: 6 }}>{k}</div>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Waves */}
          {wavePlan.waves.map((wave, wi) => (
            <div key={wave.waveNumber} className="wave-card" style={{ borderColor: expanded[wi] ? WAVE_COLORS[wi] + '40' : 'var(--border)' }}>
              <div
                className="wave-header"
                onClick={() => toggleWave(wi)}
                style={{ background: expanded[wi] ? WAVE_BG[wi] : undefined }}
              >
                <div className="wave-number" style={{ background: WAVE_BG[wi], color: WAVE_COLORS[wi] }}>W{wave.waveNumber}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{wave.name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3 }}>{wave.description}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="badge" style={{ background: `${wave.riskColor}22`, color: wave.riskColor, border: `1px solid ${wave.riskColor}44` }}>{wave.risk} RISK</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{wave.duration}</span>
                  {expanded[wi] ? <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} /> : <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />}
                </div>
              </div>

              {expanded[wi] && (
                <div className="wave-body">
                  {/* Services */}
                  {wave.services.map((svc) => (
                    <div key={svc.name} className="service-row">
                      <div style={{ fontSize: 24, flexShrink: 0 }}>{TYPE_ICONS[svc.type] || '📦'}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{svc.name}</span>
                          <span className="badge badge-cyan" style={{ fontSize: 10 }}>{svc.awsService}</span>
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 6 }}>{svc.action}</div>
                        {svc.dependencies.length > 0 && (
                          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                            Depends on: {svc.dependencies.join(', ')}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{svc.estimatedHours}h</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>est.</div>
                      </div>
                    </div>
                  ))}

                  {/* Risk flags */}
                  {wave.riskFlags.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Risk Flags</div>
                      {wave.riskFlags.map((rf, i) => (
                        <div key={i} style={{
                          display: 'flex', gap: 10, alignItems: 'flex-start',
                          padding: '10px 12px', borderRadius: 8, marginBottom: 8,
                          background: rf.severity === 'HIGH' ? 'rgba(239,68,68,0.06)' : rf.severity === 'MEDIUM' ? 'rgba(249,115,22,0.05)' : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${rf.severity === 'HIGH' ? 'rgba(239,68,68,0.2)' : 'rgba(249,115,22,0.2)'}`
                        }}>
                          <AlertOctagon size={14} style={{ color: rf.severity === 'HIGH' ? 'var(--red)' : 'var(--orange)', flexShrink: 0, marginTop: 1 }} />
                          <div>
                            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{rf.flag}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>↳ {rf.mitigation}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          <button className="btn btn-primary btn-lg" style={{ marginTop: 8 }} onClick={() => navigate('/migration')}>
            Start Live Migration <ArrowRight size={18} />
          </button>
        </>
      )}

      {!wavePlan && !loading && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <button className="btn btn-primary btn-lg" onClick={fetchPlan}>
            <GitBranch size={18} /> Generate Wave Plan
          </button>
        </div>
      )}
    </div>
  );
}
