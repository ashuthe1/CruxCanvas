import OpenAI from 'openai';
import 'dotenv/config';

export const deepseekPro = new OpenAI({
  baseURL: process.env.DEEPSEEK_PRO_BASE_URL,
  apiKey: process.env.DEEPSEEK_PRO_KEY,
});
export const deepseekFlash = new OpenAI({
  baseURL: process.env.DEEPSEEK_FLASH_BASE_URL,
  apiKey: process.env.DEEPSEEK_FLASH_KEY,
});
export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const MODELS = {
  planner: process.env.DEEPSEEK_PRO_MODEL || 'DeepSeek-V4-Pro',
  fast: process.env.DEEPSEEK_FLASH_MODEL || 'DeepSeek-V4.1-Flash',
  vision: process.env.VISION_MODEL || 'gpt-4.1',
  image: process.env.IMAGE_MODEL || 'gpt-image-1',
};

/** Retry helper for the shared rate-limited endpoints (429) */
export async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const status = e?.status ?? e?.response?.status;
      if (status === 429 || status >= 500) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
