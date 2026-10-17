import { useEffect } from 'react';
import { PolotnoContainer, SidePanelWrap, WorkspaceWrap } from 'polotno';
import { Toolbar } from 'polotno/toolbar/toolbar';
import { ZoomButtons } from 'polotno/toolbar/zoom-buttons';
import { SidePanel, DEFAULT_SECTIONS } from 'polotno/side-panel';
import { Workspace } from 'polotno/canvas/workspace';
import { PagesTimeline } from 'polotno/pages-timeline';
import { store } from './store';
import { BrandSection } from './sections/BrandSection';
import { CopilotPanel } from './components/CopilotPanel';
import { getBrandId, onBrandChange } from './lib/brand';
import { restoreCanvas, startAutosave } from './lib/persist';

const sections = [BrandSection, ...DEFAULT_SECTIONS.filter((s: any) => ['text', 'elements', 'upload', 'background', 'layers', 'size'].includes(s.name))];

export default function App() {
  useEffect(() => {
    restoreCanvas(store, getBrandId());
    const stop = startAutosave(store, getBrandId);
    const off = onBrandChange((id) => {
      if (!restoreCanvas(store, id)) {
        store.loadJSON({ width: store.width, height: store.height, pages: [] });
        store.addPage();
      }
    });
    return () => {
      stop?.();
      off();
    };
  }, []);

  return (
    <div className="app">
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
      <CopilotPanel store={store} />
    </div>
  );
}
