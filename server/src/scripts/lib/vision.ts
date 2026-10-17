/**
 * Vision model for the onboarding scripts. Loads server/.env regardless of cwd, then
 * reuses the app's providers. `TAGGING_MODEL` (or --tag-model) switches per-asset tagging to a
 * cheaper model (e.g. gpt-4.1-mini); guideline reading always uses the main vision model.
 */
import path from 'path';
import { config as dotenv } from 'dotenv';
import { fileURLToPath } from 'url';
import type { IVisionModel } from '../../core/interfaces.js';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
dotenv({ path: path.join(SERVER_DIR, '.env'), quiet: true } as any);

export type VisionSet = { tagging: IVisionModel; guidelines: IVisionModel } | null;

export async function loadVision(opts: { disabled?: boolean; tagModel?: string } = {}): Promise<VisionSet> {
  if (opts.disabled) return null;
  if (!process.env.OPENAI_API_KEY) return null;
  const { createProviders } = await import('../../providers/index.js');
  const providers = createProviders();
  const tagModel = opts.tagModel || process.env.TAGGING_MODEL;
  let tagging: IVisionModel = providers.vision;
  if (tagModel && tagModel !== providers.vision.name) {
    const [{ default: OpenAI }, { OpenAIVision }] = await Promise.all([import('openai'), import('../../providers/openaiVision.js')]);
    tagging = new OpenAIVision(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), tagModel);
  }
  return { tagging, guidelines: providers.vision };
}
