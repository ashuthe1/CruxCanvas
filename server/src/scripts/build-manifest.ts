/**
 * Build brands/<id>/assets.json for an existing brand folder (classify + tag every image).
 *
 *   npm run manifest -- --brand xero [--skip-tagging] [--retag] [--concurrency 6] [--tag-model gpt-4.1-mini] [--dry-run]
 *
 * Incremental: name/description/tags are reused from the previous assets.json (by id) and from
 * brands/<id>/.tagcache.json, so re-runs only tag new files.
 */
import { parseArgs, bool, num, requireStr, str } from './lib/args.js';
import { buildManifest } from './lib/manifest.js';
import { loadVision } from './lib/vision.js';
import { banner, c, dim, fmtMs, ok, progress, swatch, table, warn } from './lib/ui.js';
import { brandPaths, relToRepo } from './lib/paths.js';

const USAGE = `Usage: npm run manifest -- --brand <id> [--skip-tagging] [--retag] [--concurrency 6] [--tag-model <model>] [--dry-run]`;

async function main() {
  const args = parseArgs();
  const id = requireStr(args, 'brand', USAGE);
  const skipTagging = bool(args, 'skipTagging');
  const dryRun = bool(args, 'dryRun');
  const p = brandPaths(id);
  banner(`Build asset manifest · ${id}`, `${relToRepo(p.assetsDir)} → ${relToRepo(p.assetsJson)}${dryRun ? '  [dry-run: nothing is written]' : ''}`);

  const vision = await loadVision({ disabled: skipTagging, tagModel: str(args, 'tagModel') });
  if (!vision && !skipTagging) warn('OPENAI_API_KEY not set — tagging skipped (metadata only)');
  else if (vision) dim(`tagging model: ${vision.tagging.name}`);

  const t0 = Date.now();
  const r = await buildManifest({
    brandId: id,
    vision: vision?.tagging,
    concurrency: num(args, 'concurrency', 6),
    retag: bool(args, 'retag'),
    dryRun,
    onProgress: (done, total, cur) => progress(`${done}/${total} ${c.grey(cur.length > 70 ? '…' + cur.slice(-69) : cur)}`),
  });
  progress(`${r.assets.length} assets processed ${c.grey(`(${fmtMs(Date.now() - t0)})`)}`, true);

  table(
    Object.entries(r.byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, n]) => [cat, n]),
    ['category', 'count'],
  );
  console.log();
  ok(`${r.cached} tag sets reused from cache, ${r.tagged} newly tagged`);
  if (r.guidelines.length) dim(`${r.guidelines.length} guideline slide(s) excluded: ${r.guidelines.map((g) => g.rel).slice(0, 6).join(', ')}${r.guidelines.length > 6 ? ', …' : ''}`);
  if (r.skipped.length) warn(`${r.skipped.length} unreadable file(s): ${r.skipped.map((s) => s.rel).join(', ')}`);
  const logos = r.assets.filter((a) => a.category === 'logo');
  if (logos.length) dim(`logo variants: ${logos.map((a) => `${a.colour} ${swatch(a.dominant)}`).join('  ')}`);
  for (const w of r.warnings) warn(w);
  if (dryRun) dim(`[dry-run] would write ${r.assets.length} assets → ${relToRepo(r.outFile)}`);
  else ok(`wrote ${r.assets.length} assets → ${relToRepo(r.outFile)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
