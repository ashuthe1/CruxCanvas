import type { LintResult } from '../lib/api';

export function LintPanel({ lint, onFix, onFixAll, onAutoFix }: { lint: LintResult | null; onFix: (ops: any[]) => void; onFixAll: () => void; onAutoFix: () => void }) {
  if (!lint) return <div className="lint">Checking…</div>;
  const color = lint.score >= 90 ? '#16a34a' : lint.score >= 70 ? '#f59e0b' : '#ef4444';
  const fixable = lint.issues.filter((i) => i.fix).length;
  return (
    <div className="lint">
      <div className="score">
        <div className="ring" style={{ background: color }}>
          {lint.score}
        </div>
        <div className="label">
          Brand compliance
          <small>{lint.issues.length === 0 ? `All ${lint.passed.length} checks passed` : `${lint.issues.length} issue${lint.issues.length > 1 ? 's' : ''} · ${lint.passed.length} checks passed`}</small>
        </div>
      </div>
      {lint.issues.length > 0 && (
        <div className="lint-actions">
          {fixable > 0 && (
            <button className="btn-primary" onClick={onAutoFix} title="Apply every deterministic fix instantly (no AI call)">
              ⚡ Auto-fix {fixable}
            </button>
          )}
          <button className="btn-ghost" onClick={onFixAll} title="Let the copilot resolve everything, including judgement calls">
            ✨ Fix with AI
          </button>
        </div>
      )}
      {lint.issues.length === 0 && <div className="ok">✓ This page follows the brand guidelines.</div>}
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
      {lint.passed.length > 0 && (
        <details className="passed">
          <summary>{lint.passed.length} checks passed</summary>
          <ul>
            {lint.passed.map((p) => (
              <li key={p}>✓ {p}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
