/**
 * Model providers, built from env. Any OpenAI-compatible endpoint works for the planner
 * (DeepSeek on Azure today); vision + images default to OpenAI. Add a new provider by
 * implementing the interface in core/interfaces.ts and registering it here.
 */
import 'dotenv/config';
import OpenAI from 'openai';
import type { Providers } from '../core/interfaces.js';
import { OpenAICompatPlanner } from './openaiCompatPlanner.js';
import { OpenAIVision } from './openaiVision.js';
import { OpenAIImages } from './openaiImages.js';

let cached: Providers | null = null;

export function createProviders(): Providers {
  if (cached) return cached;
  const plannerClient = new OpenAI({ baseURL: process.env.PLANNER_BASE_URL || process.env.DEEPSEEK_PRO_BASE_URL, apiKey: process.env.PLANNER_API_KEY || process.env.DEEPSEEK_PRO_KEY });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  cached = {
    planner: new OpenAICompatPlanner(plannerClient, process.env.PLANNER_MODEL || process.env.DEEPSEEK_PRO_MODEL || 'DeepSeek-V4-Pro'),
    vision: new OpenAIVision(openai, process.env.VISION_MODEL || 'gpt-4.1'),
    images: new OpenAIImages(openai, process.env.IMAGE_MODEL || 'gpt-image-1'),
  };
  return cached;
}

export { withRetry } from './retry.js';
