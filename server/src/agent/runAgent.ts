/**
 * The copilot loop: planner (DeepSeek) + tool registry + server-side canvas mirror.
 * Every design passes through the validator (lint + auto-fix) before it reaches the editor,
 * and a final validation pass runs over every page touched in the run.
 */
import type { AgentTool, ChatMessage, IBrandRepository, Providers, ToolContext } from '../core/interfaces.js';
import type { AgentEvent, AgentInput, CompactPage } from '../core/types.js';
import { LintEngine } from '../lint/index.js';
import { buildSystemPrompt } from './prompt.js';
import { validateAndFix } from './tools/createDesign.js';
import { analyzeReferences } from './references.js';

export type AgentDeps = { brandId: string; brands: IBrandRepository; providers: Providers; lint: LintEngine; tools: AgentTool[] };

export async function runAgent(input: AgentInput, deps: AgentDeps, emit: (e: AgentEvent) => void, signal?: AbortSignal) {
  const brand = await deps.brands.get(deps.brandId);
  const assets = await deps.brands.assets(deps.brandId);
  const pages = new Map<string, CompactPage>();
  for (const p of input.canvas.pages) pages.set(p.id, JSON.parse(JSON.stringify(p)));
  const activePage = pages.get(input.canvas.activePageId);

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
    state: {},
    setCanvas: (W, H) => {
      ctx.canvas = { W, H };
      messages[0] = { role: 'system', content: buildSystemPrompt(brand, assets, W, H) };
    },
  };

  let refBrief: any = null;
  if (input.references?.length) {
    emit({ type: 'status', text: `Analysing ${input.references.length} reference image${input.references.length > 1 ? 's' : ''}…` });
    try {
      refBrief = await analyzeReferences(deps.providers.vision, input.references);
    } catch {
      emit({ type: 'status', text: 'Reference analysis failed, continuing without it' });
    }
  }

  const canvasDesc = {
    activePageId: input.canvas.activePageId,
    selectedIds: input.canvas.selectedIds,
    pages: [...pages.values()].map((p) => ({ id: p.id, background: p.background, elementCount: p.elements.length, elements: p.id === input.canvas.activePageId ? p.elements : undefined })),
  };
  const userParts: string[] = [];
  if (refBrief) userParts.push(`REFERENCE BRIEF (from vision analysis — recreate this composition system with ${brand.name} assets, do not copy brand-specific items):\n${JSON.stringify(refBrief)}`);
  userParts.push(`CANVAS STATE:\n${JSON.stringify(canvasDesc)}`);
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

  let finalText = 'Done.';
  for (let iter = 0; iter < 14; iter++) {
    if (signal?.aborted) return;
    emit({ type: 'status', text: iter === 0 ? 'Planning the design…' : 'Thinking…' });
    const t0 = Date.now();
    const { message: msg, usage } = await deps.providers.planner.chat(messages, toolDefs);
    console.log(`[agent] iter ${iter} ${Date.now() - t0}ms tools=${msg.tool_calls?.length || 0} tokens=${usage?.total_tokens ?? '?'} cached=${usage?.prompt_tokens_details?.cached_tokens ?? 0}`);
    messages.push(msg as any);
    if (!msg.tool_calls?.length) {
      finalText = msg.content || finalText;
      break;
    }
    // Slow, side-effect-free tools (image generation, search) run concurrently; canvas-mutating
    // tools run in order so pages/ops arrive at the editor deterministically.
    const PARALLEL = new Set(['generate_image', 'search_assets', 'lint_page']);
    const run = async (call: any): Promise<string> => {
      const fn = call.function;
      const tool = toolByName.get(fn.name);
      try {
        const args = JSON.parse(fn.arguments || '{}');
        return tool ? await tool.execute(args, ctx) : `ERROR: unknown tool ${fn.name}`;
      } catch (e: any) {
        return e instanceof SyntaxError ? 'ERROR: arguments were not valid JSON. Re-send the call with valid JSON.' : `ERROR: ${e?.message || e}`;
      }
    };
    const calls = msg.tool_calls as any[];
    const results = new Map<string, string>();
    await Promise.all(calls.filter((c) => PARALLEL.has(c.function.name)).map(async (c) => results.set(c.id, await run(c))));
    for (const c of calls) {
      if (signal?.aborted) return;
      if (!results.has(c.id)) results.set(c.id, await run(c));
    }
    for (const c of calls) {
      const result = results.get(c.id)!;
      console.log(`[agent] ${c.function.name} -> ${result.slice(0, 300)}`);
      messages.push({ role: 'tool', tool_call_id: c.id, content: result });
    }
  }

  // Final validation pass over everything touched in this run
  const touched: Set<string> = ctx.state.touched || new Set();
  if (touched.size) {
    emit({ type: 'status', text: `Final brand validation on ${touched.size} page${touched.size > 1 ? 's' : ''}…` });
    for (const id of touched) {
      const page = pages.get(id);
      if (!page) continue;
      const { report, lint } = validateAndFix(ctx, page, true);
      emit({ type: 'lint', pageId: id, result: lint });
      if (report.autoFixed.length) emit({ type: 'report', pageId: id, report: { ...report, name: 'Final validation' } });
    }
  }
  emit({ type: 'message', text: finalText });
}
