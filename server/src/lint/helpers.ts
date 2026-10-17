import type { CompactEl, CompactPage, Op } from '../core/types.js';

export const IMAGE_ROLES = new Set(['photo', 'illustration', 'charm', 'product-ui', 'image', 'decor', 'background', 'bloom']);

export function role(el: CompactEl) {
  return el.role || el.custom?.role || (el.type === 'text' ? el.name || 'text' : el.name) || '';
}
export function overlaps(a: CompactEl, b: CompactEl, pad = 0) {
  return !(a.x + a.width + pad <= b.x || b.x + b.width <= a.x - pad || a.y + a.height + pad <= b.y || b.y + b.height <= a.y - pad);
}
export function contains(outer: CompactEl, inner: CompactEl) {
  const cx = inner.x + inner.width / 2, cy = inner.y + inner.height / 2;
  return cx >= outer.x && cx <= outer.x + outer.width && cy >= outer.y && cy <= outer.y + outer.height;
}
export function label(el: CompactEl) {
  return el.text ? `"${el.text.slice(0, 30)}"` : `"${el.name || role(el)}"`;
}

/** Background colour behind an element: nearest filled figure under it (by z-order), else page bg. null = over imagery */
export function backgroundBehind(page: CompactPage, el: CompactEl): string | null {
  const idx = page.elements.indexOf(el);
  for (let i = idx - 1; i >= 0; i--) {
    const b = page.elements[i];
    if (b.type === 'figure' && b.fill && contains(b, el)) return b.fill;
    if ((b.type === 'image' || b.type === 'svg') && contains(b, el)) return null;
  }
  return page.background && page.background.startsWith('#') ? page.background : null;
}

/** Elements belonging to a container rect: tagged children first, then visual containment */
export function contentsOf(page: CompactPage, container: CompactEl) {
  return page.elements.filter(
    (e) =>
      e !== container &&
      ((e.container || e.custom?.container) === container.id ||
        (!['card', 'background', 'bloom', 'photo', 'illustration', 'product-ui'].includes(role(e)) && contains(container, e))),
  );
}

/** Expand ops that move a container into ops that move its contents by the same delta */
export function expandContainerMoves(page: CompactPage, ops: Op[]): Op[] {
  const out: Op[] = [];
  for (const op of ops) {
    out.push(op);
    if (op.op !== 'set') continue;
    const el = page.elements.find((e) => e.id === op.id);
    if (!el || !['card', 'logo-pill', 'cta-bg'].includes(role(el))) continue;
    const dx = op.props.x !== undefined ? op.props.x - el.x : 0;
    const dy = op.props.y !== undefined ? op.props.y - el.y : 0;
    if (!dx && !dy) continue;
    for (const child of contentsOf(page, el)) {
      if (ops.some((o) => o.op === 'set' && o.id === child.id && (o.props.x !== undefined || o.props.y !== undefined))) continue;
      out.push({ op: 'set', id: child.id, props: { x: Math.round(child.x + dx), y: Math.round(child.y + dy) } });
    }
  }
  return out;
}

/** A position fix that moves a card together with its contents */
export function moveWith(page: CompactPage, el: CompactEl, props: Record<string, number>): Op[] {
  const dx = props.x !== undefined ? props.x - el.x : 0, dy = props.y !== undefined ? props.y - el.y : 0;
  const ops: Op[] = [{ op: 'set', id: el.id, props }];
  if (role(el) === 'card') for (const c of contentsOf(page, el)) ops.push({ op: 'set', id: c.id, props: { x: Math.round(c.x + dx), y: Math.round(c.y + dy) } });
  return ops;
}

/** Apply ops to a compact page (server-side mirror of the canvas) */
export function applyOpsCompact(page: CompactPage, ops: Op[]) {
  for (const op of ops) {
    if (op.op === 'set') {
      const el = page.elements.find((e) => e.id === op.id);
      if (el) Object.assign(el, op.props, op.props.custom ? { role: op.props.custom.role || el.role, assetId: op.props.custom.assetId || el.assetId } : {});
    } else if (op.op === 'delete') {
      page.elements = page.elements.filter((e) => e.id !== op.id);
    } else if (op.op === 'add') {
      page.elements.push(compactFromElement(op.element));
    } else if (op.op === 'raise') {
      const el = page.elements.find((e) => e.id === op.id);
      if (el) page.elements = page.elements.filter((e) => e !== el).concat(el);
    } else if (op.op === 'background') {
      page.background = op.value;
    }
  }
}

export function compactFromElement(el: any): CompactEl {
  return {
    id: el.id, type: el.type, name: el.name, role: el.custom?.role, container: el.custom?.container, custom: el.custom,
    x: el.x, y: el.y, width: el.width, height: el.height, rotation: el.rotation, opacity: el.opacity,
    text: el.text, fontSize: el.fontSize, fontFamily: el.fontFamily, fill: el.fill, align: el.align,
    src: el.src, assetId: el.custom?.assetId, subType: el.subType, cornerRadius: el.cornerRadius,
  };
}

export function compactFromPage(page: any): CompactPage {
  return { id: page.id, background: page.background, elements: (page.children || []).map(compactFromElement) };
}
