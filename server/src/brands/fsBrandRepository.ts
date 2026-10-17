/**
 * Brands live on disk: brands/<id>/{brand.json, assets.json, assets/**, references/**, fonts/**}
 * Swap this for a DB-backed repository without touching the agent.
 */
import fs from 'fs';
import path from 'path';
import type { IBrandRepository } from '../core/interfaces.js';
import type { Asset, BrandKit } from '../core/types.js';

export class FsBrandRepository implements IBrandRepository {
  private cache = new Map<string, { brand: BrandKit; assets: Asset[]; mtime: number }>();

  constructor(public readonly root: string) {}

  private dir(id: string) {
    if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error('invalid brand id');
    return path.join(this.root, id);
  }

  async list() {
    if (!fs.existsSync(this.root)) return [];
    return fs
      .readdirSync(this.root)
      .filter((d) => !d.startsWith('_') && fs.existsSync(path.join(this.root, d, 'brand.json')))
      .map((d) => {
        const b = JSON.parse(fs.readFileSync(path.join(this.root, d, 'brand.json'), 'utf8'));
        return { id: d, name: b.name || d, tagline: b.tagline };
      });
  }

  private load(id: string) {
    const dir = this.dir(id);
    const bp = path.join(dir, 'brand.json');
    if (!fs.existsSync(bp)) throw Object.assign(new Error(`Unknown brand "${id}"`), { status: 404 });
    const mtime = Math.max(fs.statSync(bp).mtimeMs, fs.existsSync(path.join(dir, 'assets.json')) ? fs.statSync(path.join(dir, 'assets.json')).mtimeMs : 0);
    const hit = this.cache.get(id);
    if (hit && hit.mtime === mtime) return hit;
    const brand: BrandKit = { ...JSON.parse(fs.readFileSync(bp, 'utf8')), id };
    const ap = path.join(dir, 'assets.json');
    const assets: Asset[] = fs.existsSync(ap) ? JSON.parse(fs.readFileSync(ap, 'utf8')) : [];
    const entry = { brand, assets, mtime };
    this.cache.set(id, entry);
    return entry;
  }

  async get(id: string) {
    return this.load(id).brand;
  }
  async assets(id: string) {
    return this.load(id).assets;
  }
  async references(id: string) {
    const dir = path.join(this.dir(id), 'references');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .sort()
      .map((f) => ({ name: f, url: `/brands/${id}/references/${f}` }));
  }
  resolve(id: string, relPath: string) {
    return path.join(this.dir(id), relPath);
  }
}
