import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  UploadCloud, BarChart2, GitBranch, Activity, ShieldCheck, Home, Zap
} from 'lucide-react';
import { useApp } from '../context/AppContext';

const navItems = [
  { to: '/', icon: Home, label: 'Overview', exact: true },
  { to: '/upload', icon: UploadCloud, label: 'Upload Config' },
  { to: '/assessment', icon: BarChart2, label: 'Readiness Score' },
  { to: '/plan', icon: GitBranch, label: 'Wave Plan' },
  { to: '/migration', icon: Activity, label: 'Live Migration' },
  { to: '/dashboard', icon: ShieldCheck, label: 'Security & Cost' },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const { sessionId } = useApp();

  return (
    <div className="sidebar">
      <div className="sidebar-logo" onClick={() => navigate('/')}>
        <div className="flex items-center gap-2">
          <Zap size={22} style={{ color: '#6366f1' }} />
          <div>
            <div className="sidebar-logo-text">CloudShift</div>
            <div className="sidebar-logo-sub">Migration Intelligence</div>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map(({ to, icon: Icon, label, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <Icon className="nav-icon" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        {sessionId ? (
          <div className="sidebar-badge">
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', flexShrink: 0 }} />
            Session Active
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center' }}>
            Upload a config to start
          </div>
        )}
        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
          us-east-1 · AWS DMS v3
        </div>
      </div>
    </div>
  );
}
