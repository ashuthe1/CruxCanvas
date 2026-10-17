export function parseHex(c: string | undefined | null): [number, number, number] | null {
  if (!c || typeof c !== 'string') return null;
  let s = c.trim();
  const rgb = s.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  if (s === 'white') return [255, 255, 255];
  if (s === 'black') return [0, 0, 0];
  if (s === 'transparent') return null;
  if (!s.startsWith('#')) return null;
  s = s.slice(1);
  if (s.length === 3 || s.length === 4) s = s.split('').map((ch) => ch + ch).join('');
  if (s.length < 6) return null;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

export function toHex([r, g, b]: [number, number, number]) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function lin(v: number) {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
export function luminance(rgb: [number, number, number]) {
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}
export function contrast(a: [number, number, number], b: [number, number, number]) {
  const la = luminance(a), lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Simple perceptual-ish distance (weighted RGB). Returns ~0..765 */
export function distance(a: [number, number, number], b: [number, number, number]) {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

export function nearestPalette(hex: string, palette: { hex: string; name: string }[]) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  let best = palette[0], bestD = Infinity;
  for (const p of palette) {
    const d = distance(rgb, parseHex(p.hex)!);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return { ...best, distance: bestD };
}
