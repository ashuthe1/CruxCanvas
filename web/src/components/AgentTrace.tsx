import { useState } from 'react';
import type { TraceStep } from '../lib/api';

const ICON: Record<TraceStep['kind'], string> = { observe: '👁', vision: '🔍', plan: '🧭', tool: '🛠', validate: '✅', fix: '🩹', note: 'ℹ️' };
const LABEL: Record<TraceStep['kind'], string> = { observe: 'Saw', vision: 'Looked', plan: 'Decided', tool: 'Did', validate: 'Checked', fix: 'Fixed', note: 'Note' };

function Pretty({ data }: { data: any }) {
  if (data == null) return null;
  if (typeof data === 'string') return <pre>{data}</pre>;
  if (Array.isArray(data) && data.length && typeof data[0] === 'object' && ('problem' in data[0] || 'rule' in data[0] || 'message' in data[0])) {
    return (
      <ul className="trace-list">
        {data.map((d: any, i: number) => (
          <li key={i}>
            <b>{d.severity || d.rule || ''}</b> {d.problem || d.message} {d.suggestion ? <em>→ {d.suggestion}</em> : null}
            {d.elementIds?.length ? <code>{d.elementIds.join(', ')}</code> : null}
          </li>
        ))}
      </ul>
    );
  }
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}

/** Collapsible "what the agent did" block for one turn, like a reasoning trace. */
export function AgentTrace({ steps, live }: { steps: TraceStep[]; live?: boolean }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (!steps.length) return null;
  const last = steps[steps.length - 1];
  const totalMs = steps.reduce((s, x) => s + (x.ms || 0), 0);
  return (
    <div className={`trace ${live ? 'live' : ''}`}>
      <button className="trace-head" onClick={() => setOpen(!open)}>
        <span className={`trace-dot ${live ? 'live' : ''}`} />
        <span className="trace-title">
          {live ? last.title : `${steps.length} steps · ${totalMs ? `${(totalMs / 1000).toFixed(1)}s of model time` : 'done'}`}
        </span>
        <span className="trace-caret">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ol className="trace-steps">
          {steps.map((s) => {
            const has = s.detail || s.data;
            const isOpen = !!expanded[s.id];
            return (
              <li key={s.id} className={`trace-step ${s.kind}`}>
                <button className="trace-row" onClick={() => has && setExpanded({ ...expanded, [s.id]: !isOpen })} disabled={!has}>
                  <span className="trace-icon">{ICON[s.kind]}</span>
                  <span className="trace-kind">{LABEL[s.kind]}</span>
                  <span className="trace-text">{s.title}</span>
                  {s.ms ? <span className="trace-ms">{(s.ms / 1000).toFixed(1)}s</span> : null}
                  {has ? <span className="trace-caret">{isOpen ? '−' : '+'}</span> : null}
                </button>
                {isOpen && (
                  <div className="trace-detail">
                    {s.detail && <p>{s.detail}</p>}
                    <Pretty data={s.data} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
