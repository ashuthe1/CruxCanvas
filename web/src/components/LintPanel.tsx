import type { LintResult } from '../lib/api';

export function LintPanel({ lint, onFix, onFixAll }: { lint: LintResult | null; onFix: (ops: any[]) => void; onFixAll: () => void }) {
  if (!lint) return <div className="lint">Checking…</div>;
  const color = lint.score >= 90 ? '#16a34a' : lint.score >= 70 ? '#f59e0b' : '#ef4444';
  return (
    <div className="lint">
      <div className="score">
        <div className="ring" style={{ background: color }}>
          {lint.score}
        </div>
        <div className="label">
          Brand compliance
          <small>{lint.issues.length === 0 ? 'All checks passed' : `${lint.issues.length} issue${lint.issues.length > 1 ? 's' : ''} on this page`}</small>
        </div>
        <div style={{ flex: 1 }} />
        {lint.issues.length > 0 && (
          <button className="btn-primary" onClick={onFixAll}>
            Fix all with AI
          </button>
        )}
      </div>
      {lint.issues.length === 0 && <div className="ok">✓ This page follows the Xero brand guidelines.</div>}
      {lint.issues.map((i) => (
        <div className="issue" key={i.id}>
          <span className={`sev ${i.severity}`} />
          <div className="body">
            <b>{i.rule}</b>
            <span>{i.message}</span>
          </div>
          {i.fix && (
            <button className="btn-ghost" onClick={() => onFix(i.fix!)}>
              Fix
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
