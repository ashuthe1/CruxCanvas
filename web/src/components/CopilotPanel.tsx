import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { streamAgent, lintPage, getBrand, listBrands, getReferences, sendSnapshotReply, type AgentEvent, type LintResult, type Brand, type BrandSummary, type DesignReport } from '../lib/api';
import { addPageFromJSON, applyOps, exportAllAsZip, pageToDataURL, serializeCanvas, serializePage } from '../lib/canvas';
import { getBrandId, setBrandId } from '../lib/brand';
import { registerBrandFonts } from '../store';
import { LintPanel } from './LintPanel';
import { ReportCard } from './ReportCard';

type Msg =
  | { kind: 'user'; text: string; refs?: string[] }
  | { kind: 'assistant'; text: string }
  | { kind: 'status'; text: string; done?: boolean }
  | { kind: 'report'; report: DesignReport & { pageId: string } };

const SUGGESTIONS = (brand: string) => [
  `Create a 1080×1080 Instagram post announcing a new ${brand} feature`,
  'Create 4 different images like this',
  'Make the headline punchier and move the logo to the bottom right',
  'Turn this into a 1080×1920 Story and make it Meta-safe',
  'Create a 1200×628 LinkedIn ad with a 3-month free offer',
];

/** tiny markdown: **bold** */
function renderLite(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : <span key={i}>{part}</span>));
}
async function urlToDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });
}

export const CopilotPanel = observer(({ store }: { store: any }) => {
  const [tab, setTab] = useState<'chat' | 'lint'>('chat');
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [brandId, setBrandIdState] = useState(getBrandId());
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [refs, setRefs] = useState<string[]>([]);
  const [useCanvasAsRef, setUseCanvasAsRef] = useState(false);
  const [variants, setVariants] = useState(1);
  const [busy, setBusy] = useState(false);
  const [lint, setLint] = useState<LintResult | null>(null);
  const [refLib, setRefLib] = useState<{ name: string; url: string }[] | null>(null);
  const [showRefLib, setShowRefLib] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // brand bootstrap
  useEffect(() => {
    listBrands().then(setBrands).catch(console.error);
  }, []);
  useEffect(() => {
    getBrand(brandId)
      .then((b) => {
        setBrand(b);
        registerBrandFonts(b);
        setRefLib(null);
        setMsgs([{ kind: 'assistant', text: `Hi! I'm the ${b.name} brand copilot. Describe what you want, attach a reference, or select something on the canvas and tell me how to change it.` }]);
      })
      .catch(console.error);
  }, [brandId]);

  const switchBrand = (id: string) => {
    setBrandId(id);
    setBrandIdState(id);
  };

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs]);

  // live lint of the active page (debounced)
  useEffect(() => {
    let t: any;
    const run = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const page = store.activePage;
        if (!page) return;
        try {
          setLint(await lintPage(serializePage(page), store.width, store.height));
        } catch {}
      }, 600);
    };
    run();
    const dispose = store.on('change', run);
    return () => {
      clearTimeout(t);
      dispose();
    };
  }, [store, brandId]);

  const pushStatus = (text: string) =>
    setMsgs((m) => {
      const last = m[m.length - 1];
      const copy = last?.kind === 'status' && !last.done ? m.slice(0, -1).concat({ ...last, done: true }) : m;
      return copy.concat({ kind: 'status', text });
    });
  const closeStatuses = (m: Msg[]) => m.map((x) => (x.kind === 'status' ? { ...x, done: true } : x));

  const handleEvent = (e: AgentEvent) => {
    switch (e.type) {
      case 'status':
        pushStatus(e.text);
        break;
      case 'page':
        addPageFromJSON(store, e.page, e.replacePageId);
        break;
      case 'ops':
        applyOps(store, e.pageId, e.ops);
        break;
      case 'lint':
        setLint(e.result);
        break;
      case 'report':
        setMsgs((m) => closeStatuses(m).concat({ kind: 'report', report: { ...e.report, pageId: e.pageId } }));
        break;
      case 'size':
        store.setSize(e.width, e.height);
        break;
      case 'snapshot_request':
        (async () => {
          try {
            await store.waitLoading?.();
            await sendSnapshotReply(e.requestId, await pageToDataURL(store, e.pageId, 0.6));
          } catch (err) {
            console.warn('snapshot failed', err);
          }
        })();
        break;
      case 'message':
        setMsgs((m) => closeStatuses(m).concat({ kind: 'assistant', text: e.text }));
        break;
      case 'error':
        setMsgs((m) => closeStatuses(m).concat({ kind: 'assistant', text: '⚠️ ' + e.text }));
        break;
      case 'done':
        setMsgs(closeStatuses);
        break;
    }
  };

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput('');
    setBusy(true);
    const allRefs = [...refs];
    if (useCanvasAsRef && store.activePage) {
      try {
        allRefs.push(await pageToDataURL(store, store.activePage.id, 0.5));
      } catch {}
    }
    setMsgs((m) => m.concat({ kind: 'user', text: message, refs: allRefs }));
    setRefs([]);
    const history = msgs
      .filter((m): m is Extract<Msg, { kind: 'user' | 'assistant' }> => m.kind === 'user' || m.kind === 'assistant')
      .slice(-8)
      .map((m) => ({ role: m.kind as 'user' | 'assistant', content: m.text }));
    abortRef.current = new AbortController();
    try {
      await streamAgent({ message, history, canvas: serializeCanvas(store), references: allRefs, variants }, handleEvent, abortRef.current.signal);
    } catch (err: any) {
      if (err?.name !== 'AbortError') handleEvent({ type: 'error', text: String(err?.message || err) });
    } finally {
      setBusy(false);
      handleEvent({ type: 'done' });
    }
  };

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((f) => {
      const r = new FileReader();
      r.onload = () => setRefs((x) => [...x, String(r.result)]);
      r.readAsDataURL(f);
    });
  };

  const autoFixAll = () => {
    if (!lint) return;
    const ops = lint.issues.flatMap((i) => i.fix || []);
    applyOps(store, store.activePage.id, ops);
  };

  const selected = store.selectedElements.length;

  return (
    <aside className="copilot">
      <div className="copilot-header">
        <div className="brand-dot" />
        <div style={{ flex: 1 }}>
          <h3>Brand Copilot</h3>
          <div className="sub">{brand ? `${brand.name} brand kit · editable canvas` : 'Loading brand…'}</div>
        </div>
        <select className="brand-select" value={brandId} onChange={(e) => switchBrand(e.target.value)} title="Your company / brand workspace">
          {(brands.length ? brands : [{ id: brandId, name: brandId }]).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <button className="btn-ghost" title="Download all pages as PNG (zip)" onClick={() => exportAllAsZip(store, `${brandId}-designs`)}>
          ⬇
        </button>
      </div>
      <div className="copilot-tabs">
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
          Chat
        </button>
        <button className={tab === 'lint' ? 'active' : ''} onClick={() => setTab('lint')}>
          Brand check {lint ? (lint.issues.length ? <span className="badge warn">{lint.issues.length}</span> : <span className="badge ok">✓</span>) : ''}
        </button>
      </div>

      {tab === 'lint' ? (
        <LintPanel lint={lint} onFix={(ops) => applyOps(store, store.activePage.id, ops)} onAutoFix={autoFixAll} onFixAll={() => send('Fix all brand compliance issues on the current page, including the judgement calls.')} />
      ) : (
        <>
          <div className="chat-log" ref={logRef}>
            {msgs.map((m, i) =>
              m.kind === 'status' ? (
                <div key={i} className={`msg status ${m.done ? 'done' : ''}`}>
                  <span className="dot" /> {m.text}
                </div>
              ) : m.kind === 'report' ? (
                <ReportCard key={i} report={m.report} onSelectPage={() => store.selectPage(m.report.pageId)} />
              ) : (
                <div key={i} className={`msg ${m.kind}`}>
                  {renderLite(m.text)}
                  {m.kind === 'user' && m.refs?.map((r, j) => <img key={j} className="ref" src={r} />)}
                </div>
              ),
            )}
          </div>
          {msgs.length < 3 && (
            <div className="suggestions">
              {SUGGESTIONS(brand?.name || 'the brand').map((s) => (
                <button key={s} onClick={() => setInput(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
          {showRefLib && refLib && (
            <div className="ref-lib">
              {refLib.length === 0 && <div className="hint">No reference ads for this brand yet.</div>}
              {refLib.map((r) => (
                <img
                  key={r.url}
                  src={r.url}
                  title={r.name}
                  onClick={async () => {
                    const d = await urlToDataUrl(r.url);
                    setRefs((x) => [...x, d]);
                    setShowRefLib(false);
                    if (!input) setInput('Create 4 different images like this');
                  }}
                />
              ))}
            </div>
          )}
          <div className="chat-input">
            {(refs.length > 0 || useCanvasAsRef || selected > 0) && (
              <div className="context-row">
                {refs.map((r, i) => (
                  <span key={i} className="chip ref">
                    <img src={r} style={{ height: 22, borderRadius: 4 }} /> reference{' '}
                    <span style={{ cursor: 'pointer' }} onClick={() => setRefs(refs.filter((_, j) => j !== i))}>
                      ✕
                    </span>
                  </span>
                ))}
                {useCanvasAsRef && <span className="chip ref">current canvas as reference</span>}
                {selected > 0 && <span className="chip sel">editing {selected} selected element{selected > 1 ? 's' : ''}</span>}
              </div>
            )}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={selected ? 'Tell me what to change about the selection…' : 'Describe the image you want…'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="chat-actions">
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
              <button className="btn-ghost" onClick={() => fileRef.current?.click()} title="Attach a reference image">
                📎
              </button>
              <button
                className="btn-ghost"
                title="Pick from this brand's reference ads"
                onClick={async () => {
                  if (!refLib) setRefLib(await getReferences(brandId));
                  setShowRefLib((s) => !s);
                }}
              >
                🖼 Library
              </button>
              <button className={`chip ${useCanvasAsRef ? 'on' : ''}`} onClick={() => setUseCanvasAsRef(!useCanvasAsRef)} title="Send a snapshot of the current page as a reference">
                canvas as ref
              </button>
              <select value={variants} onChange={(e) => setVariants(Number(e.target.value))} className="btn-ghost" title="Number of variants to generate">
                {[1, 2, 3, 4, 6].map((n) => (
                  <option key={n} value={n}>
                    ×{n}
                  </option>
                ))}
              </select>
              <div className="spacer" />
              {busy ? (
                <button className="btn-ghost" onClick={() => abortRef.current?.abort()}>
                  Stop
                </button>
              ) : (
                <button className="btn-primary" onClick={() => send()} disabled={!input.trim()}>
                  Send
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  );
});
