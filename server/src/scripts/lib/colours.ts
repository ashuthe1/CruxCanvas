/**
 * Colour helpers for onboarding: named-colour mapping, opaque-pixel sampling and
 * dominant colour (computed over opaque pixels only, unlike sharp's stats()).
 */
import sharp from 'sharp';

export type RGB = [number, number, number];

/** Small named colour list used for asset `colour` and logo variant names. */
export const NAMED_COLOURS: { name: string; hex: string }[] = [
  { name: 'white', hex: '#FFFFFF' },
  { name: 'off-white', hex: '#F2F1ED' },
  { name: 'light-grey', hex: '#C8CCD2' },
  { name: 'grey', hex: '#808890' },
  { name: 'dark-grey', hex: '#3A3F47' },
  { name: 'black', hex: '#111111' },
  { name: 'navy', hex: '#0A1060' },
  { name: 'dark-blue', hex: '#153E8C' },
  { name: 'blue', hex: '#1868D8' },
  { name: 'light-blue', hex: '#3ECCFE' },
  { name: 'pale-blue', hex: '#BFE9FF' },
  { name: 'teal', hex: '#13A4A8' },
  { name: 'mint', hex: '#51D9A5' },
  { name: 'green', hex: '#2EAA4F' },
  { name: 'dark-green', hex: '#146B3A' },
  { name: 'lime', hex: '#B5E24A' },
  { name: 'yellow', hex: '#FFC83D' },
  { name: 'orange', hex: '#FF7A1A' },
  { name: 'red', hex: '#E0312E' },
  { name: 'pink', hex: '#F26D8E' },
  { name: 'magenta', hex: '#D62E9A' },
  { name: 'purple', hex: '#9D7BF6' },
  { name: 'dark-purple', hex: '#4B2A8A' },
  { name: 'brown', hex: '#8A5A2B' },
  { name: 'beige', hex: '#E7D5B8' },
];

export function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    const s = /^#?([0-9a-f]{3})$/i.exec(hex.trim());
    if (!s) return null;
    const [r, g, b] = s[1].split('').map((ch) => parseInt(ch + ch, 16));
    return [r, g, b];
  }
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function toHex([r, g, b]: RGB) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function normaliseHex(hex: string): string | null {
  const rgb = parseHex(hex);
  return rgb ? toHex(rgb) : null;
}

/** Weighted RGB distance (~0..765), good enough for nearest-colour lookups. */
export function distance(a: RGB, b: RGB) {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

function lin(v: number) {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
export function luminance([r, g, b]: RGB) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/** HSL saturation 0..1 */
export function saturation([r, g, b]: RGB) {
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

export function nearestNamed(hex: string): { name: string; hex: string; distance: number } {
  const rgb = parseHex(hex) || [0, 0, 0];
  let best = NAMED_COLOURS[0], bestD = Infinity;
  for (const n of NAMED_COLOURS) {
    const d = distance(rgb, parseHex(n.hex)!);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return { ...best, distance: bestD };
}

export type PixelSample = { pixels: RGB[]; opaqueRatio: number; total: number };

/**
 * Sample the opaque pixels of an image (downscaled so this stays cheap).
 * `pixels` is a flat list of opaque RGB triples (alpha >= alphaMin).
 */
export async function sampleOpaquePixels(file: string, maxSide = 96, alphaMin = 200): Promise<PixelSample> {
  const { data, info } = await sharp(file, { density: 96 }).resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px: RGB[] = [];
  const total = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] >= alphaMin) px.push([data[i], data[i + 1], data[i + 2]]);
  }
  return { pixels: px, opaqueRatio: total ? px.length / total : 0, total };
}

/**
 * Dominant colour over opaque pixels: 4-bit/channel histogram, take the heaviest bin,
 * return the average of the pixels inside it (so anti-aliased edges don't skew it).
 */
export function dominantOf(pixels: RGB[]): string {
  if (!pixels.length) return '#000000';
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const [r, g, b] of pixels) {
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key);
    if (bin) {
      bin.n++;
      bin.r += r;
      bin.g += g;
      bin.b += b;
    } else bins.set(key, { n: 1, r, g, b });
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const bin of bins.values()) if (!best || bin.n > best.n) best = bin;
  return toHex([best!.r / best!.n, best!.g / best!.n, best!.b / best!.n]);
}

export async function dominantColour(file: string): Promise<{ dominant: string; colour: string; opaqueRatio: number }> {
  const s = await sampleOpaquePixels(file);
  const dominant = dominantOf(s.pixels);
  return { dominant, colour: nearestNamed(dominant).name, opaqueRatio: s.opaqueRatio };
}
