/**
 * The copilot loop: planner (DeepSeek) + tool registry + server-side canvas mirror.
 *
 * Transparency: every step is streamed as a `trace` event (what the agent saw, what it decided,
 * which tool it called with which arguments, what the validator and the visual QA found).
 * Quality: edits start with a vision inspection of the real render, every design passes the
 * deterministic validator, and the run ends with a visual QA loop that keeps fixing until clean
 * (bounded) — so "100/100" means the pixels were checked too, not just the JSON.
 */
import { randomUUID } from 'crypto';
import type { AgentTool, ChatMessage, IBrandRepository, Providers, ToolContext } from '../core/interfaces.js';
import type { AgentEvent, AgentInput, CompactPage, TraceStep } from '../core/types.js';
import { LintEngine } from '../lint/index.js';
import { buildSystemPrompt } from './prompt.js';
import { validateAndFix, lintSummary } from './tools/createDesign.js';
import { analyzeReferences } from './references.js';
import { inspectRender, type VisualQA } from './visualQA.js';
import { waitForSnapshot } from './snapshots.js';

export type AgentDeps = { brandId: string; brands: IBrandRepository; providers: Providers; lint: LintEngine; tools: AgentTool[] };

const MAX_ITER = 14;
const VISUAL_QA_ROUNDS = 2;

export async function runAgent(input: AgentInput, deps: AgentDeps, emit: (e: AgentEvent) => void, signal?: AbortSignal) {
  const brand = await deps.brands.get(deps.brandId);
  const assets = await deps.brands.assets(deps.brandId);
  const pages = new Map<string, CompactPage>();
  for (const p of input.canvas.pages) pages.set(p.id, JSON.parse(JSON.stringify(p)));
  const activePage = pages.get(input.canvas.activePageId);
  const trace = (step: Omit<TraceStep, 'id'>) => emit({ type: 'trace', step: { id: randomUUID().slice(0, 8), ...step } });

  const ctx: ToolContext = {
    brand,
    assets,
    providers: deps.providers,
    canvas: { W: input.canvas.width, H: input.canvas.height },
    pages,
    activePageId: input.canvas.activePageId,
    input: { message: input.message, variants: input.variants },
    userIsEditing: !!(activePage && activePage.elements.length > 0 && !(input.variants && input.variants > 1)),
    emit,
    lint: (page) => deps.lint.run(brand, assets, page, ctx.canvas.W, ctx.canvas.H),
    state: { trace },
    setCanvas: (W, H) => {
      ctx.canvas = { W, H };
      messages[0] = { role: 'system', content: buildSystemPrompt(brand, assets, W, H) };
    },
  };

  // ---- 1. what the agent sees ----
  const selected = input.canvas.selectedIds || [];
  trace({
    kind: 'observe',
    title: activePage ? `Reading the canvas: ${activePage.elements.length} elements on the active page${selected.length ? `, ${selected.length} selected` : ''}` : 'Reading the canvas',
    detail: activePage
      ? `The agent receives every element's id, role, box, text, font and colour as structured JSON (not pixels). ${selected.length ? `Selected: ${selected.join(', ')}.` : 'Nothing is selected, so "this" is resolved from your words.'}`
      : 'No active page.',
    data: activePage ? { elements: activePage.elements.map((e) => ({ id: e.id, role: e.role || e.type, text: e.text, x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.width), h: Math.round(e.height) })), selectedIds: selected } : undefined,
  });

  let refBrief: any = null;
  if (input.references?.length) {
    emit({ type: 'status', text: `Analysing ${input.references.length} reference image${input.references.length > 1 ? 's' : ''}…` });
    const t0 = Date.now();
    try {
      refBrief = await analyzeReferences(deps.providers.vision, input.references);
      trace({ kind: 'vision', title: `Reference analysed: ${refBrief?.summary?.slice(0, 80) || 'layout brief extracted'}`, detail: 'The vision model turned the reference into a brand-neutral brief (boxes, palette, hierarchy, copy angle). It is a style to recreate, not the current canvas.', data: refBrief, ms: Date.now() - t0 });
    } catch (e: any) {
      trace({ kind: 'note', title: 'Reference analysis failed, continuing without it', detail: e?.message });
    }
  }

  // ---- 2. look at the real render before editing ----
  let renderQA: VisualQA | null = null;
  if (ctx.userIsEditing && input.canvasSnapshot && activePage) {
    emit({ type: 'status', text: 'Looking at the current render…' });
    const t0 = Date.now();
    try {
      renderQA = await inspectRender(deps.providers.vision, input.canvasSnapshot, activePage, ctx.canvas.W, ctx.canvas.H, input.message);
      trace({
        kind: 'vision',
        title: renderQA.issues.length ? `Looked at the canvas: ${renderQA.issues.length} visual issue${renderQA.issues.length > 1 ? 's' : ''} spotted` : 'Looked at the canvas: no visual defects',
        detail: renderQA.summary,
        data: renderQA.issues,
        ms: Date.now() - t0,
      });
    } catch (e: any) {
      trace({ kind: 'note', title: 'Could not inspect the render', detail: e?.message });
    }
  }

  const canvasDesc = {
    activePageId: input.canvas.activePageId,
    selectedIds: selected,
    pages: [...pages.values()].map((p) => ({ id: p.id, background: p.background, elementCount: p.elements.length, elements: p.id === input.canvas.activePageId ? p.elements : undefined })),
  };
  const userParts: string[] = [];
  if (refBrief) userParts.push(`REFERENCE BRIEF (from vision analysis — recreate this composition system with ${brand.name} assets, do not copy brand-specific items):\n${JSON.stringify(refBrief)}`);
  userParts.push(`CANVAS STATE (structured; coordinates are absolute pixels, canvas ${ctx.canvas.W}x${ctx.canvas.H}):\n${JSON.stringify(canvasDesc)}`);
  if (renderQA) userParts.push(`CURRENT RENDER OBSERVATIONS (a vision check of how the active page actually looks right now — these are defects to fix or avoid, NOT a reference to recreate):\n${JSON.stringify(renderQA)}`);
  if (input.variants && input.variants > 1) userParts.push(`VARIANTS REQUESTED: ${input.variants}. Call create_design ${input.variants} times with meaningfully different layouts/colourways/imagery/copy angles. Never reuse the same illustration/photo/bloom asset across variants.`);
  if (activePage && activePage.elements.length === 0 && !(input.variants && input.variants > 1)) userParts.push('The active page is empty: when creating a single new design, pass replacePageId = the active page id so it fills the blank page.');
  userParts.push(`USER REQUEST: ${input.message}`);

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(brand, assets, ctx.canvas.W, ctx.canvas.H) },
    ...input.history.map((h) => ({ role: h.role, content: h.content }) as ChatMessage),
    { role: 'user', content: userParts.join('\n\n') },
  ];
  const toolDefs = deps.tools.map((t) => t.definition);
  const toolByName = new Map(deps.tools.map((t) => [(t.definition as any).function.name as string, t]));

  const summariseArgs = (name: string, args: any) => {
    if (name === 'create_design') return { name: args?.design?.name, elements: Array.isArray(args?.design?.elements) ? args.design.elements.length : undefined, rationale: args?.design?.rationale };
    if (name === 'update_design') return { pageId: args?.pageId, rationale: args?.rationale, ops: args?.ops };
    return args;
  };

  // ---- 3. plan / act loop ----
  let finalText = 'Done.';
  let iter = 0;
  const runPlanner = async (): Promise<boolean> => {
    // returns false when the planner answered with a final message
    for (; iter < MAX_ITER; iter++) {
      if (signal?.aborted) return false;
      emit({ type: 'status', text: iter === 0 ? 'Planning…' : 'Thinking…' });
      const t0 = Date.now();
      const { message: msg, usage } = await deps.providers.planner.chat(messages, toolDefs);
      const ms = Date.now() - t0;
      console.log(`[agent] iter ${iter} ${ms}ms tools=${msg.tool_calls?.length || 0} tokens=${usage?.total_tokens ?? '?'} cached=${usage?.prompt_tokens_details?.cached_tokens ?? 0}`);
      messages.push(msg as any);
      if (!msg.tool_calls?.length) {
        finalText = msg.content || finalText;
        return false;
      }
      if (msg.content) trace({ kind: 'plan', title: msg.content.slice(0, 100), detail: msg.content, ms });
      const PARALLEL = new Set(['generate_image', 'search_assets', 'lint_page']);
      const run = async (call: any): Promise<string> => {
        const fn = call.function;
        const tool = toolByName.get(fn.name);
        let args: any = {};
        try {
          args = JSON.parse(fn.arguments || '{}');
        } catch {
          return 'ERROR: arguments were not valid JSON. Re-send the call with valid JSON.';
        }
        const started = Date.now();
        trace({ kind: 'tool', title: `${fn.name}${args?.rationale ? `: ${String(args.rationale).slice(0, 90)}` : args?.design?.name ? `: ${args.design.name}` : ''}`, detail: args?.rationale || args?.design?.rationale, data: summariseArgs(fn.name, args) });
        try {
          const result = tool ? await tool.execute(args, ctx) : `ERROR: unknown tool ${fn.name}`;
          trace({ kind: result.startsWith('ERROR') ? 'note' : 'validate', title: result.startsWith('ERROR') ? `${fn.name} failed: ${result.slice(7, 90)}` : `${fn.name} result: ${result.replace(/^Created page \w+\. Elements: [^.]*\. /, '').slice(0, 110)}`, detail: result, ms: Date.now() - started });
          return result;
        } catch (e: any) {
          const result = `ERROR: ${e?.message || e}`;
          trace({ kind: 'note', title: `${fn.name} failed`, detail: result, ms: Date.now() - started });
          return result;
        }
      };
      const calls = msg.tool_calls as any[];
      const results = new Map<string, string>();
      await Promise.all(calls.filter((c) => PARALLEL.has(c.function.name)).map(async (c) => results.set(c.id, await run(c))));
      for (const c of calls) {
        if (signal?.aborted) return false;
        if (!results.has(c.id)) results.set(c.id, await run(c));
      }
      for (const c of calls) {
        const result = results.get(c.id)!;
        console.log(`[agent] ${c.function.name} -> ${result.slice(0, 300)}`);
        messages.push({ role: 'tool', tool_call_id: c.id, content: result });
      }
    }
    return false;
  };

  await runPlanner();

  // ---- 4. final deterministic validation ----
  const touched: Set<string> = ctx.state.touched || new Set();
  const validateTouched = () => {
    for (const id of touched) {
      const page = pages.get(id);
      if (!page) continue;
      const { report, lint } = validateAndFix(ctx, page, true);
      emit({ type: 'lint', pageId: id, result: lint });
      trace({ kind: 'validate', title: `Validator on ${report.name || id}: ${lintSummary(lint).slice(0, 100)}`, detail: report.autoFixed.length ? `Auto-fixed: ${report.autoFixed.join(', ')}` : undefined, data: lint.issues });
      if (report.autoFixed.length) emit({ type: 'report', pageId: id, report: { ...report, name: 'Final validation' } });
    }
  };
  if (touched.size) {
    emit({ type: 'status', text: `Final brand validation on ${touched.size} page${touched.size > 1 ? 's' : ''}…` });
    validateTouched();
  }

  // ---- 5. visual QA loop: look at the real pixels, fix, look again (bounded) ----
  const qaTarget = touched.size === 1 ? [...touched][0] : touched.has(input.canvas.activePageId) ? input.canvas.activePageId : null;
  if (qaTarget && !(input.variants && input.variants > 1)) {
    for (let round = 0; round < VISUAL_QA_ROUNDS; round++) {
      if (signal?.aborted) return;
      const page = pages.get(qaTarget);
      if (!page) break;
      emit({ type: 'status', text: round === 0 ? 'Visual QA: checking the rendered result…' : 'Visual QA: re-checking after fixes…' });
      const requestId = randomUUID();
      const wait = waitForSnapshot(requestId, 12000);
      emit({ type: 'snapshot_request', pageId: page.id, requestId });
      const shot = await wait;
      if (!shot) {
        trace({ kind: 'note', title: 'Visual QA skipped: the editor did not return a snapshot' });
        break;
      }
      const t0 = Date.now();
      let qa: VisualQA;
      try {
        qa = await inspectRender(deps.providers.vision, shot, page, ctx.canvas.W, ctx.canvas.H);
      } catch (e: any) {
        trace({ kind: 'note', title: 'Visual QA failed', detail: e?.message });
        break;
      }
      const errors = qa.issues.filter((i) => i.severity === 'error');
      trace({ kind: 'vision', title: errors.length ? `Visual QA round ${round + 1}: ${errors.length} defect${errors.length > 1 ? 's' : ''} to fix` : `Visual QA round ${round + 1}: render looks clean${qa.issues.length ? ` (${qa.issues.length} minor note${qa.issues.length > 1 ? 's' : ''})` : ''}`, detail: qa.summary, data: qa.issues, ms: Date.now() - t0 });
      if (!errors.length || round === VISUAL_QA_ROUNDS - 1) break;
      messages.push({ role: 'user', content: `VISUAL QA of the rendered page ${page.id} found defects that must be fixed now with update_design (use the element ids; coordinates are absolute):\n${JSON.stringify(errors)}\nCurrent elements:\n${JSON.stringify(page.elements.map((e) => ({ id: e.id, role: e.role || e.type, x: e.x, y: e.y, width: e.width, height: e.height, text: e.text })))}\nFix every defect, then reply with a one-line summary.` });
      ctx.state.rounds = new Map(); // allow fixes
      await runPlanner();
      validateTouched();
    }
  }

  emit({ type: 'message', text: finalText });
}
