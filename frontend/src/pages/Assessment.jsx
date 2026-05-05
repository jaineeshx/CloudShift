import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { BarChart2, ArrowRight, RefreshCw, AlertTriangle, CheckCircle, TrendingUp, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import { runAssessment } from '../api/client';
import { useApp } from '../context/AppContext';
import StepIndicator from '../components/StepIndicator';

const RISK_COLOR = { LOW: 'var(--green)', MEDIUM: 'var(--orange)', HIGH: 'var(--red)' };
const GRADE_COLOR = { A: 'var(--green)', B: '#84cc16', C: 'var(--yellow)', D: 'var(--orange)', F: 'var(--red)' };

function ScoreRing({ score, grade }) {
  const radius = 80;
  const stroke = 10;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 75 ? 'var(--green)' : score >= 50 ? 'var(--orange)' : 'var(--red)';

  return (
    <svg width={radius * 2} height={radius * 2} style={{ transform: 'rotate(-90deg)' }}>
      <circle stroke="rgba(255,255,255,0.06)" fill="transparent" strokeWidth={stroke} r={normalizedRadius} cx={radius} cy={radius} />
      <circle
        stroke={color} fill="transparent" strokeWidth={stroke}
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={offset} r={normalizedRadius} cx={radius} cy={radius}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 1.5s cubic-bezier(0.4,0,0.2,1)' }}
      />
      <text x={radius} y={radius - 8} fill="var(--text-primary)" fontSize="28" fontWeight="800" textAnchor="middle" style={{ transform: 'rotate(90deg)', transformOrigin: `${radius}px ${radius}px` }}>
        {score}
      </text>
      <text x={radius} y={radius + 16} fill={GRADE_COLOR[grade]} fontSize="14" fontWeight="700" textAnchor="middle" style={{ transform: 'rotate(90deg)', transformOrigin: `${radius}px ${radius}px` }}>
        Grade {grade}
      </text>
    </svg>
  );
}

export default function Assessment() {
  const navigate = useNavigate();
  const { sessionId, assessment, setAssessment } = useApp();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (sessionId && !assessment) fetchAssessment();
  }, [sessionId]);

  const fetchAssessment = async () => {
    if (!sessionId) return toast.error('No session — upload a config first');
    setLoading(true);
    try {
      const result = await runAssessment(sessionId);
      setAssessment(result.assessment);
      toast.success('Assessment complete!');
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const radarData = assessment ? Object.values(assessment.categories).map(c => ({
    subject: c.label,
    value: c.score,
    fullMark: 20
  })) : [];

  if (!sessionId) return (
    <div className="animate-fadeUp">
      <StepIndicator current={1} />
      <div className="card" style={{ textAlign: 'center', padding: 60 }}>
        <BarChart2 size={48} style={{ color: 'var(--text-muted)', opacity: 0.4, marginBottom: 16 }} />
        <h2 style={{ marginBottom: 8 }}>No Session Found</h2>
        <p className="text-muted" style={{ marginBottom: 24 }}>Upload a config file to run an assessment</p>
        <button className="btn btn-primary" onClick={() => navigate('/upload')}>Go to Upload</button>
      </div>
    </div>
  );

  return (
    <div className="animate-fadeUp">
      <StepIndicator current={1} />

      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Readiness <span className="gradient-text">Assessment</span></h1>
          <p className="page-subtitle">AI-powered migration readiness analysis across 5 dimensions</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={fetchAssessment} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Analyzing...' : 'Re-run'}
        </button>
      </div>

      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', border: '3px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 1s linear infinite', margin: '0 auto 20px' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Analyzing your stack across 5 dimensions...</p>
        </div>
      )}

      {assessment && !loading && (
        <>
          {/* Score + Radar */}
          <div className="grid-2" style={{ gap: 20, marginBottom: 20 }}>
            <div className="card">
              <div className="section-heading"><Shield size={16} style={{ color: 'var(--accent)' }} /> Overall Score</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
                <ScoreRing score={assessment.totalScore} grade={assessment.grade} />
                <div style={{ flex: 1 }}>
                  <div style={{ marginBottom: 16 }}>
                    <div className="flex justify-between" style={{ marginBottom: 6 }}>
                      <span className="text-sm text-muted">Migration Risk</span>
                      <span className="badge" style={{ background: `${RISK_COLOR[assessment.risk]}22`, color: RISK_COLOR[assessment.risk], border: `1px solid ${RISK_COLOR[assessment.risk]}44`, padding: '2px 10px', borderRadius: 20, fontSize: 11 }}>{assessment.risk}</span>
                    </div>
                    <div className="flex justify-between text-sm" style={{ marginBottom: 8 }}>
                      <span className="text-muted">Est. timeline</span>
                      <span style={{ fontWeight: 600 }}>{assessment.estimatedMigrationWeeks} weeks</span>
                    </div>
                    <div className="progress-bar-wrap">
                      <div className="progress-bar-fill" style={{ width: `${assessment.totalScore}%` }} />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {Object.values(assessment.categories).map(cat => (
                      <div key={cat.label} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{cat.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: cat.color }}>{cat.score}<span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>/20</span></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="section-heading"><TrendingUp size={16} style={{ color: 'var(--accent)' }} /> Score Breakdown</div>
              <ResponsiveContainer width="100%" height={260}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="rgba(255,255,255,0.07)" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                  <Radar name="Score" dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} strokeWidth={2} />
                  <Tooltip contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10 }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Issues */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="section-heading"><AlertTriangle size={16} style={{ color: 'var(--orange)' }} /> Findings & Issues</div>
            <div style={{ display: 'grid', gap: 12 }}>
              {Object.values(assessment.categories).flatMap(cat =>
                cat.issues.map((issue, i) => (
                  <div key={`${cat.label}-${i}`} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: '12px 14px', borderRadius: 10,
                    background: issue.severity === 'HIGH' ? 'rgba(239,68,68,0.06)' : issue.severity === 'MEDIUM' ? 'rgba(249,115,22,0.06)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${issue.severity === 'HIGH' ? 'rgba(239,68,68,0.2)' : issue.severity === 'MEDIUM' ? 'rgba(249,115,22,0.2)' : 'var(--border)'}`
                  }}>
                    <span className={`badge badge-${issue.severity === 'HIGH' ? 'red' : issue.severity === 'MEDIUM' ? 'orange' : 'gray'}`} style={{ flexShrink: 0 }}>
                      {issue.severity}
                    </span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{issue.message}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>{cat.label}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Recommendations */}
          <div className="card" style={{ marginBottom: 28 }}>
            <div className="section-heading"><CheckCircle size={16} style={{ color: 'var(--green)' }} /> Top Recommendations</div>
            <div style={{ display: 'grid', gap: 10 }}>
              {assessment.recommendations.map((rec) => (
                <div key={rec.priority} style={{ display: 'flex', gap: 14, padding: '12px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: '1px solid var(--border)' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(99,102,241,0.15)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{rec.priority}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>{rec.action}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <span className={`badge badge-${rec.impact === 'HIGH' ? 'red' : 'orange'}`}>Impact: {rec.impact}</span>
                      <span className={`badge badge-${rec.effort === 'LOW' ? 'green' : 'orange'}`}>Effort: {rec.effort}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button className="btn btn-primary btn-lg" onClick={() => navigate('/plan')}>
            Generate Wave Plan <ArrowRight size={18} />
          </button>
        </>
      )}

      {!assessment && !loading && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <button className="btn btn-primary btn-lg" onClick={fetchAssessment}>
            <BarChart2 size={18} /> Run Assessment
          </button>
        </div>
      )}
    </div>
  );
}
