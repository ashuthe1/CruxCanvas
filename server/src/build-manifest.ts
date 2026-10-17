/**
 * Builds data/assets.json: an LLM-friendly manifest of the brand kit.
 * - dimensions, alpha, dominant colour via sharp
 * - category from folder
 * - short description + tags via a vision model (cached; re-run is incremental)
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { openai, MODELS, withRetry } from './llm.js';

const ROOT = path.resolve(process.cwd(), '..');
const KIT = path.join(ROOT, 'assets', 'brand-kit');
const OUT = path.join(process.cwd(), 'data', 'assets.json');

const FOLDER_CATEGORY: Record<string, { category: string; skipGuides?: boolean }> = {
  '10_Logo': { category: 'logo' },
  '06_Shapes_Cropping_Blooms': { category: 'bloom', skipGuides: true },
  '24_Background_Templates': { category: 'background' },
  '07_Illustration': { category: 'illustration' },
  '22_Charms': { category: 'charm' },
  '11_Product_UI_References': { category: 'product-ui' },
};

const GUIDE_RE = /^0[1-7]_0[1-7]_|^01_01_|_intro|blooms_set|cropping_and_frames|background_templates\.png|patterning|in_photography|examples/;

type Asset = {
  id: string;
  category: string;
  name: string;
  file: string;
  url: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  dominant: string;
  description: string;
  tags: string[];
};

const hex = (c: { r: number; g: number; b: number }) =>
  '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');

async function describe(file: string, category: string): Promise<{ description: string; tags: string[]; name: string }> {
  const buf = await sharp(file, { density: 96 }).resize(512, 512, { fit: 'inside' }).png().toBuffer();
  const res = await withRetry(() =>
    openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You tag brand design assets for a design copilot. Return JSON {"name": short 2-4 word name, "description": one sentence, "tags": 4-8 lowercase keywords}. Mention colours (navy, light blue, blue, white, green, pink, yellow, purple), subject, shape/orientation (e.g. "top-left", "bottom wave", "horizontal", "vertical", "square"), and mood. For background templates say where the blue area sits and the aspect (square/portrait/landscape). For logos say the colour.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Category: ${category}` },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${buf.toString('base64')}` } },
          ],
        },
      ],
    }),
  );
  try {
    return JSON.parse(res.choices[0].message.content || '{}');
  } catch {
    return { name: category, description: '', tags: [category] };
  }
}

async function main() {
  const prev: Asset[] = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
  const prevById = new Map(prev.map((a) => [a.id, a]));
  const items: { file: string; category: string; rel: string }[] = [];
  for (const [folder, cfg] of Object.entries(FOLDER_CATEGORY)) {
    const dir = path.join(KIT, folder);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!/\.(png|jpe?g|svg|webp)$/i.test(f)) continue;
      if (cfg.skipGuides && GUIDE_RE.test(f)) continue;
      items.push({ file: path.join(dir, f), category: cfg.category, rel: `${folder}/${f}` });
    }
  }
  console.log(`Found ${items.length} assets`);
  const out: Asset[] = [];
  let i = 0;
  const workers = Array.from({ length: 6 }, async () => {
    while (i < items.length) {
      const it = items[i++];
      const id = it.rel.replace(/[^a-zA-Z0-9]+/g, '_').replace(/_png$|_svg$|_jpg$|_webp$/i, '').slice(0, 60);
      const meta = await sharp(it.file, { density: 96 }).metadata();
      let dominant = '#000000';
      try {
        const s = await sharp(it.file, { density: 96 }).stats();
        dominant = hex(s.dominant);
      } catch {}
      const cached = prevById.get(id);
      const desc = cached?.description ? { description: cached.description, tags: cached.tags, name: cached.name } : await describe(it.file, it.category);
      out.push({
        id,
        category: it.category,
        name: desc.name || id,
        file: it.rel,
        url: `/assets/brand-kit/${it.rel}`,
        width: meta.width || 0,
        height: meta.height || 0,
        hasAlpha: !!meta.hasAlpha,
        dominant,
        description: desc.description || '',
        tags: desc.tags || [],
      });
      process.stdout.write('.');
    }
  });
  await Promise.all(workers);
  out.sort((a, b) => a.file.localeCompare(b.file));
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${out.length} assets to ${OUT}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
