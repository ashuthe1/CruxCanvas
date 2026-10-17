import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { openai, MODELS, withRetry } from './llm.js';

const OUT = path.join(process.cwd(), 'generated');
fs.mkdirSync(OUT, { recursive: true });

const STYLE_PREFIX: Record<string, string> = {
  illustration:
    'Flat vector illustration in the Xero brand style: bold simple shapes, one sweeping ribbon-like bloom in light blue (#3ECCFE) and blue (#1868D8), small playful objects with accents of mint green, pink, yellow and purple, soft 3D-ish shading, clean edges, optimistic small-business mood. Absolutely no text, letters, numbers or logos. Isolated subject on a fully transparent background.',
  photo:
    'Editorial photograph of a real small business owner at work, candid, warm natural light, shallow depth of field, authentic and optimistic, modern workspace. No text or logos anywhere.',
  background:
    'Abstract minimal background made of smooth organic fern-inspired bloom shapes in Xero blue (#1868D8) on light blue (#3ECCFE), flat vector, no gradients, no text, large soft curves that bleed off the edges.',
  charm: 'Small glossy 3D icon in Xero brand style: light blue (#3ECCFE) and blue (#1868D8) with a mint, pink or yellow accent, simple, playful, soft shading. No text. Isolated on a fully transparent background.',
};

export type GenResult = { src: string; width: number; height: number; file: string };

export async function generateImage(prompt: string, purpose: keyof typeof STYLE_PREFIX = 'illustration', size: '1024x1024' | '1536x1024' | '1024x1536' = '1024x1024'): Promise<GenResult> {
  const transparent = purpose === 'illustration' || purpose === 'charm';
  const full = `${STYLE_PREFIX[purpose] || STYLE_PREFIX.illustration}\n\nSubject: ${prompt}`;
  const res = await withRetry(() =>
    openai.images.generate({
      model: MODELS.image,
      prompt: full,
      size,
      quality: 'medium',
      n: 1,
      ...(transparent ? { background: 'transparent', output_format: 'png' } : { output_format: 'png' }),
    } as any),
  );
  const b64 = (res.data?.[0] as any)?.b64_json;
  if (!b64) throw new Error('No image returned');
  const buf = Buffer.from(b64, 'base64');
  const id = randomUUID().slice(0, 10);
  const file = path.join(OUT, `${id}.png`);
  await sharp(buf).png().toFile(file);
  const meta = await sharp(file).metadata();
  return { src: `/generated/${id}.png`, width: meta.width || 1024, height: meta.height || 1024, file };
}
