/**
 * Per-request usage meter. Providers record every model call into the meter of the current
 * request (AsyncLocalStorage), so the agent loop, iterations and scans need no plumbing. The
 * totals are emitted as a `usage` event and accumulated per session by the editor.
 *
 * Prices are estimates in USD and overridable through env (per 1M tokens / per image):
 *   PRICE_PLANNER_IN, PRICE_PLANNER_CACHED, PRICE_PLANNER_OUT
 *   PRICE_VISION_IN, PRICE_VISION_CACHED, PRICE_VISION_OUT  (gpt-4.1-mini is priced separately)
 *   PRICE_IMAGE_LOW, PRICE_IMAGE_MEDIUM, PRICE_IMAGE_HIGH   (per 1024² image; 1536 sizes ×1.5)
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type UsageKind = 'planner' | 'vision' | 'image';
export type UsageCall = { kind: UsageKind; model: string; inputTokens: number; cachedTokens: number; outputTokens: number; images: number; ms: number; costUsd: number };
export type UsageTotals = {
  calls: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  images: number;
  ms: number;
  costUsd: number;
  byKind: Record<UsageKind, { calls: number; costUsd: number; ms: number }>;
  estimate: true;
};

const num = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);
const PER_M = 1_000_000;
const PRICES = {
  planner: { in: num('PRICE_PLANNER_IN', 1.2), cached: num('PRICE_PLANNER_CACHED', 0.12), out: num('PRICE_PLANNER_OUT', 2.4) },
  vision: { in: num('PRICE_VISION_IN', 2.0), cached: num('PRICE_VISION_CACHED', 0.5), out: num('PRICE_VISION_OUT', 8.0) },
  visionMini: { in: 0.4, cached: 0.1, out: 1.6 },
  image: { low: num('PRICE_IMAGE_LOW', 0.011), medium: num('PRICE_IMAGE_MEDIUM', 0.042), high: num('PRICE_IMAGE_HIGH', 0.167) },
};

export function priceTokens(kind: 'planner' | 'vision', model: string, inputTokens: number, cachedTokens: number, outputTokens: number) {
  const p = kind === 'vision' && /mini/i.test(model) ? PRICES.visionMini : PRICES[kind];
  const fresh = Math.max(0, inputTokens - cachedTokens);
  return (fresh * p.in + cachedTokens * p.cached + outputTokens * p.out) / PER_M;
}

export function priceImage(quality: string, size: string) {
  const base = PRICES.image[(quality as keyof typeof PRICES.image) || 'medium'] ?? PRICES.image.medium;
  return /1536/.test(size) ? base * 1.5 : base;
}

export class UsageMeter {
  readonly calls: UsageCall[] = [];
  add(call: UsageCall) {
    this.calls.push(call);
  }
  totals(): UsageTotals {
    const t: UsageTotals = {
      calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, images: 0, ms: 0, costUsd: 0,
      byKind: { planner: { calls: 0, costUsd: 0, ms: 0 }, vision: { calls: 0, costUsd: 0, ms: 0 }, image: { calls: 0, costUsd: 0, ms: 0 } },
      estimate: true,
    };
    for (const c of this.calls) {
      t.calls++;
      t.inputTokens += c.inputTokens;
      t.cachedTokens += c.cachedTokens;
      t.outputTokens += c.outputTokens;
      t.images += c.images;
      t.ms += c.ms;
      t.costUsd += c.costUsd;
      t.byKind[c.kind].calls++;
      t.byKind[c.kind].costUsd += c.costUsd;
      t.byKind[c.kind].ms += c.ms;
    }
    t.costUsd = round(t.costUsd);
    for (const k of Object.keys(t.byKind) as UsageKind[]) t.byKind[k].costUsd = round(t.byKind[k].costUsd);
    return t;
  }
}
const round = (n: number) => Math.round(n * 10000) / 10000;

const als = new AsyncLocalStorage<UsageMeter>();
/** Run `fn` with a fresh meter; every provider call inside records into it. */
export function withUsageMeter<T>(fn: (meter: UsageMeter) => Promise<T>): Promise<T> {
  const meter = new UsageMeter();
  return als.run(meter, () => fn(meter));
}
export function currentMeter(): UsageMeter | undefined {
  return als.getStore();
}
/** Record a chat-completions call from its OpenAI-style usage block */
export function recordChat(kind: 'planner' | 'vision', model: string, usage: any, ms: number) {
  const m = currentMeter();
  if (!m) return;
  const inputTokens = usage?.prompt_tokens ?? 0;
  const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? usage?.prompt_cache_hit_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;
  m.add({ kind, model, inputTokens, cachedTokens, outputTokens, images: 0, ms, costUsd: priceTokens(kind, model, inputTokens, cachedTokens, outputTokens) });
}
export function recordImage(model: string, quality: string, size: string, ms: number) {
  const m = currentMeter();
  if (!m) return;
  m.add({ kind: 'image', model, inputTokens: 0, cachedTokens: 0, outputTokens: 0, images: 1, ms, costUsd: priceImage(quality, size) });
}
/** Sum two totals (the editor keeps a running total per session) */
export function addTotals(a: UsageTotals | undefined, b: UsageTotals): UsageTotals {
  if (!a) return b;
  const out: UsageTotals = { ...b, byKind: { ...b.byKind } };
  out.calls = a.calls + b.calls;
  out.inputTokens = a.inputTokens + b.inputTokens;
  out.cachedTokens = a.cachedTokens + b.cachedTokens;
  out.outputTokens = a.outputTokens + b.outputTokens;
  out.images = a.images + b.images;
  out.ms = a.ms + b.ms;
  out.costUsd = round(a.costUsd + b.costUsd);
  for (const k of Object.keys(out.byKind) as UsageKind[]) out.byKind[k] = { calls: (a.byKind?.[k]?.calls || 0) + b.byKind[k].calls, costUsd: round((a.byKind?.[k]?.costUsd || 0) + b.byKind[k].costUsd), ms: (a.byKind?.[k]?.ms || 0) + b.byKind[k].ms };
  return out;
}
