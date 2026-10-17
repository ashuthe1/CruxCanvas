import { useRef, useState } from 'react';
import { getReferences, scanCreative, type ScanReport } from '../lib/api';
import { getBrandId } from '../lib/brand';
import { pageToDataURL } from '../lib/canvas';

async function urlToDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });
}

/**
 * Brand scan: audit any creative (upload, reference, or the current page as pixels)
 * against the active brand, then remake it on-brand with one click.
 */
export function ScanPanel({ store, brandName, onRemake }: { store: any; brandName: string; onRemake: (brief: string, image: string) => void }) {
  const [image, setImage] = useState<string | null>(null);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lib, setLib] = useState<{ name: string; url: string }[] | null>(null);
  const [showLib, setShowLib] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (dataUrl: string) => {
    setImage(dataUrl);
    setReport(null);
    setError(null);
    setBusy(true);
    try {
      setReport(await scanCreative(dataUrl));
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
    r.onload = () => run(String(r.result));
    r.readAsDataURL(f);
  };

  const scanCurrentPage = async () => {
    if (!store.activePage?.children.length) return setError('The current page is empty.');
    await store.waitLoading?.();
    run(await pageToDataURL(store, store.activePage.id, 0.6));
  };

  const color = (s: number) => (s >= 85 ? '#16a34a' : s >= 60 ? '#f59e0b' : '#ef4444');

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
                <img key={r.url} src={r.url} title={r.name} onClick={async () => run(await urlToDataUrl(r.url))} />
              ))}
              {!lib.length && <div className="hint">No references for this brand.</div>}
            </div>
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
