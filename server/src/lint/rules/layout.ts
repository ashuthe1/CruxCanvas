import type { LintRule } from '../../core/interfaces.js';
import { contains, contentsOf, label, moveWith, overlaps, role } from '../helpers.js';

function protectedElements(page: any) {
  const cards = page.elements.filter((e: any) => role(e) === 'card');
  const inCard = (e: any) => cards.find((c: any) => contains(c, e));
  return page.elements.filter((el: any) => {
    const r = role(el);
    return (el.type === 'text' || r === 'logo' || r === 'cta-bg' || r === 'card') && !(r !== 'card' && inCard(el));
  });
}

export const edgesRule: LintRule = {
  id: 'edges',
  title: 'Edge margins',
  run({ page, brand, W, H, S }) {
    const out = [];
    const m = S * brand.layout.marginRatio;
    for (const el of protectedElements(page)) {
      const props: Record<string, number> = {};
      if (el.x < m * 0.6) props.x = Math.round(m);
      if (el.y < m * 0.6) props.y = Math.round(m);
      if (el.x + el.width > W - m * 0.6) props.x = Math.round(W - m - el.width);
      if (el.y + el.height > H - m * 0.6) props.y = Math.round(H - m - el.height);
      if (Object.keys(props).length) out.push({ rule: 'Too close to edge', severity: 'warn' as const, elementId: el.id, message: `${label(el)} is closer than ${Math.round(brand.layout.marginRatio * 100)}% to the canvas edge.`, fix: moveWith(page, el, props) });
    }
    return out;
  },
};

export const safeZoneRule: LintRule = {
  id: 'safe-zone',
  title: 'Platform safe zones',
  run({ page, brand, W, H }) {
    const aspect = W / H;
    const key = Math.abs(aspect - 9 / 16) < 0.03 ? '9:16' : Math.abs(aspect - 4 / 5) < 0.03 ? '4:5' : 'default';
    const zone = brand.safeZones[key];
    if (!zone || key === 'default') return [];
    const out = [];
    const top = H * zone.top, bottom = H * (1 - zone.bottom), left = W * zone.left, right = W * (1 - zone.right);
    for (const el of protectedElements(page)) {
      const props: Record<string, number> = {};
      if (el.y < top) props.y = Math.round(top);
      if (el.y + el.height > bottom) props.y = Math.round(bottom - el.height);
      if (el.x < left) props.x = Math.round(left);
      if (el.x + el.width > right) props.x = Math.round(right - el.width);
      if (Object.keys(props).length) out.push({ rule: `Safe zone (${key})`, severity: 'warn' as const, elementId: el.id, message: `${label(el)} is inside the platform UI zone (${key}: top ${zone.top * 100}%, bottom ${zone.bottom * 100}%).`, fix: moveWith(page, el, props) });
    }
    return out;
  },
};

export const cardContentsRule: LintRule = {
  id: 'card-contents',
  title: 'Text stays inside its card',
  run({ page, brand, W }) {
    const out = [];
    for (const card of page.elements.filter((e) => role(e) === 'card')) {
      const kids = page.elements.filter((e) => (e.container || e.custom?.container) === card.id);
      const strays = kids.filter((k) => k.y < card.y - 2 || k.y + k.height > card.y + card.height + 2 || k.x < card.x - 2 || k.x + k.width > card.x + card.width + 2);
      if (!strays.length) continue;
      const pad = Math.round(W * brand.layout.card.paddingRatio);
      const minY = Math.min(...kids.map((k) => k.y)), minX = Math.min(...kids.map((k) => k.x));
      const dy = card.y + pad - minY, dx = card.x + pad - minX;
      const maxBottom = Math.max(...kids.map((k) => k.y + dy + k.height)) + pad;
      const fix: any[] = kids.map((k) => ({ op: 'set', id: k.id, props: { x: Math.round(k.x + dx), y: Math.round(k.y + dy) } }));
      if (maxBottom > card.y + card.height) fix.push({ op: 'set', id: card.id, props: { height: Math.round(maxBottom - card.y) } });
      out.push({ rule: 'Text outside card', severity: 'error' as const, elementId: strays[0].id, message: `${strays.length} element(s) sit outside their content card.`, fix });
    }
    return out;
  },
};

export const imageOverTextRule: LintRule = {
  id: 'image-over-text',
  title: 'Imagery never covers text',
  run({ page, S }) {
    const out = [];
    const els = page.elements;
    for (let i = 0; i < els.length; i++) {
      const img = els[i];
      if (!(img.type === 'image' || img.type === 'svg')) continue;
      const r = role(img);
      if (!['photo', 'illustration', 'product-ui', 'image', 'charm'].includes(r)) continue;
      const covered = els.slice(0, i).filter((t) => t.type === 'text' && overlaps(img, t, -4));
      if (!covered.length) continue;
      const lowest = Math.max(...covered.map((t) => t.y + t.height));
      out.push({ rule: 'Image covers text', severity: 'error' as const, elementId: img.id, message: `"${img.name || r}" overlaps ${covered.map(label).join(', ')}.`, fix: [{ op: 'set' as const, id: img.id, props: { y: Math.round(lowest + S * 0.02) } }] });
    }
    return out;
  },
};

export const onCanvasRule: LintRule = {
  id: 'on-canvas',
  title: 'Key elements fully on canvas',
  run({ page, W, H }) {
    const out = [];
    for (const el of page.elements) {
      const r = role(el);
      if (!(el.type === 'text' || r === 'logo' || r === 'cta-bg' || r === 'card')) continue;
      const props: Record<string, number> = {};
      if (el.x < 0) props.x = 0;
      if (el.y < 0) props.y = 0;
      if (el.x + el.width > W) props.x = Math.max(0, Math.round(W - el.width));
      if (el.y + el.height > H) props.y = Math.max(0, Math.round(H - el.height));
      if (Object.keys(props).length) out.push({ rule: 'Cut off by canvas edge', severity: 'error' as const, elementId: el.id, message: `${label(el)} extends beyond the canvas.`, fix: moveWith(page, el, props) });
    }
    return out;
  },
};

export { contentsOf };
