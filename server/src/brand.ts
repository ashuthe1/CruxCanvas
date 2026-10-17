import fs from 'fs';
import path from 'path';

export type Asset = {
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

const DATA = path.join(process.cwd(), 'data');

export const brand = JSON.parse(fs.readFileSync(path.join(DATA, 'brand.json'), 'utf8'));

let assets: Asset[] = [];
export function loadAssets(): Asset[] {
  const p = path.join(DATA, 'assets.json');
  if (fs.existsSync(p)) {
    try {
      assets = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
  }
  return assets;
}
loadAssets();

export function getAssets() {
  return assets.length ? assets : loadAssets();
}

export function getAsset(id: string) {
  return getAssets().find((a) => a.id === id);
}

export function searchAssets(query: string, category?: string, limit = 12) {
  const q = (query || '').toLowerCase().split(/\W+/).filter(Boolean);
  const scored = getAssets()
    .filter((a) => !category || a.category === category)
    .map((a) => {
      const hay = `${a.name} ${a.description} ${a.tags.join(' ')} ${a.category}`.toLowerCase();
      const score = q.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
      return { a, score };
    })
    .filter((x) => q.length === 0 || x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
  return scored.map((x) => x.a);
}

/** Compact catalogue for the system prompt */
export function catalogueText() {
  const byCat: Record<string, Asset[]> = {};
  for (const a of getAssets()) (byCat[a.category] ||= []).push(a);
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

export const PALETTE: { name: string; hex: string }[] = brand.colors.map((c: any) => ({ name: c.name, hex: c.hex.toUpperCase() }));
export const FONT_FAMILIES = [brand.fonts.headline, brand.fonts.body, brand.fonts.bodyBold];
