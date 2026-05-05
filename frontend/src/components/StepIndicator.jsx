import React from 'react';
import { CheckCircle, Circle, Clock } from 'lucide-react';

const STEPS = ['Upload', 'Assess', 'Wave Plan', 'Migrate', 'Dashboard'];

export default function StepIndicator({ current }) {
  return (
    <div className="steps" style={{ marginBottom: 36 }}>
      {STEPS.map((label, i) => {
        const isDone = i < current;
        const isActive = i === current;
        return (
          <React.Fragment key={label}>
            <div className="step-wrapper">
              <div className={`step-circle ${isDone ? 'done' : isActive ? 'active' : 'pending'}`}>
                {isDone ? <CheckCircle size={16} /> : isActive ? i + 1 : <Clock size={14} />}
              </div>
              <div className="step-label" style={{ color: isActive ? 'var(--text-primary)' : isDone ? 'var(--green)' : 'var(--text-muted)' }}>
                {label}
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`step-connector ${isDone ? 'done' : ''}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
