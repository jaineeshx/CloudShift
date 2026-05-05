import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, UploadCloud, BarChart2, GitBranch, Activity, ShieldCheck, ArrowRight, CheckCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';

const FEATURES = [
  { icon: UploadCloud, title: 'Config Upload', desc: 'Upload JSON/YAML app config. Auto-parsed and stored in S3 + DynamoDB.', to: '/upload', color: '#6366f1', badge: 'Step 1' },
  { icon: BarChart2, title: 'AI Readiness Score', desc: 'Heuristic engine scores your stack across 5 dimensions (0–100) with risk flags.', to: '/assessment', color: '#06b6d4', badge: 'Step 2' },
  { icon: GitBranch, title: 'Wave Plan Generator', desc: '3-wave migration plan in AWS Transform format — dependencies, timelines, risk.', to: '/plan', color: '#a855f7', badge: 'Step 3' },
  { icon: Activity, title: 'Live DMS Migration', desc: 'Real AWS DMS task — MySQL on EC2 → Aurora PostgreSQL. Table-by-table progress.', to: '/migration', color: '#22c55e', badge: 'Step 4' },
  { icon: ShieldCheck, title: 'Security Dashboard', desc: 'IAM roles, RDS encryption, VPC isolation, CloudTrail audit, cost savings.', to: '/dashboard', color: '#f97316', badge: 'Step 5' },
];

const TECH_STACK = [
  { label: 'Frontend', value: 'Vite + React', icon: '⚛️' },
  { label: 'Backend', value: 'AWS Lambda (Node.js 20)', icon: '⚡' },
  { label: 'API', value: 'API Gateway REST', icon: '🌐' },
  { label: 'Storage', value: 'S3 + DynamoDB', icon: '🗄️' },
  { label: 'Migration', value: 'AWS DMS (real)', icon: '🔄' },
  { label: 'Source DB', value: 'MySQL on EC2', icon: '🖥️' },
  { label: 'Target DB', value: 'Aurora PostgreSQL', icon: '🐘' },
  { label: 'Infra', value: 'AWS CDK (TypeScript)', icon: '🏗️' },
  { label: 'Security', value: 'IAM + CloudTrail', icon: '🔐' },
  { label: 'Cost', value: 'Cost Explorer API', icon: '💰' },
];

export default function Home() {
  const navigate = useNavigate();
  const { sessionId } = useApp();

  return (
    <div className="animate-fadeUp">
      {/* Hero */}
      <div style={{
        background: 'radial-gradient(ellipse 80% 60% at 50% -20%, rgba(99,102,241,0.15), transparent)',
        borderRadius: 24, padding: '64px 48px', textAlign: 'center',
        border: '1px solid var(--border)', marginBottom: 40, position: 'relative', overflow: 'hidden'
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'radial-gradient(circle at 70% 20%, rgba(6,182,212,0.08), transparent 50%), radial-gradient(circle at 30% 80%, rgba(168,85,247,0.08), transparent 50%)',
          pointerEvents: 'none'
        }} />

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)',
          borderRadius: 99, padding: '6px 16px', fontSize: 12, fontWeight: 600,
          color: 'var(--accent)', marginBottom: 24, letterSpacing: '0.5px'
        }}>
          <Zap size={13} /> Built with Real AWS DMS — Not a Simulation
        </div>

        <h1 style={{ fontSize: 52, fontWeight: 900, letterSpacing: -2, marginBottom: 20, lineHeight: 1.1 }}>
          Cloud Migration
          <span className="gradient-text"> Intelligence</span>
          <br />at Your Fingertips
        </h1>

        <p style={{ fontSize: 18, color: 'var(--text-secondary)', maxWidth: 600, margin: '0 auto 36px', lineHeight: 1.7 }}>
          A production-grade AWS migration platform — upload your legacy stack config, get an AI readiness score,
          generate a wave plan, and watch a <strong style={{ color: 'var(--text-primary)' }}>real DMS migration</strong> happen live.
        </p>

        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-lg" onClick={() => navigate('/upload')} style={{ animation: 'glow 3s infinite' }}>
            <UploadCloud size={20} /> Start Migration Flow <ArrowRight size={18} />
          </button>
          {sessionId && (
            <button className="btn btn-secondary btn-lg" onClick={() => navigate('/dashboard')}>
              <ShieldCheck size={20} /> View Dashboard
            </button>
          )}
        </div>

        {sessionId && (
          <div style={{ marginTop: 24 }}>
            <span style={{ fontSize: 12.5, color: 'var(--green)', background: 'rgba(34,197,94,0.1)', padding: '6px 14px', borderRadius: 99, border: '1px solid rgba(34,197,94,0.2)' }}>
              ✓ Active Session: {sessionId.slice(0, 8)}...
            </span>
          </div>
        )}
      </div>

      {/* Features Grid */}
      <div style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, color: 'var(--text-secondary)' }}>
          Migration Flow — 5 Steps
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {FEATURES.map(({ icon: Icon, title, desc, to, color, badge }) => (
            <div
              key={to}
              className="card"
              style={{ cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
              onClick={() => navigate(to)}
            >
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                background: `linear-gradient(90deg, ${color}, transparent)`
              }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: `${color}18`, border: `1px solid ${color}30`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <Icon size={22} style={{ color }} />
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color, background: `${color}18`, padding: '3px 8px', borderRadius: 99, border: `1px solid ${color}30`, letterSpacing: '0.5px' }}>
                  {badge}
                </span>
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{title}</div>
              <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{desc}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 14, color, fontSize: 12.5, fontWeight: 600 }}>
                Open <ArrowRight size={13} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tech Stack */}
      <div className="card">
        <div className="section-heading">🏗️ Full Tech Stack</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          {TECH_STACK.map(({ label, value, icon }) => (
            <div key={label} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 20 }}>{icon}</span>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* What makes it real */}
      <div style={{ marginTop: 28, padding: '20px 24px', borderRadius: 14, background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)' }}>
        <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14, color: 'var(--green)' }}>✓ Why this is NOT a demo</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {[
            'Real AWS DMS task — MySQL → Aurora PostgreSQL, tracked via DescribeTableStatistics API',
            'Real IAM role listing from your AWS account via IAM SDK',
            'Real RDS encryption status from DescribeDBInstances',
            'Real CloudTrail audit logs from LookupEvents API',
            'Real cost data from Cost Explorer API',
            'All infra deployed via AWS CDK — reproducible, production-grade'
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13.5 }}>
              <CheckCircle size={15} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 2 }} />
              <span style={{ color: 'var(--text-secondary)' }}>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
