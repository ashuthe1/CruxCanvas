/**
 * npm run vectorize -- --brand xero [--max-width 800] [--force]
 * Traces every bitmap logo asset into an SVG and records it as `vectorUrl` on the asset so the
 * renderer and the editor use crisp vectors at any size.
 */
import fs from 'fs';
import path from 'path';
import { vectorizeLogo } from './lib/vectorize.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]] : [])).filter((x) => x.length));
const brand = args.brand;
if (!brand) {
  console.error('usage: npm run vectorize -- --brand <id> [--max-width 800] [--force]');
  process.exit(1);
}
const maxWidth = Number(args['max-width'] || 800);
const root = path.resolve(process.cwd(), '..', 'brands', brand);
const manifestPath = path.join(root, 'assets.json');
const assets = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

let done = 0, skipped = 0;
for (const a of assets) {
  if (a.category !== 'logo' || !/\.(png|jpe?g|webp)$/i.test(a.file)) continue;
  if (a.width > maxWidth && args.force !== 'true') {
    skipped++;
    continue;
  }
  const png = path.join(root, 'assets', a.file);
  try {
    const r = await vectorizeLogo(png);
    a.vectorUrl = `/brands/${brand}/assets/${a.file.replace(/\.(png|jpe?g|webp)$/i, '.svg')}`;
    a.vectorColours = r.colours;
    console.log(`✔ ${a.file} → ${path.basename(r.svgPath)} (${r.colours.join(', ')})`);
    done++;
  } catch (e: any) {
    console.warn(`✖ ${a.file}: ${e.message}`);
  }
}
fs.writeFileSync(manifestPath, JSON.stringify(assets, null, 2));
console.log(`\n${done} logo(s) vectorised, ${skipped} skipped (already ≥ ${maxWidth}px). Manifest updated.`);
