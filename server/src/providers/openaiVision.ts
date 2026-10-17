import type OpenAI from 'openai';
import type { IVisionModel } from '../core/interfaces.js';
import { withRetry } from './retry.js';
import { recordChat } from '../core/usage.js';

export class OpenAIVision implements IVisionModel {
  constructor(private client: OpenAI, public readonly name: string) {}

  async describeJSON(system: string, userText: string, images: string[], maxTokens = 1500) {
    const t0 = Date.now();
    const res = await withRetry(() =>
      this.client.chat.completions.create({
        model: this.name,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: [{ type: 'text', text: userText }, ...images.slice(0, 6).map((u) => ({ type: 'image_url' as const, image_url: { url: u, detail: 'high' as const } }))] },
        ],
      }),
    );
    recordChat('vision', this.name, res.usage, Date.now() - t0);
    try {
      return JSON.parse(res.choices[0].message.content || '{}');
    } catch {
      return { summary: res.choices[0].message.content };
    }
  }

  async describe(system: string, userText: string, image: string, maxTokens = 400) {
    const t0 = Date.now();
    const res = await withRetry(() =>
      this.client.chat.completions.create({
        model: this.name,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: [{ type: 'text', text: userText }, { type: 'image_url', image_url: { url: image } }] },
        ],
      }),
    );
    recordChat('vision', this.name, res.usage, Date.now() - t0);
    return res.choices[0].message.content || '';
  }
}
