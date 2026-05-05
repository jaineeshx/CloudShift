import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AppProvider } from './context/AppContext';
import Sidebar from './components/Sidebar';
import Home from './pages/Home';
import Upload from './pages/Upload';
import Assessment from './pages/Assessment';
import WavePlan from './pages/WavePlan';
import LiveMigration from './pages/LiveMigration';
import Dashboard from './pages/Dashboard';

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <div className="app-layout">
          <Sidebar />
          <main className="main-content">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/upload" element={<Upload />} />
              <Route path="/assessment" element={<Assessment />} />
              <Route path="/plan" element={<WavePlan />} />
              <Route path="/migration" element={<LiveMigration />} />
              <Route path="/dashboard" element={<Dashboard />} />
            </Routes>
          </main>
        </div>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-bright)',
              borderRadius: '12px',
              fontSize: '13.5px',
              fontFamily: 'Inter, sans-serif'
            },
            success: { iconTheme: { primary: '#22c55e', secondary: 'var(--bg-secondary)' } },
            error: { iconTheme: { primary: '#ef4444', secondary: 'var(--bg-secondary)' } }
          }}
        />
      </BrowserRouter>
    </AppProvider>
  );
}
