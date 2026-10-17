/**
 * Download a brand kit (and optional references) from Google Drive folders into brands/<id>/.
 *
 *   npm run download -- --brand xero --drive <folder-url> [--references <folder-url>] [--max-passes 8]
 */
import fs from 'fs';
import { parseArgs, num, requireStr, str } from './lib/args.js';
import { downloadDriveFolder, gdownAvailable, isDriveUrl } from './lib/drive.js';
import { banner, c, fail, fmtMs, ok, progress, warn } from './lib/ui.js';
import { brandPaths, countFiles, relToRepo } from './lib/paths.js';

const USAGE = `Usage: npm run download -- --brand <id> --drive <google-drive-folder-url> [--references <folder-url>] [--max-passes 8]`;

async function main() {
  const args = parseArgs();
  const id = requireStr(args, 'brand', USAGE);
  const drive = str(args, 'drive');
  const refs = str(args, 'references');
  const maxPasses = num(args, 'maxPasses', 8);
  if (!drive && !refs) {
    console.error(USAGE);
    process.exit(2);
  }
  const p = brandPaths(id);
  banner(`Download brand kit · ${id}`, `→ ${relToRepo(p.dir)}`);
  if (!(await gdownAvailable())) {
    fail('gdown not found. Install with: python3 -m pip install --user gdown');
    process.exit(1);
  }
  fs.mkdirSync(p.dir, { recursive: true });
  const jobs: { label: string; url: string; dir: string }[] = [];
  if (drive) jobs.push({ label: 'brand kit', url: drive, dir: p.assetsDir });
  if (refs) jobs.push({ label: 'references', url: refs, dir: p.referencesDir });
  for (const job of jobs) {
    if (!isDriveUrl(job.url)) warn(`${job.label}: "${job.url}" does not look like a Google Drive URL — trying anyway`);
    const t0 = Date.now();
    console.log(`\n${c.bold(job.label)} ← ${c.grey(job.url)}`);
    const before = countFiles(job.dir);
    if (before) warn(`${job.dir} already has ${before} files — gdown will skip ones it already downloaded`);
    const r = await downloadDriveFolder(job.url, job.dir, {
      maxPasses,
      onProgress: (pr) => progress(`pass ${pr.pass}/${pr.maxPasses} · ${pr.files} files${pr.added ? c.green(` (+${pr.added})`) : ''} · ${pr.message || ''}`),
    });
    progress(`${r.files} files after ${r.passes} pass${r.passes === 1 ? '' : 'es'} ${c.grey(`(${fmtMs(Date.now() - t0)})`)}`, true);
    if (r.stable) ok(`${job.label}: file count stable → ${relToRepo(job.dir)}`);
    else warn(`${job.label}: file count was still growing after ${r.passes} passes — re-run to fetch the rest${r.lastError ? ` (last gdown message: ${r.lastError})` : ''}`);
    if (!r.files) fail(`${job.label}: nothing downloaded${r.lastError ? ` — ${r.lastError}` : ''}. Is the folder shared as "anyone with the link"?`);
  }
  console.log(`\nNext: ${c.cyan(`npm run manifest -- --brand ${id}`)}  or  ${c.cyan(`npm run onboard -- --brand ${id} --name "<Brand Name>" --skip-download`)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
