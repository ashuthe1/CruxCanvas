import type { LintRule } from '../../core/interfaces.js';
import { contrast, parseHex } from '../../core/color.js';
import { IMAGE_ROLES, backgroundBehind, contains, overlaps, role } from '../helpers.js';

export const logoRule: LintRule = {
  id: 'logo',
  title: 'Logo usage',
  run({ brand, page, W, assets }) {
    const out: any[] = [];
    const els = page.elements;
    const logoIds = new Set(Object.values(brand.logo.assets));
    const logos = els.filter((e) => role(e) === 'logo' || (e.assetId && logoIds.has(e.assetId)));
    if (logos.length === 0) out.push({ rule: 'Missing logo', severity: 'warn', message: `No ${brand.name} logo on this page. Add one in a corner.` });
    if (logos.length > 1) out.push({ rule: 'Multiple logos', severity: 'warn', message: `${logos.length} logos found; use exactly one.`, fix: logos.slice(1).map((l) => ({ op: 'delete' as const, id: l.id })) });

    const variantOf = (l: any) => l.custom?.variant || Object.entries(brand.logo.assets).find(([, id]) => id === l.assetId)?.[0];
    const variantColor = (v: string) => brand.logo.variantColors?.[v];

    for (const l of logos) {
      const minW = W * brand.logo.minWidthRatio;
      if (l.width < minW * 0.98) {
        const ratio = l.width / l.height;
        out.push({ rule: 'Logo too small', severity: 'error', elementId: l.id, message: `Logo is ${Math.round(l.width)}px wide; minimum is ${Math.round(minW)}px (${Math.round(brand.logo.minWidthRatio * 100)}% of width).`, fix: [{ op: 'set', id: l.id, props: { width: Math.round(minW), height: Math.round(minW / ratio) } }] });
      }
      const behind = backgroundBehind(page, l);
      const variant = variantOf(l);
      if (behind && variant && variantColor(variant)) {
        const bgRgb = parseHex(behind), logoRgb = parseHex(variantColor(variant)!);
        if (bgRgb && logoRgb && contrast(bgRgb, logoRgb) < 3) {
          const better = Object.entries(brand.logo.variantColors || {}).map(([v, hex]) => ({ v, c: contrast(bgRgb, parseHex(hex)!) })).sort((a, b) => b.c - a.c)[0];
          if (better && better.v !== variant) {
            const asset = assets.find((a) => a.id === brand.logo.assets[better.v]);
            out.push({ rule: 'Logo colourway', severity: 'error', elementId: l.id, message: `${variant} logo has poor contrast on ${behind}. Use the ${better.v} version.`, fix: asset ? [{ op: 'set', id: l.id, props: { src: asset.url, custom: { ...(l.custom || {}), assetId: asset.id, role: 'logo', variant: better.v } } }] : undefined });
          }
        }
      } else if (!behind && !els.some((e) => role(e) === 'logo-pill' && contains(e, l))) {
        const idx = els.indexOf(l);
        const under = els.slice(0, idx).reverse().find((e) => (e.type === 'image' || e.type === 'svg') && contains(e, l));
        const r = under ? role(under) : '';
        if (r === 'photo' || r === 'background' || (under && !under.assetId && !(under.src || '').includes('/generated/')))
          out.push({ rule: 'Logo over imagery', severity: 'warn', elementId: l.id, message: 'Logo sits over a photo without a pill. Add a pill behind it or move it onto a flat colour.' });
      }
      const pad = l.height * 0.5;
      const intruders = els.filter((e) => e !== l && !IMAGE_ROLES.has(role(e)) && !['card', 'logo-pill', 'cta-bg', 'shape', 'background'].includes(role(e)) && overlaps(l, e, pad));
      if (intruders.length) out.push({ rule: 'Logo clear space', severity: 'warn', elementId: l.id, message: `${intruders.map((i) => i.name || i.type).join(', ')} intrudes on the logo clear space.` });
      // partially outside the canvas / hidden behind imagery drawn later
      const idx = els.indexOf(l);
      const cover = els.slice(idx + 1).find((e) => (e.type === 'image' || e.type === 'svg' || (e.type === 'figure' && (e.opacity ?? 1) > 0.5)) && overlaps(e, l));
      if (cover) {
        const pill = els.find((e) => role(e) === 'logo-pill' && contains(e, l));
        out.push({ rule: 'Logo hidden', severity: 'error', elementId: l.id, message: `"${cover.name || role(cover)}" is drawn over the logo.`, fix: [...(pill ? [{ op: 'raise' as const, id: pill.id }] : []), { op: 'raise' as const, id: l.id }] });
      }
    }
    return out;
  },
};
