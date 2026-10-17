/**
 * Brand scan: score any flat creative against a brand kit.
 * Deterministic where pixels allow (palette coverage, geometry, copy rules) and vision-assisted
 * where only a model can tell (what the headline says, whether the logo is there, which font it is).
 */
import sharp from 'sharp';
import type { IVisionModel } from '../core/interfaces.js';
import type { Asset, BrandKit, ScanCheck, ScanElement, ScanReport } from '../core/types.js';
import { contrast, distance, nearestPalette, parseHex, toHex } from '../core/color.js';

const WEIGHTS = { error: 15, warn: 7, info: 3 };
const PALETTE_TOLERANCE = 48;

export type ScanDeps = { brand: BrandKit; assets: Asset[]; vision: IVisionModel; resolve: (rel: string) => string };

/** Quantised colour histogram over the whole image (ignores near-transparent pixels) */
export async function samplePalette(buf: Buffer, maxColors = 8) {
  const { data, info } = await sharp(buf).ensureAlpha().resize(96, 96, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const hist = new Map<string, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i] >> 4 << 4, g = data[i + 1] >> 4 << 4, b = data[i + 2] >> 4 << 4;
    const k = `${r},${g},${b}`;
    const e = hist.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2];
    hist.set(k, e);
    total++;
  }
  const bins = [...hist.values()].map((e) => ({ rgb: [e.r / e.n, e.g / e.n, e.b / e.n] as [number, number, number], n: e.n })).sort((a, b) => b.n - a.n);
  // greedy merge of near-identical bins
  const merged: { rgb: [number, number, number]; n: number }[] = [];
  for (const b of bins) {
    const m = merged.find((x) => distance(x.rgb, b.rgb) < 60);
    if (m) {
      const n = m.n + b.n;
      m.rgb = [(m.rgb[0] * m.n + b.rgb[0] * b.n) / n, (m.rgb[1] * m.n + b.rgb[1] * b.n) / n, (m.rgb[2] * m.n + b.rgb[2] * b.n) / n];
      m.n = n;
    } else merged.push({ ...b });
  }
  return merged.slice(0, maxColors).map((m) => ({ hex: toHex(m.rgb), share: m.n / Math.max(1, total) }));
}

async function toDataUrl(file: string) {
  const buf = await sharp(file).resize(600, 600, { fit: 'inside' }).png().toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

export async function scanCreative(image: string, deps: ScanDeps): Promise<ScanReport> {
  const { brand, assets, vision } = deps;
  const m = /^data:image\/\w+;base64,(.+)$/.exec(image);
  if (!m) throw Object.assign(new Error('image must be a data URL'), { status: 400 });
  const buf = Buffer.from(m[1], 'base64');
  const meta = await sharp(buf).metadata();
  const W = meta.width || 1, H = meta.height || 1;
  const aspect = Math.abs(W / H - 9 / 16) < 0.03 ? '9:16' : Math.abs(W / H - 4 / 5) < 0.03 ? '4:5' : Math.abs(W / H - 1) < 0.03 ? '1:1' : W > H ? 'landscape' : 'portrait';

  // ---- deterministic: palette coverage ----
  const palette = brand.colors.map((c) => ({ name: c.name, hex: c.hex.toUpperCase() }));
  const sampled = await samplePalette(buf);
  const detected = sampled.map((s) => {
    const near = nearestPalette(s.hex, palette)!;
    return { hex: s.hex, share: s.share, nearest: near.name, distance: Math.round(near.distance), onBrand: near.distance <= PALETTE_TOLERANCE };
  });
  // neutrals (paper, ink, anti-aliasing greys) are tolerated even if not in the palette
  for (const d of detected) {
    const rgb = parseHex(d.hex)!;
    const l = (rgb[0] + rgb[1] + rgb[2]) / 3;
    const sat = Math.max(...rgb) - Math.min(...rgb);
    if (!d.onBrand && (l > 238 || l < 22 || sat < 20)) d.onBrand = true;
  }
  const coverageOnBrand = detected.filter((d) => d.onBrand).reduce((s, d) => s + d.share, 0) / Math.max(1e-6, detected.reduce((s, d) => s + d.share, 0));

  // ---- vision: what is on the creative ----
  const logoAssetId = Object.values(brand.logo.assets)[0];
  const logoAsset = assets.find((a) => a.id === logoAssetId);
  const images = [image];
  if (logoAsset) {
    try {
      images.push(await toDataUrl(deps.resolve(`assets/${logoAsset.file}`)));
    } catch {}
  }
  const brief = {
    name: brand.name,
    palette: brand.colors.map((c) => `${c.name} ${c.hex} (${c.role})`),
    fonts: brand.fonts.notes,
    logoRules: { minWidthRatio: brand.logo.minWidthRatio, placement: brand.logo.placement, colourways: brand.logo.colourways, variants: Object.keys(brand.logo.assets) },
    voice: brand.voice,
    rules: brand.rules,
  };
  const v = await vision.describeJSON(
    `You audit ad creatives against a brand kit. Image 1 is the creative to audit${logoAsset ? '; image 2 is the brand logo for reference' : ''}.
Return strict JSON:
{
 "summary": "2 sentences: what the creative is and the overall brand impression",
 "layout": "one paragraph describing composition in reading order",
 "headline": "...", "subhead": "...", "cta": "...", "legal": "...",
 "elements": [{"type":"headline|subhead|body|cta|logo|photo|illustration|shape|badge|legal|other","text":"if any","box":{"x":0..1,"y":0..1,"w":0..1,"h":0..1},"color":"#hex of the text/fill","background":"#hex behind it","notes":"..."}],
 "logo": {"present":true|false,"variant":"which brand logo variant or 'other'/'competitor'","widthRatio":0..1,"position":"top-left|top-right|bottom-left|bottom-right|centre|other","notes":"clear space, pill, distortion, wrong colour..."},
 "fontsLookLikeBrand": true|false, "fontNotes":"what the headline/body typefaces look like vs the brand fonts",
 "textContrastIssues": ["element text that is hard to read and why"],
 "offBrandObservations": ["anything violating the rules: colours, tone, imagery, layout"],
 "strengths": ["what already works"]
}
Boxes must be accurate. Be strict but fair.`,
    `Brand kit: ${JSON.stringify(brief)}\nCreative size: ${W}x${H} (${aspect}).`,
    images,
    1800,
  );

  const elements: ScanElement[] = Array.isArray(v.elements) ? v.elements.filter((e: any) => e && e.box) : [];
  const checks: ScanCheck[] = [];
  const push = (c: ScanCheck) => checks.push(c);

  // ---- checks ----
  const offPalette = detected.filter((d) => !d.onBrand && d.share > 0.04);
  push({
    rule: 'Brand palette',
    ok: offPalette.length === 0,
    severity: 'error',
    detail: offPalette.length ? `${Math.round((1 - coverageOnBrand) * 100)}% of the pixels are off-palette: ${offPalette.map((d) => `${d.hex} (nearest ${d.nearest})`).join(', ')}.` : `${Math.round(coverageOnBrand * 100)}% of the pixels use brand colours.`,
    fix: offPalette.length ? `Swap ${offPalette.map((d) => d.hex).join(', ')} for ${[...new Set(offPalette.map((d) => d.nearest))].join(' / ')}.` : undefined,
  });

  const logo = v.logo || { present: false };
  push({ rule: 'Logo present', ok: !!logo.present, severity: 'error', detail: logo.present ? `${logo.variant || 'brand'} logo found ${logo.position ? `(${logo.position})` : ''}.` : 'No brand logo detected.', fix: logo.present ? undefined : `Add the ${brand.name} wordmark in a corner (≥ ${Math.round(brand.logo.minWidthRatio * 100)}% of width).` });
  if (logo.present) {
    const wr = Number(logo.widthRatio || 0);
    push({ rule: 'Logo size', ok: wr >= brand.logo.minWidthRatio * 0.9, severity: 'error', detail: `Logo is ~${Math.round(wr * 100)}% of the width; minimum ${Math.round(brand.logo.minWidthRatio * 100)}%.`, fix: wr >= brand.logo.minWidthRatio * 0.9 ? undefined : `Scale the logo to at least ${Math.round(brand.logo.minWidthRatio * 100)}% of the canvas width.` });
    const cornerOk = /left|right/.test(String(logo.position || ''));
    push({ rule: 'Logo placement', ok: cornerOk, severity: 'warn', detail: `Logo sits ${logo.position || 'somewhere unusual'}. ${logo.notes || ''}`.trim(), fix: cornerOk ? undefined : brand.logo.placement });
    const knownVariant = Object.keys(brand.logo.assets).some((k) => String(logo.variant || '').toLowerCase().includes(k.split('-')[0]));
    push({ rule: 'Logo colourway', ok: knownVariant || /brand|official|correct/i.test(String(logo.variant)), severity: 'warn', detail: `Variant: ${logo.variant || 'unknown'}.`, fix: knownVariant ? undefined : `Use an approved variant: ${Object.keys(brand.logo.assets).join(', ')}.` });
  }

  push({ rule: 'Brand typefaces', ok: v.fontsLookLikeBrand !== false, severity: 'warn', detail: v.fontNotes || (v.fontsLookLikeBrand ? 'Typography matches the brand fonts.' : 'Could not assess.'), fix: v.fontsLookLikeBrand === false ? `Set headlines in ${brand.fonts.headline.family.replace(/Headline$/, '')} headline face and body in the brand body face.` : undefined });

  const headline = String(v.headline || '');
  if (headline) {
    const L = brand.layout.headline;
    push({ rule: 'Headline length', ok: headline.length <= L.maxChars, severity: 'info', detail: `${headline.length} characters (max ${L.maxChars}).`, fix: headline.length > L.maxChars ? 'Tighten the headline to one idea.' : undefined });
    const capsBanned = (brand.voice.avoid || []).some((a) => /caps/i.test(a));
    const bangBanned = (brand.voice.avoid || []).some((a) => /exclamation/i.test(a));
    if (bangBanned) push({ rule: 'Tone: punctuation', ok: !/!/.test(headline), severity: 'info', detail: /!/.test(headline) ? 'Exclamation marks are off-voice.' : 'No exclamation marks.', fix: /!/.test(headline) ? 'Replace "!" with a full stop.' : undefined });
    if (capsBanned) push({ rule: 'Tone: case', ok: !(headline.length > 4 && headline === headline.toUpperCase()), severity: 'info', detail: headline === headline.toUpperCase() ? 'Headline is ALL CAPS.' : 'Sentence case.', fix: headline === headline.toUpperCase() ? 'Use sentence case.' : undefined });
  } else {
    push({ rule: 'Headline', ok: false, severity: 'warn', detail: 'No clear headline detected.', fix: 'Lead with one short, benefit-led headline.' });
  }

  const ctas = elements.filter((e) => e.type === 'cta');
  push({ rule: 'Single call to action', ok: ctas.length <= 1 && (ctas.length === 1 || !!v.cta), severity: ctas.length > 1 ? 'info' : 'warn', detail: ctas.length === 0 && !v.cta ? 'No CTA found.' : ctas.length > 1 ? `${ctas.length} CTAs compete.` : `CTA: "${v.cta || ctas[0]?.text}".`, fix: ctas.length === 0 && !v.cta ? `Add one pill CTA (${brand.layout.cta.notes || 'short imperative copy'}).` : ctas.length > 1 ? 'Keep one CTA.' : undefined });

  const issues: string[] = Array.isArray(v.textContrastIssues) ? v.textContrastIssues : [];
  // deterministic contrast where the model gave both colours
  for (const e of elements) {
    if (!['headline', 'subhead', 'body', 'cta', 'legal'].includes(e.type)) continue;
    const fg = parseHex(e.color), bg = parseHex(e.background);
    if (fg && bg && contrast(fg, bg) < 3) issues.push(`"${(e.text || e.type).slice(0, 30)}" ${contrast(fg, bg).toFixed(1)}:1 on ${e.background}`);
  }
  push({ rule: 'Text contrast', ok: issues.length === 0, severity: 'error', detail: issues.length ? issues.slice(0, 3).join('; ') : 'Text reads clearly against its background.', fix: issues.length ? 'Put text on a flat brand colour or a card, or switch to the high-contrast text colour.' : undefined });

  const zone = brand.safeZones[aspect as keyof typeof brand.safeZones];
  if (zone && aspect !== '1:1') {
    const out = elements.filter((e) => ['headline', 'subhead', 'cta', 'logo'].includes(e.type) && (e.box.y < zone.top || e.box.y + e.box.h > 1 - zone.bottom || e.box.x < zone.left || e.box.x + e.box.w > 1 - zone.right));
    push({ rule: `Safe zone (${aspect})`, ok: out.length === 0, severity: 'warn', detail: out.length ? `${out.map((o) => o.type).join(', ')} sit inside the platform UI zone.` : 'Key elements stay clear of platform UI.', fix: out.length ? `Keep text, CTA and logo between ${Math.round(zone.top * 100)}% and ${Math.round((1 - zone.bottom) * 100)}% of the height.` : undefined });
  }

  const edges = elements.filter((e) => ['headline', 'subhead', 'cta', 'logo'].includes(e.type) && (e.box.x < 0.03 || e.box.y < 0.03 || e.box.x + e.box.w > 0.97 || e.box.y + e.box.h > 0.97));
  push({ rule: 'Edge margins', ok: edges.length === 0, severity: 'info', detail: edges.length ? `${edges.map((o) => o.type).join(', ')} touch the canvas edge.` : 'Comfortable margins.', fix: edges.length ? `Keep key elements ${Math.round(brand.layout.marginRatio * 100)}% away from the edges.` : undefined });

  const obs: string[] = Array.isArray(v.offBrandObservations) ? v.offBrandObservations : [];
  if (obs.length) push({ rule: 'Reviewer notes', ok: false, severity: 'info', detail: obs.slice(0, 4).join(' · ') });

  const score = Math.max(0, 100 - checks.filter((c) => !c.ok).reduce((s, c) => s + WEIGHTS[c.severity], 0));
  const verdict = score >= 80 ? 'on-brand' : score >= 55 ? 'needs-work' : 'off-brand';
  const failed = checks.filter((c) => !c.ok);
  const remakeBrief = [
    `Recreate this creative on-brand for ${brand.name}. Keep the same message and structure: headline "${headline || v.summary}"${v.subhead ? `, subhead "${v.subhead}"` : ''}${v.cta ? `, CTA "${v.cta}"` : ''}.`,
    `Layout to echo: ${v.layout || 'as in the reference'}.`,
    failed.length ? `Fix these issues: ${failed.map((f) => `${f.rule} — ${f.fix || f.detail}`).join('; ')}.` : 'It is already close; polish it to 100.',
    'Use library assets and the brand fonts; generate a photo only if the original relies on one.',
  ].join('\n');

  return {
    score,
    verdict,
    width: W,
    height: H,
    aspect,
    summary: v.summary || '',
    checks,
    extracted: { headline: v.headline, subhead: v.subhead, cta: v.cta, legal: v.legal, logo, fontsLookLikeBrand: v.fontsLookLikeBrand, fontNotes: v.fontNotes, layout: v.layout || '', elements },
    palette: { detected, coverageOnBrand },
    remakeBrief,
  };
}
