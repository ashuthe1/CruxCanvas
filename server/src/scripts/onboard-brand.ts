/**
 * One-shot brand onboarding: folder skeleton → download/copy kit → classify + tag assets →
 * draft brand.json (sampled palette + guideline reading) → summary.
 *
 *   npm run onboard -- --brand acme --name "Acme Co" [--drive <folder-url>] [--references <folder-url>]
 *                      [--from <local-dir>] [--skip-download] [--skip-tagging] [--force] [--dry-run]
 *                      [--concurrency 6] [--tag-model gpt-4.1-mini]
 */
import fs from 'fs';
import path from 'path';
import { parseArgs, bool, num, requireStr, str } from './lib/args.js';
import { downloadDriveFolder, gdownAvailable } from './lib/drive.js';
import { buildManifest, type ManifestResult } from './lib/manifest.js';
import { draftBrand, installFonts, type DraftResult } from './lib/draftBrand.js';
import { loadVision } from './lib/vision.js';
import { banner, c, dim, fmtMs, info, ok, progress, resetSteps, step, stepDone, swatch, table, warn } from './lib/ui.js';
import { REPO_ROOT, brandPaths, countFiles, isEmptyDir, relToRepo } from './lib/paths.js';

/** `npm --prefix server` changes cwd to server/, so also try where npm was invoked (INIT_CWD) and the repo root. */
function resolveFrom(dir: string): string | null {
  const bases = [process.cwd(), process.env.INIT_CWD, REPO_ROOT].filter(Boolean) as string[];
  for (const b of bases) {
    const candidate = path.resolve(b, dir);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
  }
  return null;
}

const USAGE = `Usage: npm run onboard -- --brand <id> --name "<Brand Name>" [--drive <folder-url>] [--references <folder-url>] [--from <local-dir>]
                           [--skip-download] [--skip-tagging] [--force] [--dry-run] [--concurrency 6] [--tag-model <model>]`;
const TOTAL = 5;

async function main() {
  const args = parseArgs();
  const id = requireStr(args, 'brand', USAGE).toLowerCase();
  const name = str(args, 'name') || id[0].toUpperCase() + id.slice(1);
  const drive = str(args, 'drive');
  const references = str(args, 'references');
  const from = str(args, 'from');
  const skipDownload = bool(args, 'skipDownload');
  const skipTagging = bool(args, 'skipTagging');
  const force = bool(args, 'force');
  const dryRun = bool(args, 'dryRun');
  const warnings: string[] = [];
  const t0 = Date.now();
  const p = brandPaths(id);

  banner(`Onboarding "${name}" (${id})`, `${relToRepo(p.dir)}${dryRun ? '   [dry-run: nothing will be written]' : ''}`);
  resetSteps();

  // ---------------------------------------------------------------- (a) skeleton
  step(TOTAL, 'Create brand folder');
  const existed = fs.existsSync(p.brandJson);
  for (const d of [p.dir, p.assetsDir, p.referencesDir, p.fontsDir]) {
    if (fs.existsSync(d)) dim(`exists  ${relToRepo(d)}/`);
    else {
      if (!dryRun) fs.mkdirSync(d, { recursive: true });
      info(`${dryRun ? 'would create' : 'created'} ${relToRepo(d)}/`);
    }
  }
  const fontsRes = installFonts(p.fontsDir, { dryRun });
  if (fontsRes.copied.length) info(`${dryRun ? 'would copy' : 'copied'} placeholder fonts: ${fontsRes.copied.join(', ')} ${c.grey('(from brands/_defaults/fonts)')}`);
  if (fontsRes.kept.length) dim(`kept existing fonts: ${fontsRes.kept.join(', ')}`);
  if (fontsRes.copied.length) warnings.push('fonts are Inter-family placeholders — drop the brand\'s licensed .ttf files into fonts/ (same file names)');
  if (existed) (force ? warn : dim)(`brand.json already exists${force ? ' — will be overwritten (--force)' : ' — will be kept (use --force to regenerate)'}`);
  stepDone();

  // ---------------------------------------------------------------- (b) download / copy
  step(TOTAL, 'Fetch brand kit');
  let sourceAssetsDir = p.assetsDir;
  let sourceRefsDir = p.referencesDir;
  if (from) {
    const src = resolveFrom(from);
    if (!src) throw new Error(`--from directory not found: ${from} (tried cwd, the directory npm was run from, and the repo root)`);
    const nested = fs.existsSync(path.join(src, 'assets')) && fs.statSync(path.join(src, 'assets')).isDirectory();
    const srcAssets = nested ? path.join(src, 'assets') : src;
    const srcRefs = nested && fs.existsSync(path.join(src, 'references')) ? path.join(src, 'references') : null;
    if (dryRun) {
      sourceAssetsDir = srcAssets;
      if (srcRefs) sourceRefsDir = srcRefs;
      info(`would copy ${countFiles(srcAssets)} files from ${relToRepo(srcAssets)} → ${relToRepo(p.assetsDir)}/`);
      if (srcRefs) info(`would copy ${countFiles(srcRefs)} references from ${relToRepo(srcRefs)}`);
    } else {
      fs.cpSync(srcAssets, p.assetsDir, { recursive: true, force: false, errorOnExist: false });
      info(`copied ${countFiles(srcAssets)} files from ${relToRepo(srcAssets)} → ${relToRepo(p.assetsDir)}/`);
      if (srcRefs) {
        fs.cpSync(srcRefs, p.referencesDir, { recursive: true, force: false, errorOnExist: false });
        info(`copied ${countFiles(srcRefs)} references`);
      }
    }
  } else if (!skipDownload && (drive || references)) {
    if (dryRun) info(`would download ${drive ? 'brand kit ' : ''}${drive && references ? '+ ' : ''}${references ? 'references ' : ''}from Google Drive`);
    else if (!(await gdownAvailable())) throw new Error('gdown not found — install with `python3 -m pip install --user gdown` or use --from <local-dir>');
    else {
      const jobs = [drive && { label: 'brand kit', url: drive, dir: p.assetsDir }, references && { label: 'references', url: references, dir: p.referencesDir }].filter(Boolean) as { label: string; url: string; dir: string }[];
      for (const job of jobs) {
        if (!isEmptyDir(job.dir)) {
          dim(`${job.label}: ${relToRepo(job.dir)} already has ${countFiles(job.dir)} files — skipping download`);
          continue;
        }
        const r = await downloadDriveFolder(job.url, job.dir, {
          onProgress: (pr) => progress(`${job.label}: pass ${pr.pass}/${pr.maxPasses} · ${pr.files} files${pr.added ? c.green(` (+${pr.added})`) : ''} · ${pr.message || ''}`),
        });
        progress(`${job.label}: ${r.files} files after ${r.passes} pass${r.passes === 1 ? '' : 'es'}`, true);
        if (!r.files) warnings.push(`${job.label}: nothing downloaded from ${job.url}${r.lastError ? ` (${r.lastError})` : ''}`);
        else if (!r.stable) warnings.push(`${job.label}: Drive was still returning new files — re-run \`npm run download -- --brand ${id} --${job.label === 'brand kit' ? 'drive' : 'references'} <url>\``);
      }
    }
  } else {
    dim(skipDownload ? 'download skipped (--skip-download)' : 'no --drive/--from given — using whatever is already in the folder');
  }
  const assetCount = countFiles(sourceAssetsDir);
  if (!assetCount) warnings.push(`no files in ${relToRepo(sourceAssetsDir)} — nothing to classify`);
  stepDone(`${assetCount} files in ${relToRepo(sourceAssetsDir)}, ${countFiles(sourceRefsDir)} references`);

  // ---------------------------------------------------------------- (c) classify + tag
  step(TOTAL, 'Classify + tag assets');
  const vision = await loadVision({ disabled: skipTagging, tagModel: str(args, 'tagModel') });
  if (skipTagging) dim('vision tagging skipped (--skip-tagging): categories from folder names, no descriptions');
  else if (!vision) warn('OPENAI_API_KEY not set — tagging skipped');
  else dim(`tagging with ${vision.tagging.name}, ${num(args, 'concurrency', 6)} workers`);
  const tm = Date.now();
  const manifest: ManifestResult = await buildManifest({
    brandId: id,
    assetsDir: sourceAssetsDir,
    vision: vision?.tagging,
    concurrency: num(args, 'concurrency', 6),
    dryRun,
    onProgress: (done, total, cur) => progress(`${done}/${total} ${c.grey(cur.length > 70 ? '…' + cur.slice(-69) : cur)}`),
  });
  progress(`${manifest.assets.length} assets, ${manifest.guidelines.length} guideline slides set aside ${c.grey(`(${fmtMs(Date.now() - tm)})`)}`, true);
  dim(`${manifest.cached} tag sets from cache, ${manifest.tagged} newly tagged`);
  warnings.push(...manifest.warnings);
  stepDone(dryRun ? `[dry-run] would write ${relToRepo(manifest.outFile)}` : `wrote ${relToRepo(manifest.outFile)}`);

  // ---------------------------------------------------------------- (d) brand.json
  step(TOTAL, 'Draft brand.json');
  let draft: DraftResult | null = null;
  if (existed && !force) {
    dim('kept existing brand.json (pass --force to regenerate)');
  } else {
    draft = await draftBrand({ id, name, assets: manifest.assets, assetsDir: sourceAssetsDir, guidelines: manifest.guidelines, vision: vision?.guidelines, log: dim });
    warnings.push(...draft.warnings);
    if (draft.guidelineFilesUsed.length) dim(`guideline pages ${draft.extracted ? 'read' : 'found (not read — no vision model)'}: ${draft.guidelineFilesUsed.map((f) => path.relative(sourceAssetsDir, f)).join(', ')}`);
    if (!dryRun) fs.writeFileSync(p.brandJson, JSON.stringify(draft.brand, null, 2) + '\n');
    stepDone(`${dryRun ? '[dry-run] would write' : 'wrote'} ${relToRepo(p.brandJson)} (${draft.brand.colors.length} colours, ${Object.keys(draft.brand.logo.assets).length} logo variants, ${draft.brand.rules.length} rules)`);
  }
  if (!draft) stepDone();

  // ---------------------------------------------------------------- (e) summary
  step(TOTAL, 'Summary');
  console.log();
  table(
    Object.entries(manifest.byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, n]) => [cat, n]),
    ['assets by category', 'count'],
  );
  if (manifest.guidelines.length) dim(`+ ${manifest.guidelines.length} guideline slides (not assets)`);
  const brand = draft?.brand ?? (existed ? JSON.parse(fs.readFileSync(p.brandJson, 'utf8')) : null);
  if (brand) {
    console.log();
    table(
      brand.colors.map((col: any) => [swatch(col.hex), col.name, col.role.length > 70 ? col.role.slice(0, 69) + '…' : col.role]),
      ['palette', 'name', 'role'],
    );
    console.log();
    const variants = Object.entries(brand.logo.assets || {});
    table(
      variants.length ? variants.map(([v, aid]) => [v, swatch(brand.logo.variantColors?.[v] || ''), String(aid)]) : [['—', '', 'none found']],
      ['logo variant', 'colour', 'asset id'],
    );
    if (brand.tagline) dim(`tagline: ${brand.tagline}`);
    dim(`voice: ${brand.voice.tone}`);
  }
  if (draft?.sampled.length) dim(`sampled palette: ${draft.sampled.map((s) => swatch(s.hex)).join('  ')}`);
  console.log();
  if (warnings.length) {
    console.log('   ' + c.bold(c.yellow('Review before demo:')));
    for (const w of warnings) warn(w);
  } else ok('nothing flagged for review');
  stepDone();

  console.log(`\n${c.bold('Done')} in ${fmtMs(Date.now() - t0)}${dryRun ? ' (dry-run, nothing written)' : ''}.`);
  console.log('Next:');
  if (dryRun) console.log(`  ${c.cyan(`npm run onboard -- --brand ${id} --name "${name}"${from ? ` --from ${from}` : ''}${drive ? ` --drive ${drive}` : ''}${references ? ` --references ${references}` : ''}`)}   ${c.grey('# run it for real')}`);
  else {
    if (skipTagging || !vision) console.log(`  ${c.cyan(`npm run manifest -- --brand ${id}`)}   ${c.grey('# add vision descriptions/tags')}`);
    console.log(`  ${c.cyan(`npm run dev`)}   ${c.grey(`# then pick "${name}" in the editor's brand switcher`)}`);
    console.log(`  ${c.grey(`edit ${relToRepo(p.brandJson)} to fix anything flagged above`)}`);
  }
  console.log();
}

main().catch((e) => {
  console.error('\n' + c.red('✖ ') + (e?.stack || e));
  process.exit(1);
});
