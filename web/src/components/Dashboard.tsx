import { useEffect, useMemo, useState } from 'react';
import { listBrands, getBrand, type BrandSummary } from '../lib/api';
import { createProject, deleteProject, duplicateProject, listProjects, updateProject, timeAgo, STATUS_LABEL, type ProjectStatus, type ProjectSummary, getProject } from '../lib/projects';

type Filter = 'all' | 'starred' | 'in-progress' | 'review' | 'done' | 'draft';

const scoreColor = (s?: number) => (s == null ? '#9ca3af' : s >= 90 ? '#16a34a' : s >= 70 ? '#f59e0b' : '#ef4444');

/** Workspace home: resume, star, organise and audit every design session across brands. */
export function Dashboard({ onOpen }: { onOpen: (projectId: string, opts?: { tab?: 'chat' | 'lint' | 'scan' }) => void }) {
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [brandColors, setBrandColors] = useState<Record<string, string>>({});
  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [scans, setScans] = useState<{ project: ProjectSummary; scan: any }[]>([]);
  const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState<string | null>(null);

  const refresh = async () => {
    const [bs, ps] = await Promise.all([listBrands(), listProjects()]);
    setBrands(bs);
    setProjects(ps);
    setLoading(false);
    // brand accent colours for placeholders
    const colors: Record<string, string> = {};
    await Promise.all(bs.map(async (b) => {
      try {
        const full = await getBrand(b.id);
        colors[b.id] = full.colors[0]?.hex || '#334155';
      } catch {}
    }));
    setBrandColors(colors);
    // recent scans across the most recent projects with scans
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
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const tryLoad = async (n = 0) => {
      try {
        await refresh();
        setOffline(false);
      } catch (e) {
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
    const brandId = brandFilter !== 'all' ? brandFilter : brands[0]?.id;
    if (!brandId) return;
    const p = await createProject(brandId);
    onOpen(p.id);
  };
  const patch = async (id: string, data: Partial<ProjectSummary>) => {
    setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, ...data } : p)));
    await updateProject(id, data as any).catch(console.error);
  };
  const brandName = (id: string) => brands.find((b) => b.id === id)?.name || id;

  return (
    <div className="dash" onClick={() => setMenu(null)}>
      <header className="dash-hero">
        <div>
          <div className="dash-kicker">Brand Copilot workspace</div>
          <h1>Your designs, scans and sessions</h1>
          <p>Pick up where you left off, star the winners, and keep every brand check on record.</p>
        </div>
        <button className="btn-primary dash-new" onClick={newProject}>
          ✚ New design
        </button>
      </header>

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
        <div><b>{stats.projects}</b><span>sessions</span></div>
        <div><b>{stats.pages}</b><span>designs</span></div>
        <div><b style={{ color: scoreColor(stats.avg ?? undefined) }}>{stats.avg ?? '–'}</b><span>avg brand score</span></div>
        <div><b>{stats.scans}</b><span>brand scans</span></div>
        <div><b>{stats.starred}</b><span>starred</span></div>
      </div>

      <div className="dash-toolbar">
        <div className="dash-filters">
          {(['all', 'starred', 'in-progress', 'review', 'done', 'draft'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'starred' ? '★ Starred' : STATUS_LABEL[f as ProjectStatus]}
            </button>
          ))}
        </div>
        <input className="dash-search" placeholder="Search sessions…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

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
          {visible.map((p) => (
            <article key={p.id} className="pcard" onClick={() => onOpen(p.id)}>
              <div className="pcard-thumb" style={{ background: p.thumb ? undefined : `linear-gradient(135deg, ${brandColors[p.brandId] || '#334155'}, #0b1220)` }}>
                {p.thumb ? <img src={p.thumb} alt="" /> : <span>{brandName(p.brandId)}</span>}
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
                          if (confirm(`Delete "${p.title}"?`)) {
                            await deleteProject(p.id);
                            setProjects((ps) => ps.filter((x) => x.id !== p.id));
                          }
                          setMenu(null);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                <div className="pcard-meta">
                  <span className="chip brand">{brandName(p.brandId)}</span>
                  <span>{p.pageCount} page{p.pageCount === 1 ? '' : 's'}</span>
                  {p.scanCount > 0 && <span>{p.scanCount} scan{p.scanCount === 1 ? '' : 's'}</span>}
                  <span>· {timeAgo(p.updatedAt)}</span>
                </div>
                {p.lastMessage && <p className="pcard-last">{p.lastMessage}</p>}
                <select
                  className={`status ${p.status}`}
                  value={p.status}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => patch(p.id, { status: e.target.value as ProjectStatus })}
                >
                  {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
            </article>
          ))}
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
  );
}
