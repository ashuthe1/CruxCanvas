import type { LintRule } from '../../core/interfaces.js';
import { contrast, parseHex } from '../../core/color.js';
import { backgroundBehind, label, overlaps, role } from '../helpers.js';

export const contrastRule: LintRule = {
  id: 'contrast',
  title: 'Text contrast (WCAG AA)',
  run({ page, brand }) {
    const out = [];
    const dark = brand.colors[0]?.hex || '#000000';
    for (const el of page.elements) {
      if (el.type !== 'text') continue;
      const behind = backgroundBehind(page, el);
      const fg = parseHex(el.fill), bg = behind ? parseHex(behind) : null;
      if (!fg || !bg) continue;
      const c = contrast(fg, bg);
      if (c < 4.5) {
        const fix = contrast(bg, parseHex(dark)!) >= 4.5 ? dark : '#FFFFFF';
        out.push({ rule: 'Low text contrast', severity: 'error' as const, elementId: el.id, message: `${label(el)} has ${c.toFixed(1)}:1 contrast on ${behind}; needs 4.5:1.`, fix: [{ op: 'set' as const, id: el.id, props: { fill: fix } }] });
      }
    }
    return out;
  },
};

export const textSizeRule: LintRule = {
  id: 'text-size',
  title: 'Legible text sizes',
  run({ page, S }) {
    const out = [];
    for (const el of page.elements) {
      if (el.type !== 'text' || !el.fontSize) continue;
      const r = role(el);
      const minFs = r === 'legal' || r === 'checklist' ? S * 0.013 : S * 0.02;
      if (el.fontSize < minFs) out.push({ rule: 'Text too small', severity: 'warn' as const, elementId: el.id, message: `${label(el)} is ${el.fontSize}px; minimum ${Math.round(minFs)}px.`, fix: [{ op: 'set' as const, id: el.id, props: { fontSize: Math.round(minFs) } }] });
    }
    return out;
  },
};

export const toneRule: LintRule = {
  id: 'tone',
  title: 'Headline tone & length',
  run({ page, brand }) {
    const out = [];
    for (const el of page.elements) {
      if (el.type !== 'text' || role(el) !== 'headline') continue;
      const t = el.text || '';
      if (t.length > brand.layout.headline.maxChars) out.push({ rule: 'Headline too long', severity: 'info' as const, elementId: el.id, message: `Headline is ${t.length} chars; keep under ${brand.layout.headline.maxChars}.` });
      if (/!/.test(t)) out.push({ rule: 'Tone of voice', severity: 'info' as const, elementId: el.id, message: 'Avoid exclamation marks in headlines.', fix: [{ op: 'set' as const, id: el.id, props: { text: t.replace(/!/g, '.') } }] });
      if (t.length > 4 && t === t.toUpperCase() && /[A-Z]/.test(t)) out.push({ rule: 'Tone of voice', severity: 'info' as const, elementId: el.id, message: 'Headlines are sentence case, not ALL CAPS.' });
    }
    return out;
  },
};

export const textOverlapRule: LintRule = {
  id: 'text-overlap',
  title: 'No overlapping text',
  run({ page, S }) {
    const out = [];
    const texts = page.elements.filter((e) => e.type === 'text');
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i], b = texts[j];
        if (a.custom?.group && a.custom.group === b.custom?.group) continue;
        if (!overlaps(a, b, -2)) continue;
        const lower = a.y <= b.y ? b : a, upper = lower === a ? b : a;
        out.push({ rule: 'Overlapping text', severity: 'error' as const, elementId: lower.id, message: `${label(upper)} and ${label(lower)} overlap.`, fix: [{ op: 'set' as const, id: lower.id, props: { y: Math.round(upper.y + upper.height + S * 0.015) } }] });
      }
    }
    return out;
  },
};

export const ctaRule: LintRule = {
  id: 'cta',
  title: 'Single call to action',
  run({ page }) {
    const ctas = page.elements.filter((e) => role(e) === 'cta');
    return ctas.length > 1 ? [{ rule: 'Multiple CTAs', severity: 'info' as const, message: `${ctas.length} CTAs found; one is best.` }] : [];
  },
};
