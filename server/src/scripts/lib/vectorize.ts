/**
 * Vectorise small flat logos: trace each colour layer of a PNG into SVG paths so the wordmark stays
 * crisp at any export size. Bitmap logos in brand kits are often tiny (Xero's are 210×60 px).
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import potrace from 'potrace';
import { distance, toHex } from '../../core/color.js';

export type VectorizeResult = { svgPath: string; colours: string[]; width: number; height: number };

function trace(buf: Buffer, colour: string): Promise<string> {
  return new Promise((resolve, reject) =>
    potrace.trace(buf, { threshold: 128, color: colour, background: 'transparent', turdSize: 4, optTolerance: 0.3, alphaMax: 1 } as any, (err: any, svg: string) => (err ? reject(err) : resolve(svg))),
  );
}

/** Dominant opaque colour clusters (≤ maxColours) as hex, most frequent first */
async function colourClusters(buf: Buffer, maxColours = 3) {
  const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const hist = new Map<string, { n: number; rgb: [number, number, number] }>();
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 96) continue; // thin anti-aliased strokes can sit at 50–80% alpha
    const k = `${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`;
    const e = hist.get(k) || { n: 0, rgb: [data[i], data[i + 1], data[i + 2]] as [number, number, number] };
    e.n++;
    hist.set(k, e);
    total++;
  }
  const bins = [...hist.values()].sort((a, b) => b.n - a.n);
  const clusters: { rgb: [number, number, number]; n: number }[] = [];
  for (const b of bins) {
    // merge generously so a gradient-filled letterform becomes one flat colour instead of banded layers
    const c = clusters.find((x) => distance(x.rgb, b.rgb) < 120);
    if (c) c.n += b.n;
    else clusters.push({ rgb: b.rgb, n: b.n });
  }
  return clusters.filter((c) => c.n / total > 0.02).slice(0, maxColours).map((c) => ({ hex: toHex(c.rgb), rgb: c.rgb }));
}

export async function vectorizeLogo(pngPath: string, outSvgPath = pngPath.replace(/\.(png|jpe?g|webp)$/i, '.svg'), scale = 6): Promise<VectorizeResult> {
  const src = sharp(pngPath).ensureAlpha();
  const meta = await src.metadata();
  const W = (meta.width || 1) * scale, H = (meta.height || 1) * scale;
  // upscale with Lanczos and soften slightly so the tracer follows smooth outlines, not pixel stairs
  const big = await sharp(pngPath).ensureAlpha().resize(W, H, { kernel: 'lanczos3' }).blur(scale / 5).raw().toBuffer({ resolveWithObject: true });
  const clusters = await colourClusters(await sharp(pngPath).ensureAlpha().png().toBuffer());
  if (!clusters.length) throw new Error('no opaque pixels to trace');
  const paths: string[] = [];
  for (const c of clusters) {
    // mask: black where the pixel belongs to this colour and is opaque, white elsewhere
    const mask = Buffer.alloc(W * H * 3, 255);
    const d = big.data;
    for (let p = 0, i = 0; i < d.length; i += 4, p += 3) {
      if (d[i + 3] < 96) continue;
      const rgb: [number, number, number] = [d[i], d[i + 1], d[i + 2]];
      let best = clusters[0], bd = Infinity;
      for (const k of clusters) {
        const dist = distance(k.rgb, rgb);
        if (dist < bd) {
          bd = dist;
          best = k;
        }
      }
      if (best === c) mask[p] = mask[p + 1] = mask[p + 2] = 0;
    }
    const maskPng = await sharp(mask, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
    const svg = await trace(maskPng, c.hex);
    const inner = svg.match(/<path[^>]*\/>/g) || [];
    paths.push(...inner);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${paths.join('')}</svg>`;
  fs.mkdirSync(path.dirname(outSvgPath), { recursive: true });
  fs.writeFileSync(outSvgPath, svg);
  return { svgPath: outSvgPath, colours: clusters.map((c) => c.hex), width: W, height: H };
}
