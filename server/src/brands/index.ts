import path from 'path';
import { FsBrandRepository } from './fsBrandRepository.js';
import type { IBrandRepository } from '../core/interfaces.js';

export const BRANDS_DIR = process.env.BRANDS_DIR || path.resolve(process.cwd(), '..', 'brands');

let repo: IBrandRepository | null = null;
export function brandRepository(): IBrandRepository {
  return (repo ||= new FsBrandRepository(BRANDS_DIR));
}

/** Compact asset catalogue text for prompts */
export function catalogueText(assets: { id: string; category: string; name: string; width: number; height: number; hasAlpha: boolean; tags: string[] }[]) {
  const byCat: Record<string, typeof assets> = {};
  for (const a of assets) (byCat[a.category] ||= []).push(a);
  const lines: string[] = [];
  for (const [cat, list] of Object.entries(byCat)) {
    lines.push(`## ${cat} (${list.length})`);
    for (const a of list) {
      const aspect = a.width && a.height ? (a.width / a.height).toFixed(2) : '?';
      lines.push(`- ${a.id} | ${a.name} | ${a.width}x${a.height} ar=${aspect}${a.hasAlpha ? ' alpha' : ''} | ${a.tags.join(', ')}`);
    }
  }
  return lines.join('\n');
}

export function searchAssets(assets: any[], query: string, category?: string, limit = 12) {
  const q = (query || '').toLowerCase().split(/\W+/).filter(Boolean);
  return assets
    .filter((a) => !category || a.category === category)
    .map((a) => {
      const hay = `${a.name} ${a.description} ${a.tags.join(' ')} ${a.category} ${a.colour || ''}`.toLowerCase();
      return { a, score: q.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0) };
    })
    .filter((x) => q.length === 0 || x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((x) => x.a);
}
