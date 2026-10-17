/**
 * Design spec -> Polotno page JSON, for any brand.
 * Brand defaults (fonts, sizes, colours), real text measurement, auto-stacking containers,
 * face-safe photo cropping, collision nudging, corner-parked charms and logo-on-top.
 */
import { randomUUID } from 'crypto';
import type { Asset, BrandKit } from '../core/types.js';
import { TextMeasurer } from './text.js';
import type { ChecklistEl, ContainerEl, CtaEl, Design, TextEl } from './schema.js';

const uid = () => randomUUID().slice(0, 8);

type Ctx = { W: number; H: number; S: number; children: any[] };

export class DesignRenderer {
  private tm: TextMeasurer;
  private fonts: { headline: string; body: string; bodyBold: string };
  private dark: string;

  constructor(private brand: BrandKit, private assets: Asset[], resolve: (rel: string) => string) {
    this.tm = new TextMeasurer(brand, resolve);
    this.fonts = { headline: brand.fonts.headline.family, body: brand.fonts.body.family, bodyBold: brand.fonts.bodyBold.family };
    this.dark = brand.colors[0]?.hex || '#000000';
  }

  private asset(id: string) {
    return this.assets.find((a) => a.id === id);
  }

  private textDefaults(el: TextEl, S: number) {
    const L = this.brand.layout;
    const role = el.role || 'body';
    const ratio = role === 'headline' ? L.headline.fontSizeRatio : role === 'subhead' ? L.subhead.fontSizeRatio : role === 'legal' ? L.legal.fontSizeRatio : role === 'stat' ? 0.16 : role === 'label' ? 0.022 : 0.026;
    const fontKey = el.font || (role === 'headline' || role === 'stat' ? 'headline' : role === 'label' ? 'bodyBold' : 'body');
    const family = this.fonts[fontKey];
    const lineHeight = el.lineHeight || (fontKey === 'headline' ? L.headline.lineHeight : role === 'subhead' ? 1.3 : 1.35);
    const letterSpacing = el.letterSpacing ?? (fontKey === 'headline' ? -0.02 : 0);
    const color = el.color || (role === 'legal' ? L.legal.color : this.dark);
    const maxLines = el.maxLines || (role === 'headline' ? L.headline.maxLines : role === 'stat' ? 1 : 6);
    return { role, fontSize: el.fontSize || Math.round(S * ratio), family, lineHeight, letterSpacing, color, maxLines };
  }

  private emitText(ctx: Ctx, el: TextEl, x: number, y: number, width: number) {
    const d = this.textDefaults(el, ctx.S);
    const minSize = Math.max(Math.round(ctx.S * 0.02), Math.round(d.fontSize * 0.6));
    const f = this.tm.fit(el.text, d.family, d.fontSize, width, d.lineHeight, d.maxLines, minSize, d.letterSpacing);
    const height = f.height + Math.round(f.size * 0.15);
    ctx.children.push({
      id: 'el_' + uid(), type: 'text', name: d.role, x, y, width, height,
      text: el.text, fontSize: f.size, fontFamily: d.family, fill: d.color,
      align: el.align || 'left', lineHeight: d.lineHeight, letterSpacing: d.letterSpacing, custom: { role: d.role },
    });
    return height;
  }

  private emitCta(ctx: Ctx, el: CtaEl, x: number, y: number) {
    const L = this.brand.layout.cta;
    const fontSize = el.fontSize || Math.round(ctx.S * L.fontSizeRatio);
    const padX = Math.round(fontSize * 1.2), h = Math.round(fontSize * 2.2);
    const natural = Math.round(this.tm.width(el.text, this.fonts.bodyBold, fontSize) + padX * 2);
    const w = el.width ? Math.max(natural, Math.min(el.width, Math.round(natural * 1.25))) : natural;
    const gid = uid();
    ctx.children.push({ id: 'el_' + gid, type: 'figure', subType: 'rect', name: 'CTA pill', x, y, width: w, height: h, fill: el.bg || L.onLight.bg, cornerRadius: h / 2, strokeWidth: 0, custom: { role: 'cta-bg', group: gid } });
    ctx.children.push({
      id: 'el_' + uid(), type: 'text', name: 'CTA text', x, y: y + Math.round((h - fontSize * 1.25) / 2), width: w, height: Math.round(fontSize * 1.3),
      text: el.text, fontSize, fontFamily: this.fonts.bodyBold, fill: el.color || L.onLight.text, align: 'center', lineHeight: 1.25, custom: { role: 'cta', group: gid },
    });
    return { height: h, width: w };
  }

  private emitChecklist(ctx: Ctx, el: ChecklistEl, x: number, y: number) {
    const fontSize = el.fontSize || Math.round(ctx.S * 0.016);
    const color = el.color || this.dark;
    const cols = el.columns || 2;
    const rowH = Math.round(fontSize * 1.9);
    const colW = Math.round(Math.max(...el.items.map((t) => this.tm.width(t.toUpperCase(), this.fonts.bodyBold, fontSize, 0.04))) * 1.2 + fontSize * 3);
    const check = el.checkColor || this.brand.colors.find((c) => /mint|green|success/i.test(c.name))?.hex || this.brand.colors[2]?.hex || this.dark;
    el.items.forEach((item, i) => {
      const cx = x + (i % cols) * colW, cy = y + Math.floor(i / cols) * rowH;
      ctx.children.push({ id: 'el_' + uid(), type: 'figure', subType: 'circle', name: 'check', x: cx, y: cy + fontSize * 0.2, width: fontSize, height: fontSize, fill: check, strokeWidth: 0, custom: { role: 'checklist' } });
      ctx.children.push({
        id: 'el_' + uid(), type: 'text', name: 'checklist item', x: cx + Math.round(fontSize * 1.4), y: cy, width: colW - Math.round(fontSize * 1.5), height: Math.round(fontSize * 1.5),
        text: item.toUpperCase(), fontSize, fontFamily: this.fonts.bodyBold, fill: color, letterSpacing: 0.04, lineHeight: 1.3, custom: { role: 'checklist' },
      });
    });
    return { height: Math.ceil(el.items.length / cols) * rowH, width: cols * colW };
  }

  private emitContainer(ctx: Ctx, el: ContainerEl) {
    const S = ctx.S, L = this.brand.layout;
    const pad = el.padding ?? (el.kind === 'card' ? Math.round(ctx.W * L.card.paddingRatio) : 0);
    const gap = el.gap ?? Math.round(S * 0.025);
    const innerW = el.width - pad * 2;
    // measure pass
    const scratch: Ctx = { ...ctx, children: [] };
    let cy = 0;
    const placed: { h: number; w: number }[] = [];
    for (const child of el.children) {
      let h = 0, w = innerW;
      if (child.kind === 'text') h = this.emitText(scratch, child, 0, cy, innerW);
      else if (child.kind === 'cta') ({ height: h, width: w } = this.emitCta(scratch, child, 0, cy));
      else if (child.kind === 'checklist') ({ height: h, width: w } = this.emitChecklist(scratch, child, 0, cy));
      else if (child.kind === 'spacer') h = child.height;
      placed.push({ h, w });
      cy += h + gap;
    }
    const contentH = Math.max(0, cy - gap);
    const totalH = Math.max(el.height || 0, contentH + pad * 2);
    const top = el.anchor === 'bottom' ? el.y - totalH : el.y;
    const containerId = 'el_' + uid();
    if (el.kind === 'card') {
      ctx.children.push({
        id: containerId, type: 'figure', subType: 'rect', name: 'Content card', x: el.x, y: top, width: el.width, height: totalH,
        fill: el.color || L.card.fill, cornerRadius: el.cornerRadius ?? Math.round(S * L.card.cornerRadiusRatio), strokeWidth: 0, custom: { role: 'card' },
      });
    }
    const extra = totalH - pad * 2 - contentH;
    let yy = top + pad + (el.height && extra > 0 ? Math.round(extra / 2) : 0);
    const before = ctx.children.length;
    el.children.forEach((child, i) => {
      const p = placed[i];
      const cx = el.align === 'center' ? el.x + pad + Math.round((innerW - p.w) / 2) : el.x + pad;
      if (child.kind === 'text') this.emitText(ctx, { ...child, align: child.align || (el.align === 'center' ? 'center' : 'left') }, el.x + pad, yy, innerW);
      else if (child.kind === 'cta') this.emitCta(ctx, child, cx, yy);
      else if (child.kind === 'checklist') this.emitChecklist(ctx, child, cx, yy);
      yy += p.h + gap;
    });
    if (el.kind === 'card') for (const c of ctx.children.slice(before)) c.custom = { ...(c.custom || {}), container: containerId };
    return { top, height: totalH };
  }

  render(design: Design, canvasW: number, canvasH: number) {
    const W = design.width || canvasW, H = design.height || canvasH, S = Math.min(W, H);
    const ctx: Ctx = { W, H, S, children: [] };
    const bg = design.background || this.brand.colors.find((c) => /secondary/i.test(c.role))?.hex || this.brand.colors[0].hex;
    const page: any = { id: 'p_' + uid(), width: W, height: H, background: '#FFFFFF', children: ctx.children, custom: { name: design.name, rationale: design.rationale } };

    const bgAsset = bg.startsWith('#') || bg.startsWith('rgb') ? null : this.asset(bg);
    if (bgAsset) ctx.children.push({ id: 'el_' + uid(), type: 'image', name: 'Background template', src: bgAsset.url, x: 0, y: 0, width: W, height: H, keepRatio: false, custom: { assetId: bgAsset.id, role: 'background' } });
    else page.background = bg;

    // text containers claim their area; imagery placed later is nudged out of it
    const claimed: { x: number; y: number; w: number; h: number }[] = [];
    const nudge = (x: number, y: number, w: number, h: number) => {
      let ny = y;
      for (const c of claimed) {
        const ox = x < c.x + c.w && x + w > c.x, oy = ny < c.y + c.h && ny + h > c.y;
        if (ox && oy && ny + h / 2 > c.y) ny = Math.max(ny, c.y + c.h + Math.round(S * 0.02));
      }
      return ny;
    };
    const clamp = (x: number, y: number, w: number, h: number) => ({ x: Math.min(Math.max(0, x), Math.max(0, W - w)), y: Math.min(Math.max(0, y), Math.max(0, H - h)) });

    for (const el of design.elements) {
      switch (el.kind) {
        case 'card':
        case 'stack': {
          const c = { ...el, ...clamp(el.x, el.anchor === 'bottom' ? el.y - 1 : el.y, el.width, 1) };
          const r = this.emitContainer(ctx, el.anchor === 'bottom' ? { ...el, x: c.x } : c);
          claimed.push({ x: el.x, y: r.top, w: el.width, h: r.height });
          break;
        }
        case 'shape': {
          const r = el.shape === 'pill' ? Math.min(el.width, el.height) / 2 : el.cornerRadius ?? 0;
          ctx.children.push({ id: 'el_' + uid(), type: 'figure', subType: el.shape === 'circle' ? 'circle' : 'rect', name: el.role || 'Shape', x: el.x, y: el.y, width: el.width, height: el.height, rotation: el.rotation || 0, fill: el.color, cornerRadius: r, opacity: el.opacity ?? 1, strokeWidth: 0, custom: { role: el.role || 'shape' } });
          break;
        }
        case 'text':
          this.emitText(ctx, el, el.x ?? Math.round(W * 0.06), el.y ?? Math.round(H * 0.08), el.width ?? Math.round(W * 0.86));
          break;
        case 'cta':
          this.emitCta(ctx, el, el.x ?? Math.round(W * 0.06), el.y ?? Math.round(H * 0.5));
          break;
        case 'checklist':
          this.emitChecklist(ctx, el, el.x ?? Math.round(W * 0.06), el.y ?? Math.round(H * 0.85));
          break;
        case 'logo': {
          const asset = this.asset(this.brand.logo.assets[el.variant] || Object.values(this.brand.logo.assets)[0]);
          if (!asset) break;
          const w = Math.max(el.width, Math.ceil(W * this.brand.logo.minWidthRatio)), h = Math.round(w / (asset.width / asset.height));
          const { x, y } = clamp(el.x, el.y, w, h);
          if (el.pill) {
            const pad = h * 0.55;
            const pillFill = (this.brand.logo as any).pillColors?.[el.pill] || this.brand.colors.find((c) => c.name.toLowerCase() === el.pill!.toLowerCase())?.hex || '#FFFFFF';
            ctx.children.push({ id: 'el_' + uid(), type: 'figure', subType: 'rect', name: 'Logo pill', x: x - pad, y: y - pad * 0.6, width: w + pad * 2, height: h + pad * 1.2, fill: pillFill, cornerRadius: (h + pad * 1.2) / 2, strokeWidth: 0, custom: { role: 'logo-pill' } });
          }
          ctx.children.push({ id: 'el_' + uid(), type: 'image', name: `${this.brand.name} logo`, src: asset.url, x, y, width: w, height: h, keepRatio: true, custom: { assetId: asset.id, role: 'logo', variant: el.variant } });
          break;
        }
        case 'image': {
          let src = el.src, aw = 1, ah = 1, assetId: string | undefined;
          if (el.assetId) {
            const a = this.asset(el.assetId);
            if (!a) break;
            src = a.url; aw = a.width || 1; ah = a.height || 1; assetId = a.id;
          }
          if (!src) break;
          const role = el.role || (assetId ? this.asset(assetId)!.category : 'image');
          const isSvg = src.endsWith('.svg');
          const w = el.width;
          const boxed = role === 'photo' || role === 'background';
          let h = boxed && el.height ? el.height : Math.round(w / (aw / ah));
          let x = el.x;
          let y = ['photo', 'illustration', 'product-ui'].includes(role) ? nudge(el.x, el.y, w, h) : el.y;
          const crop: Record<string, number> = {};
          if (role === 'photo') {
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
            for (const c of claimed) {
              const ox = x < c.x + c.w && x + w > c.x, oy = y < c.y + c.h && y + h > c.y;
              if (ox && oy) {
                x = x + w / 2 < c.x + c.w / 2 ? c.x - Math.round(w * 0.55) : c.x + c.w - Math.round(w * 0.45);
                y = y + h / 2 < c.y + c.h / 2 ? c.y - Math.round(h * 0.45) : c.y + c.h - Math.round(h * 0.55);
              }
            }
          }
          ctx.children.push({
            id: 'el_' + uid(), type: isSvg ? 'svg' : 'image', name: role, src, x, y, width: w, height: h, rotation: el.rotation || 0, flipX: !!el.flipX, opacity: el.opacity ?? 1,
            cornerRadius: el.cornerRadius || 0, keepRatio: !boxed, ...crop, custom: { assetId, role },
          });
          break;
        }
      }
    }
    // logo (and its pill) always on top, and imagery keeps out of its clear space
    const logoParts = ctx.children.filter((c) => c.custom?.role === 'logo' || c.custom?.role === 'logo-pill');
    const logo = logoParts.find((c) => c.custom?.role === 'logo');
    if (logo) {
      const pad = logo.height * 0.5;
      const zone = { x: logo.x - pad, y: logo.y - pad, w: logo.width + pad * 2, h: logo.height + pad * 2 };
      for (const c of ctx.children) {
        if (!['illustration', 'product-ui', 'charm'].includes(c.custom?.role)) continue;
        const ox = c.x < zone.x + zone.w && c.x + c.width > zone.x, oy = c.y < zone.y + zone.h && c.y + c.height > zone.y;
        if (!(ox && oy)) continue;
        // try sliding horizontally away from the logo; otherwise shrink to clear it (keep bottom edge)
        const logoOnLeft = logo.x + logo.width / 2 < W / 2;
        const target = logoOnLeft ? zone.x + zone.w : zone.x - c.width;
        if (target >= 0 && target + c.width <= W) c.x = Math.round(target);
        else {
          const scale = Math.max(0.6, 1 - (logoOnLeft ? zone.x + zone.w - c.x : c.x + c.width - zone.x) / c.width);
          const nw = Math.round(c.width * scale), nh = Math.round(c.height * scale);
          c.x = logoOnLeft ? c.x + (c.width - nw) : c.x;
          c.y = c.y + (c.height - nh);
          c.width = nw;
          c.height = nh;
        }
      }
    }
    if (logoParts.length) page.children = ctx.children.filter((c) => !logoParts.includes(c)).concat(logoParts);
    return page;
  }
}
