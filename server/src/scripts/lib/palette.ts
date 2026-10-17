/**
 * Palette extraction: frequency histogram over opaque pixels across many assets,
 * each asset weighted equally, bins merged greedily by perceptual distance, and each
 * surviving bin snapped to its most frequent exact colour (so we get the real brand hex,
 * not a bin centroid).
 */
import { distance, luminance, nearestNamed, parseHex, sampleOpaquePixels, saturation, toHex, type RGB } from './colours.js';

export type PaletteEntry = { hex: string; weight: number; name: string; assets: number };

type Bin = { n: number; exact: Map<string, number>; r: number; g: number; b: number; assets: Set<number> };

export type PaletteOptions = {
  maxColours?: number;
  minColours?: number;
  /** merge bins closer than this (weighted RGB distance) */
  mergeDistance?: number;
  /** drop colours that appear in fewer than this share of total weight */
  minShare?: number;
};

export async function extractPalette(files: string[], opts: PaletteOptions = {}): Promise<PaletteEntry[]> {
  const maxColours = opts.maxColours ?? 10;
  const minColours = opts.minColours ?? 6;
  const mergeDistance = opts.mergeDistance ?? 70;
  const minShare = opts.minShare ?? 0.01;

  const bins = new Map<number, Bin>();
  let assetIdx = 0;
  for (const file of files) {
    let sample;
    try {
      sample = await sampleOpaquePixels(file, 80);
    } catch {
      continue;
    }
    if (!sample.pixels.length) continue;
    const w = 1 / sample.pixels.length; // each asset contributes weight 1 in total
    for (const [r, g, b] of sample.pixels) {
      // 5 bits per channel
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const hex = toHex([r, g, b]);
      let bin = bins.get(key);
      if (!bin) {
        bin = { n: 0, exact: new Map(), r: 0, g: 0, b: 0, assets: new Set() };
        bins.set(key, bin);
      }
      bin.n += w;
      bin.r += r * w;
      bin.g += g * w;
      bin.b += b * w;
      bin.exact.set(hex, (bin.exact.get(hex) || 0) + w);
      bin.assets.add(assetIdx);
    }
    assetIdx++;
  }
  if (!bins.size) return [];

  // greedy merge: heaviest bins absorb lighter neighbours within mergeDistance
  const sorted = [...bins.values()].sort((a, b) => b.n - a.n);
  const merged: Bin[] = [];
  for (const bin of sorted) {
    const c: RGB = [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n];
    const host = merged.find((m) => distance([m.r / m.n, m.g / m.n, m.b / m.n], c) < mergeDistance);
    if (host) {
      host.n += bin.n;
      host.r += bin.r;
      host.g += bin.g;
      host.b += bin.b;
      for (const [h, w] of bin.exact) host.exact.set(h, (host.exact.get(h) || 0) + w);
      for (const a of bin.assets) host.assets.add(a);
    } else merged.push(bin);
  }

  const totalW = merged.reduce((s, m) => s + m.n, 0);
  const out: PaletteEntry[] = merged.map((m) => {
    let bestHex = '#000000', bestW = -1;
    for (const [h, w] of m.exact) if (w > bestW) (bestW = w), (bestHex = h);
    return { hex: bestHex, weight: m.n / totalW, name: nearestNamed(bestHex).name, assets: m.assets.size };
  });
  out.sort((a, b) => b.weight - a.weight);

  const kept = out.filter((e, i) => i < minColours || e.weight >= minShare).slice(0, maxColours);
  // de-duplicate names: navy, navy-2 ...
  const seen = new Map<string, number>();
  for (const e of kept) {
    const n = (seen.get(e.name) || 0) + 1;
    seen.set(e.name, n);
    if (n > 1) e.name = `${e.name}-${n}`;
  }
  return kept;
}

/** Pick role colours out of a palette (used to fill layout defaults). */
export function pickRoles(colours: { hex: string; role?: string; name?: string }[]) {
  const withRgb = colours.map((c) => ({ ...c, rgb: parseHex(c.hex)! })).filter((c) => c.rgb);
  const byRole = (re: RegExp) => withRgb.find((c) => re.test(`${c.role || ''} ${c.name || ''}`));
  const dark = withRgb.filter((c) => luminance(c.rgb) < 0.12).sort((a, b) => saturation(b.rgb) - saturation(a.rgb));
  const light = withRgb.filter((c) => luminance(c.rgb) > 0.8).sort((a, b) => luminance(b.rgb) - luminance(a.rgb));
  const mids = withRgb.filter((c) => luminance(c.rgb) >= 0.12 && luminance(c.rgb) <= 0.8).sort((a, b) => saturation(b.rgb) - saturation(a.rgb));

  const primary = byRole(/primary/i) || dark[0] || mids[0] || withRgb[0];
  const secondary = byRole(/secondary/i) || mids.find((c) => c.hex !== primary?.hex) || mids[0] || primary;
  const accent = byRole(/accent/i) || mids.find((c) => c.hex !== primary?.hex && c.hex !== secondary?.hex) || secondary;
  const lightC = light[0] || { hex: '#FFFFFF', rgb: [255, 255, 255] as RGB };
  const darkC = dark[0] || primary;
  return {
    primary: primary?.hex || '#111111',
    secondary: secondary?.hex || '#3B82F6',
    accent: accent?.hex || '#F59E0B',
    light: lightC.hex,
    dark: darkC?.hex || '#111111',
  };
}
