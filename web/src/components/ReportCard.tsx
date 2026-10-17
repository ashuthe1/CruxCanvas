import { useState } from 'react';
import type { DesignReport } from '../lib/api';

/** The validator's reasoning for one design: rationale, auto-fixes, checks. */
export function ReportCard({ report, onSelectPage, onIterate }: { report: DesignReport & { pageId?: string; thumb?: string }; onSelectPage?: () => void; onIterate?: () => void }) {
  const [open, setOpen] = useState(false);
  const failed = report.checks.filter((c) => !c.ok);
  const color = report.score >= 90 ? '#16a34a' : report.score >= 70 ? '#f59e0b' : '#ef4444';
  return (
    <div className="report" onClick={onSelectPage} title="Click to jump to this page">
      <div className="report-head">
        {report.thumb ? <img className="report-thumb" src={report.thumb} alt="" /> : null}
        <span className="report-score" style={{ background: color }}>
          {report.score}
        </span>
        <div>
          <b>{report.name || 'Design'}</b>
          <small>
            {report.checks.length - failed.length}/{report.checks.length} checks passed
            {report.autoFixed.length ? ` · auto-fixed ${report.autoFixed.length}` : ''}
          </small>
        </div>
        {onIterate && (
          <button
            className="chip"
            title="Winner iterations: A/B variants of this page that change one thing each"
            onClick={(e) => {
              e.stopPropagation();
              onIterate();
            }}
          >
            ⑂ Iterate
          </button>
        )}
        <button
          className="link"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
        >
          {open ? 'hide' : 'why?'}
        </button>
      </div>
      {report.rationale && <p className="report-why">{report.rationale}</p>}
      {open && (
        <div className="report-body">
          {report.autoFixed.length > 0 && (
            <div className="report-sec">
              <b>Auto-fixed by validator</b>
              <ul>
                {report.autoFixed.map((f) => (
                  <li key={f}>⚡ {f}</li>
                ))}
              </ul>
            </div>
          )}
          {failed.length > 0 && (
            <div className="report-sec">
              <b>Still flagged</b>
              <ul>
                {failed.map((f, i) => (
                  <li key={i}>
                    ⚠ {f.rule}
                    {f.detail ? ` — ${f.detail}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="report-sec">
            <b>Passed</b>
            <div className="chips">
              {report.checks.filter((c) => c.ok).map((c) => (
                <span key={c.rule} className="chip ok">
                  ✓ {c.rule}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
