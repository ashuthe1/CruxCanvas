import type { StoreType } from '../store';
import type { ElementOp } from './api';

/** Compact, LLM-friendly serialization of a page. */
export function serializePage(page: any) {
  return {
    id: page.id,
    background: page.background,
    elements: page.children.map((el: any) => {
      const base: any = {
        id: el.id,
        type: el.type,
        name: el.name || undefined,
        x: Math.round(el.x),
        y: Math.round(el.y),
        width: Math.round(el.width),
        height: Math.round(el.height),
        rotation: el.rotation || undefined,
        opacity: el.opacity !== 1 ? el.opacity : undefined,
      };
      if (el.type === 'text') {
        Object.assign(base, {
          text: el.text,
          fontSize: el.fontSize,
          fontFamily: el.fontFamily,
          fontWeight: el.fontWeight,
          fill: el.fill,
          align: el.align,
          lineHeight: el.lineHeight,
        });
      } else if (el.type === 'image' || el.type === 'svg') {
        Object.assign(base, { src: el.src, assetId: el.custom?.assetId, role: el.custom?.role });
      } else if (el.type === 'figure') {
        Object.assign(base, { subType: el.subType, fill: el.fill, cornerRadius: el.cornerRadius, stroke: el.stroke, strokeWidth: el.strokeWidth });
      }
      if (el.custom?.role && !base.role) base.role = el.custom.role;
      if (el.custom?.container) base.container = el.custom.container;
      if (el.custom?.variant) base.custom = { variant: el.custom.variant, assetId: el.custom.assetId };
      return base;
    }),
  };
}

export function serializeCanvas(store: StoreType) {
  return {
    width: store.width,
    height: store.height,
    pages: store.pages.map(serializePage),
    activePageId: store.activePage?.id ?? '',
    selectedIds: store.selectedElements.map((e: any) => e.id),
  };
}

export function applyOps(store: StoreType, pageId: string, ops: ElementOp[]) {
  const page = store.pages.find((p: any) => p.id === pageId) || store.activePage;
  if (!page) return;
  for (const op of ops) {
    try {
      if (op.op === 'set') {
        const el = store.getElementById(op.id);
        if (el) el.set(op.props);
      } else if (op.op === 'delete') {
        store.deleteElements([op.id]);
      } else if (op.op === 'add') {
        page.addElement(op.element);
      } else if (op.op === 'background') {
        page.set({ background: op.value });
      }
    } catch (e) {
      console.warn('op failed', op, e);
    }
  }
}

/** Add a full page JSON (Polotno format) to the store, optionally replacing an existing page. */
export function addPageFromJSON(store: StoreType, pageJSON: any, replacePageId?: string) {
  if (replacePageId) {
    const existing = store.pages.find((p: any) => p.id === replacePageId);
    if (existing) {
      // clear children, set bg, add new
      existing.set({ background: pageJSON.background || 'white' });
      const ids = existing.children.map((c: any) => c.id);
      if (ids.length) store.deleteElements(ids);
      for (const el of pageJSON.children || []) existing.addElement(el);
      store.selectPage(existing.id);
      store.selectElements([]);
      return existing;
    }
  }
  const page = store.addPage({ id: pageJSON.id, background: pageJSON.background || 'white' });
  for (const el of pageJSON.children || []) page.addElement(el);
  store.selectPage(page.id);
  store.selectElements([]);
  return page;
}

export async function pageToDataURL(store: StoreType, pageId: string, pixelRatio = 0.5) {
  return store.toDataURL({ pageId, pixelRatio, mimeType: 'image/jpeg', quality: 0.8 } as any);
}
