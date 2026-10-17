/**
 * Asset manifest builder (step "classify + tag" of onboarding).
 *  - category from folder/file-name heuristics, vision model as fallback
 *  - guideline slides detected (strong: folder name; weak: file name / slide-like size → vision confirms)
 *  - width/height/alpha via sharp, dominant colour over opaque pixels, nearest named colour
 *  - name/description/tags via the vision model, 6 concurrent workers, incremental via the
 *    previous assets.json (by id) and a .tagcache.json sidecar (also remembers guideline flags)
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import type { IVisionModel } from '../../core/interfaces.js';
import type { Asset } from '../../core/types.js';
import { NAMED_COLOURS, dominantOf, nearestNamed, sampleOpaquePixels } from './colours.js';
import { brandPaths, listImages } from './paths.js';

export const CATEGORIES = ['logo', 'bloom', 'background', 'illustration', 'charm', 'product-ui', 'photo'] as const;
export type Category = (typeof CATEGORIES)[number];

const CATEGORY_RULES: { category: Category; re: RegExp }[] = [
  { category: 'logo', re: /logo|wordmark|brandmark|lockup|monogram/i },
  { category: 'bloom', re: /bloom|shape|blob|swoosh|ribbon|squiggle/i },
  { category: 'background', re: /background|template|pattern|texture|gradient|backdrop/i },
  { category: 'illustration', re: /illustration|illo|spot[-_ ]?art|artwork|graphic|drawing/i },
  { category: 'charm', re: /charm|icon|sticker|emoji|badge|glyph/i },
  { category: 'product-ui', re: /product|(^|[^a-z])ui([^a-z]|$)|screen|device|mockup|dashboard|app[-_ ]?shot/i },
  { category: 'photo', re: /photo|photography|lifestyle|people|imagery|hero[-_ ]?image/i },
];

/** Folders that are clearly guideline material (strong signal: skipped without asking the model). */
const GUIDELINE_DIR_RE = /guideline|guide(s|book)?($|[^a-z])|safe[-_ ]?zone|brand[-_ ]?book|specs?($|[^a-z])|usage|rules|typography|colou?r[-_ ]?(palette|system)|do[-_ ]?s?[-_ ]?(and|&)[-_ ]?don/i;
/** File names that look like exported deck slides (weak signal: the vision model gets the final say). */
const GUIDELINE_FILE_RE = /^\d\d_\d\d_|_intro\b|intro(duction)?[-_.]|guide|overview|examples?[-_.]|blooms_set|cropping_and|patterning|in_photography|do[-_ ]?s?[-_ ]?(and|&)[-_ ]?don|usage|rules|cheat[-_ ]?sheet/i;

export type Classification = { category: Category | null; guideline: 'strong' | 'weak' | null; reason: string };

/** Heuristic classification from the relative path (folders first, then the file name). */
export function classifyPath(rel: string): Classification {
  const parts = rel.split('/');
  const file = parts.pop() || rel;
  const dirs = parts;
  for (const d of dirs) if (GUIDELINE_DIR_RE.test(d)) return { category: null, guideline: 'strong', reason: `folder "${d}" looks like guidelines` };

  let category: Category | null = null;
  let reason = '';
  for (const d of dirs) {
    const hit = CATEGORY_RULES.find((r) => r.re.test(d));
    if (hit) {
      category = hit.category;
      reason = `folder "${d}"`;
      break;
    }
  }
  if (!category) {
    const stem = file.replace(/\.[a-z0-9]+$/i, '');
    const hit = CATEGORY_RULES.find((r) => r.re.test(stem));
    if (hit) {
      category = hit.category;
      reason = `file name`;
    }
  }
  const guideline = GUIDELINE_FILE_RE.test(file) ? 'weak' : null;
  return { category, guideline, reason: reason || 'no folder/file-name match' };
}

export function assetId(rel: string) {
  return rel
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_(png|svg|jpe?g|webp|gif|tiff?|avif)$/i, '')
    .slice(0, 60);
}

export function assetUrl(brandId: string, rel: string) {
  return `/brands/${brandId}/assets/${rel.split('/').map(encodeURIComponent).join('/')}`.replace(/%2F/g, '/');
}

export type TagResult = {
  name?: string;
  description?: string;
  tags?: string[];
  category?: string;
  colour?: string;
  isGuideline?: boolean;
};

const TAG_SYSTEM = `You tag brand design assets for a design copilot. Return strict JSON:
{"name": "short 2-5 word name", "description": "one sentence", "tags": ["4-8 lowercase keywords"],
 "category": one of [${CATEGORIES.map((c) => `"${c}"`).join(', ')}],
 "colour": the single most prominent colour of the artwork, one of [${NAMED_COLOURS.map((c) => `"${c.name}"`).join(', ')}],
 "isGuideline": true only if this is a brand-guideline/presentation slide or a spec sheet (lots of explanatory text, labelled examples, measurements, grids, "do/don't" panels) rather than a reusable design asset}.
Mention colours, subject, shape/orientation (e.g. "top-left", "bottom wave", "horizontal", "vertical", "square") and mood in the tags.
For background templates say where the coloured area sits and the aspect (square/portrait/landscape). For logos say the colour and whether it is a wordmark or symbol.
Categories: logo = the brand's logo/wordmark files; bloom = abstract brand shapes/blobs; background = full-bleed background templates; illustration = flat/3D illustrations; charm = small icons/stickers; product-ui = screenshots or device mockups of the product; photo = photographs.`;

export async function tagImage(vision: IVisionModel, file: string, hint: { category: Category | null; guidelineSuspect: boolean }): Promise<TagResult> {
  const buf = await sharp(file, { density: 96 }).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
  const user = [
    hint.category ? `Folder suggests category: ${hint.category} (override only if clearly wrong).` : 'Category unknown — choose the best fit.',
    hint.guidelineSuspect ? 'The file name / size suggests this may be a guideline slide; decide isGuideline carefully.' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const res = await vision.describeJSON(TAG_SYSTEM, user, [dataUrl], 300);
  return sanitiseTag(res);
}

function sanitiseTag(raw: any): TagResult {
  if (!raw || typeof raw !== 'object') return {};
  const out: TagResult = {};
  if (typeof raw.name === 'string') out.name = raw.name.trim().slice(0, 80);
  if (typeof raw.description === 'string') out.description = raw.description.trim().slice(0, 300);
  if (Array.isArray(raw.tags)) out.tags = raw.tags.filter((t: any) => typeof t === 'string').map((t: string) => t.toLowerCase().trim()).filter(Boolean).slice(0, 10);
  if (typeof raw.category === 'string' && (CATEGORIES as readonly string[]).includes(raw.category)) out.category = raw.category;
  if (typeof raw.colour === 'string') {
    const c = raw.colour.toLowerCase().trim().replace(/\s+/g, '-');
    if (NAMED_COLOURS.some((n) => n.name === c)) out.colour = c;
  }
  if (typeof raw.isGuideline === 'boolean') out.isGuideline = raw.isGuideline;
  return out;
}

export type SkippedFile = { rel: string; reason: string; file: string; width: number; height: number };

export type ManifestOptions = {
  brandId: string;
  /** defaults to brands/<id>/assets */
  assetsDir?: string;
  /** defaults to brands/<id>/assets.json; also used as the incremental cache */
  outFile?: string;
  vision?: IVisionModel | null;
  concurrency?: number;
  /** ignore cached tags and re-tag everything */
  retag?: boolean;
  /** compute everything but write nothing */
  dryRun?: boolean;
  onProgress?: (done: number, total: number, current: string) => void;
  log?: (msg: string) => void;
};

export type ManifestResult = {
  assets: Asset[];
  guidelines: SkippedFile[];
  skipped: SkippedFile[];
  tagged: number;
  cached: number;
  warnings: string[];
  outFile: string;
  byCategory: Record<string, number>;
};

export async function buildManifest(opts: ManifestOptions): Promise<ManifestResult> {
  const p = brandPaths(opts.brandId);
  const assetsDir = opts.assetsDir || p.assetsDir;
  const outFile = opts.outFile || p.assetsJson;
  const tagCacheFile = path.join(path.dirname(outFile), '.tagcache.json');
  const vision = opts.vision || null;
  const concurrency = Math.max(1, opts.concurrency ?? 6);
  const warnings: string[] = [];
  const log = opts.log || (() => {});

  const rels = listImages(assetsDir);
  const prev: Asset[] = !opts.retag && fs.existsSync(outFile) ? safeJson(outFile, []) : [];
  const prevById = new Map(prev.map((a) => [a.id, a]));
  const tagCache: Record<string, TagResult & { file?: string }> = !opts.retag && fs.existsSync(tagCacheFile) ? safeJson(tagCacheFile, {}) : {};

  // id collisions (60-char truncation) are rare but would silently merge assets
  const idSeen = new Map<string, string>();
  const items = rels.map((rel) => {
    let id = assetId(rel);
    if (idSeen.has(id)) {
      let n = 2;
      while (idSeen.has(`${id.slice(0, 57)}_${n}`)) n++;
      const alt = `${id.slice(0, 57)}_${n}`;
      warnings.push(`id collision: "${rel}" and "${idSeen.get(id)}" → using ${alt}`);
      id = alt;
    }
    idSeen.set(id, rel);
    return { rel, id, file: path.join(assetsDir, rel), cls: classifyPath(rel) };
  });

  const assets: Asset[] = [];
  const guidelines: SkippedFile[] = [];
  const skipped: SkippedFile[] = [];
  let tagged = 0, cachedN = 0, done = 0;
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const it = items[next++];
      opts.onProgress?.(done, items.length, it.rel);
      try {
        const meta = await sharp(it.file, { density: 96 }).metadata();
        const width = meta.width || 0, height = meta.height || 0;
        const hasAlpha = !!meta.hasAlpha;

        if (it.cls.guideline === 'strong') {
          guidelines.push({ rel: it.rel, reason: it.cls.reason, file: it.file, width, height });
          continue;
        }
        const slideLike = width >= 2400 && !hasAlpha && width / Math.max(1, height) >= 1.3 && width / Math.max(1, height) <= 2.1;
        const guidelineSuspect = it.cls.guideline === 'weak' || slideLike;

        const cachedAsset = prevById.get(it.id);
        const cachedTag = tagCache[it.id];
        let tag: TagResult | null = null;
        let fromCache = false;
        if (cachedTag && (cachedTag.name || cachedTag.isGuideline !== undefined)) {
          tag = cachedTag;
          fromCache = true;
        } else if (cachedAsset?.description || cachedAsset?.name) {
          tag = { name: cachedAsset.name, description: cachedAsset.description, tags: cachedAsset.tags, category: cachedAsset.category, colour: cachedAsset.colour, isGuideline: false };
          fromCache = true;
        } else if (vision) {
          try {
            tag = await tagImage(vision, it.file, { category: it.cls.category, guidelineSuspect });
            tagged++;
          } catch (e: any) {
            warnings.push(`tagging failed for ${it.rel}: ${e?.message || e}`);
            tag = null;
          }
        }
        if (fromCache) cachedN++;
        if (tag && !opts.dryRun) tagCache[it.id] = { ...tag, file: it.rel };

        // guideline decision: the model has the final say when it answered; otherwise fall back to the weak heuristic
        const isGuideline = tag && tag.isGuideline !== undefined ? tag.isGuideline : it.cls.guideline === 'weak';
        if (isGuideline) {
          guidelines.push({ rel: it.rel, reason: tag?.isGuideline ? 'vision model flagged isGuideline' : it.cls.reason + ' + file name looks like a slide', file: it.file, width, height });
          continue;
        }
        if (!tag && slideLike) warnings.push(`${it.rel} is slide-sized (${width}x${height}) and untagged — check it is not a guideline page`);

        const sample = await sampleOpaquePixels(it.file);
        const dominant = dominantOf(sample.pixels);
        let colour = nearestNamed(dominant).name;
        if (/grey$/.test(colour) && tag?.colour) {
          // multi-colour artwork averages to grey; trust the model there (if it named a known colour)
          const tc = tag.colour.toLowerCase().replace(/\s+/g, '-');
          if (NAMED_COLOURS.some((n) => n.name === tc)) colour = tc;
        }

        let category: string | null = it.cls.category;
        if (!category) {
          category = tag?.category || (hasAlpha ? 'illustration' : 'photo');
          if (!tag?.category) warnings.push(`${it.rel}: no folder hint and no model category → defaulted to "${category}"`);
        }

        assets.push({
          id: it.id,
          category,
          name: tag?.name || prettyName(it.rel),
          file: it.rel,
          url: assetUrl(opts.brandId, it.rel),
          width,
          height,
          hasAlpha,
          dominant,
          description: tag?.description || '',
          tags: tag?.tags || [category, colour],
          colour,
        });
      } catch (e: any) {
        skipped.push({ rel: it.rel, reason: `unreadable: ${e?.message || e}`, file: it.file, width: 0, height: 0 });
      } finally {
        done++;
        opts.onProgress?.(done, items.length, it.rel);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  assets.sort((a, b) => a.file.localeCompare(b.file));
  guidelines.sort((a, b) => a.rel.localeCompare(b.rel));
  if (!vision && tagged === 0 && assets.some((a) => !a.description)) warnings.push(`${assets.filter((a) => !a.description).length} assets have no description/tags (tagging skipped) — run \`npm run manifest -- --brand ${opts.brandId}\``);

  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(assets, null, 2) + '\n');
    fs.writeFileSync(tagCacheFile, JSON.stringify(tagCache, null, 2) + '\n');
    log(`wrote ${assets.length} assets → ${outFile}`);
  }
  const byCategory: Record<string, number> = {};
  for (const a of assets) byCategory[a.category] = (byCategory[a.category] || 0) + 1;
  return { assets, guidelines, skipped, tagged, cached: cachedN, warnings, outFile, byCategory };
}

function prettyName(rel: string) {
  return path
    .basename(rel)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/^\d+[_-]/, '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
    .replace(/[_-]+/g, ' ')
    .trim() || rel;
}

function safeJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
