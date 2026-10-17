import type { ToolContext } from '../../core/interfaces.js';
import type { CompactEl, CompactPage, Op } from '../../core/types.js';
import { TextMeasurer } from '../../render/text.js';
import { brandRepository } from '../../brands/index.js';

const contains = (outer: CompactEl | undefined, inner: CompactEl) => !!outer && inner.x + inner.width / 2 >= outer.x && inner.x + inner.width / 2 <= outer.x + outer.width && inner.y + inner.height / 2 >= outer.y && inner.y + inner.height / 2 <= outer.y + outer.height;

/**
 * Re-measure text whose copy or size changed so the lint sees real heights, then re-stack: siblings
 * below it in the same container shift by the height delta and the container grows — the same
 * auto-stacking the renderer does, so a longer hook never lands on the CTA.
 */
export function remeasureText(ctx: ToolContext, page: CompactPage, ops: Op[]) {
  const tm = new TextMeasurer(ctx.brand, (rel) => brandRepository().resolve(ctx.brand.id, rel));
  const extra: Op[] = [];
  for (const op of ops) {
    if (op.op !== 'set' || (op.props.text === undefined && op.props.fontSize === undefined && op.props.width === undefined)) continue;
    const el: any = page.elements.find((e) => e.id === op.id);
    if (!el || el.type !== 'text' || !el.fontFamily) continue;
    const m = tm.measure(String(el.text || ''), el.fontFamily, el.fontSize, el.width, el.lineHeight || 1.2, el.letterSpacing || 0);
    if (!m.height || Math.abs(m.height - el.height) <= 2) continue;
    const delta = m.height - el.height;
    const oldBottom = el.y + el.height;
    el.height = m.height;
    op.props.height = m.height;
    const containerId = el.container || el.custom?.container;
    const container = containerId ? page.elements.find((e) => e.id === containerId) : undefined;
    const siblings = page.elements.filter((e) => e !== el && (containerId ? (e.container || e.custom?.container) === containerId : contains(container, e)) && e.y >= oldBottom - 4);
    for (const sib of siblings) {
      sib.y = Math.round(sib.y + delta);
      extra.push({ op: 'set', id: sib.id, props: { y: sib.y } });
    }
    if (container && delta > 0) {
      container.height = Math.round(container.height + delta);
      extra.push({ op: 'set', id: container.id, props: { height: container.height } });
    }
  }
  ops.push(...extra);
}
