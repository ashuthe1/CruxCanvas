import type { AgentTool } from '../../core/interfaces.js';
import type { Op } from '../../core/types.js';
import { applyOpsCompact, expandContainerMoves } from '../../lint/index.js';
import { lintSummary, validateAndFix } from './createDesign.js';
import { darkestColor } from '../../render/renderer.js';

export const updateDesignTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'update_design',
      description:
        'Apply element operations to an existing page. ops: {op:"set",id,props:{x,y,width,height,text,fontSize,fill,src,opacity,rotation,...}} | {op:"delete",id} | {op:"raise",id} (bring to front) | {op:"add",element:{type:"text"|"image"|"figure", x,y,width,height, text?, fontSize?, fill?, assetId? (library image), src? (generated image), subType?:"rect"|"circle", cornerRadius?, custom:{role}}} | {op:"background",value:"#hex"}. Prefer "set" on existing ids over adding. Moving a card moves its contents. Returns the updated lint report.',
      parameters: { type: 'object', properties: { pageId: { type: 'string' }, ops: { type: 'array', items: { type: 'object' } } }, required: ['pageId', 'ops'] },
    },
  },
  async execute(args, ctx) {
    const page = ctx.pages.get(args.pageId) || ctx.pages.get(ctx.activePageId);
    if (!page) return 'ERROR: unknown pageId';
    const rounds = (ctx.state.rounds ||= new Map<string, number>());
    const r = (rounds.get(page.id) || 0) + 1;
    rounds.set(page.id, r);
    if (r > (ctx.userIsEditing ? 4 : 2)) return `STOP: you have already adjusted ${page.id} ${r - 1} times. Remaining lint items are acceptable — do not call update_design again for this page; finish with your summary.`;

    const rawOps: Op[] = Array.isArray(args.ops) ? args.ops : [];
    const { W, H } = ctx.canvas;
    const dark = darkestColor(ctx.brand);
    for (const op of rawOps) {
      if (op.op !== 'add' || !op.element) continue;
      const el = op.element;
      if (!el.id) el.id = 'el_' + Math.random().toString(36).slice(2, 10);
      if (el.type === 'text') {
        const role = el.custom?.role || el.role || 'body';
        el.fontFamily = el.fontFamily || (role === 'headline' ? ctx.brand.fonts.headline.family : role === 'cta' || role === 'label' ? ctx.brand.fonts.bodyBold.family : ctx.brand.fonts.body.family);
        el.fill = el.fill && el.fill !== 'black' ? el.fill : dark;
        el.fontSize = el.fontSize || Math.round(Math.min(W, H) * 0.026);
        el.width = el.width || Math.round(W * 0.6);
        el.height = el.height || Math.round(el.fontSize * 1.4);
        el.name = el.name || role;
        el.custom = { ...(el.custom || {}), role };
      } else if (el.type === 'figure') {
        el.fill = el.fill && el.fill !== 'black' ? el.fill : dark;
        el.strokeWidth = el.strokeWidth ?? 0;
      } else if (el.type === 'image' && el.assetId && !el.src) {
        const a = ctx.assets.find((x) => x.id === el.assetId);
        if (a) {
          el.src = a.url;
          el.custom = { ...(el.custom || {}), assetId: a.id, role: el.custom?.role || a.category };
          if (el.width && !el.height) el.height = Math.round(el.width / (a.width / a.height));
        }
      }
    }
    // images keep their aspect ratio when only one dimension is set (otherwise the canvas crops them)
    for (const op of rawOps) {
      if (op.op !== 'set') continue;
      const el = page.elements.find((e) => e.id === op.id);
      if (!el || !(el.type === 'image' || el.type === 'svg') || !el.width || !el.height) continue;
      if (op.props.width !== undefined && op.props.height === undefined) op.props.height = Math.round(op.props.width * (el.height / el.width));
      else if (op.props.height !== undefined && op.props.width === undefined) op.props.width = Math.round(op.props.height * (el.width / el.height));
    }
    const ops = expandContainerMoves(page, rawOps);
    ctx.emit({ type: 'status', text: `Applying ${rawOps.length} change${rawOps.length === 1 ? '' : 's'}…` });
    applyOpsCompact(page, ops);
    ctx.emit({ type: 'ops', pageId: page.id, ops });
    (ctx.state.touched ||= new Set<string>()).add(page.id);
    const { report, lint } = validateAndFix(ctx, page, true);
    ctx.emit({ type: 'lint', pageId: page.id, result: lint });
    ctx.emit({ type: 'report', pageId: page.id, report: { ...report, name: 'Edit applied' } });
    return `Applied ${rawOps.length} ops to ${page.id}. Auto-fixed: ${report.autoFixed.join(', ') || 'nothing'}. Brand lint: ${lintSummary(lint)}`;
  },
};
