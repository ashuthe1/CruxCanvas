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
        quality: 'medium',
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
