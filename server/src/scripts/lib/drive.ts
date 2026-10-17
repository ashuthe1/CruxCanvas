/**
 * Google Drive folder download via `python3 -m gdown`. Drive rate-limits folder
 * downloads, so we run several passes (`--remaining-ok --continue`) until the file
 * count stops growing.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import { countFiles } from './paths.js';

export type DriveProgress = { pass: number; maxPasses: number; files: number; added: number; message?: string };

export type DriveOptions = {
  maxPasses?: number;
  /** consecutive passes with no new files before we call it stable */
  stablePasses?: number;
  pauseMs?: number;
  python?: string;
  onProgress?: (p: DriveProgress) => void;
};

export function isDriveUrl(s: string | undefined): s is string {
  return !!s && /drive\.google\.com/.test(s);
}

export async function gdownAvailable(python = process.env.PYTHON || 'python3'): Promise<boolean> {
  const r = await run(python, ['-m', 'gdown', '--version']);
  return r.code === 0;
}

export async function downloadDriveFolder(url: string, dir: string, opts: DriveOptions = {}): Promise<{ files: number; passes: number; stable: boolean; lastError?: string }> {
  const maxPasses = opts.maxPasses ?? 8;
  const stablePasses = opts.stablePasses ?? 2;
  const pauseMs = opts.pauseMs ?? 4000;
  const python = opts.python || process.env.PYTHON || 'python3';
  fs.mkdirSync(dir, { recursive: true });

  let before = countFiles(dir);
  let unchanged = 0;
  let lastError: string | undefined;
  let pass = 0;
  for (pass = 1; pass <= maxPasses; pass++) {
    opts.onProgress?.({ pass, maxPasses, files: before, added: 0, message: 'downloading…' });
    const r = await run(python, ['-m', 'gdown', '--folder', '--remaining-ok', '--continue', '-q', url, '-O', dir]);
    if (r.code !== 0) lastError = (r.stderr || r.stdout).trim().split('\n').filter((l) => !/Warning|warnings\.warn/.test(l)).slice(-2).join(' ');
    const after = countFiles(dir);
    const added = after - before;
    opts.onProgress?.({ pass, maxPasses, files: after, added, message: r.code === 0 ? 'ok' : 'gdown exited non-zero (rate limit?)' });
    before = after;
    unchanged = added > 0 ? 0 : unchanged + 1;
    if (unchanged >= stablePasses && after > 0) return { files: after, passes: pass, stable: true, lastError };
    if (pass < maxPasses) await new Promise((res) => setTimeout(res, pauseMs));
  }
  return { files: before, passes: pass - 1, stable: unchanged >= stablePasses, lastError };
}

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '', stderr = '';
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e: any) {
      return resolve({ code: 127, stdout: '', stderr: String(e?.message || e) });
    }
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => resolve({ code: 127, stdout, stderr: stderr + String(e.message) }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
