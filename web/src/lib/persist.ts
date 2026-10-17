/**
 * Server-backed autosave: the open project's canvas, per-page scores and a thumbnail are
 * written (debounced) to /api/projects/:id. Replaces the earlier localStorage autosave.
 */
import type { StoreType } from '../store';
import { updateProject, type Project } from './projects';
import { pageToDataURL } from './canvas';

export function loadProjectIntoStore(store: StoreType, project: Project) {
  const c = project.canvas;
  if (c && c.pages?.length) {
    store.loadJSON(c);
    if (c.width && c.height) store.setSize(c.width, c.height);
  } else {
    store.loadJSON({ width: 1080, height: 1080, pages: [] });
    store.setSize(1080, 1080);
    store.addPage();
  }
  store.history.clear();
}

/** Start over inside the open project: clear all pages, keep the canvas size (autosave persists it). */
export function clearCanvas(store: StoreType, _projectId?: string) {
  const w = store.width, h = store.height;
  store.loadJSON({ width: w, height: h, pages: [] });
  store.setSize(w, h);
  store.addPage();
}

export type Saver = { flush: () => Promise<void>; stop: () => void; setScores: (scores: Record<string, number>) => void; markDirty: () => void };

export function startAutosave(store: StoreType, projectId: () => string | null, onSaved?: (p: Project) => void): Saver {
  let t: any;
  let scores: Record<string, number> = {};
  let dirty = false;
  const save = async () => {
    const id = projectId();
    if (!id || !dirty) return;
    dirty = false;
    try {
      let thumb: string | undefined;
      const first = store.pages.find((p: any) => p.children.length);
      if (first) {
        try {
          await store.waitLoading?.();
          thumb = await pageToDataURL(store, first.id, 0.18);
        } catch {}
      }
      const p = await updateProject(id, { canvas: store.toJSON(), pageScores: scores, ...(thumb ? { thumb } : {}) });
      onSaved?.(p);
    } catch (e) {
      console.warn('autosave failed', e);
      dirty = true;
    }
  };
  const schedule = () => {
    dirty = true;
    clearTimeout(t);
    t = setTimeout(save, 1200);
  };
  const off = store.on('change', schedule);
  return {
    flush: async () => {
      clearTimeout(t);
      await save();
    },
    stop: () => {
      clearTimeout(t);
      off?.();
    },
    setScores: (s) => {
      scores = { ...scores, ...s };
      schedule();
    },
    markDirty: schedule,
  };
}
