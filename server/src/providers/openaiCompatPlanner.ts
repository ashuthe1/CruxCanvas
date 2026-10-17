import type OpenAI from 'openai';
import type { ChatMessage, IPlannerModel, ToolDef } from '../core/interfaces.js';
import { withRetry } from './retry.js';
import { recordChat } from '../core/usage.js';

export class OpenAICompatPlanner implements IPlannerModel {
  constructor(private client: OpenAI, public readonly name: string) {}

  async chat(messages: ChatMessage[], tools: ToolDef[], opts: { temperature?: number; maxTokens?: number } = {}) {
    const t0 = Date.now();
    const res = await withRetry(() =>
      this.client.chat.completions.create({
        model: this.name,
        messages,
        tools: tools.length ? tools : undefined,
        tool_choice: tools.length ? 'auto' : undefined,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 6000,
      }),
    );
    recordChat('planner', this.name, res.usage, Date.now() - t0);
    return { message: res.choices[0].message, usage: res.usage };
  }
}
