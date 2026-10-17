/**
 * Design spec (what the LLM writes) -> Polotno page JSON (what the canvas renders).
 * Keeping the LLM away from raw Polotno JSON gives us validation, brand defaults,
 * composite elements (card, cta, logo pill, checklist) and — crucially — real text
 * measurement + auto-stacking so text never overlaps.
 */
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { brand, getAsset } from './brand.js';
import { measure, fit, textWidth } from './text.js';

const uid = () => randomUUID().slice(0, 8);
const num = z.number();

const Text = z.object({
  kind: z.literal('text'),
  role: z.enum(['headline', 'subhead', 'body', 'label', 'legal', 'stat']).optional(),
  text: z.string(),
  x: num.optional(), y: num.optional(), width: num.optional(),
  fontSize: num.optional(),
  maxLines: num.optional(),
  font: z.enum(['headline', 'body', 'bodyBold']).optional(),
  color: z.string().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  lineHeight: num.optional(),
  letterSpacing: num.optional(),
});
const Image = z.object({
  kind: z.literal('image'),
  role: z.enum(['background', 'bloom', 'photo', 'illustration', 'charm', 'product-ui', 'decor']).optional(),
  assetId: z.string().optional(),
  src: z.string().optional(),
  x: num, y: num, width: num, height: num.optional(),
  rotation: num.optional(),
  flipX: z.boolean().optional(),
  opacity: num.optional(),
  cornerRadius: num.optional(),
});
const Shape = z.object({
  kind: z.literal('shape'),
  shape: z.enum(['rect', 'circle', 'pill']),
  x: num, y: num, width: num, height: num,
  color: z.string(),
  cornerRadius: num.optional(),
  opacity: num.optional(),
  rotation: num.optional(),
  role: z.string().optional(),
});
const Cta = z.object({
  kind: z.literal('cta'),
  text: z.string(),
  x: num.optional(), y: num.optional(),
  bg: z.string().optional(),
  color: z.string().optional(),
  fontSize: num.optional(),
  width: num.optional(),
});
const Logo = z.object({
  kind: z.literal('logo'),
  variant: z.enum(['navy', 'white', 'light-blue']),
  x: num, y: num, width: num,
  pill: z.enum(['white', 'navy', 'light-blue']).optional(),
});
const Checklist = z.object({
  kind: z.literal('checklist'),
  items: z.array(z.string()).min(1).max(6),
  x: num.optional(), y: num.optional(),
  color: z.string().optional(),
  fontSize: num.optional(),
  columns: num.optional(),
  checkColor: z.string().optional(),
});
const Spacer = z.object({ kind: z.literal('spacer'), height: num });

const Child = z.discriminatedUnion('kind', [Text, Cta, Checklist, Spacer]);

/** A vertical flow container. `card` draws a white rounded rect behind it; `stack` is invisible. */
const Container = z.object({
  kind: z.enum(['card', 'stack']),
  x: num, y: num, width: num,
  height: num.optional(),
  padding: num.optional(),
  gap: num.optional(),
  color: z.string().optional(),
  cornerRadius: num.optional(),
  align: z.enum(['left', 'center']).optional(),
  anchor: z.enum(['top', 'bottom']).optional(),
  children: z.array(Child).default([]),
});

export const DesignSchema = z.object({
  name: z.string().optional(),
  width: num.optional(),
  height: num.optional(),
  background: z.string().optional(),
  elements: z.array(z.discriminatedUnion('kind', [Text, Image, Shape, Container, Cta, Logo, Checklist])),
});
export type Design = z.infer<typeof DesignSchema>;

const FONT = {
  headline: brand.fonts.headline as string,
  body: brand.fonts.body as string,
  bodyBold: brand.fonts.bodyBold as string,
};

type Ctx = { W: number; H: number; S: number; children: any[] };

function textDefaults(el: z.infer<typeof Text>, S: number) {
  const role = el.role || 'body';
  const ratio =
    role === 'headline' ? brand.layout.headline.fontSizeRatio
    : role === 'subhead' ? brand.layout.subhead.fontSizeRatio
    : role === 'legal' ? brand.layout.legal.fontSizeRatio
    : role === 'stat' ? 0.16
    : role === 'label' ? 0.022
    : 0.026;
  const fontKey = el.font || (role === 'headline' || role === 'stat' ? 'headline' : role === 'label' ? 'bodyBold' : 'body');
  const family = FONT[fontKey];
  const lineHeight = el.lineHeight || (fontKey === 'headline' ? brand.layout.headline.lineHeight : role === 'subhead' ? 1.3 : 1.35);
  const letterSpacing = el.letterSpacing ?? (fontKey === 'headline' ? -0.02 : 0);
  const color = el.color || (role === 'legal' ? brand.layout.legal.color : '#000856');
  const maxLines = el.maxLines || (role === 'headline' ? brand.layout.headline.maxLines : role === 'stat' ? 1 : 6);
  return { role, fontSize: el.fontSize || Math.round(S * ratio), family, lineHeight, letterSpacing, color, maxLines };
}

/** Emit a text node; returns its height. Shrinks to fit maxLines. */
function emitText(ctx: Ctx, el: z.infer<typeof Text>, x: number, y: number, width: number) {
  const d = textDefaults(el, ctx.S);
  const minSize = Math.max(Math.round(ctx.S * 0.02), Math.round(d.fontSize * 0.6));
  const f = fit(el.text, d.family, d.fontSize, width, d.lineHeight, d.maxLines, minSize, d.letterSpacing);
  const height = f.height + Math.round(f.size * 0.15);
  ctx.children.push({
    id: 'el_' + uid(), type: 'text', name: d.role,
    x, y, width, height,
    text: el.text, fontSize: f.size, fontFamily: d.family, fill: d.color,
    align: el.align || 'left', lineHeight: d.lineHeight, letterSpacing: d.letterSpacing,
    custom: { role: d.role },
  });
  return height;
}

function emitCta(ctx: Ctx, el: z.infer<typeof Cta>, x: number, y: number) {
  const fontSize = el.fontSize || Math.round(ctx.S * brand.layout.cta.fontSizeRatio);
  const padX = Math.round(fontSize * 1.2), h = Math.round(fontSize * 2.2);
  const natural = Math.round(textWidth(el.text, FONT.bodyBold, fontSize) + padX * 2);
  const w = el.width ? Math.max(natural, Math.min(el.width, Math.round(natural * 1.25))) : natural;
  const gid = uid();
  ctx.children.push({
    id: 'el_' + gid, type: 'figure', subType: 'rect', name: 'CTA pill',
    x, y, width: w, height: h, fill: el.bg || brand.layout.cta.onLight.bg, cornerRadius: h / 2, strokeWidth: 0,
    custom: { role: 'cta-bg', group: gid },
  });
  ctx.children.push({
    id: 'el_' + uid(), type: 'text', name: 'CTA text',
    x, y: y + Math.round((h - fontSize * 1.25) / 2), width: w, height: Math.round(fontSize * 1.3),
    text: el.text, fontSize, fontFamily: FONT.bodyBold, fill: el.color || brand.layout.cta.onLight.text, align: 'center', lineHeight: 1.25,
    custom: { role: 'cta', group: gid },
  });
  return { height: h, width: w };
}

function emitChecklist(ctx: Ctx, el: z.infer<typeof Checklist>, x: number, y: number) {
  const fontSize = el.fontSize || Math.round(ctx.S * 0.016);
  const color = el.color || '#000856';
  const cols = el.columns || 2;
  const rowH = Math.round(fontSize * 1.9);
  const colW = Math.round(Math.max(...el.items.map((t) => textWidth(t.toUpperCase(), FONT.bodyBold, fontSize, 0.04))) * 1.2 + fontSize * 3);
  el.items.forEach((item, i) => {
    const cx = x + (i % cols) * colW, cy = y + Math.floor(i / cols) * rowH;
    ctx.children.push({
      id: 'el_' + uid(), type: 'figure', subType: 'circle', name: 'check', x: cx, y: cy + fontSize * 0.2, width: fontSize, height: fontSize,
      fill: el.checkColor || '#51D9A5', strokeWidth: 0, custom: { role: 'checklist' },
    });
    ctx.children.push({
      id: 'el_' + uid(), type: 'text', name: 'checklist item', x: cx + Math.round(fontSize * 1.4), y: cy, width: colW - Math.round(fontSize * 1.5), height: Math.round(fontSize * 1.5),
      text: item.toUpperCase(), fontSize, fontFamily: FONT.bodyBold, fill: color, letterSpacing: 0.04, lineHeight: 1.3, custom: { role: 'checklist' },
    });
  });
  return { height: Math.ceil(el.items.length / cols) * rowH, width: cols * colW };
}

function emitContainer(ctx: Ctx, el: z.infer<typeof Container>) {
  const S = ctx.S;
  const pad = el.padding ?? (el.kind === 'card' ? Math.round(ctx.W * brand.layout.card.paddingRatio) : 0);
  const gap = el.gap ?? Math.round(S * 0.025);
  const innerW = el.width - pad * 2;
  // measure first to know height (so the card rect goes behind, and anchor=bottom works)
  const scratch: Ctx = { ...ctx, children: [] };
  let cy = 0;
  const placed: { h: number; w: number; idx: number }[] = [];
  for (const child of el.children) {
    let h = 0, w = innerW;
    if (child.kind === 'text') h = emitText(scratch, child, 0, cy, innerW);
    else if (child.kind === 'cta') ({ height: h, width: w } = emitCta(scratch, child, 0, cy));
    else if (child.kind === 'checklist') ({ height: h, width: w } = emitChecklist(scratch, child, 0, cy));
    else if (child.kind === 'spacer') h = child.height;
    placed.push({ h, w, idx: scratch.children.length });
    cy += h + gap;
  }
  const contentH = Math.max(0, cy - gap);
  const totalH = Math.max(el.height || 0, contentH + pad * 2);
  const top = el.anchor === 'bottom' ? el.y - totalH : el.y;
  const containerId = 'el_' + uid();
  if (el.kind === 'card') {
    ctx.children.push({
      id: containerId, type: 'figure', subType: 'rect', name: 'Content card',
      x: el.x, y: top, width: el.width, height: totalH,
      fill: el.color || brand.layout.card.fill, cornerRadius: el.cornerRadius ?? Math.round(S * brand.layout.card.cornerRadiusRatio),
      strokeWidth: 0, custom: { role: 'card' },
    });
  }
  // vertical centring when a fixed height is larger than content
  const extra = totalH - pad * 2 - contentH;
  const startY = top + pad + (el.height && extra > 0 ? Math.round(extra / 2) : 0);
  // re-emit for real with offsets; tag children with their container so they move as a unit
  let yy = startY;
  let i = 0;
  const before = ctx.children.length;
  for (const child of el.children) {
    const p = placed[i++];
    const cx = el.align === 'center' ? el.x + pad + Math.round((innerW - p.w) / 2) : el.x + pad;
    if (child.kind === 'text') emitText(ctx, { ...child, align: child.align || (el.align === 'center' ? 'center' : 'left') }, el.x + pad, yy, innerW);
    else if (child.kind === 'cta') emitCta(ctx, child, cx, yy);
    else if (child.kind === 'checklist') emitChecklist(ctx, child, cx, yy);
    yy += p.h + gap;
  }
  if (el.kind === 'card') for (const c of ctx.children.slice(before)) c.custom = { ...(c.custom || {}), container: containerId };
  return totalH;
}

export function renderDesign(design: Design, canvasW: number, canvasH: number) {
  const W = design.width || canvasW;
  const H = design.height || canvasH;
  const S = Math.min(W, H);
  const ctx: Ctx = { W, H, S, children: [] };
  const bg = design.background || '#3ECCFE';
  const page: any = { id: 'p_' + uid(), width: W, height: H, background: '#FFFFFF', children: ctx.children, custom: { name: design.name } };

  const bgAsset = bg.startsWith('#') || bg.startsWith('rgb') ? null : getAsset(bg);
  if (bgAsset) {
    ctx.children.push({
      id: 'el_' + uid(), type: 'image', name: 'Background template', src: bgAsset.url,
      x: 0, y: 0, width: W, height: H, keepRatio: false,
      custom: { assetId: bgAsset.id, role: 'background' },
    });
  } else {
    page.background = bg;
  }

  // text containers claim their area; imagery placed later is nudged out of it
  const claimed: { x: number; y: number; w: number; h: number }[] = [];
  const nudge = (x: number, y: number, w: number, h: number) => {
    let ny = y;
    for (const c of claimed) {
      const overlapX = x < c.x + c.w && x + w > c.x;
      const overlapY = ny < c.y + c.h && ny + h > c.y;
      if (overlapX && overlapY && ny + h / 2 > c.y) ny = Math.max(ny, c.y + c.h + Math.round(S * 0.02)); // image mostly below → push below
    }
    return ny;
  };

  for (const el of design.elements) {
    switch (el.kind) {
      case 'card':
      case 'stack': {
        const h = emitContainer(ctx, el);
        const top = el.anchor === 'bottom' ? el.y - h : el.y;
        claimed.push({ x: el.x, y: top, w: el.width, h });
        break;
      }
      case 'shape': {
        const r = el.shape === 'pill' ? Math.min(el.width, el.height) / 2 : el.cornerRadius ?? 0;
        ctx.children.push({
          id: 'el_' + uid(), type: 'figure', subType: el.shape === 'circle' ? 'circle' : 'rect', name: el.role || 'Shape',
          x: el.x, y: el.y, width: el.width, height: el.height, rotation: el.rotation || 0,
          fill: el.color, cornerRadius: r, opacity: el.opacity ?? 1, strokeWidth: 0, custom: { role: el.role || 'shape' },
        });
        break;
      }
      case 'text':
        emitText(ctx, el, el.x ?? Math.round(W * 0.06), el.y ?? Math.round(H * 0.08), el.width ?? Math.round(W * 0.86));
        break;
      case 'cta':
        emitCta(ctx, el, el.x ?? Math.round(W * 0.06), el.y ?? Math.round(H * 0.5));
        break;
      case 'checklist':
        emitChecklist(ctx, el, el.x ?? Math.round(W * 0.06), el.y ?? Math.round(H * 0.85));
        break;
      case 'logo': {
        const asset = getAsset(brand.logo.assets[el.variant]);
        if (!asset) break;
        const w = el.width, h = Math.round(w / (asset.width / asset.height));
        if (el.pill) {
          const pad = h * 0.55;
          const pillFill = el.pill === 'white' ? '#FFFFFF' : el.pill === 'navy' ? '#000856' : '#3ECCFE';
          ctx.children.push({
            id: 'el_' + uid(), type: 'figure', subType: 'rect', name: 'Logo pill',
            x: el.x - pad, y: el.y - pad * 0.6, width: w + pad * 2, height: h + pad * 1.2, fill: pillFill, cornerRadius: (h + pad * 1.2) / 2, strokeWidth: 0,
            custom: { role: 'logo-pill' },
          });
        }
        ctx.children.push({
          id: 'el_' + uid(), type: 'image', name: 'Xero logo', src: asset.url,
          x: el.x, y: el.y, width: w, height: h, keepRatio: true,
          custom: { assetId: asset.id, role: 'logo', variant: el.variant },
        });
        break;
      }
      case 'image': {
        let src = el.src, aw = 1, ah = 1, assetId: string | undefined;
        if (el.assetId) {
          const a = getAsset(el.assetId);
          if (!a) break;
          src = a.url; aw = a.width || 1; ah = a.height || 1; assetId = a.id;
        }
        if (!src) break;
        const role = el.role || 'image';
        const isSvg = src.endsWith('.svg');
        const w = el.width;
        // only photos/backgrounds may be boxed; everything else keeps its aspect ratio
        const boxed = role === 'photo' || role === 'background';
        let h = boxed && el.height ? el.height : Math.round(w / (aw / ah));
        let x = el.x;
        let y = ['photo', 'illustration', 'product-ui'].includes(role) ? nudge(el.x, el.y, w, h) : el.y;
        const crop: Record<string, number> = {};
        if (role === 'photo') {
          // Photos are cover-cropped into their box (box height defaults to "down to the canvas bottom"),
          // with the focus slightly above centre so faces survive.
          const boxH = el.height || Math.max(Math.round(S * 0.3), H - y);
          const natAspect = aw / ah, boxAspect = w / boxH;
          if (natAspect > boxAspect) {
            const cw = boxAspect / natAspect;
            Object.assign(crop, { cropX: (1 - cw) / 2, cropY: 0, cropWidth: cw, cropHeight: 1 });
          } else {
            const ch = natAspect / boxAspect;
            Object.assign(crop, { cropX: 0, cropY: Math.max(0, Math.min(1 - ch, 0.35 - ch / 2)), cropWidth: 1, cropHeight: ch });
          }
          h = boxH;
        } else if (role === 'charm') {
          // charms decorate corners; keep them off text
          for (const c of claimed) {
            const ox = x < c.x + c.w && x + w > c.x, oy = y < c.y + c.h && y + h > c.y;
            if (ox && oy) {
              x = x + w / 2 < c.x + c.w / 2 ? c.x - Math.round(w * 0.55) : c.x + c.w - Math.round(w * 0.45);
              y = y + h / 2 < c.y + c.h / 2 ? c.y - Math.round(h * 0.45) : c.y + c.h - Math.round(h * 0.55);
            }
          }
        }
        ctx.children.push({
          id: 'el_' + uid(), type: isSvg ? 'svg' : 'image', name: role, src,
          x, y, width: w, height: h, rotation: el.rotation || 0, flipX: !!el.flipX, opacity: el.opacity ?? 1,
          cornerRadius: el.cornerRadius || 0, keepRatio: !boxed,
          ...crop,
          custom: { assetId, role },
        });
        break;
      }
    }
  }
  // logo (and its pill) always on top
  const logoParts = ctx.children.filter((c) => c.custom?.role === 'logo' || c.custom?.role === 'logo-pill');
  if (logoParts.length) {
    page.children = ctx.children.filter((c) => !logoParts.includes(c)).concat(logoParts);
  }
  return page;
}

export { measure };
