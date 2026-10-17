/**
 * Deterministic brand linter. Works on the compact page serialization the client sends
 * (and on server-rendered pages). Produces issues with optional auto-fix ops.
 */
import { brand, PALETTE, FONT_FAMILIES, getAsset } from './brand.js';
import { contrast, nearestPalette, parseHex } from './color.js';

export type Op =
  | { op: 'set'; id: string; props: Record<string, any> }
  | { op: 'delete'; id: string }
  | { op: 'add'; element: any }
  | { op: 'background'; value: string };

export type Issue = {
  id: string;
  rule: string;
  severity: 'error' | 'warn' | 'info';
  message: string;
  elementId?: string;
  fix?: Op[];
};

export type CompactEl = {
  id: string; type: string; name?: string; role?: string; container?: string;
  x: number; y: number; width: number; height: number; rotation?: number; opacity?: number;
  text?: string; fontSize?: number; fontFamily?: string; fill?: string; align?: string;
  src?: string; assetId?: string; subType?: string; cornerRadius?: number;
  custom?: any;
};
export type CompactPage = { id: string; background: string; elements: CompactEl[] };

const WEIGHTS = { error: 15, warn: 7, info: 3 };
const PALETTE_TOLERANCE = 40; // weighted-rgb distance
const EXEMPT_ROLES = new Set(['photo', 'illustration', 'charm', 'product-ui', 'image', 'decor', 'background', 'bloom']);

function role(el: CompactEl) {
  return el.role || el.custom?.role || (el.type === 'text' ? (el.name || 'text') : el.name) || '';
}
function overlaps(a: CompactEl, b: CompactEl, pad = 0) {
  return !(a.x + a.width + pad <= b.x || b.x + b.width <= a.x - pad || a.y + a.height + pad <= b.y || b.y + b.height <= a.y - pad);
}
function contains(outer: CompactEl, inner: CompactEl) {
  const cx = inner.x + inner.width / 2, cy = inner.y + inner.height / 2;
  return cx >= outer.x && cx <= outer.x + outer.width && cy >= outer.y && cy <= outer.y + outer.height;
}

/** Background colour behind an element: nearest filled figure under it (by z-order), else page bg */
function backgroundBehind(page: CompactPage, el: CompactEl): string | null {
  const idx = page.elements.indexOf(el);
  for (let i = idx - 1; i >= 0; i--) {
    const b = page.elements[i];
    if (b.type === 'figure' && b.fill && contains(b, el)) return b.fill;
    if ((b.type === 'image' || b.type === 'svg') && contains(b, el)) return null; // over image: unknown
  }
  return page.background && page.background.startsWith('#') ? page.background : null;
}

/** Elements visually inside a container rect (card / pill) — used so containers move as a unit */
export function contentsOf(page: CompactPage, container: CompactEl) {
  return page.elements.filter(
    (e) => e !== container && ((e.container || e.custom?.container) === container.id || (!['card', 'background', 'bloom', 'photo', 'illustration', 'product-ui'].includes(role(e)) && contains(container, e))),
  );
}

/** Expand ops that move/resize a container into ops that move its contents by the same delta */
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

export function lintPage(page: CompactPage, W: number, H: number) {
  const issues: Issue[] = [];
  const S = Math.min(W, H);
  const els = page.elements || [];
  let n = 0;
  const push = (i: Omit<Issue, 'id'>) => issues.push({ id: `i${++n}`, ...i });

  // 1. Palette
  const pageBg = page.background;
  if (pageBg && pageBg.startsWith('#')) {
    const near = nearestPalette(pageBg, PALETTE);
    if (near && near.distance > PALETTE_TOLERANCE)
      push({ rule: 'Off-palette background', severity: 'error', message: `Page background ${pageBg} is not a brand colour. Nearest: ${near.name} ${near.hex}.`, fix: [{ op: 'background', value: near.hex }] });
  }
  for (const el of els) {
    const r = role(el);
    if ((el.type === 'text' || el.type === 'figure') && el.fill && !EXEMPT_ROLES.has(r)) {
      const near = nearestPalette(el.fill, PALETTE);
      if (near && near.distance > PALETTE_TOLERANCE)
        push({ rule: 'Off-palette colour', severity: 'error', elementId: el.id, message: `"${el.name || r}" uses ${el.fill}. Nearest brand colour: ${near.name} ${near.hex}.`, fix: [{ op: 'set', id: el.id, props: { fill: near.hex } }] });
    }
  }

  // 2. Fonts
  for (const el of els) {
    if (el.type === 'text' && el.fontFamily && !FONT_FAMILIES.includes(el.fontFamily)) {
      const r = role(el);
      const target = r === 'headline' || r === 'stat' ? brand.fonts.headline : r === 'cta' || r === 'label' ? brand.fonts.bodyBold : brand.fonts.body;
      push({ rule: 'Non-brand font', severity: 'error', elementId: el.id, message: `"${(el.text || '').slice(0, 30)}" uses ${el.fontFamily}. Use ${target}.`, fix: [{ op: 'set', id: el.id, props: { fontFamily: target } }] });
    }
  }

  // 3. Logo rules
  const logos = els.filter((e) => role(e) === 'logo' || (e.assetId || '').startsWith('10_Logo'));
  if (logos.length === 0) push({ rule: 'Missing logo', severity: 'warn', message: 'No Xero wordmark on this page. Add one in a corner (bottom-left or bottom-right).' });
  if (logos.length > 1) push({ rule: 'Multiple logos', severity: 'warn', message: `${logos.length} logos found; use exactly one.`, fix: logos.slice(1).map((l) => ({ op: 'delete' as const, id: l.id })) });
  for (const l of logos) {
    const minW = W * brand.logo.minWidthRatio;
    if (l.width < minW * 0.98) {
      const ratio = l.width / l.height;
      push({ rule: 'Logo too small', severity: 'error', elementId: l.id, message: `Logo is ${Math.round(l.width)}px wide; minimum is ${Math.round(minW)}px (${Math.round(brand.logo.minWidthRatio * 100)}% of width).`, fix: [{ op: 'set', id: l.id, props: { width: Math.round(minW), height: Math.round(minW / ratio) } }] });
    }
    // colourway vs background
    const behind = backgroundBehind(page, l);
    const variant = l.custom?.variant || (l.assetId?.includes('02_2f020a69') ? 'navy' : l.assetId?.includes('01_0f4c5387') ? 'white' : l.assetId?.includes('03_a6d69555') ? 'light-blue' : undefined);
    if (behind && variant) {
      const bgRgb = parseHex(behind);
      const logoRgb = parseHex(variant === 'navy' ? '#000856' : variant === 'white' ? '#FFFFFF' : '#3ECCFE');
      if (bgRgb && logoRgb && contrast(bgRgb, logoRgb) < 3) {
        const better = contrast(bgRgb, parseHex('#000856')!) >= 3 ? 'navy' : contrast(bgRgb, parseHex('#3ECCFE')!) >= 3 ? 'light-blue' : 'white';
        const asset = brand.logo.assets[better];
        push({ rule: 'Logo colourway', severity: 'error', elementId: l.id, message: `${variant} logo has poor contrast on ${behind}. Use the ${better} wordmark.`, fix: [{ op: 'set', id: l.id, props: { src: `/assets/brand-kit/${assetFile(asset)}`, custom: { ...(l.custom || {}), assetId: asset, role: 'logo', variant: better } } }] });
      }
    } else if (!behind && !els.some((e) => role(e) === 'logo-pill' && contains(e, l))) {
      const idx = els.indexOf(l);
      const under = els.slice(0, idx).reverse().find((e) => (e.type === 'image' || e.type === 'svg') && contains(e, l));
      const r = under ? role(under) : '';
      if (r === 'photo' || r === 'background' || (under && !under.assetId && !(under.src || '').includes('/generated/')))
        push({ rule: 'Logo over imagery', severity: 'warn', elementId: l.id, message: 'Logo sits over a photo without the pill. Add a pill behind it or move it onto a flat colour.' });
    }
    // clear space
    const pad = l.height * 0.5;
    const intruders = els.filter((e) => e !== l && !EXEMPT_ROLES.has(role(e)) && !['card', 'logo-pill', 'cta-bg', 'shape', 'background'].includes(role(e)) && overlaps(l, e, pad));
    if (intruders.length) push({ rule: 'Logo clear space', severity: 'warn', elementId: l.id, message: `${intruders.map((i) => i.name || i.type).join(', ')} intrudes on the logo clear space.` });
  }

  // 4. Text contrast + size + edges + safe zones
  const aspect = W / H;
  const zoneKey = Math.abs(aspect - 9 / 16) < 0.03 ? '9:16' : Math.abs(aspect - 4 / 5) < 0.03 ? '4:5' : 'default';
  const zone = brand.safeZones[zoneKey];
  const margin = brand.layout.marginRatio;
  const cards = els.filter((e) => role(e) === 'card');
  const inCard = (e: CompactEl) => cards.find((c) => contains(c, e));
  /** position fix that moves a card together with its contents */
  const moveWith = (el: CompactEl, props: Record<string, number>): Op[] => {
    const dx = props.x !== undefined ? props.x - el.x : 0, dy = props.y !== undefined ? props.y - el.y : 0;
    const ops: Op[] = [{ op: 'set', id: el.id, props }];
    if (role(el) === 'card') for (const c of contentsOf(page, el)) ops.push({ op: 'set', id: c.id, props: { x: Math.round(c.x + dx), y: Math.round(c.y + dy) } });
    return ops;
  };
  for (const el of els) {
    const r = role(el);
    const isText = el.type === 'text';
    // text/cta inside a card is positioned via the card (checked below as a unit)
    const protectedEl = (isText || r === 'logo' || r === 'cta-bg' || r === 'card') && !(r !== 'card' && inCard(el));
    if (isText) {
      const behind = backgroundBehind(page, el);
      const fg = parseHex(el.fill);
      const bgRgb = behind ? parseHex(behind) : null;
      if (fg && bgRgb) {
        const c = contrast(fg, bgRgb);
        if (c < 4.5) {
          const fix = contrast(bgRgb, parseHex('#000856')!) >= 4.5 ? '#000856' : '#FFFFFF';
          push({ rule: 'Low text contrast', severity: 'error', elementId: el.id, message: `"${(el.text || '').slice(0, 30)}" has ${c.toFixed(1)}:1 contrast on ${behind}; needs 4.5:1.`, fix: [{ op: 'set', id: el.id, props: { fill: fix } }] });
        }
      }
      const minFs = r === 'legal' || r === 'checklist' ? S * 0.013 : S * 0.02;
      if (el.fontSize && el.fontSize < minFs)
        push({ rule: 'Text too small', severity: 'warn', elementId: el.id, message: `"${(el.text || '').slice(0, 30)}" is ${el.fontSize}px; minimum ${Math.round(minFs)}px for legibility.`, fix: [{ op: 'set', id: el.id, props: { fontSize: Math.round(minFs) } }] });
      if (r === 'headline') {
        const t = el.text || '';
        if (t.length > brand.layout.headline.maxChars) push({ rule: 'Headline too long', severity: 'info', elementId: el.id, message: `Headline is ${t.length} chars; keep under ${brand.layout.headline.maxChars}.` });
        if (/!/.test(t)) push({ rule: 'Tone of voice', severity: 'info', elementId: el.id, message: 'Avoid exclamation marks in headlines.', fix: [{ op: 'set', id: el.id, props: { text: t.replace(/!/g, '.') } }] });
        if (t.length > 4 && t === t.toUpperCase() && /[A-Z]/.test(t)) push({ rule: 'Tone of voice', severity: 'info', elementId: el.id, message: 'Headlines are sentence case, not ALL CAPS.' });
      }
    }
    if (protectedEl) {
      const m = S * margin;
      const fixProps: Record<string, number> = {};
      if (el.x < m * 0.6) fixProps.x = Math.round(m);
      if (el.y < m * 0.6) fixProps.y = Math.round(m);
      if (el.x + el.width > W - m * 0.6) fixProps.x = Math.round(W - m - el.width);
      if (el.y + el.height > H - m * 0.6) fixProps.y = Math.round(H - m - el.height);
      if (Object.keys(fixProps).length) push({ rule: 'Too close to edge', severity: 'warn', elementId: el.id, message: `"${el.name || r}" is closer than ${Math.round(margin * 100)}% to the canvas edge.`, fix: moveWith(el, fixProps) });
      if (zoneKey !== 'default') {
        const top = H * zone.top, bottom = H * (1 - zone.bottom), left = W * zone.left, right = W * (1 - zone.right);
        const out = el.y < top || el.y + el.height > bottom || el.x < left || el.x + el.width > right;
        if (out) {
          const props: Record<string, number> = {};
          if (el.y < top) props.y = Math.round(top);
          if (el.y + el.height > bottom) props.y = Math.round(bottom - el.height);
          if (el.x < left) props.x = Math.round(left);
          if (el.x + el.width > right) props.x = Math.round(right - el.width);
          push({ rule: `Safe zone (${zoneKey})`, severity: 'warn', elementId: el.id, message: `"${el.name || r}" is inside the platform UI zone (${zoneKey}: top ${zone.top * 100}%, bottom ${zone.bottom * 100}%).`, fix: moveWith(el, props) });
        }
      }
    }
  }

  // 4b. Card contents that escaped their card (e.g. card moved without them)
  for (const card of cards) {
    const kids = els.filter((e) => (e.container || e.custom?.container) === card.id);
    const strays = kids.filter((k) => k.y < card.y - 2 || k.y + k.height > card.y + card.height + 2 || k.x < card.x - 2 || k.x + k.width > card.x + card.width + 2);
    if (strays.length) {
      const pad = Math.round(W * brand.layout.card.paddingRatio);
      const minY = Math.min(...kids.map((k) => k.y)), minX = Math.min(...kids.map((k) => k.x));
      const dy = card.y + pad - minY, dx = card.x + pad - minX;
      push({ rule: 'Text outside card', severity: 'error', elementId: strays[0].id, message: `${strays.length} element(s) sit outside their content card and may be unreadable.`, fix: kids.map((k) => ({ op: 'set' as const, id: k.id, props: { x: Math.round(k.x + dx), y: Math.round(k.y + dy) } })) });
    }
  }

  // 5. Imagery covering text (z-order: image drawn after text and overlapping its box)
  for (let i = 0; i < els.length; i++) {
    const img = els[i];
    if (!(img.type === 'image' || img.type === 'svg')) continue;
    const r = role(img);
    if (!['photo', 'illustration', 'product-ui', 'image', 'charm'].includes(r)) continue;
    const covered = els.slice(0, i).filter((t) => t.type === 'text' && overlaps(img, t, -4));
    if (covered.length) {
      const lowest = Math.max(...covered.map((t) => t.y + t.height));
      push({ rule: 'Image covers text', severity: 'error', elementId: img.id, message: `"${img.name || r}" overlaps ${covered.map((t) => `"${(t.text || '').slice(0, 18)}"`).join(', ')}.`, fix: [{ op: 'set', id: img.id, props: { y: Math.round(lowest + S * 0.02) } }] });
    }
  }

  // 6. CTA count
  const ctas = els.filter((e) => role(e) === 'cta');
  if (ctas.length > 1) push({ rule: 'Multiple CTAs', severity: 'info', message: `${ctas.length} CTAs found; one is best.` });

  const score = Math.max(0, 100 - issues.reduce((s, i) => s + WEIGHTS[i.severity], 0));
  return { score, issues };
}

function assetFile(id: string) {
  return getAsset(id)?.file || '';
}
