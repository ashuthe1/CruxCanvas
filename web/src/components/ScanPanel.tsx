import { useRef, useState } from 'react';
import { getReferences, scanCreative, type ScanReport } from '../lib/api';
import { getBrandId } from '../lib/brand';
import { pageToDataURL } from '../lib/canvas';
import { timeAgo, type ScanRecord } from '../lib/projects';

function shrink(dataUrl: string, max: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function urlToDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });
}

const color = (s: number) => (s >= 80 ? '#16a34a' : s >= 55 ? '#f59e0b' : '#ef4444');

/**
 * Brand scan: audit any creative (upload, reference, or the current page as pixels)
 * against the active brand, then remake it on-brand with one click.
 */
export function ScanPanel({
  store,
  brandName,
  onRemake,
  scans = [],
  onScanned,
}: {
  store: any;
  brandName: string;
  onRemake: (brief: string, image: string) => void;
  scans?: ScanRecord[];
  onScanned?: (rec: Omit<ScanRecord, 'id' | 'createdAt'>) => void;
}) {
  const [image, setImage] = useState<string | null>(null);
  const [report, setReport] = useState<ScanReport | null>(null);
  const sourceRef = useRef<'upload' | 'library' | 'page'>('upload');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lib, setLib] = useState<{ name: string; url: string }[] | null>(null);
  const [showLib, setShowLib] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (dataUrl: string, source: 'upload' | 'library' | 'page' = 'upload') => {
    sourceRef.current = source;
    setImage(dataUrl);
    setReport(null);
    setError(null);
    setBusy(true);
    try {
      const rep = await scanCreative(dataUrl);
      setReport(rep);
      // keep a small thumbnail with the record
      const thumb = await shrink(dataUrl, 240);
      onScanned?.({ source, thumb, report: rep });
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => run(String(r.result), 'upload');
    r.readAsDataURL(f);
  };

  const scanCurrentPage = async () => {
    if (!store.activePage?.children.length) return setError('The current page is empty.');
    await store.waitLoading?.();
    run(await pageToDataURL(store, store.activePage.id, 0.6), 'page');
  };

  return (
    <div className="scan">
      {!image && (
        <>
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onFiles(e.dataTransfer.files);
            }}
            onClick={() => fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFiles(e.target.files)} />
            <div className="drop-icon">⌕</div>
            <b>Scan any creative against the {brandName} brand</b>
            <span>Drop an image here or click to upload. You get a scored report, the fixes, and a one-click on-brand remake.</span>
          </div>
          <div className="scan-sources">
            <button
              className="btn-ghost"
              onClick={async () => {
                if (!lib) setLib(await getReferences(getBrandId()));
                setShowLib((s) => !s);
              }}
            >
              🖼 Pick from library
            </button>
            <button className="btn-ghost" onClick={scanCurrentPage}>
              ▣ Scan current page as pixels
            </button>
          </div>
          {showLib && lib && (
            <div className="ref-lib">
              {lib.map((r) => (
                <img key={r.url} src={r.url} title={r.name} onClick={async () => run(await urlToDataUrl(r.url), 'library')} />
              ))}
              {!lib.length && <div className="hint">No references for this brand.</div>}
            </div>
          )}
          {scans.length > 0 && (
            <>
              <h5>Previous scans in this session</h5>
              <div className="scan-history">
                {scans.map((s) => (
                  <button
                    key={s.id}
                    className="scan-row"
                    onClick={() => {
                      setImage(s.thumb);
                      setReport(s.report);
                      setError(null);
                    }}
                  >
                    <img src={s.thumb} alt="" />
                    <span className="ring" style={{ background: color(s.report.score) }}>
                      {s.report.score}
                    </span>
                    <div>
                      <b>{s.report.extracted?.headline || s.report.summary?.slice(0, 50) || 'Creative'}</b>
                      <small>
                        {s.report.verdict.replace('-', ' ')} · {s.source} · {timeAgo(s.createdAt)}
                      </small>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {image && (
        <div className="scan-result">
          <div className="scan-head">
            <img className="scan-thumb" src={image} alt="" />
            <div className="scan-score">
              {busy ? (
                <div className="scan-busy">
                  <span className="dot" /> Scanning pixels, reading copy, checking the kit…
                </div>
              ) : report ? (
                <>
                  <div className="ring big" style={{ background: color(report.score) }}>
                    {report.score}
                  </div>
                  <div>
                    <b className={`verdict ${report.verdict}`}>{report.verdict.replace('-', ' ')}</b>
                    <small>
                      {report.width}×{report.height} · {report.aspect} · {report.checks.filter((c) => c.ok).length}/{report.checks.length} checks passed
                    </small>
                  </div>
                </>
              ) : (
                <div className="hint">{error}</div>
              )}
            </div>
          </div>

          {report && (
            <>
              <button className="btn-primary remake" onClick={() => onRemake(report.remakeBrief, image)}>
                ✨ Remake on-brand
              </button>
              <p className="scan-summary">{report.summary}</p>

              <h5>Checks</h5>
              {report.checks.map((c, i) => (
                <div className={`issue ${c.ok ? 'pass' : ''}`} key={i}>
                  <span className={`sev ${c.ok ? 'pass' : c.severity}`} />
                  <div className="body">
                    <b>
                      {c.ok ? '✓ ' : ''}
                      {c.rule}
                    </b>
                    <span>{c.detail}</span>
                    {!c.ok && c.fix && <em className="fix">Fix: {c.fix}</em>}
                  </div>
                </div>
              ))}

              <h5>Colours found</h5>
              <div className="swatch-row">
                {report.palette.detected.map((d) => (
                  <div key={d.hex} className={`swatch ${d.onBrand ? '' : 'off'}`} title={`${d.hex} · ${Math.round(d.share * 100)}% · nearest ${d.nearest}`}>
                    <span style={{ background: d.hex }} />
                    <small>{Math.round(d.share * 100)}%</small>
                  </div>
                ))}
                <small className="hint">{Math.round(report.palette.coverageOnBrand * 100)}% on-brand coverage</small>
              </div>

              {(report.extracted.headline || report.extracted.cta) && (
                <>
                  <h5>Copy detected</h5>
                  <div className="copy-box">
                    {report.extracted.headline && <b>{report.extracted.headline}</b>}
                    {report.extracted.subhead && <span>{report.extracted.subhead}</span>}
                    {report.extracted.cta && <span className="chip">{report.extracted.cta}</span>}
                  </div>
                </>
              )}
            </>
          )}

          <div className="scan-actions">
            <button
              className="btn-ghost"
              onClick={() => {
                setImage(null);
                setReport(null);
                setError(null);
              }}
            >
              ← Scan another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
