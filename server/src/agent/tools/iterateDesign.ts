import type { AgentTool } from '../../core/interfaces.js';
import { dimensions } from '../../iterate/dimensions.js';
import { iteratePage } from '../../iterate/iterate.js';
import { brandRepository } from '../../brands/index.js';
import { defaultLintEngine } from '../../lint/index.js';

/** Lets the chat run winner iterations too ("give me 3 headline variants of this page"). */
export const iterateDesignTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'iterate_design',
      description: `Winner iterations for A/B testing: duplicate a page N times, changing exactly ONE dimension per copy. dimensions: ${dimensions.map((d) => `"${d.id}" (${d.blurb.toLowerCase()})`).join(', ')}. Use when the user asks for controlled variants, A/B tests, or "try other headlines / colourways / CTAs / imagery / layouts" of an existing page.`,
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string' },
          dimensions: { type: 'array', items: { type: 'string', enum: dimensions.map((d) => d.id) } },
          count: { type: 'number', description: 'total variants (1–6); dimensions are cycled' },
        },
        required: ['pageId', 'dimensions'],
      },
    },
  },
  async execute(args, ctx) {
    const page = ctx.pages.get(args.pageId) || ctx.pages.get(ctx.activePageId);
    if (!page) return 'ERROR: unknown pageId';
    if (!page.elements.length) return 'ERROR: the page is empty; create a design first.';
    const results = await iteratePage(
      { page, width: ctx.canvas.W, height: ctx.canvas.H, dimensions: args.dimensions || [], count: args.count || (args.dimensions || []).length },
      { brandId: ctx.brand.id, brands: brandRepository(), providers: ctx.providers, lint: defaultLintEngine },
      (e) => {
        if (e.type !== 'message') ctx.emit(e);
      },
    );
    return `Created ${results?.length || 0} variant pages next to ${page.id}: ${(results || []).join(' · ') || 'none'}. Do not edit them further; summarise what each variant tests.`;
  },
};
