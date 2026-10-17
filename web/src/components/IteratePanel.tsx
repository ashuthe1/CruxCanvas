import { useEffect, useState } from 'react';
import { getIterationDimensions, type IterationDimension } from '../lib/api';

/** One row of the comparison grid: the original or a variant page */
export type VariantCard = {
  pageId: string;
  dimension?: string;
  label: string;
  score?: number;
  thumb?: string;
  dropped?: string[];
  rejected?: string;
  kept?: boolean | null;
};

const scoreColor = (s?: number) => (s === undefined ? '#9ca3af' : s >= 90 ? '#16a34a' : s >= 70 ? '#f59e0b' : '#ef4444');

/**
 * Picker: which dimensions to vary and how many variants. Dimensions come from the server registry,
 * so a new dimension added on the server shows up here without a web change.
 */
export function IteratePicker({ onRun, onClose, disabled }: { onRun: (dimensions: string[], count: number) => void; onClose: () => void; disabled?: boolean }) {
  const [dims, setDims] = useState<IterationDimension[]>([]);
  const [chosen, setChosen] = useState<string[]>(['hook']);
  const [count, setCount] = useState(3);
  useEffect(() => {
    getIterationDimensions().then(setDims).catch(console.error);
  }, []);
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  return (
    <div className="iterate-picker">
      <div className="iterate-title">
        <b>Winner iterations</b>
        <span>Duplicate this page and change exactly one thing per copy, so you can A/B test what moved the needle.</span>
      </div>
      <div className="dim-list">
        {dims.map((d) => (
          <label key={d.id} className={chosen.includes(d.id) ? 'on' : ''}>
            <input type="checkbox" checked={chosen.includes(d.id)} onChange={() => toggle(d.id)} />
            <b>{d.label}</b>
            <span>{d.blurb}</span>
          </label>
        ))}
        {!dims.length && <div className="hint">Loading dimensions…</div>}
      </div>
      <div className="iterate-actions">
        <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="btn-ghost" title="How many variants in total (dimensions are cycled)">
          {[1, 2, 3, 4, 6].map((n) => (
            <option key={n} value={n}>
              {n} variant{n > 1 ? 's' : ''}
            </option>
          ))}
        </select>
        <div className="spacer" />
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={disabled || !chosen.length} onClick={() => onRun(chosen, count)}>
          Generate
        </button>
      </div>
    </div>
  );
}

/** Comparison grid: original + variants side by side with scores, the changed dimension, keep / discard. */
export function IterationGrid({
  original,
  variants,
  busy,
  dimensionLabel,
  onKeep,
  onDiscard,
  onJump,
  onClose,
}: {
  original: VariantCard;
  variants: VariantCard[];
  busy: boolean;
  dimensionLabel: (id?: string) => string;
  onKeep: (pageId: string) => void;
  onDiscard: (pageId: string) => void;
  onJump: (pageId: string) => void;
  onClose: () => void;
}) {
  const live = variants.filter((v) => !v.rejected);
  const rejected = variants.filter((v) => v.rejected);
  const undecided = live.filter((v) => v.kept == null);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal iteration-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <b>Winner iterations</b>
            <span>
              {busy ? 'Generating controlled variants…' : `${live.length} variant${live.length === 1 ? '' : 's'} · one change each · keep the ones worth testing`}
            </span>
          </div>
          {!busy && undecided.length > 0 && (
            <button className="btn-ghost" onClick={() => undecided.forEach((v) => onKeep(v.pageId))}>
              Keep all
            </button>
          )}
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="variant-grid">
          <VariantTile card={original} isOriginal onJump={onJump} dimensionLabel={dimensionLabel} />
          {live.map((v) => (
            <VariantTile key={v.pageId} card={v} baseline={original.score} onJump={onJump} onKeep={onKeep} onDiscard={onDiscard} dimensionLabel={dimensionLabel} />
          ))}
        </div>
        {rejected.length > 0 && (
          <div className="variant-rejected">
            {rejected.map((v) => (
              <div key={v.pageId}>
                ✕ {dimensionLabel(v.dimension)} variant discarded: {v.rejected}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function VariantTile({
  card,
  isOriginal,
  baseline,
  onJump,
  onKeep,
  onDiscard,
  dimensionLabel,
}: {
  card: VariantCard;
  isOriginal?: boolean;
  baseline?: number;
  onJump: (pageId: string) => void;
  onKeep?: (pageId: string) => void;
  onDiscard?: (pageId: string) => void;
  dimensionLabel: (id?: string) => string;
}) {
  const delta = card.score !== undefined && baseline !== undefined ? card.score - baseline : undefined;
  return (
    <div className={`variant-tile ${isOriginal ? 'original' : ''} ${card.kept === true ? 'kept' : card.kept === false ? 'discarded' : ''}`}>
      <div className="variant-thumb" onClick={() => onJump(card.pageId)} title="Jump to this page on the canvas">
        {card.thumb ? <img src={card.thumb} alt="" /> : <div className="variant-pending">{card.score === undefined ? 'Composing…' : 'Rendering…'}</div>}
      </div>
      <div className="variant-meta">
        <span className="variant-dim" style={isOriginal ? { background: '#e5e7eb', color: '#374151' } : undefined}>
          {isOriginal ? 'Original' : dimensionLabel(card.dimension)}
        </span>
        <span className="report-score" style={{ background: scoreColor(card.score), width: 28, height: 28, fontSize: 11.5 }}>
          {card.score ?? '…'}
        </span>
        {delta !== undefined && delta !== 0 && <small className={delta > 0 ? 'up' : 'down'}>{delta > 0 ? `+${delta}` : delta}</small>}
      </div>
      <div className="variant-label" title={card.dropped?.length ? `Ignored out-of-scope changes: ${card.dropped.join('; ')}` : undefined}>
        {card.label}
        {card.dropped && card.dropped.length > 0 ? <span className="variant-dropped"> · {card.dropped.length} ignored</span> : null}
      </div>
      {!isOriginal && (
        <div className="variant-actions">
          {card.kept === false ? (
            <span className="hint">Discarded</span>
          ) : (
            <>
              <button className={`btn-ghost ${card.kept ? 'on' : ''}`} onClick={() => onKeep?.(card.pageId)} disabled={card.score === undefined}>
                {card.kept ? '✓ Kept' : 'Keep'}
              </button>
              <button className="btn-ghost danger" onClick={() => onDiscard?.(card.pageId)} disabled={card.score === undefined}>
                Discard
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
