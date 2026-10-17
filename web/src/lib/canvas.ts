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
  const hadSelection = store.selectedElements.length > 0;
  const done = () => {
    if (!hadSelection) store.selectElements([]);
  };
  for (const op of ops) {
    try {
      if (op.op === 'set') {
        const el = store.getElementById(op.id);
        if (el) el.set(op.props.custom && typeof op.props.custom === 'object' ? { ...op.props, custom: { ...(el.custom || {}), ...op.props.custom } } : op.props);
      } else if (op.op === 'delete') {
        store.deleteElements([op.id]);
      } else if (op.op === 'raise') {
        store.getElementById(op.id)?.moveTop();
      } else if (op.op === 'add') {
        page.addElement(op.element);
      } else if (op.op === 'background') {
        page.set({ background: op.value });
      }
    } catch (e) {
      console.warn('op failed', op, e);
    }
  }
  done();
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

/**
 * Duplicate a page in place (right after the source) with every element id suffixed, so server ops
 * addressed to `${id}_${suffix}` land on the copy. Labels go on page.custom (variantOf, dimension).
 */
export function duplicatePage(store: StoreType, sourcePageId: string, pageId: string, suffix: string, custom: Record<string, any> = {}) {
  const source = store.pages.find((p: any) => p.id === sourcePageId);
  if (!source) return null;
  const map = (id?: string) => (id ? `${id}_${suffix}` : id);
  const json = source.toJSON();
  const children = (json.children || []).map((el: any) => ({
    ...el,
    id: map(el.id),
    custom: el.custom ? { ...el.custom, ...(el.custom.container ? { container: map(el.custom.container) } : {}), ...(el.custom.group ? { group: map(el.custom.group) } : {}) } : el.custom,
  }));
  const page = store.addPage({ id: pageId, background: json.background || 'white', custom: { ...(json.custom || {}), ...custom } });
  for (const el of children) page.addElement(el);
  // keep variants next to their source
  const idx = store.pages.findIndex((p: any) => p.id === sourcePageId);
  const variantsAfter = store.pages.slice(idx + 1).filter((p: any) => p.custom?.variantOf === sourcePageId).length;
  try {
    page.setZIndex?.(Math.min(idx + variantsAfter, store.pages.length - 1));
  } catch {}
  return page;
}

/** Variant pages produced by winner iterations for a source page (newest batch first) */
export function variantsOf(store: StoreType, sourcePageId: string) {
  return store.pages.filter((p: any) => p.custom?.variantOf === sourcePageId);
}

export async function pageToDataURL(store: StoreType, pageId: string, pixelRatio = 0.5) {
  return store.toDataURL({ pageId, pixelRatio, mimeType: 'image/jpeg', quality: 0.8 } as any);
}

/** Export every non-empty page as PNG inside a zip */
export async function exportAllAsZip(store: StoreType, name = 'designs') {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  let i = 0;
  for (const page of store.pages) {
    if (!page.children.length) continue;
    const url = await store.toDataURL({ pageId: page.id, pixelRatio: 2, mimeType: 'image/png' } as any);
    zip.file(`${name}-${String(++i).padStart(2, '0')}.png`, url.split(',')[1], { base64: true });
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return i;
}
