/**
 * Winner iterations runner: duplicate the page N times and ask the planner for one op set per
 * variant that changes exactly one dimension (hook, colourway, CTA, imagery, layout). Every op set
 * is filtered by the dimension whitelist, applied to the clone, then validated/auto-fixed like any
 * other design. The planner sees the ORIGINAL ids; ops are remapped to each clone's ids.
 */
import type { IBrandRepository, Providers, ToolContext, ToolDef } from '../core/interfaces.js';
import type { AgentEvent, CompactEl, CompactPage, Op } from '../core/types.js';
import { LintEngine, applyOpsCompact } from '../lint/index.js';
import { buildSystemPrompt } from '../agent/prompt.js';
import { validateAndFix } from '../agent/tools/createDesign.js';
import { prepareOps } from '../agent/tools/updateDesign.js';
import { TextMeasurer } from '../render/text.js';
import { brandRepository } from '../brands/index.js';
import { changesSomething, dimensionById, dimensions, validateVariantOps, type IterationDimension } from './dimensions.js';

export type IterateInput = { page: CompactPage; width: number; height: number; dimensions: string[]; count: number };
export type IterateDeps = { brandId: string; brands: IBrandRepository; providers: Providers; lint: LintEngine };

const MAX_VARIANTS = 6;
const uid = () => Math.random().toString(36).slice(2, 7);

/** Clone a compact page under a new id, suffixing every element id (and container references). */
export function cloneCompact(page: CompactPage, pageId: string, suffix: string): CompactPage {
  const map = (id?: string) => (id ? `${id}_${suffix}` : id);
  return {
    id: pageId,
    background: page.background,
    elements: page.elements.map((e) => {
      const c: CompactEl = JSON.parse(JSON.stringify(e));
      c.id = map(e.id)!;
      if (c.container) c.container = map(c.container);
      if (c.custom?.container) c.custom = { ...c.custom, container: map(c.custom.container) };
      if (c.custom?.group) c.custom = { ...c.custom, group: map(c.custom.group) };
      return c;
    }),
  };
}

/** Rewrite op ids from the original page to a clone's ids. */
export function remapOps(ops: Op[], suffix: string): Op[] {
  const map = (id: string) => `${id}_${suffix}`;
  return ops.map((op) => {
    if (op.op === 'set' || op.op === 'delete' || op.op === 'raise') return { ...op, id: map(op.id) } as Op;
    if (op.op === 'add' && op.element?.custom?.container) return { op: 'add', element: { ...op.element, custom: { ...op.element.custom, container: map(op.element.custom.container) } } };
    return op;
  });
}

const proposeTool = (dim: IterationDimension, k: number): ToolDef => ({
  type: 'function',
  function: {
    name: 'propose_variants',
    description: `Return exactly ${k} variant${k > 1 ? 's' : ''} of the page, each changing ONLY the "${dim.label}" dimension, as update_design-style ops on the existing element ids.`,
    parameters: {
      type: 'object',
      properties: {
        variants: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'What this variant tests, ≤ 8 words (e.g. "Proof-point hook", "Navy on light blue")' },
              ops: { type: 'array', items: { type: 'object' }, description: '{op:"set",id,props} | {op:"background",value} | {op:"raise",id} | {op:"add",element} | {op:"delete",id}' },
            },
            required: ['label', 'ops'],
          },
        },
      },
      required: ['variants'],
    },
  },
});

/** Ask the planner for k op sets for one dimension (one call; retries once if it answers in prose). */
async function proposeVariants(ctx: ToolContext, dim: IterationDimension, page: CompactPage, k: number, emit: (e: AgentEvent) => void): Promise<{ label: string; ops: Op[] }[]> {
  const { W, H } = ctx.canvas;
  const system = buildSystemPrompt(ctx.brand, ctx.assets, W, H);
  const task = `WINNER ITERATIONS — controlled A/B test. Produce ${k} variant${k > 1 ? 's' : ''} of the page below where ONLY the "${dim.label}" dimension changes; everything else must stay byte-identical so marketers can attribute performance to that one change. The ${k} variants must differ clearly from each other.

DIMENSION BRIEF: ${dim.brief(ctx.brand, ctx.assets, page, W, H)}

PAGE (element ids are what your ops must reference):
${JSON.stringify(page)}

Call propose_variants once with all ${k} variants. Ops use the update_design format. No prose.`;
  const messages: any[] = [
    { role: 'system', content: system },
    { role: 'user', content: task },
  ];
  const tools = [proposeTool(dim, k)];
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    const { message, usage } = await ctx.providers.planner.chat(messages, tools, { temperature: 0.8 });
    console.log(`[iterate] ${dim.id} x${k} ${Date.now() - t0}ms tokens=${usage?.total_tokens ?? '?'}`);
    const calls = (message.tool_calls || []) as any[];
    // tolerate the shapes DeepSeek produces: JSON strings for nested values, a single object instead of an array
    const parse = (v: any): any => {
      if (typeof v !== 'string') return v;
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    };
    const asList = (v: any) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
    const call = calls.find((c) => c.function?.name === 'propose_variants');
    const args = call ? parse(call.function?.arguments || '{}') : null;
    let list: any[] = asList(parse(args?.variants)).map((v: any) => (v && typeof v === 'object' ? { ...v, ops: asList(parse(v.ops)) } : null)).filter((v: any) => v && v.ops.length);
    // the planner sometimes reaches for update_design instead: each call is one variant
    if (!list.length) list = calls.filter((c) => c.function?.name === 'update_design').map((c) => parse(c.function?.arguments || '{}')).map((a) => a && { label: a.label || a.rationale || dim.label, ops: asList(parse(a.ops)) }).filter((a) => a && a.ops.length);
    if (list.length) return list.slice(0, k).map((v: any, i: number) => ({ label: String(v.label || `${dim.label} ${i + 1}`).slice(0, 60), ops: Array.isArray(v.ops) ? v.ops : [] }));
    const why = calls.length ? `called ${calls.map((c) => c.function?.name).join(', ')} with unusable arguments ${String(calls[0].function?.arguments || '').slice(0, 160)}` : `answered in prose: "${String(message.content || '').slice(0, 100)}"`;
    console.warn(`[iterate] ${dim.id}: ${why}`);
    emit({ type: 'status', text: `${dim.label}: planner ${why}${attempt === 0 ? ' — retrying' : ''}` });
    messages.push(message, { role: 'user', content: 'You must answer by calling propose_variants with valid JSON — no prose.' });
  }
  return [];
}

/**
 * Images must keep their artwork's proportions: when the imagery dimension swaps an asset, derive the
 * height from the new asset; when only one dimension is set, scale the other. Otherwise the canvas
 * would cover-crop or stretch the picture — which reads as "quality loss".
 */
function keepImageAspect(ctx: ToolContext, page: CompactPage, ops: Op[]): Op[] {
  for (const op of ops) {
    if (op.op !== 'set') continue;
    const el = page.elements.find((e) => e.id === op.id);
    if (!el || !(el.type === 'image' || el.type === 'svg')) continue;
    const p = op.props;
    const newAssetId = p.assetId || p.custom?.assetId;
    const asset = newAssetId ? ctx.assets.find((a) => a.id === newAssetId) : undefined;
    const aspect = asset && asset.width && asset.height ? asset.width / asset.height : el.width && el.height ? el.width / el.height : undefined;
    if (!aspect) continue;
    if (asset) {
      p.src = asset.url;
      p.custom = { ...(el.custom || {}), ...(p.custom || {}), assetId: asset.id, role: p.custom?.role || el.role || asset.category };
      const w = p.width ?? el.width;
      p.width = w;
      p.height = Math.round(w / aspect);
      // don't blow a small asset up beyond 1.5x its pixels — it would look soft
      const maxW = asset.width * 1.5;
      if (p.width > maxW) {
        p.width = Math.round(maxW);
        p.height = Math.round(maxW / aspect);
      }
    } else if (p.width !== undefined && p.height === undefined) p.height = Math.round(p.width / aspect);
    else if (p.height !== undefined && p.width === undefined) p.width = Math.round(p.height * aspect);
  }
  return ops;
}

/** The planner may only point at library assets or generated files; a hand-typed src is replaced by the asset it resembles or dropped. */
function sanitiseSrc(ctx: ToolContext, ops: Op[]) {
  for (const op of ops) {
    const el = op.op === 'set' ? op.props : op.op === 'add' ? op.element : null;
    if (!el || typeof el.src !== 'string' || el.assetId || el.src.startsWith('/generated/') || el.src.startsWith('data:')) continue;
    const known = ctx.assets.find((a) => a.url === el.src);
    if (known) {
      el.assetId = known.id;
      continue;
    }
    const base = el.src.split('/').pop()?.split('.')[0]?.slice(0, 12) || '';
    const near = base && ctx.assets.find((a) => a.url.includes(base));
    if (near) el.assetId = near.id;
    delete el.src;
    if (near) continue;
    if (op.op === 'set' && el.custom?.assetId) el.assetId = el.custom.assetId;
  }
}

/**
 * Re-measure text whose copy or size changed so the lint sees real heights, then re-stack: siblings
 * below it in the same container shift by the height delta and the container grows — the same
 * auto-stacking the renderer does, so a longer hook never lands on the CTA.
 */
function remeasureText(ctx: ToolContext, page: CompactPage, ops: Op[]) {
  const tm = new TextMeasurer(ctx.brand, (rel) => brandRepository().resolve(ctx.brand.id, rel));
  const extra: Op[] = [];
  for (const op of ops) {
    if (op.op !== 'set' || (op.props.text === undefined && op.props.fontSize === undefined)) continue;
    const el: any = page.elements.find((e) => e.id === op.id);
    if (!el || el.type !== 'text' || !el.fontFamily) continue;
    const m = tm.measure(String(el.text || ''), el.fontFamily, el.fontSize, el.width, el.lineHeight || 1.2, el.letterSpacing || 0);
    if (!m.height || Math.abs(m.height - el.height) <= 2) continue;
    const delta = m.height - el.height;
    const oldBottom = el.y + el.height;
    el.height = m.height;
    op.props.height = m.height;
    const containerId = el.container || el.custom?.container;
    const container = containerId ? page.elements.find((e) => e.id === containerId) : undefined;
    const siblings = page.elements.filter((e) => e !== el && (containerId ? (e.container || e.custom?.container) === containerId : contains(container, e)) && e.y >= oldBottom - 4);
    for (const sib of siblings) {
      sib.y = Math.round(sib.y + delta);
      extra.push({ op: 'set', id: sib.id, props: { y: sib.y } });
    }
    if (container && delta > 0) {
      container.height = Math.round(container.height + delta);
      extra.push({ op: 'set', id: container.id, props: { height: container.height } });
    }
  }
  ops.push(...extra);
}
const contains = (outer: CompactEl | undefined, inner: CompactEl) => !!outer && inner.x + inner.width / 2 >= outer.x && inner.x + inner.width / 2 <= outer.x + outer.width && inner.y + inner.height / 2 >= outer.y && inner.y + inner.height / 2 <= outer.y + outer.height;

export async function iteratePage(input: IterateInput, deps: IterateDeps, emit: (e: AgentEvent) => void, signal?: AbortSignal) {
  const brand = await deps.brands.get(deps.brandId);
  const assets = await deps.brands.assets(deps.brandId);
  const source: CompactPage = JSON.parse(JSON.stringify(input.page));
  if (!source?.id || !Array.isArray(source.elements) || !source.elements.length) throw Object.assign(new Error('The page is empty — create a design first.'), { status: 400 });
  const dims = (input.dimensions || []).map(dimensionById).filter((d): d is IterationDimension => !!d);
  if (!dims.length) throw Object.assign(new Error(`dimensions must be some of: ${dimensions.map((d) => d.id).join(', ')}`), { status: 400 });
  const count = Math.max(1, Math.min(MAX_VARIANTS, Math.round(input.count || dims.length)));

  const pages = new Map<string, CompactPage>([[source.id, source]]);
  const ctx: ToolContext = {
    brand,
    assets,
    providers: deps.providers,
    canvas: { W: input.width, H: input.height },
    pages,
    activePageId: source.id,
    input: { message: 'winner iterations' },
    userIsEditing: true,
    emit,
    lint: (page) => deps.lint.run(brand, assets, page, input.width, input.height),
    state: {},
    setCanvas: () => {},
  };

  // 1. plan the batch: variant i tests dimension i % dims.length; duplicate every page up front
  type Slot = { dim: IterationDimension; pageId: string; suffix: string };
  const slots: Slot[] = Array.from({ length: count }, (_, i) => {
    const suffix = uid();
    return { dim: dims[i % dims.length], pageId: `${source.id}_v${suffix}`, suffix };
  });
  for (const s of slots) {
    pages.set(s.pageId, cloneCompact(source, s.pageId, s.suffix));
    emit({ type: 'duplicate_page', sourcePageId: source.id, pageId: s.pageId, suffix: s.suffix, custom: { variantOf: source.id, dimension: s.dim.id } });
  }
  const summary = dims.map((d) => `${slots.filter((s) => s.dim === d).length}× ${d.label.toLowerCase()}`).join(', ');
  emit({ type: 'status', text: `Planning ${count} controlled variant${count > 1 ? 's' : ''} (${summary})…` });

  // 2. one planner call per dimension, in parallel
  const results: string[] = [];
  await Promise.all(
    dims.map(async (dim) => {
      const mine = slots.filter((s) => s.dim === dim);
      let proposals: { label: string; ops: Op[] }[] = [];
      try {
        proposals = await proposeVariants(ctx, dim, source, mine.length, emit);
      } catch (e: any) {
        emit({ type: 'status', text: `${dim.label}: planner failed (${e?.message || e})` });
      }
      if (signal?.aborted) return;
      mine.forEach((slot, i) => {
        const clone = pages.get(slot.pageId)!;
        const proposal = proposals[i];
        const base = { pageId: slot.pageId, sourcePageId: source.id, dimension: dim.id };
        if (!proposal) {
          emit({ type: 'variant', ...base, label: dim.label, score: 0, dropped: [], rejected: 'the planner returned no variant' });
          results.push(`${dim.label}: no proposal`);
          return;
        }
        // 3. keep the change inside the dimension, then remap to the clone's ids and apply
        const { ops: allowed, dropped } = validateVariantOps(source, dim, proposal.ops);
        if (!changesSomething(source, allowed)) {
          emit({ type: 'variant', ...base, label: proposal.label, score: 0, dropped, rejected: 'no change inside this dimension survived validation' });
          results.push(`${dim.label} "${proposal.label}": rejected`);
          return;
        }
        const remapped = remapOps(allowed, slot.suffix);
        sanitiseSrc(ctx, remapped);
        const ops = keepImageAspect(ctx, clone, prepareOps(clone, remapped, ctx));
        applyOpsCompact(clone, ops);
        remeasureText(ctx, clone, ops);
        emit({ type: 'ops', pageId: clone.id, ops });
        // 4. the same validator every design passes through
        const { report, lint } = validateAndFix(ctx, clone, true, `${dim.label} · ${proposal.label}`, dropped.length ? `Kept to the ${dim.label.toLowerCase()} dimension; ignored ${dropped.length} out-of-scope change${dropped.length > 1 ? 's' : ''}.` : undefined);
        emit({ type: 'lint', pageId: clone.id, result: lint });
        emit({ type: 'report', pageId: clone.id, report });
        emit({ type: 'variant', ...base, label: proposal.label, score: lint.score, dropped });
        results.push(`${dim.label} "${proposal.label}": score ${lint.score}`);
      });
    }),
  );
  if (signal?.aborted) return;
  const original = ctx.lint(source);
  emit({ type: 'message', text: `Original scores ${original.score}. ${results.length ? results.join(' · ') : 'No variants were produced.'}` });
  return results;
}
