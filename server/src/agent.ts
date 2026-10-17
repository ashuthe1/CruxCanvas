/**
 * The copilot: a tool-using agent on DeepSeek V4-Pro.
 * It never touches raw canvas JSON — it writes design specs and element ops, which we
 * validate, render, lint and stream to the editor as events.
 */
import type OpenAI from 'openai';
import { deepseekPro, MODELS, withRetry } from './llm.js';
import { brand, catalogueText, searchAssets, getAsset } from './brand.js';
import { DesignSchema, renderDesign } from './render.js';
import { lintPage, expandContainerMoves, type CompactPage, type Op } from './lint.js';
import { generateImage } from './images.js';
import { analyzeReferences, critiqueRender } from './vision.js';
import { waitForSnapshot } from './snapshots.js';
import { randomUUID } from 'crypto';

export type AgentInput = {
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  canvas: { width: number; height: number; pages: CompactPage[]; activePageId: string; selectedIds: string[] };
  references?: string[];
  variants?: number;
};
export type Emit = (e: any) => void;

/** Polotno page JSON -> compact page used by the linter / planner */
function compactFromPage(page: any): CompactPage {
  return {
    id: page.id,
    background: page.background,
    elements: (page.children || []).map((el: any) => ({
      id: el.id, type: el.type, name: el.name, role: el.custom?.role, container: el.custom?.container, custom: el.custom,
      x: el.x, y: el.y, width: el.width, height: el.height, rotation: el.rotation, opacity: el.opacity,
      text: el.text, fontSize: el.fontSize, fontFamily: el.fontFamily, fill: el.fill, align: el.align,
      src: el.src, assetId: el.custom?.assetId, subType: el.subType, cornerRadius: el.cornerRadius,
    })),
  };
}

function applyOpsCompact(page: CompactPage, ops: Op[]) {
  for (const op of ops) {
    if (op.op === 'set') {
      const el = page.elements.find((e) => e.id === op.id);
      if (el) Object.assign(el, op.props, op.props.custom ? { role: op.props.custom.role || el.role, assetId: op.props.custom.assetId || el.assetId } : {});
    } else if (op.op === 'delete') {
      page.elements = page.elements.filter((e) => e.id !== op.id);
    } else if (op.op === 'add') {
      page.elements.push(compactFromPage({ children: [op.element] }).elements[0]);
    } else if (op.op === 'background') {
      page.background = op.value;
    }
  }
}

function lintSummary(res: { score: number; issues: any[] }) {
  if (!res.issues.length) return `score ${res.score}/100, no issues`;
  return `score ${res.score}/100. Issues: ` + res.issues.map((i) => `[${i.severity}] ${i.rule}: ${i.message}${i.elementId ? ` (element ${i.elementId})` : ''}`).join(' | ');
}

const SYSTEM = (W: number, H: number) => `You are the Xero Brand Copilot inside a design editor (Canva-like, layered, fully editable). You help designers create on-brand social/display images from scratch, edit the current design, or recreate the style of reference images with Xero's own assets.

# Canvas
Current canvas is ${W}x${H}px. All coordinates you output are absolute pixels in that space (origin top-left). Elements are listed in z-order (first = back).

# Brand (Xero)
${JSON.stringify({ colors: brand.colors, fonts: brand.fonts.notes, logo: { ...brand.logo, assets: undefined }, layout: brand.layout, voice: brand.voice, imagery: brand.imagery, rules: brand.rules, safeZones: brand.safeZones })}

# Asset library (use ids exactly)
${catalogueText()}

# Design spec you write with create_design
{
 "name": "short name",
 "background": "#hex from palette OR a background-template asset id",
 "elements": [  // back to front
  {"kind":"image","role":"bloom|photo|illustration|charm|product-ui|decor","assetId":"...","x":..,"y":..,"width":..,"height"?:..,"rotation"?:..,"flipX"?:true,"opacity"?:..},
  {"kind":"image","role":"illustration","src":"/generated/...png","x":..,"y":..,"width":..},   // from generate_image
  {"kind":"card","x":..,"y":..,"width":..,"padding"?:..,"gap"?:..,"color"?:"#FFFFFF","align"?:"left|center","anchor"?:"top|bottom","children":[ ...text/cta/checklist/spacer... ]},
  {"kind":"stack","x":..,"y":..,"width":..,"gap"?:..,"align"?:"left|center","anchor"?:"top|bottom","children":[ ... ]},   // same as card but no background rect
  {"kind":"shape","shape":"rect|circle|pill","x":..,"y":..,"width":..,"height":..,"color":"#hex","opacity"?:..,"rotation"?:..},
  {"kind":"logo","variant":"navy|white|light-blue","x":..,"y":..,"width":..,"pill"?:"white|navy|light-blue"},
  {"kind":"checklist","items":["Accounting","Payments","Payroll","Analytics"],"x":..,"y":..,"color"?:"#hex","columns"?:2}
 ]
}
Children of card/stack (laid out top-to-bottom automatically, heights measured with the real fonts, headline auto-shrinks to fit maxLines):
  {"kind":"text","role":"headline|subhead|body|label|legal|stat","text":"...","fontSize"?:..,"maxLines"?:3,"color"?:"#hex","align"?:..}
  {"kind":"cta","text":"Try Xero for free","bg"?:"#000856","color"?:"#FFFFFF"}
  {"kind":"checklist","items":[...]} | {"kind":"spacer","height":..}
ALWAYS put headline/subhead/CTA inside one card or stack — never as loose text elements — so they can't overlap. Loose text/cta (with x,y,width) is only for isolated labels (e.g. legal line, a stat badge). The container's height is computed from its content (you may pass "height" as a minimum). With anchor:"bottom", y is the container's bottom edge.

# Proven layout recipes (from Xero's own ads; S = min(W,H))
A) "Card on bloom" — background #3ECCFE (or #000856). One big bloom (navy on light blue / #1868D8 or #3ECCFE on navy) partially off-canvas (e.g. x=-0.15W, y=-0.1H, width=0.9W). White card x=0.07W y=0.08H width=0.86W with children [headline, (subhead), cta]. Lower half: photo or illustration or product-ui (width 0.6–0.8W) anchored bottom, y chosen so it starts below the card (card height ≈ 0.32–0.42H for a 2–3 line headline + CTA). Logo navy width 0.2W bottom-right (or bottom-left) at margin 0.06S; optional 1 charm (0.09W) overlapping the card corner.
B) "Headline on navy" — background #000856. stack x=0.06W y=0.08H width=0.88W with children [headline white 0.08S, cta bg #3ECCFE color #000856]. Light-blue bloom bottom-right partially off canvas behind an illustration (width 0.7W) in the lower half. Logo white or light-blue bottom-left width 0.2W.
C) "Light blue statement" — background #3ECCFE, navy bloom at bottom; white card [headline, subhead, cta]; product-ui device shot overlapping the card bottom edge; logo navy bottom-right; checklist near logo.
D) "Stat" — background #000856; stack [stat text e.g. "93%" white, headline white 0.06S, legal]; light-blue bloom; logo light-blue.
E) "Photo hero" — generate a photo (purpose "photo", 1024x1536 for portrait) filling the lower 55–60%: give the photo x=0, width=W, y≈0.42H and height=H-y (photos are cover-cropped into their box, faces kept); card with headline+cta in the top 40%; navy bloom peeking from a corner; logo with pill if it sits over the photo.
Formats: for 9:16 Stories (1080x1920) keep every text container, CTA and logo between y=0.15H and y=0.63H and inside x=0.07W..0.93W (Meta UI covers the top 14% and bottom 35%); photos/blooms may fill the rest. For 4:5 keep them between 0.07H and 0.88H. When moving a card with update_design, set x/y on the card only — its contents move with it.
Imagery sizing: illustrations and product-ui shots should be big — width 0.55–0.8W, anchored to the lower half, may bleed off the bottom edge by up to 10%. Never leave a large empty middle. Charms are small (0.08–0.11W) and sit on a card corner, never on text. Checklist (if used) sits in the bottom strip on the opposite side to the logo.
Vary across variants: colourway (light-blue vs navy), bloom choice/orientation, imagery type (photo vs illustration vs product-ui), card vs stack, logo corner, copy angle. Keep ONE logo, ONE CTA, headline ≤ 60 chars, sentence case, no exclamation marks. Leave breathing room: nothing except blooms/photos within 0.06S of the edges; don't let images cover text.

# Workflow
1. Understand intent: create from blank / edit current page / recreate from references / make N variants.
2. For new designs call create_design once per design (N times for N variants, each meaningfully different). Pick assets by id from the library; use generate_image only when no library asset fits (e.g. a specific photo subject or a bespoke illustration). Photos: there are no stock photos in the library — generate one (purpose "photo") when a layout needs a person.
3. create_design returns a brand-lint report. Only fix [error] items (and only once, in a single update_design call per page). [warn]/[info] items are advisory — ignore them unless trivial. Never chase a perfect score; never call lint_page just to re-check.
4. For edits to the existing page, use update_design with precise ops on existing element ids (set props, delete, add). Preserve what the user didn't ask to change. If the user selected elements, those are the target.
5. Finish with a brief, friendly summary (1–3 sentences, plain text, no markdown, no asterisks) of what you made and any choices worth noting. For multiple variants, one short line per variant.

Be decisive and fast. Never ask clarifying questions for simple requests — make a sensible on-brand choice and mention it.`;

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_design',
      description: 'Render a new design as a new editable page on the canvas. Returns the page id, element ids and a brand-lint report.',
      parameters: {
        type: 'object',
        properties: {
          design: { type: 'object', description: 'Design spec (see system prompt). Must include elements[].' },
          replacePageId: { type: 'string', description: 'Optional: replace this existing page instead of adding a new one (use for "redo this page").' },
        },
        required: ['design'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_design',
      description: 'Apply element operations to an existing page. ops: {op:"set",id,props:{x,y,width,height,text,fontSize,fill,src,opacity,rotation,...}} | {op:"delete",id} | {op:"add",element:{type:"text"|"image"|"figure", x,y,width,height, text?, fontSize?, fill?, assetId? (library image), src? (generated image), subType?:"rect"|"circle", cornerRadius?, custom:{role}}} | {op:"background",value:"#hex"}. Prefer "set" on existing ids over adding new elements. Returns the updated lint report.',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string' },
          ops: { type: 'array', items: { type: 'object' } },
        },
        required: ['pageId', 'ops'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: 'Generate a raster image with the image model in Xero style. Use for bespoke illustrations (transparent bg), photos of people/scenes, or abstract backgrounds. Returns {src,width,height} to use in an image element.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Subject description only; brand style is added automatically.' },
          purpose: { type: 'string', enum: ['illustration', 'photo', 'background', 'charm'] },
          size: { type: 'string', enum: ['1024x1024', '1536x1024', '1024x1536'] },
        },
        required: ['prompt', 'purpose'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_assets',
      description: 'Search the brand asset library by keywords (and optional category) when the catalogue above is not enough.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, category: { type: 'string', enum: ['logo', 'bloom', 'background', 'illustration', 'charm', 'product-ui'] } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lint_page',
      description: 'Run the brand compliance checker on a page.',
      parameters: { type: 'object', properties: { pageId: { type: 'string' } }, required: ['pageId'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'review_render',
      description: 'Ask an art-director vision model to look at the actual rendered page (real fonts, images) and return up to 4 concrete visual fixes, or LGTM. Use once per design when quality matters (single designs, hero pieces, user asked for polish). Costs ~5s.',
      parameters: { type: 'object', properties: { pageId: { type: 'string' }, brief: { type: 'string', description: 'What this design is trying to do' } }, required: ['pageId'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_canvas_size',
      description: 'Change the canvas size for all pages (e.g. 1080x1920 for Stories/Reels, 1200x628 for LinkedIn/Facebook, 1080x1350 for 4:5 feed). Call BEFORE create_design when the user asks for a specific format.',
      parameters: { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' } }, required: ['width', 'height'] },
    },
  },
];

export async function runAgent(input: AgentInput, emit: Emit, signal?: AbortSignal) {
  let { width: W, height: H } = input.canvas;
  // server-side mirror of the canvas so lint/update can run without round-trips
  const pages = new Map<string, CompactPage>();
  for (const p of input.canvas.pages) pages.set(p.id, JSON.parse(JSON.stringify(p)));

  let refBrief: any = null;
  if (input.references?.length) {
    emit({ type: 'status', text: `Analysing ${input.references.length} reference image${input.references.length > 1 ? 's' : ''}…` });
    try {
      refBrief = await analyzeReferences(input.references);
    } catch (e: any) {
      emit({ type: 'status', text: 'Reference analysis failed, continuing without it' });
    }
  }

  const activePage = pages.get(input.canvas.activePageId);
  const canvasDesc = {
    activePageId: input.canvas.activePageId,
    selectedIds: input.canvas.selectedIds,
    pages: [...pages.values()].map((p) => ({ id: p.id, background: p.background, elementCount: p.elements.length, elements: p.id === input.canvas.activePageId ? p.elements : undefined })),
  };

  const userParts: string[] = [];
  if (refBrief) userParts.push(`REFERENCE BRIEF (from vision analysis — recreate this composition system with Xero assets, do not copy brand-specific items):\n${JSON.stringify(refBrief)}`);
  userParts.push(`CANVAS STATE:\n${JSON.stringify(canvasDesc)}`);
  if (input.variants && input.variants > 1) userParts.push(`VARIANTS REQUESTED: ${input.variants}. Call create_design ${input.variants} times with meaningfully different layouts/colourways/imagery/copy angles. Never reuse the same illustration/photo/bloom asset across variants.`);
  if (activePage && activePage.elements.length === 0 && !input.variants) userParts.push('The active page is empty: when creating a single new design, pass replacePageId = the active page id so it fills the blank page.');
  userParts.push(`USER REQUEST: ${input.message}`);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM(W, H) },
    ...input.history.map((h) => ({ role: h.role, content: h.content }) as OpenAI.Chat.ChatCompletionMessageParam),
    { role: 'user', content: userParts.join('\n\n') },
  ];

  let designsMade = 0;
  const updateRounds = new Map<string, number>();
  const userIsEditing = !!(activePage && activePage.elements.length > 0 && !(input.variants && input.variants > 1));
  for (let iter = 0; iter < 14; iter++) {
    if (signal?.aborted) return;
    emit({ type: 'status', text: iter === 0 ? 'Planning the design…' : 'Thinking…' });
    const t0 = Date.now();
    const res = await withRetry(() =>
      deepseekPro.chat.completions.create({ model: MODELS.planner, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.7, max_tokens: 6000 }),
    );
    const msg = res.choices[0].message;
    console.log(`[agent] iter ${iter} ${Date.now() - t0}ms tools=${msg.tool_calls?.length || 0} usage=${JSON.stringify(res.usage)}`);
    messages.push(msg as any);

    if (!msg.tool_calls?.length) {
      emit({ type: 'message', text: msg.content || 'Done.' });
      return;
    }

    for (const call of msg.tool_calls) {
      if (signal?.aborted) return;
      const fn = (call as any).function;
      console.log(`[agent] tool ${fn.name} (${(fn.arguments || '').length} chars)`);
      let args: any = {};
      try {
        args = JSON.parse(fn.arguments || '{}');
      } catch (e) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'ERROR: arguments were not valid JSON. Re-send the call with valid JSON.' });
        continue;
      }
      let result: string;
      try {
        switch (fn.name) {
          case 'create_design': {
            designsMade++;
            emit({ type: 'status', text: `Composing design ${designsMade}${args.design?.name ? `: ${args.design.name}` : ''}…` });
            const parsed = DesignSchema.safeParse(args.design);
            if (!parsed.success) {
              result = 'ERROR: invalid design spec: ' + parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
              break;
            }
            const page = renderDesign(parsed.data, W, H);
            const replaceId = args.replacePageId && pages.has(args.replacePageId) ? args.replacePageId : undefined;
            if (replaceId) page.id = replaceId;
            const compact = compactFromPage(page);
            pages.set(page.id, compact);
            emit({ type: 'page', page, replacePageId: replaceId });
            emit({ type: 'status', text: 'Checking brand compliance…' });
            const lint = lintPage(compact, W, H);
            emit({ type: 'lint', pageId: page.id, result: lint });
            const idMap = compact.elements.map((e) => `${e.id}=${e.role || e.type}${e.text ? `("${e.text.slice(0, 20)}")` : ''}`).join(', ');
            result = `Created page ${page.id}. Elements: ${idMap}. Brand lint: ${lintSummary(lint)}`;
            break;
          }
          case 'update_design': {
            const page = pages.get(args.pageId) || activePage;
            if (!page) {
              result = 'ERROR: unknown pageId';
              break;
            }
            const rounds = (updateRounds.get(page.id) || 0) + 1;
            updateRounds.set(page.id, rounds);
            if (rounds > (userIsEditing ? 4 : 3)) {
              result = `STOP: you have already adjusted ${page.id} ${rounds - 1} times. Remaining lint items are acceptable — do not call update_design again for this page; finish with your summary.`;
              break;
            }
            const rawOps: Op[] = Array.isArray(args.ops) ? args.ops : [];
            const ops = expandContainerMoves(page, rawOps); // moving a card moves its text/CTA too
            emit({ type: 'status', text: `Applying ${rawOps.length} change${rawOps.length === 1 ? '' : 's'}…` });
            // give added elements ids + brand defaults so follow-up ops can target them and lint stays clean
            for (const op of ops) {
              if (op.op === 'add' && op.element) {
                const el = op.element;
                if (!el.id) el.id = 'el_' + Math.random().toString(36).slice(2, 10);
                if (el.type === 'text') {
                  const r = el.custom?.role || el.role || 'body';
                  el.fontFamily = el.fontFamily || (r === 'headline' ? brand.fonts.headline : r === 'cta' || r === 'label' ? brand.fonts.bodyBold : brand.fonts.body);
                  el.fill = el.fill && el.fill !== 'black' ? el.fill : '#000856';
                  el.fontSize = el.fontSize || Math.round(Math.min(W, H) * 0.026);
                  el.width = el.width || Math.round(W * 0.6);
                  el.height = el.height || Math.round(el.fontSize * 1.4);
                  el.name = el.name || r;
                  el.custom = { ...(el.custom || {}), role: r };
                } else if (el.type === 'figure') {
                  el.fill = el.fill && el.fill !== 'black' ? el.fill : '#000856';
                  el.strokeWidth = el.strokeWidth ?? 0;
                } else if (el.type === 'image' && el.assetId && !el.src) {
                  const a = getAsset(el.assetId);
                  if (a) {
                    el.src = a.url;
                    el.custom = { ...(el.custom || {}), assetId: a.id, role: el.custom?.role || a.category };
                    if (el.width && !el.height) el.height = Math.round(el.width / (a.width / a.height));
                  }
                }
              }
            }
            applyOpsCompact(page, ops);
            emit({ type: 'ops', pageId: page.id, ops });
            const lint = lintPage(page, W, H);
            emit({ type: 'lint', pageId: page.id, result: lint });
            result = `Applied ${ops.length} ops to ${page.id}. Brand lint: ${lintSummary(lint)}`;
            break;
          }
          case 'generate_image': {
            emit({ type: 'status', text: `Generating ${args.purpose || 'image'}: ${String(args.prompt).slice(0, 60)}…` });
            const g = await generateImage(args.prompt, args.purpose, args.size);
            result = JSON.stringify({ src: g.src, width: g.width, height: g.height, note: 'Use as {"kind":"image","src":...}. Set width in canvas px; height follows aspect.' });
            break;
          }
          case 'search_assets': {
            const found = searchAssets(args.query, args.category);
            result = JSON.stringify(found.map((a) => ({ id: a.id, name: a.name, category: a.category, width: a.width, height: a.height, tags: a.tags })));
            break;
          }
          case 'lint_page': {
            const page = pages.get(args.pageId) || activePage;
            result = page ? lintSummary(lintPage(page, W, H)) : 'ERROR: unknown pageId';
            break;
          }
          case 'set_canvas_size': {
            W = Math.round(args.width);
            H = Math.round(args.height);
            emit({ type: 'size', width: W, height: H });
            messages[0] = { role: 'system', content: SYSTEM(W, H) };
            result = `Canvas is now ${W}x${H}. Use these dimensions for all coordinates.`;
            break;
          }
          case 'review_render': {
            const page = pages.get(args.pageId) || activePage;
            if (!page) {
              result = 'ERROR: unknown pageId';
              break;
            }
            emit({ type: 'status', text: 'Reviewing the rendered design…' });
            const requestId = randomUUID();
            const wait = waitForSnapshot(requestId);
            emit({ type: 'snapshot_request', pageId: page.id, requestId });
            const dataUrl = await wait;
            if (!dataUrl) {
              result = 'Snapshot unavailable; skip visual review.';
              break;
            }
            const elementList = page.elements.map((e) => `${e.id}=${e.role || e.type}${e.text ? `("${(e.text || '').slice(0, 20)}")` : ''} @${Math.round(e.x)},${Math.round(e.y)} ${Math.round(e.width)}x${Math.round(e.height)}`).join('; ');
            const critique = await critiqueRender(dataUrl, `Canvas ${W}x${H}. Brief: ${args.brief || input.message}. Elements: ${elementList}`);
            result = `Visual review: ${critique}\n(Apply fixes with update_design using the element ids above, if any are worth it.)`;
            break;
          }
          default:
            result = `ERROR: unknown tool ${fn.name}`;
        }
      } catch (e: any) {
        result = `ERROR: ${e?.message || e}`;
      }
      console.log(`[agent] ${fn.name} -> ${result.slice(0, 400)}`);
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }
  emit({ type: 'message', text: 'I made the changes above (stopped after several steps). Tell me what to refine next.' });
}

export { getAsset };
