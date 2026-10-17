import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { streamAgent, streamIterate, lintPage, getBrand, listBrands, getReferences, getIterationDimensions, sendSnapshotReply, type AgentEvent, type LintResult, type Brand, type BrandSummary, type DesignReport } from '../lib/api';
import { addPageFromJSON, applyOps, duplicatePage, exportAllAsZip, pageToDataURL, serializeCanvas, serializePage } from '../lib/canvas';
import { getBrandId, setBrandId } from '../lib/brand';
import { registerBrandFonts } from '../store';
import { PROMPT_EVENT } from '../sections/TemplatesSection';
import { LintPanel } from './LintPanel';
import { ReportCard } from './ReportCard';
import { ScanPanel } from './ScanPanel';
import { addProjectScan, type Project } from '../lib/projects';
import { IteratePicker, IterationGrid, type VariantCard } from './IteratePanel';

type Msg =
  | { kind: 'user'; text: string; refs?: string[] }
  | { kind: 'assistant'; text: string }
  | { kind: 'status'; text: string; done?: boolean }
  | { kind: 'report'; report: DesignReport & { pageId: string; thumb?: string } }
  | { kind: 'iteration'; count: number };

type Iteration = { original: VariantCard; variants: VariantCard[]; busy: boolean };

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

export type CopilotProps = {
  store: any;
  /** the persisted session this editor has open */
  project?: Project | null;
  initialTab?: 'chat' | 'lint' | 'scan';
  /** persist a partial update of the project (messages, brandId, pageScores) */
  onProjectChange?: (patch: Partial<Project>) => void;
};

export const CopilotPanel = observer(({ store, project, initialTab, onProjectChange }: CopilotProps) => {
  const [tab, setTab] = useState<'chat' | 'lint' | 'scan'>(initialTab || 'chat');
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [brandId, setBrandIdState] = useState(project?.brandId || getBrandId());
  const [msgs, setMsgs] = useState<Msg[]>(() => (project?.messages?.length ? (project.messages as Msg[]) : []));
  const restoredRef = useRef(!!project?.messages?.length);
  const pageScoresRef = useRef<Record<string, number>>(project?.pageScores || {});
  const [input, setInput] = useState('');
  const [refs, setRefs] = useState<string[]>([]);
  const [useCanvasAsRef, setUseCanvasAsRef] = useState(false);
  const [variants, setVariants] = useState(1);
  const [busy, setBusy] = useState(false);
  const [lint, setLint] = useState<LintResult | null>(null);
  const [refLib, setRefLib] = useState<{ name: string; url: string }[] | null>(null);
  const [showRefLib, setShowRefLib] = useState(false);
  const [showIterate, setShowIterate] = useState(false);
  const [iteration, setIteration] = useState<Iteration | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [dimLabels, setDimLabels] = useState<Record<string, string>>({});
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // brand bootstrap
  useEffect(() => {
    listBrands().then(setBrands).catch(console.error);
    getIterationDimensions()
      .then((d) => setDimLabels(Object.fromEntries(d.map((x) => [x.id, x.label]))))
      .catch(console.error);
  }, []);
  useEffect(() => {
    getBrand(brandId)
      .then((b) => {
        setBrand(b);
        registerBrandFonts(b);
        setRefLib(null);
        if (restoredRef.current) restoredRef.current = false; // keep the restored conversation
        else setMsgs([{ kind: 'assistant', text: `Hi! I'm the ${b.name} brand copilot. Describe what you want, attach a reference, pick a layout from Templates, or select something on the canvas and tell me how to change it.` }]);
      })
      .catch(async () => {
        // stored brand no longer exists → fall back to the first available one
        const list = await listBrands().catch(() => []);
        if (list[0] && list[0].id !== brandId) switchBrand(list[0].id);
      });
  }, [brandId]);

  const switchBrand = (id: string) => {
    setBrandId(id);
    setBrandIdState(id);
    if (project && id !== project.brandId) onProjectChange?.({ brandId: id });
  };

  // persist the conversation (debounced; statuses are kept but closed)
  useEffect(() => {
    if (!project || !onProjectChange) return;
    // never let a fresh instance's default greeting clobber a real saved conversation
    const hasUserTurn = msgs.some((m) => m.kind === 'user');
    if (!hasUserTurn && (project.messages?.length || 0) > msgs.length) return;
    const t = setTimeout(() => onProjectChange({ messages: msgs.map((m) => (m.kind === 'status' ? { ...m, done: true } : m)) }), 900);
    return () => clearTimeout(t);
  }, [msgs]);

  // prompts coming from the side panel (Templates)
  useEffect(() => {
    const h = (e: Event) => {
      const { text, send: go } = (e as CustomEvent).detail || {};
      if (!text) return;
      setTab('chat');
      setInput(text);
      if (go) setTimeout(() => send(text), 50);
    };
    window.addEventListener(PROMPT_EVENT, h);
    return () => window.removeEventListener(PROMPT_EVENT, h);
  });

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
          const res = await lintPage(serializePage(page), store.width, store.height);
          if (res && Array.isArray(res.issues)) setLint(res);
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
        pageScoresRef.current = { ...pageScoresRef.current, [e.pageId]: e.result.score };
        onProjectChange?.({ pageScores: pageScoresRef.current });
        break;
      case 'report': {
        const entry: Msg = { kind: 'report', report: { ...e.report, pageId: e.pageId } };
        setMsgs((m) => closeStatuses(m).concat(entry));
        // attach a thumbnail once the page has rendered
        setTimeout(async () => {
          try {
            await store.waitLoading?.();
            const thumb = await pageToDataURL(store, e.pageId, 0.12);
            setMsgs((m) => m.map((x) => (x === entry ? { kind: 'report', report: { ...entry.report, thumb } } : x)));
          } catch {}
        }, 400);
        break;
      }
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

  const thumbOf = async (pageId: string, ratio = 0.25) => {
    await store.waitLoading?.();
    return pageToDataURL(store, pageId, ratio);
  };
  const patchVariant = (pageId: string, patch: Partial<VariantCard>) =>
    setIteration((it) => (it ? { ...it, variants: it.variants.map((v) => (v.pageId === pageId ? { ...v, ...patch } : v)) } : it));

  /** Winner iterations: duplicate the active page N times, one controlled change per copy */
  const runIteration = async (dimensions: string[], count: number) => {
    const page = store.activePage;
    if (!page || !page.children.length || busy) return;
    setShowIterate(false);
    setBusy(true);
    setTab('chat');
    const original: VariantCard = { pageId: page.id, label: page.custom?.name || 'Current page', score: lint?.score, kept: true };
    setIteration({ original, variants: [], busy: true });
    setShowGrid(true);
    setMsgs((m) => m.concat({ kind: 'user', text: `Winner iterations: ${count} variant${count > 1 ? 's' : ''} varying ${dimensions.map((d) => (dimLabels[d] || d).toLowerCase()).join(', ')}` }));
    thumbOf(page.id).then((thumb) => setIteration((it) => (it ? { ...it, original: { ...it.original, thumb } } : it))).catch(() => {});
    abortRef.current = new AbortController();
    const onEvent = (e: AgentEvent) => {
      if (e.type === 'duplicate_page') {
        duplicatePage(store, e.sourcePageId, e.pageId, e.suffix, e.custom);
        setIteration((it) => (it ? { ...it, variants: it.variants.concat({ pageId: e.pageId, dimension: e.custom?.dimension, label: '', kept: null }) } : it));
      } else if (e.type === 'variant') {
        if (e.rejected) {
          try {
            store.deletePages([e.pageId]);
          } catch {}
          patchVariant(e.pageId, { label: e.label, rejected: e.rejected, kept: false });
        } else {
          patchVariant(e.pageId, { label: e.label, score: e.score, dropped: e.dropped });
          setTimeout(() => thumbOf(e.pageId).then((thumb) => patchVariant(e.pageId, { thumb })).catch(() => {}), 300);
        }
      } else {
        handleEvent(e);
      }
    };
    try {
      await streamIterate({ page: serializePage(page), width: store.width, height: store.height, dimensions, count }, onEvent, abortRef.current.signal);
    } catch (err: any) {
      if (err?.name !== 'AbortError') handleEvent({ type: 'error', text: String(err?.message || err) });
    } finally {
      setBusy(false);
      setIteration((it) => (it ? { ...it, busy: false } : it));
      setMsgs((m) => closeStatuses(m).concat({ kind: 'iteration', count }));
      store.selectPage(page.id);
    }
  };
  const keepVariant = (pageId: string) => patchVariant(pageId, { kept: true });
  const discardVariant = (pageId: string) => {
    try {
      store.deletePages([pageId]);
    } catch {}
    patchVariant(pageId, { kept: false });
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
        <button
          className={`btn-ghost ${showIterate ? 'on' : ''}`}
          title="Winner iterations: A/B variants of the current page that change exactly one thing each"
          disabled={busy || !store.activePage?.children?.length}
          onClick={() => setShowIterate((v) => !v)}
        >
          ⑂ Iterate
        </button>
        <button className="btn-ghost" title="Download all pages as PNG (zip)" onClick={() => exportAllAsZip(store, `${brandId}-designs`)}>
          ⬇
        </button>
      </div>
      {showIterate && <IteratePicker onRun={runIteration} onClose={() => setShowIterate(false)} disabled={busy} />}
      {showGrid && iteration && (
        <IterationGrid
          original={iteration.original}
          variants={iteration.variants}
          busy={iteration.busy}
          dimensionLabel={(id) => (id && dimLabels[id]) || id || ''}
          onKeep={keepVariant}
          onDiscard={discardVariant}
          onJump={(id) => {
            store.selectPage(id);
            setShowGrid(false);
          }}
          onClose={() => setShowGrid(false)}
        />
      )}
      <div className="copilot-tabs">
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
          Chat
        </button>
        <button className={tab === 'lint' ? 'active' : ''} onClick={() => setTab('lint')}>
          Brand check {lint ? (lint.issues.length ? <span className="badge warn">{lint.issues.length}</span> : <span className="badge ok">✓</span>) : ''}
        </button>
        <button className={tab === 'scan' ? 'active' : ''} onClick={() => setTab('scan')} title="Audit any creative against this brand">
          Brand scan
        </button>
      </div>

      {tab === 'scan' ? (
        <ScanPanel
          store={store}
          brandName={brand?.name || 'the'}
          scans={project?.scans || []}
          onScanned={async (rec) => {
            if (!project) return;
            try {
              const saved = await addProjectScan(project.id, rec);
              onProjectChange?.({ scans: [saved, ...(project.scans || [])] });
            } catch (e) {
              console.warn('scan not saved', e);
            }
          }}
          onRemake={(brief, image) => {
            setTab('chat');
            setRefs([image]);
            setTimeout(() => send(brief), 60);
          }}
        />
      ) : tab === 'lint' ? (
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
                <ReportCard
                  key={i}
                  report={m.report}
                  onSelectPage={() => store.selectPage(m.report.pageId)}
                  onIterate={() => {
                    store.selectPage(m.report.pageId);
                    setShowIterate(true);
                  }}
                />
              ) : m.kind === 'iteration' ? (
                <div key={i} className="msg assistant">
                  Compared {m.count} controlled variant{m.count > 1 ? 's' : ''} against the original.{' '}
                  <button className="link" style={{ background: 'none', border: 0, color: 'var(--bloom-blue)', cursor: 'pointer', padding: 0, font: 'inherit' }} onClick={() => setShowGrid(true)}>
                    Open comparison
                  </button>
                </div>
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
