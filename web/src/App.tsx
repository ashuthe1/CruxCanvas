import { useEffect, useRef, useState } from 'react';
import { PolotnoContainer, SidePanelWrap, WorkspaceWrap } from 'polotno';
import { Toolbar } from 'polotno/toolbar/toolbar';
import { ZoomButtons } from 'polotno/toolbar/zoom-buttons';
import { SidePanel, DEFAULT_SECTIONS } from 'polotno/side-panel';
import { Workspace } from 'polotno/canvas/workspace';
import { PagesTimeline } from 'polotno/pages-timeline';
import { store } from './store';
import { BrandSection } from './sections/BrandSection';
import { TemplatesSection } from './sections/TemplatesSection';
import { CopilotPanel } from './components/CopilotPanel';
import { Dashboard } from './components/Dashboard';
import { setBrandId } from './lib/brand';
import { getProject, updateProject, getOpenProjectId, setOpenProjectId, type Project } from './lib/projects';
import { loadProjectIntoStore, startAutosave, type Saver } from './lib/persist';
import { TopBar } from './components/TopBar';
import { exportAllAsZip } from './lib/canvas';
import { getBrand } from './lib/api';

const sections = [BrandSection, TemplatesSection, ...DEFAULT_SECTIONS.filter((s: any) => ['text', 'elements', 'upload', 'background', 'layers', 'size'].includes(s.name))];

type View = { kind: 'dashboard' } | { kind: 'editor'; project: Project; tab?: 'chat' | 'lint' | 'scan' };

export default function App() {
  const [view, setView] = useState<View | null>(null);
  const [, setSavedAt] = useState<string | null>(null); // kept for autosave callbacks
  const [brandInfo, setBrandInfo] = useState<{ name: string; color: string } | null>(null);
  const saverRef = useRef<Saver | null>(null);
  const projectRef = useRef<Project | null>(null);

  // resume the last open session on load
  useEffect(() => {
    const id = getOpenProjectId();
    if (id) getProject(id).then((p) => open(p)).catch(() => setView({ kind: 'dashboard' })); // getProject retries through server restarts
    else setView({ kind: 'dashboard' });
  }, []);

  const open = (p: Project, tab?: 'chat' | 'lint' | 'scan') => {
    projectRef.current = p;
    setBrandId(p.brandId);
    setOpenProjectId(p.id);
    getBrand(p.brandId)
      .then((b) => setBrandInfo({ name: b.name, color: b.colors[0]?.hex || '#94a3b8' }))
      .catch(() => setBrandInfo(null));
    loadProjectIntoStore(store, p);
    saverRef.current?.stop();
    saverRef.current = startAutosave(store, () => projectRef.current?.id || null, (saved) => {
      setSavedAt(saved.updatedAt);
      if (projectRef.current && projectRef.current.id === saved.id) projectRef.current = { ...projectRef.current, thumb: saved.thumb, pageCount: saved.pageCount, score: saved.score };
    });
    if (p.pageScores) saverRef.current.setScores(p.pageScores);
    setSavedAt(p.updatedAt);
    setView({ kind: 'editor', project: p, tab });
  };

  const openById = async (id: string, opts?: { tab?: 'chat' | 'lint' | 'scan' }) => open(await getProject(id), opts?.tab);

  const backToDashboard = async () => {
    await saverRef.current?.flush();
    saverRef.current?.stop();
    saverRef.current = null;
    setOpenProjectId(null);
    projectRef.current = null;
    setView({ kind: 'dashboard' });
  };

  /** partial project updates coming from the copilot (messages, scans, brand, page scores) */
  const onProjectChange = async (patch: Partial<Project>) => {
    const p = projectRef.current;
    if (!p) return;
    projectRef.current = { ...p, ...patch };
    // keep the rendered project in sync so a remount restores the latest conversation/scans
    setView((v) => (v && v.kind === 'editor' && v.project.id === p.id ? { ...v, project: { ...v.project, ...patch } } : v));
    if (patch.pageScores) saverRef.current?.setScores(patch.pageScores);
    const persist: Partial<Project> = { ...patch };
    delete (persist as any).scans; // scans are appended server-side
    if (Object.keys(persist).length) {
      try {
        const saved = await updateProject(p.id, persist);
        setSavedAt(saved.updatedAt);
      } catch (e) {
        console.warn('project update failed', e);
      }
    }
  };

  const patchMeta = async (patch: Partial<Project>) => {
    const p = projectRef.current;
    if (!p) return;
    projectRef.current = { ...p, ...patch };
    setView((v) => (v && v.kind === 'editor' ? { ...v, project: { ...v.project, ...patch } } : v));
    try {
      const saved = await updateProject(p.id, patch);
      setSavedAt(saved.updatedAt);
    } catch {}
  };

  if (!view) return <div className="dash-empty">Loading workspace…</div>;
  if (view.kind === 'dashboard') return <Dashboard onOpen={openById} />;

  const p = view.project;
  return (
    <div className="app">
      <div className="editor-wrap">
        <TopBar
          project={p}
          brandName={brandInfo?.name}
          brandColor={brandInfo?.color}
          onBack={backToDashboard}
          onRename={(title) => patchMeta({ title })}
          onStar={() => patchMeta({ starred: !p.starred })}
          onStatus={(status) => patchMeta({ status })}
          onExport={() => exportAllAsZip(store, `${p.brandId}-${p.title.replace(/\W+/g, '-').toLowerCase()}`)}
          onNewPage={() => {
            const page = store.addPage();
            store.selectPage(page.id);
          }}
        />
        <div className="editor-body">
          <div className="editor">
            <PolotnoContainer style={{ width: '100%', height: '100%' }}>
              <SidePanelWrap>
                <SidePanel store={store} sections={sections as any} defaultSection="brand" />
              </SidePanelWrap>
              <WorkspaceWrap>
                <Toolbar store={store} />
                <Workspace store={store} />
                <ZoomButtons store={store} />
                <PagesTimeline store={store} />
              </WorkspaceWrap>
            </PolotnoContainer>
          </div>
          <CopilotPanel key={p.id} store={store} project={p} initialTab={view.tab} onProjectChange={onProjectChange} />
        </div>
      </div>
    </div>
  );
}
