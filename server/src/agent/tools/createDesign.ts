import type { AgentTool, ToolContext } from '../../core/interfaces.js';
import type { DesignReport } from '../../core/types.js';
import { DesignSchema } from '../../render/schema.js';
import { DesignRenderer } from '../../render/renderer.js';
import { LintEngine, applyOpsCompact, compactFromPage } from '../../lint/index.js';
import { brandRepository } from '../../brands/index.js';

export function lintSummary(res: { score: number; issues: any[] }) {
  if (!res.issues.length) return `score ${res.score}/100, no issues`;
  return `score ${res.score}/100. Remaining: ` + res.issues.map((i) => `[${i.severity}] ${i.rule}: ${i.message}${i.elementId ? ` (element ${i.elementId})` : ''}`).join(' | ');
}

/** Lint, auto-apply error fixes (and re-lint) — the "validator" step every design passes through. */
export function validateAndFix(ctx: ToolContext, page: any, emitOps: boolean, name?: string, rationale?: string): { report: DesignReport; lint: ReturnType<ToolContext['lint']> } {
  let lint = ctx.lint(page);
  const autoFixed: string[] = [];
  for (let round = 0; round < 2; round++) {
    const { ops, fixed } = LintEngine.collectFixes(lint, ['error'], true);
    if (!ops.length) break;
    applyOpsCompact(page, ops);
    if (emitOps) ctx.emit({ type: 'ops', pageId: page.id, ops });
    autoFixed.push(...fixed.filter((f) => !autoFixed.includes(f)));
    lint = ctx.lint(page);
  }
  const report: DesignReport = {
    name,
    rationale,
    score: lint.score,
    checks: [...lint.passed.map((rule) => ({ rule, ok: true })), ...lint.issues.map((i) => ({ rule: i.rule, ok: false, detail: i.message }))],
    autoFixed,
  };
  return { report, lint };
}

export const createDesignTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'create_design',
      description: 'Render a new design as a new editable page on the canvas. It is validated, brand-linted and auto-fixed. Returns the page id, element ids and the final report.',
      parameters: {
        type: 'object',
        properties: {
          design: { type: 'object', description: 'Design spec (see system prompt). Must include elements[] and a one-sentence rationale.' },
          replacePageId: { type: 'string', description: 'Optional: replace this existing page instead of adding one (use when the active page is empty or the user says "redo this page").' },
        },
        required: ['design'],
      },
    },
  },
  async execute(args, ctx) {
    const n = (ctx.state.designs = (ctx.state.designs || 0) + 1);
    ctx.emit({ type: 'status', text: `Composing design ${n}${args.design?.name ? `: ${args.design.name}` : ''}…` });
    const parsed = DesignSchema.safeParse(args.design);
    if (!parsed.success) return 'ERROR: invalid design spec: ' + parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');

    const renderer = new DesignRenderer(ctx.brand, ctx.assets, (rel) => brandRepository().resolve(ctx.brand.id, rel));
    const page = renderer.render(parsed.data, ctx.canvas.W, ctx.canvas.H);
    const replaceId = args.replacePageId && ctx.pages.has(args.replacePageId) ? args.replacePageId : undefined;
    if (replaceId) page.id = replaceId;

    // validate on the server mirror before the page reaches the editor
    const compact = compactFromPage(page);
    ctx.emit({ type: 'status', text: 'Validating against brand guidelines…' });
    const { report, lint } = validateAndFix(ctx, compact, false, parsed.data.name, parsed.data.rationale);
    // write fixes back into the page JSON so the editor receives the corrected design
    const byId = new Map(compact.elements.map((e) => [e.id, e]));
    page.children = page.children
      .filter((c: any) => byId.has(c.id))
      .map((c: any) => {
        const e = byId.get(c.id)!;
        return { ...c, x: e.x, y: e.y, width: e.width, height: e.height, fill: e.fill ?? c.fill, text: e.text ?? c.text, fontSize: e.fontSize ?? c.fontSize, fontFamily: e.fontFamily ?? c.fontFamily, src: e.src ?? c.src, custom: e.custom ?? c.custom };
      })
      .sort((a: any, b: any) => compact.elements.findIndex((e) => e.id === a.id) - compact.elements.findIndex((e) => e.id === b.id));
    page.background = compact.background;
    ctx.pages.set(page.id, compact);
    (ctx.state.touched ||= new Set<string>()).add(page.id);

    ctx.emit({ type: 'page', page, replacePageId: replaceId });
    ctx.emit({ type: 'lint', pageId: page.id, result: lint });
    ctx.emit({ type: 'report', pageId: page.id, report });

    const idMap = compact.elements.map((e) => `${e.id}=${e.role || e.type}${e.text ? `("${e.text.slice(0, 20)}")` : ''}`).join(', ');
    return `Created page ${page.id}. Elements: ${idMap}. Auto-fixed: ${report.autoFixed.join(', ') || 'nothing'}. Brand lint: ${lintSummary(lint)}`;
  },
};
