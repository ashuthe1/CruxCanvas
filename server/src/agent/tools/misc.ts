import { randomUUID } from 'crypto';
import type { AgentTool } from '../../core/interfaces.js';
import { searchAssets } from '../../brands/index.js';
import { waitForSnapshot } from '../snapshots.js';
import { lintSummary } from './createDesign.js';
import { buildSystemPrompt } from '../prompt.js';

export const searchAssetsTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'search_assets',
      description: 'Search the brand asset library by keywords (and optional category) when the catalogue is not enough.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string' } }, required: ['query'] },
    },
  },
  async execute(args, ctx) {
    return JSON.stringify(searchAssets(ctx.assets, args.query, args.category).map((a) => ({ id: a.id, name: a.name, category: a.category, width: a.width, height: a.height, tags: a.tags })));
  },
};

export const lintPageTool: AgentTool = {
  definition: {
    type: 'function',
    function: { name: 'lint_page', description: 'Run the brand compliance checker on a page.', parameters: { type: 'object', properties: { pageId: { type: 'string' } }, required: ['pageId'] } },
  },
  async execute(args, ctx) {
    const page = ctx.pages.get(args.pageId) || ctx.pages.get(ctx.activePageId);
    return page ? lintSummary(ctx.lint(page)) : 'ERROR: unknown pageId';
  },
};

export const setCanvasSizeTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'set_canvas_size',
      description: 'Change the canvas size for all pages (e.g. 1080x1920 Stories/Reels, 1200x628 LinkedIn/Facebook, 1080x1350 4:5 feed). Call BEFORE create_design when the user asks for a specific format.',
      parameters: { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' } }, required: ['width', 'height'] },
    },
  },
  async execute(args, ctx) {
    ctx.setCanvas(Math.round(args.width), Math.round(args.height));
    ctx.emit({ type: 'size', width: ctx.canvas.W, height: ctx.canvas.H });
    return `Canvas is now ${ctx.canvas.W}x${ctx.canvas.H}. Use these dimensions for all coordinates.`;
  },
};

export const reviewRenderTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'review_render',
      description: 'Ask an art-director vision model to look at the actual rendered page (real fonts, images) and return up to 4 concrete visual fixes, or LGTM. Use once per design when quality matters. Costs ~5s.',
      parameters: { type: 'object', properties: { pageId: { type: 'string' }, brief: { type: 'string' } }, required: ['pageId'] },
    },
  },
  async execute(args, ctx) {
    const page = ctx.pages.get(args.pageId) || ctx.pages.get(ctx.activePageId);
    if (!page) return 'ERROR: unknown pageId';
    ctx.emit({ type: 'status', text: 'Reviewing the rendered design…' });
    const requestId = randomUUID();
    const wait = waitForSnapshot(requestId);
    ctx.emit({ type: 'snapshot_request', pageId: page.id, requestId });
    const dataUrl = await wait;
    if (!dataUrl) return 'Snapshot unavailable; skip visual review.';
    const elementList = page.elements.map((e) => `${e.id}=${e.role || e.type}${e.text ? `("${(e.text || '').slice(0, 20)}")` : ''} @${Math.round(e.x)},${Math.round(e.y)} ${Math.round(e.width)}x${Math.round(e.height)}`).join('; ');
    const critique = await ctx.providers.vision.describe(
      'You are a brand design reviewer. Give at most 4 terse, concrete fixes (overlaps, cramped text, misalignment, empty areas, hierarchy, cut-off elements). If it looks good say "LGTM".',
      `Canvas ${ctx.canvas.W}x${ctx.canvas.H}. Brief: ${args.brief || ctx.input.message}. Elements: ${elementList}`,
      dataUrl,
    );
    return `Visual review: ${critique}\n(Apply fixes with update_design using the element ids above, if any are worth it.)`;
  },
};

export { buildSystemPrompt };
