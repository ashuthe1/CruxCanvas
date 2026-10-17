import { useEffect, useMemo, useState } from 'react';
import { listBrands, getBrand, formatUsage, type BrandSummary } from '../lib/api';
import { getBrandId, setBrandId } from '../lib/brand';
import { createProject, deleteProject, duplicateProject, listProjects, updateProject, timeAgo, STATUS_LABEL, type ProjectStatus, type ProjectSummary, getProject } from '../lib/projects';
import { Workspace } from 'polotno/canvas/workspace';
import { getOffscreenStore, upgradeStaleThumbs } from '../lib/thumbs';

type Filter = 'all' | 'starred' | 'in-progress' | 'review' | 'done' | 'draft';

const scoreColor = (s?: number) => (s == null ? '#9ca3af' : s >= 90 ? '#16a34a' : s >= 70 ? '#f59e0b' : '#ef4444');

/** Workspace home: resume, star, organise, bulk-manage and audit every design session across brands. */
export function Dashboard({ onOpen }: { onOpen: (projectId: string, opts?: { tab?: 'chat' | 'lint' | 'scan' }) => void }) {
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [brandColors, setBrandColors] = useState<Record<string, string>>({});
  const [brandFilter, setBrandFilterState] = useState<string>(() => getBrandId());
  const setBrandFilter = (id: string) => {
    setBrandFilterState(id);
    if (id !== 'all') setBrandId(id);
  };
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [scans, setScans] = useState<{ project: ProjectSummary; scan: any }[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyBulk, setBusyBulk] = useState(false);

  const refresh = async () => {
    const [bs, ps] = await Promise.all([listBrands(), listProjects()]);
    setBrands(bs);
    setProjects(ps);
    setLoading(false);
    void upgradeStaleThumbs(ps, (id, thumb) => setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, thumb } : p))));
    const colors: Record<string, string> = {};
    await Promise.all(bs.map(async (b) => {
      try {
        const full = await getBrand(b.id);
        colors[b.id] = full.colors[0]?.hex || '#334155';
      } catch {}
    }));
    setBrandColors(colors);
    const withScans = ps.filter((p) => p.scanCount > 0).slice(0, 6);
    const recs: { project: ProjectSummary; scan: any }[] = [];
    await Promise.all(withScans.map(async (p) => {
      try {
        const full = await getProject(p.id);
        for (const s of full.scans.slice(0, 3)) recs.push({ project: p, scan: s });
      } catch {}
    }));
    setScans(recs.sort((a, b) => b.scan.createdAt.localeCompare(a.scan.createdAt)).slice(0, 8));
  };
  useEffect(() => {
    let cancelled = false;
    const tryLoad = async (n = 0) => {
      try {
        await refresh();
        setOffline(false);
      } catch {
        if (cancelled) return;
        setOffline(true);
        if (n < 20) setTimeout(() => tryLoad(n + 1), 1500);
      }
    };
    tryLoad();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(
    () =>
      projects
        .filter((p) => brandFilter === 'all' || p.brandId === brandFilter)
        .filter((p) => (filter === 'all' ? true : filter === 'starred' ? p.starred : p.status === filter))
        .filter((p) => !q || (p.title + ' ' + (p.lastMessage || '') + ' ' + p.tags.join(' ')).toLowerCase().includes(q.toLowerCase())),
    [projects, brandFilter, filter, q],
  );

  const stats = useMemo(() => {
    const pool = projects.filter((p) => brandFilter === 'all' || p.brandId === brandFilter);
    const scored = pool.filter((p) => p.score != null);
    return {
      projects: pool.length,
      pages: pool.reduce((s, p) => s + p.pageCount, 0),
      avg: scored.length ? Math.round(scored.reduce((s, p) => s + (p.score || 0), 0) / scored.length) : null,
      scans: pool.reduce((s, p) => s + p.scanCount, 0),
      starred: pool.filter((p) => p.starred).length,
    };
  }, [projects, brandFilter]);

  const newProject = async () => {
    const brandId = brandFilter !== 'all' ? brandFilter : getBrandId() || brands[0]?.id;
    if (!brandId) return;
    const p = await createProject(brandId);
    onOpen(p.id);
  };
  const patch = async (id: string, data: Partial<ProjectSummary>) => {
    setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, ...data } : p)));
    await updateProject(id, data as any).catch(console.error);
  };
  const brandName = (id: string) => brands.find((b) => b.id === id)?.name || id;

  // ---- selection / bulk ----
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const selectAllVisible = () => setSelected(new Set(visible.map((p) => p.id)));
  const clearSelection = () => setSelected(new Set());
  const bulk = async (fn: (id: string) => Promise<any>, ids = [...selected]) => {
    setBusyBulk(true);
    try {
      for (const id of ids) await fn(id);
    } finally {
      setBusyBulk(false);
    }
  };
  const deleteIds = async (ids: string[]) => {
    await bulk(async (id) => deleteProject(id), ids);
    setProjects((ps) => ps.filter((p) => !ids.includes(p.id)));
    clearSelection();
  };
  const deleteSelected = () => {
    if (!selected.size) return;
    if (confirm(`Delete ${selected.size} session${selected.size > 1 ? 's' : ''}? This cannot be undone.`)) deleteIds([...selected]);
  };
  const deleteAllVisible = () => {
    if (!visible.length) return;
    const scope = brandFilter === 'all' && filter === 'all' && !q ? 'ALL sessions in the workspace' : `all ${visible.length} sessions in the current view`;
    if (prompt(`Type DELETE to remove ${scope} (${visible.length}). This cannot be undone.`) === 'DELETE') deleteIds(visible.map((p) => p.id));
  };
  const starSelected = async (starred: boolean) => {
    await bulk(async (id) => patch(id, { starred }));
    clearSelection();
  };
  const statusSelected = async (status: ProjectStatus) => {
    await bulk(async (id) => patch(id, { status }));
    clearSelection();
  };

  const selectMode = selected.size > 0;

  return (
    <div className="dash" onClick={() => setMenu(null)}>
      <div className="thumb-renderer" aria-hidden>
        <Workspace store={getOffscreenStore()} components={{ PageControls: () => null }} />
      </div>
      <header className="dash-hero">
        <div className="dash-hero-text">
          <div className="dash-kicker">Brand Copilot · workspace</div>
          <h1>Your designs, scans and sessions</h1>
          <p>Pick up where you left off, star the winners, and keep every brand check on record.</p>
        </div>
        <div className="dash-hero-actions">
          <button className="btn-primary dash-new" onClick={newProject}>
            ✚ New design
          </button>
        </div>
        <div className="dash-hero-art" aria-hidden>
          <span className="blob b1" />
          <span className="blob b2" />
          <span className="blob b3" />
        </div>
      </header>

      <div className="dash-body">
        <div className="dash-brands">
          <button className={brandFilter === 'all' ? 'on' : ''} onClick={() => setBrandFilter('all')}>
            All brands
          </button>
          {brands.map((b) => (
            <button key={b.id} className={brandFilter === b.id ? 'on' : ''} onClick={() => setBrandFilter(b.id)}>
              <span className="dot" style={{ background: brandColors[b.id] || '#94a3b8' }} /> {b.name}
            </button>
          ))}
        </div>

        <div className="dash-stats">
          {[
            { v: stats.projects, l: 'sessions', i: '▣' },
            { v: stats.pages, l: 'designs', i: '◫' },
            { v: stats.avg ?? '–', l: 'avg brand score', i: '◎', c: scoreColor(stats.avg ?? undefined) },
            { v: stats.scans, l: 'brand scans', i: '⌕' },
            { v: stats.starred, l: 'starred', i: '★' },
          ].map((s) => (
            <div key={s.l} className="stat">
              <span className="stat-icon">{s.i}</span>
              <b style={s.c ? { color: s.c } : undefined}>{s.v}</b>
              <span>{s.l}</span>
            </div>
          ))}
        </div>

        <div className="dash-toolbar">
          <div className="dash-filters">
            {(['all', 'starred', 'in-progress', 'review', 'done', 'draft'] as Filter[]).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f === 'starred' ? '★ Starred' : STATUS_LABEL[f as ProjectStatus]}
              </button>
            ))}
          </div>
          <div className="dash-tools">
            <input className="dash-search" placeholder="Search sessions…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn-ghost" onClick={selectAllVisible} disabled={!visible.length} title="Select every session in this view">
              Select all
            </button>
            <button className="btn-ghost danger" onClick={deleteAllVisible} disabled={!visible.length} title="Delete every session in this view">
              Delete all
            </button>
          </div>
        </div>

        {selectMode && (
          <div className="bulk-bar">
            <b>{selected.size} selected</b>
            <button className="btn-ghost" onClick={() => starSelected(true)} disabled={busyBulk}>
              ★ Star
            </button>
            <button className="btn-ghost" onClick={() => starSelected(false)} disabled={busyBulk}>
              ☆ Unstar
            </button>
            <select className="btn-ghost" defaultValue="" onChange={(e) => e.target.value && statusSelected(e.target.value as ProjectStatus)} disabled={busyBulk}>
              <option value="" disabled>
                Set status…
              </option>
              {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <button className="btn-ghost" onClick={() => bulk(async (id) => duplicateProject(id)).then(refresh)} disabled={busyBulk}>
              ⧉ Duplicate
            </button>
            <button className="btn-danger" onClick={deleteSelected} disabled={busyBulk}>
              🗑 Delete selected
            </button>
            <span className="spacer" />
            <button className="btn-ghost" onClick={clearSelection}>
              Clear
            </button>
          </div>
        )}

        {loading ? (
          <div className="dash-empty">{offline ? 'Reconnecting to the copilot server…' : 'Loading…'}</div>
        ) : visible.length === 0 ? (
          <div className="dash-empty">
            <div className="big">◇</div>
            <b>Nothing here yet</b>
            <span>Start a new design and the copilot will keep the canvas, the chat and every brand check for you.</span>
            <button className="btn-primary" onClick={newProject}>
              ✚ New design
            </button>
          </div>
        ) : (
          <div className="dash-grid">
            {visible.map((p) => {
              const isSel = selected.has(p.id);
              return (
                <article key={p.id} className={`pcard ${isSel ? 'selected' : ''} ${selectMode ? 'select-mode' : ''}`} onClick={() => (selectMode ? toggle(p.id) : onOpen(p.id))}>
                  <div className="pcard-thumb" style={{ background: p.thumb ? undefined : `linear-gradient(135deg, ${brandColors[p.brandId] || '#334155'}, #0b1220)` }}>
                    {p.thumb ? <img src={p.thumb} alt="" /> : <span>{brandName(p.brandId)}</span>}
                    <label className={`pcard-check ${isSel ? 'on' : ''}`} onClick={(e) => e.stopPropagation()} title="Select">
                      <input type="checkbox" checked={isSel} onChange={() => toggle(p.id)} />
                      <span />
                    </label>
                    {p.score != null && (
                      <span className="pcard-score" style={{ background: scoreColor(p.score) }}>
                        {p.score}
                      </span>
                    )}
                    <button
                      className={`pcard-star ${p.starred ? 'on' : ''}`}
                      title={p.starred ? 'Unstar' : 'Star'}
                      onClick={(e) => {
                        e.stopPropagation();
                        patch(p.id, { starred: !p.starred });
                      }}
                    >
                      {p.starred ? '★' : '☆'}
                    </button>
                    <div className="pcard-hover">
                      <span>{selectMode ? (isSel ? 'Deselect' : 'Select') : 'Open'}</span>
                    </div>
                  </div>
                  <div className="pcard-body">
                    <div className="pcard-title">
                      <b>{p.title}</b>
                      <button
                        className="pcard-menu"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenu(menu === p.id ? null : p.id);
                        }}
                      >
                        ⋯
                      </button>
                      {menu === p.id && (
                        <div className="pcard-dropdown" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => onOpen(p.id)}>Open</button>
                          <button onClick={() => onOpen(p.id, { tab: 'scan' })}>Open brand scan</button>
                          <button
                            onClick={async () => {
                              const t = prompt('Rename session', p.title);
                              if (t) patch(p.id, { title: t });
                              setMenu(null);
                            }}
                          >
                            Rename
                          </button>
                          <button
                            onClick={async () => {
                              await duplicateProject(p.id);
                              setMenu(null);
                              refresh();
                            }}
                          >
                            Duplicate
                          </button>
                          <button
                            className="danger"
                            onClick={async () => {
                              if (confirm(`Delete "${p.title}"?`)) deleteIds([p.id]);
                              setMenu(null);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="pcard-meta">
                      <span className="chip brand">
                        <i style={{ background: brandColors[p.brandId] || '#94a3b8' }} /> {brandName(p.brandId)}
                      </span>
                      <span>
                        {p.pageCount} page{p.pageCount === 1 ? '' : 's'}
                      </span>
                      {p.usage?.calls ? <span className="muted usage" title="Estimated model cost for this session">{formatUsage(p.usage).split(' · ')[0]}</span> : null}
                      {p.scanCount > 0 && (
                        <span>
                          {p.scanCount} scan{p.scanCount === 1 ? '' : 's'}
                        </span>
                      )}
                      <span className="muted">· {timeAgo(p.updatedAt)}</span>
                    </div>
                    {p.lastMessage && <p className="pcard-last">{p.lastMessage}</p>}
                    <select className={`status ${p.status}`} value={p.status} onClick={(e) => e.stopPropagation()} onChange={(e) => patch(p.id, { status: e.target.value as ProjectStatus })}>
                      {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {scans.length > 0 && (
          <section className="dash-scans">
            <h3>Recent brand scans</h3>
            <div className="scan-list">
              {scans.map(({ project, scan }) => (
                <button key={scan.id} className="scan-row" onClick={() => onOpen(project.id, { tab: 'scan' })}>
                  <img src={scan.thumb} alt="" />
                  <span className="ring" style={{ background: scoreColor(scan.report.score) }}>
                    {scan.report.score}
                  </span>
                  <div>
                    <b>{scan.report.extracted?.headline || scan.report.summary?.slice(0, 60) || 'Creative'}</b>
                    <small>
                      {scan.report.verdict.replace('-', ' ')} · {brandName(project.brandId)} · {project.title} · {timeAgo(scan.createdAt)}
                    </small>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
