/**
 * Drafts brand.json for a newly onboarded brand:
 *  - palette sampled from the assets (logos / blooms / backgrounds) + palette/rules read from
 *    guideline slides by the vision model, merged
 *  - layout / safeZones / imageStyles / fonts copied from brands/_defaults/brand.defaults.json
 *    with {brand}/{primary}/... placeholders filled from the palette
 *  - logo variants picked from logo-category assets and named by their colour
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import type { IVisionModel } from '../../core/interfaces.js';
import type { Asset, BrandColor, BrandKit } from '../../core/types.js';
import { distance, luminance, nearestNamed, normaliseHex, parseHex } from './colours.js';
import { extractPalette, pickRoles, type PaletteEntry } from './palette.js';
import { DEFAULTS_DIR } from './paths.js';
import type { SkippedFile } from './manifest.js';

export type GuidelineExtract = {
  tagline?: string;
  palette?: { name: string; hex: string; role: string }[];
  logo?: { minWidthRatio?: number; clearSpace?: string; placement?: string; colourways?: Record<string, string>; variants?: string[]; notes?: string };
  typography?: { headline?: string; body?: string; notes?: string };
  voice?: { tone?: string; headlinePatterns?: string[]; avoid?: string[] };
  imagery?: Record<string, string>;
  rules?: string[];
  dos?: string[];
  donts?: string[];
  summary?: string;
};

export function loadDefaults(): any {
  const file = path.join(DEFAULTS_DIR, 'brand.defaults.json');
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete d._comment;
  return d;
}

/** Copy the placeholder fonts into brands/<id>/fonts (never overwrites existing files). */
export function installFonts(fontsDir: string, opts: { dryRun?: boolean } = {}): { copied: string[]; kept: string[] } {
  const src = path.join(DEFAULTS_DIR, 'fonts');
  const copied: string[] = [], kept: string[] = [];
  for (const f of ['headline.ttf', 'body.ttf', 'bodybold.ttf']) {
    const dst = path.join(fontsDir, f);
    if (fs.existsSync(dst)) {
      kept.push(f);
      continue;
    }
    if (!fs.existsSync(path.join(src, f))) continue;
    if (!opts.dryRun) {
      fs.mkdirSync(fontsDir, { recursive: true });
      fs.copyFileSync(path.join(src, f), dst);
    }
    copied.push(f);
  }
  return { copied, kept };
}

const GUIDE_SYSTEM = `You are a brand-guidelines analyst. You will be shown up to 6 pages from a brand's guideline deck.
Extract what a design system needs, as strict JSON with exactly these keys (omit a key only if nothing is visible for it):
{
 "tagline": "brand tagline if shown",
 "palette": [{"name": "colour name as the brand calls it", "hex": "#RRGGBB", "role": "primary/secondary/accent/neutral + what it is used for"}],
 "logo": {"minWidthRatio": number fraction of canvas width if a minimum size is stated (else omit), "clearSpace": "clear-space rule", "placement": "placement rule", "colourways": {"on-light": "which logo variant", "on-dark": "...", "on-photo-or-busy": "..."}, "variants": ["list of logo colour variants shown"], "notes": "restrictions (no stretching, no recolouring, pill/holding shape rules...)"},
 "typography": {"headline": "typeface + weight + case", "body": "typeface + weight", "notes": "line-height, tracking, hierarchy"},
 "voice": {"tone": "one or two sentences", "headlinePatterns": ["pattern: 'example'"], "avoid": ["things to avoid"]},
 "imagery": {"shapes": "...", "illustrations": "...", "photos": "...", "icons": "..."},
 "rules": ["concise imperative do-rules"],
 "donts": ["concise don't-rules"]
}
Read hex values exactly as printed; if only RGB/CMYK is printed, convert RGB to hex. Do not invent colours that are not shown. Keep every string short.`;

export async function readGuidelines(vision: IVisionModel, files: string[], brandName: string): Promise<GuidelineExtract | null> {
  const images: string[] = [];
  for (const f of files.slice(0, 6)) {
    try {
      const buf = await sharp(f, { density: 96 }).resize(1536, 1536, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      images.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
    } catch {
      /* skip unreadable */
    }
  }
  if (!images.length) return null;
  const res = await vision.describeJSON(GUIDE_SYSTEM, `Brand: ${brandName}. ${images.length} guideline page(s) attached.`, images, 2500);
  return sanitiseExtract(res);
}

/** Models answer "not specified" / "N/A" instead of omitting keys; treat those as absent. */
const PLACEHOLDER_RE = /^(not? ?(specified|shown|visible|stated|applicable|available|provided)|n\/?a|none|unknown|unspecified|-+|null|undefined)\.?$/i;
const clean = (v: any): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s && !PLACEHOLDER_RE.test(s) ? s : undefined;
};

function sanitiseExtract(raw: any): GuidelineExtract | null {
  if (!raw || typeof raw !== 'object') return null;
  // normalise every string field up front so the rest of the parser only sees real values
  const scrub = (v: any): any => {
    if (typeof v === 'string') return clean(v);
    if (Array.isArray(v)) return v.map(scrub).filter((x) => x !== undefined);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]).filter(([, x]) => x !== undefined));
    return v;
  };
  raw = scrub(raw);
  const out: GuidelineExtract = {};
  const strs = (v: any) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : undefined);
  if (typeof raw.tagline === 'string' && raw.tagline.trim()) out.tagline = raw.tagline.trim();
  if (Array.isArray(raw.palette)) {
    out.palette = raw.palette
      .map((c: any) => ({ name: String(c?.name || '').trim(), hex: normaliseHex(String(c?.hex || '')), role: String(c?.role || '').trim() }))
      .filter((c: any) => c.hex)
      .map((c: any) => ({ name: c.name || nearestNamed(c.hex).name, hex: c.hex, role: c.role || 'from guidelines' }));
  }
  if (raw.logo && typeof raw.logo === 'object') {
    const l = raw.logo;
    out.logo = {};
    if (typeof l.minWidthRatio === 'number' && l.minWidthRatio > 0.03 && l.minWidthRatio < 0.6) out.logo.minWidthRatio = l.minWidthRatio;
    if (typeof l.clearSpace === 'string') out.logo.clearSpace = l.clearSpace.trim();
    if (typeof l.placement === 'string') out.logo.placement = l.placement.trim();
    if (typeof l.notes === 'string') out.logo.notes = l.notes.trim();
    if (l.colourways && typeof l.colourways === 'object') out.logo.colourways = Object.fromEntries(Object.entries(l.colourways).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, String(v).trim()]));
    out.logo.variants = strs(l.variants);
  }
  if (raw.typography && typeof raw.typography === 'object') out.typography = { headline: raw.typography.headline, body: raw.typography.body, notes: raw.typography.notes };
  if (raw.voice && typeof raw.voice === 'object') out.voice = { tone: typeof raw.voice.tone === 'string' ? raw.voice.tone : undefined, headlinePatterns: strs(raw.voice.headlinePatterns), avoid: strs(raw.voice.avoid) };
  if (raw.imagery && typeof raw.imagery === 'object') out.imagery = Object.fromEntries(Object.entries(raw.imagery).filter(([, v]) => typeof v === 'string' && (v as string).trim()).map(([k, v]) => [k, (v as string).trim()]));
  out.rules = strs(raw.rules);
  out.dos = strs(raw.dos);
  out.donts = strs(raw.donts);
  if (typeof raw.summary === 'string') out.summary = raw.summary;
  return out;
}

// ---------- merging ----------

export type DraftInput = {
  id: string;
  name: string;
  assets: Asset[];
  /** absolute dir the asset `file`s are relative to */
  assetsDir: string;
  guidelines: SkippedFile[];
  vision?: IVisionModel | null;
  log?: (msg: string) => void;
};

export type DraftResult = {
  brand: BrandKit;
  sampled: PaletteEntry[];
  extracted: GuidelineExtract | null;
  guidelineFilesUsed: string[];
  warnings: string[];
};

export async function draftBrand(input: DraftInput): Promise<DraftResult> {
  const warnings: string[] = [];
  const log = input.log || (() => {});
  const defaults = loadDefaults();

  // 1. sample palette from the assets
  const paletteSources = input.assets.filter((a) => ['logo', 'bloom', 'background', 'charm'].includes(a.category));
  const sources = (paletteSources.length ? paletteSources : input.assets).slice(0, 60).map((a) => path.join(input.assetsDir, a.file));
  const sampled = await extractPalette(sources, { minColours: 6, maxColours: 10 });
  log(`sampled ${sampled.length} colours from ${sources.length} assets`);

  // 2. read guideline slides
  let extracted: GuidelineExtract | null = null;
  const guidelineFilesUsed = pickGuidelineFiles(input.guidelines).slice(0, 6);
  if (input.vision && guidelineFilesUsed.length) {
    try {
      extracted = await readGuidelines(input.vision, guidelineFilesUsed, input.name);
      log(`vision read ${guidelineFilesUsed.length} guideline page(s)`);
    } catch (e: any) {
      warnings.push(`guideline reading failed: ${e?.message || e}`);
    }
  } else if (!guidelineFilesUsed.length) warnings.push('no guideline slides found — palette/voice/rules are sampled + defaults, review them');
  else warnings.push('vision model unavailable — guideline slides were not read');

  // 3. merge palette
  const colors = mergePalette(extracted?.palette || [], sampled, warnings);
  const roles = pickRoles(colors);

  // 4. logo
  const logoAssets = input.assets.filter((a) => a.category === 'logo');
  const logo = buildLogo(logoAssets, colors, defaults.logo, extracted?.logo, warnings);

  // 5. placeholders
  const vars: Record<string, string> = {
    brand: input.name,
    Brand: fontFamilyBase(input.name),
    primary: roles.primary,
    secondary: roles.secondary,
    accent: roles.accent,
    light: roles.light,
    dark: roles.dark,
  };
  const fill = <T>(v: T): T => fillTemplate(v, vars);

  const fonts = fill(defaults.fonts);
  if (extracted?.typography && (extracted.typography.headline || extracted.typography.body)) {
    fonts.notes = `Guidelines: headline = ${extracted.typography.headline || '?'}; body = ${extracted.typography.body || '?'}${extracted.typography.notes ? '; ' + extracted.typography.notes : ''}. ${fonts.notes}`;
  }

  const voice = {
    tone: extracted?.voice?.tone || fill(defaults.voice.tone),
    headlinePatterns: extracted?.voice?.headlinePatterns?.length ? extracted.voice.headlinePatterns : fill(defaults.voice.headlinePatterns),
    avoid: uniq([...(extracted?.voice?.avoid || []), ...(defaults.voice.avoid || [])]),
  };

  const rules = uniq([
    ...(extracted?.rules || []),
    ...(extracted?.dos || []),
    ...(extracted?.donts || []).map((d) => (/^(don'?t|never|avoid|do not)/i.test(d) ? d : `Don't ${lcFirst(d)}`)),
    ...fill(defaults.rules as string[]),
  ]).slice(0, 18);

  const imagery = { ...fill(defaults.imagery || {}), ...(extracted?.imagery || {}) };

  const brand: BrandKit = {
    id: input.id,
    name: input.name,
    tagline: extracted?.tagline || undefined,
    colors,
    fonts,
    logo,
    layout: fill(defaults.layout),
    safeZones: fill(defaults.safeZones),
    voice,
    imagery,
    rules,
    imageStyles: fill(defaults.imageStyles),
  };
  if (!brand.tagline) delete brand.tagline;
  return { brand, sampled, extracted, guidelineFilesUsed, warnings };
}

function pickGuidelineFiles(guidelines: SkippedFile[]): string[] {
  // prefer pages about logo / colour / typography / tone, then the rest, largest first
  const score = (g: SkippedFile) => {
    const s = g.rel.toLowerCase();
    let n = 0;
    if (/colou?r|palette/.test(s)) n += 5;
    if (/logo|wordmark/.test(s)) n += 4;
    if (/typ(e|o)|font/.test(s)) n += 4;
    if (/tone|voice|writing/.test(s)) n += 3;
    if (/intro|overview|primary|principles/.test(s)) n += 2;
    if (/safe[-_ ]?zone|meta/.test(s)) n -= 2;
    return n;
  };
  return [...guidelines].sort((a, b) => score(b) - score(a) || b.width * b.height - a.width * a.height).map((g) => g.file);
}

export function mergePalette(fromGuidelines: { name: string; hex: string; role: string }[], sampled: PaletteEntry[], warnings: string[]): BrandColor[] {
  const out: BrandColor[] = [];
  const has = (hex: string, d = 28) => out.some((c) => distance(parseHex(c.hex)!, parseHex(hex)!) < d);
  for (const c of fromGuidelines) {
    if (out.length >= 10 || has(c.hex)) continue;
    out.push({ name: titleCase(c.name), hex: c.hex, role: c.role });
  }
  const guidelineCount = out.length;
  for (const s of sampled) {
    if (out.length >= 10) break;
    if (has(s.hex, 60)) continue;
    out.push({ name: titleCase(s.name.replace(/-\d+$/, '')), hex: s.hex, role: `sampled from ${s.assets} asset${s.assets === 1 ? '' : 's'} (${Math.round(s.weight * 100)}% of sampled pixels) — review` });
  }
  if (!out.some((c) => luminance(parseHex(c.hex)!) > 0.85)) out.push({ name: 'White', hex: '#FFFFFF', role: 'content cards, text on dark backgrounds' });
  if (out.length < 6) warnings.push(`only ${out.length} palette colours found — add the rest by hand`);
  if (!guidelineCount) warnings.push('palette is sampled from assets only (no guideline palette) — verify hex values and roles');
  // de-duplicate names
  const seen = new Map<string, number>();
  for (const c of out) {
    const n = (seen.get(c.name) || 0) + 1;
    seen.set(c.name, n);
    if (n > 1) c.name = `${c.name} ${n}`;
  }
  return out;
}

function buildLogo(logoAssets: Asset[], colors: BrandColor[], defaults: any, extracted: GuidelineExtract['logo'] | undefined, warnings: string[]): BrandKit['logo'] {
  const assets: Record<string, string> = {};
  const variantColors: Record<string, string> = {};
  const used = new Map<string, number>();
  for (const a of logoAssets) {
    const base = a.colour || nearestNamed(a.dominant).name;
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    const variant = n === 1 ? base : `${base}-${n}`;
    assets[variant] = a.id;
    const rgb = parseHex(a.dominant);
    const snap = rgb ? colors.map((c) => ({ c, d: distance(rgb, parseHex(c.hex)!) })).sort((x, y) => x.d - y.d)[0] : null;
    variantColors[variant] = snap && snap.d < 60 ? snap.c.hex : a.dominant;
  }
  if (!logoAssets.length) warnings.push('no logo assets found — put the logo files in a folder named "Logo" and re-run, then fill logo.assets');
  else if (logoAssets.length === 1) warnings.push('only one logo variant found — the planner needs light + dark variants for contrast');

  const byLum = Object.entries(variantColors).map(([v, hex]) => ({ v, lum: luminance(parseHex(hex)!) })).sort((a, b) => a.lum - b.lum);
  const darkest = byLum[0]?.v, lightest = byLum[byLum.length - 1]?.v;
  const lightVariants = byLum.filter((x) => x.lum > 0.3).map((x) => x.v);
  const colourways: Record<string, string> = {
    'on-light': darkest || 'dark',
    'on-dark': lightVariants.length ? lightVariants.join(' or ') : lightest || 'light',
    'on-photo-or-busy': `use the pill: light pill with ${darkest || 'dark'} logo, or dark pill with ${lightest || 'light'} logo`,
    ...(extracted?.colourways || {}),
  };
  const first = logoAssets[0];
  const out: BrandKit['logo'] = {
    assets,
    colourways,
    aspectRatio: first && first.height ? Math.round((first.width / first.height) * 100) / 100 : undefined,
    minWidthRatio: extracted?.minWidthRatio ?? defaults.minWidthRatio,
    preferredWidthRatio: Math.max(defaults.preferredWidthRatio, (extracted?.minWidthRatio ?? defaults.minWidthRatio) * 1.4),
    clearSpace: [extracted?.clearSpace || defaults.clearSpace, extracted?.notes].filter(Boolean).join(' '),
    placement: extracted?.placement || defaults.placement,
    variantColors,
  };
  if (out.aspectRatio === undefined) delete out.aspectRatio;
  return out;
}

// ---------- small utils ----------

export function fontFamilyBase(name: string) {
  const words = name.replace(/[^a-zA-Z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const base = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return base || 'Brand';
}

function fillTemplate<T>(v: T, vars: Record<string, string>): T {
  if (typeof v === 'string') return v.replace(/\{(brand|Brand|primary|secondary|accent|light|dark)\}/g, (_, k) => vars[k] ?? `{${k}}`) as any;
  if (Array.isArray(v)) return v.map((x) => fillTemplate(x, vars)) as any;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as any).map(([k, x]) => [k, fillTemplate(x, vars)])) as any;
  return v;
}

function titleCase(s: string) {
  return s
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
function lcFirst(s: string) {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}
function uniq(list: string[]) {
  const seen = new Set<string>();
  return list.filter((s) => {
    const k = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
