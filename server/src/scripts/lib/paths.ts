/** Where brands live on disk. Resolved relative to this file so the scripts work from any cwd. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** repo root = server/src/scripts/lib/../../../.. */
export const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
export const BRANDS_DIR = process.env.BRANDS_DIR ? path.resolve(process.env.BRANDS_DIR) : path.join(REPO_ROOT, 'brands');
export const DEFAULTS_DIR = path.join(BRANDS_DIR, '_defaults');

export function brandDir(id: string) {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error(`invalid brand id "${id}" (use letters, digits, - and _)`);
  return path.join(BRANDS_DIR, id);
}

export function brandPaths(id: string) {
  const dir = brandDir(id);
  return {
    dir,
    assetsDir: path.join(dir, 'assets'),
    referencesDir: path.join(dir, 'references'),
    fontsDir: path.join(dir, 'fonts'),
    brandJson: path.join(dir, 'brand.json'),
    assetsJson: path.join(dir, 'assets.json'),
    tagCache: path.join(dir, '.tagcache.json'),
  };
}

export const IMAGE_RE = /\.(png|jpe?g|webp|svg|gif|tiff?|avif)$/i;

/** Recursively list image files under `dir`, returning paths relative to `dir` (posix separators), sorted. */
export function listImages(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && IMAGE_RE.test(ent.name)) out.push(path.relative(dir, p).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return out.sort((a, b) => a.localeCompare(b));
}

export function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.isDirectory()) walk(path.join(d, ent.name));
      else if (ent.isFile() && !ent.name.startsWith('.')) n++;
    }
  };
  walk(dir);
  return n;
}

export function isEmptyDir(dir: string) {
  return countFiles(dir) === 0;
}

/** Repo-relative display path; falls back to the absolute path for files outside the repo. */
export function relToRepo(p: string) {
  const rel = path.relative(REPO_ROOT, p);
  if (!rel) return '.';
  return rel.startsWith('..') || path.isAbsolute(rel) ? p : rel;
}
