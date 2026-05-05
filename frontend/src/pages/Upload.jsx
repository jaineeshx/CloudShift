import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, FileJson, CheckCircle, ArrowRight, Download, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { uploadConfig } from '../api/client';
import { useApp } from '../context/AppContext';
import StepIndicator from '../components/StepIndicator';

const SAMPLE_CONFIG = {
  appName: "LegacyBankingApp",
  framework: "Spring Boot 2.x",
  runtime: "Java 11",
  environment: "production",
  database: { type: "mysql", version: "5.7", host: "192.168.1.10", port: 3306, sizeGB: 45, name: "banking_db" },
  server: { type: "EC2", instanceType: "m4.large", os: "CentOS 7", count: 3 },
  services: [
    { name: "auth-service", port: 8080, type: "REST" },
    { name: "payment-gateway", port: 8081, type: "REST" },
    { name: "reporting-engine", port: 8082, type: "REST" }
  ],
  dependencies: ["spring-boot:2.7", "hibernate:5.6", "log4j:1.2", "commons-lang:2.6"],
  ssl: true,
  auth: { type: "JWT", provider: "internal" },
  monitoring: false,
  containerized: false,
  cicd: false,
  ports: [80, 443, 8080, 8081, 8082],
  encryption: { atRest: false, inTransit: true }
};

export default function Upload() {
  const navigate = useNavigate();
  const { setSessionId, setConfigMetadata } = useApp();
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');

  const onDrop = (acceptedFiles) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setFileName(file.name);
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        setPreview(parsed);
      } catch {
        try {
          // YAML fallback — just store as string, backend parses it
          setPreview({ _raw: e.target.result, _note: 'YAML file — will be parsed by backend' });
        } catch {
          setError('Invalid file format. Use JSON or YAML.');
        }
      }
    };
    reader.readAsText(file);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/json': ['.json'], 'text/yaml': ['.yaml', '.yml'] },
    maxFiles: 1
  });

  const handleLoadSample = () => {
    setPreview(SAMPLE_CONFIG);
    setFileName('sample-banking-app.json');
    setError('');
  };

  const handleUpload = async () => {
    if (!preview) return toast.error('Please select or load a config file first');
    setLoading(true);
    try {
      const result = await uploadConfig(preview, fileName || 'config.json');
      setSessionId(result.sessionId);
      setConfigMetadata(result.metadata);
      toast.success('Config uploaded! Running assessment...');
      navigate('/assessment');
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      setError(msg);
      toast.error(`Upload failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-fadeUp">
      <StepIndicator current={0} />

      <div className="page-header">
        <h1 className="page-title">Upload <span className="gradient-text">Legacy Config</span></h1>
        <p className="page-subtitle">Drop your application stack config (JSON/YAML) to start the readiness assessment</p>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        {/* Dropzone */}
        <div>
          <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
            <input {...getInputProps()} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                background: 'rgba(99,102,241,0.1)', border: '2px solid rgba(99,102,241,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: isDragActive ? 'pulse 1s infinite' : undefined
              }}>
                <UploadCloud size={32} style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
                  {isDragActive ? 'Drop it here!' : 'Drag & drop your config'}
                </p>
                <p className="text-muted text-sm">Supports JSON and YAML · Max 10MB</p>
              </div>
              {fileName && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'rgba(99,102,241,0.1)', padding: '8px 16px',
                  borderRadius: 8, border: '1px solid rgba(99,102,241,0.3)'
                }}>
                  <FileJson size={16} style={{ color: 'var(--accent)' }} />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{fileName}</span>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={handleLoadSample}>
              <Download size={16} /> Load Sample Config
            </button>
          </div>

          {error && (
            <div className="alert alert-error" style={{ marginTop: 16 }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} /> {error}
            </div>
          )}

          {preview && (
            <button
              className="btn btn-primary btn-lg"
              style={{ width: '100%', marginTop: 20, justifyContent: 'center' }}
              onClick={handleUpload}
              disabled={loading}
            >
              {loading ? (
                <><span className="animate-spin">⟳</span> Uploading...</>
              ) : (
                <><CheckCircle size={18} /> Upload & Analyze <ArrowRight size={16} /></>
              )}
            </button>
          )}
        </div>

        {/* Config Preview */}
        <div>
          {preview ? (
            <div className="card">
              <div className="section-heading">
                <FileJson size={16} style={{ color: 'var(--accent)' }} /> Config Preview
              </div>
              <div className="log-terminal" style={{ maxHeight: 420 }}>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-secondary)', fontSize: 12 }}>
                  {JSON.stringify(preview, null, 2)}
                </pre>
              </div>

              {/* Detected fields summary */}
              {!preview._raw && (
                <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {[
                    { label: 'App Name', value: preview.appName || preview.name || '—' },
                    { label: 'Framework', value: preview.framework || preview.runtime || '—' },
                    { label: 'Database', value: preview.database?.type || preview.dbType || '—' },
                    { label: 'DB Size', value: preview.database?.sizeGB ? `${preview.database.sizeGB} GB` : '—' },
                    { label: 'Services', value: (preview.services?.length || 0) + ' services' },
                    { label: 'SSL', value: preview.ssl ? '✓ Enabled' : '✗ Not set' },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="card" style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, textAlign: 'center' }}>
              <FileJson size={48} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
              <p style={{ color: 'var(--text-muted)' }}>Config preview will appear here</p>
              <p className="text-xs text-muted">Try loading the sample config →</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
