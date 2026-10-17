import type OpenAI from 'openai';
import type { IImageModel, ImageSize } from '../core/interfaces.js';
import { withRetry } from './retry.js';

export class OpenAIImages implements IImageModel {
  constructor(private client: OpenAI, public readonly name: string) {}

  async generate(prompt: string, opts: { size: ImageSize; transparent: boolean }) {
    const res = await withRetry(() =>
      this.client.images.generate({
        model: this.name,
        prompt,
        size: opts.size,
        // medium is ~1/3 the cost and latency of high and is plenty for 1080-px social canvases;
        // set IMAGE_QUALITY=high for print or hero work
        quality: (process.env.IMAGE_QUALITY as any) || 'medium',
        n: 1,
        output_format: 'png',
        ...(opts.transparent ? { background: 'transparent' } : {}),
      } as any),
    );
    const b64 = (res.data?.[0] as any)?.b64_json;
    if (!b64) throw new Error('No image returned');
    return Buffer.from(b64, 'base64');
  }
}
