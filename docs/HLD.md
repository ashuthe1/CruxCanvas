# High-Level Design — Brand Copilot

An AI copilot inside a layered, editable image editor (Polotno). It designs on-brand social and display images for any
onboarded brand, edits the current design, and recreates the style of reference ads with the brand's own assets.
First tenant: Xero. Built for the GetCrux AI Hackathon, 17 Oct 2026.

Companion docs: [architecture.md](architecture.md) (component diagram, request lifecycle), [flows.md](flows.md)
(sequence diagrams), [brand-onboarding.md](brand-onboarding.md), [demo-script.md](demo-script.md).

## 1. Goals

| Goal | How the system meets it |
|---|---|
| Output is on-brand and **fully editable** | The planner writes a structured design spec, not pixels. `render/renderer.ts` turns it into real Polotno layers: text in the brand's font files, shapes, the actual logo asset, library images. |
| Compliance is **enforced**, not hoped for | `lint/` runs 13 deterministic rules over every page. Error-level issues carry fix ops that are auto-applied before the page reaches the editor and again at the end of each run (`validateAndFix`). |
| Three ways of working, one loop | Create from blank (`create_design`), edit the current page (`update_design` with element ops), recreate reference ads (vision brief → planner). `agent/runAgent.ts` handles all three. |
| **Brand-agnostic** | Everything brand-specific flows through the `BrandKit` type loaded from `brands/<id>/brand.json`. No module names a company. Brand is selected per request via `x-brand-id`. |
| Explainable | Every design produces a `DesignReport` (rationale, auto-fixes, checks passed/failed) rendered as a report card in the chat. |
| Fast enough to demo live | NDJSON streaming of status/page/ops events; planner iteration cap of 14; snapshot round-trip timeout of 15 s; lint is synchronous and local. |

## 2. Non-goals

- Pixel-painting typography or logos with an image model. Image generation is used only for bespoke illustrations, photos, backgrounds and charms (`generate_image`).
- Multi-user persistence. Canvas autosave is per brand in the browser's `localStorage` (`web/src/lib/persist.ts`); there is no server-side document store.
- Authentication or tenant isolation beyond a brand id. `brandIdOf` trusts the header/query/body.
- Horizontal scaling. The snapshot round-trip keeps pending requests in an in-process `Map` (`agent/snapshots.ts`), so one server process serves one editor session's agent run.
- Arbitrary Polotno element types. The spec vocabulary is deliberately small (text, cta, checklist, spacer, card/stack, image, shape, logo).

## 3. High-level design

```
browser (Vite + React + Polotno)                    server (Node + Express + TypeScript)
┌─────────────────────────────────┐   x-brand-id    ┌──────────────────────────────────────────────┐
│ Polotno canvas + Brand kit panel│ ──────────────► │ api/routes.ts  REST + NDJSON /api/agent       │
│ CopilotPanel (chat, refs, ×N)   │ ◄── NDJSON ──── │ agent/runAgent.ts  planner loop + tool registry│
│ LintPanel (live lint, fixes)    │                 │   tools: create_design, update_design,         │
│ ReportCard (rationale, checks)  │                 │          generate_image, search_assets,        │
│ canvas.ts  serialize / applyOps │                 │          lint_page, review_render, set_canvas  │
│ persist.ts autosave per brand   │                 │ render/   spec → layers (opentype.js metrics)  │
└─────────────────────────────────┘                 │ lint/     13 rules → issues + fix ops          │
                                                    │ brands/   IBrandRepository (filesystem)        │
   brands/<id>/ brand.json, assets.json,            │ providers/ planner, vision, images             │
                assets/, fonts/, references/        │ scripts/  onboarding CLIs                      │
                                                    └──────────────────────────────────────────────┘
```

The server keeps a **compact mirror** of the canvas for the duration of a run (`ctx.pages: Map<pageId, CompactPage>`).
Tools mutate the mirror and emit the same mutation to the editor as events, so both sides stay in sync without the
browser re-sending the canvas after every tool call.

## 4. Component responsibilities

| Component | Files | Responsibility |
|---|---|---|
| Contracts | `server/src/core/types.ts`, `core/interfaces.ts` | Domain types and the five extension interfaces (`IBrandRepository`, `IPlannerModel`, `IVisionModel`, `IImageModel`, `LintRule`, `AgentTool`). |
| Brand repository | `brands/fsBrandRepository.ts`, `brands/index.ts` | Loads `brand.json` + `assets.json` per brand with an mtime cache; lists brands (folders starting with `_` are skipped); resolves font/asset paths; `catalogueText` and `searchAssets` for prompts. |
| Providers | `providers/*.ts` | Thin adapters over the OpenAI SDK. Planner is any OpenAI-compatible chat endpoint with tools (DeepSeek-V4-Pro by default), vision is `gpt-4.1`, images `gpt-image-1`. `withRetry` retries 429/5xx four times with linear backoff. |
| Design spec | `render/schema.ts` | Zod schema for what the planner writes, plus `DESIGN_SPEC_DOC`, the human-readable version embedded in the system prompt. |
| Renderer | `render/renderer.ts`, `render/text.ts` | Spec → Polotno page JSON. Measures text with the brand's `.ttf` via opentype.js, auto-stacks card/stack children, shrinks headlines to `maxLines`, cover-crops photos with a face-safe focus, nudges imagery below text containers, parks charms on card corners, clamps elements on-canvas, enforces logo minimum width and keeps the logo (and pill) on top. |
| Linter | `lint/engine.ts`, `lint/rules/*.ts`, `lint/helpers.ts` | Runs the rule registry over a `CompactPage`; scores 100 minus 15/7/3 per error/warn/info; `collectFixes` dedupes fix ops per element/prop. Helpers apply ops to the mirror and expand card moves to their contents. |
| Agent loop | `agent/runAgent.ts`, `agent/prompt.ts` | Builds the system prompt from the BrandKit + asset catalogue + spec doc + recipes, runs the planner/tool loop (max 14 iterations), then a final `validateAndFix` over every touched page. |
| Tools | `agent/tools/*.ts` | `create_design`, `update_design`, `generate_image`, `search_assets`, `lint_page`, `review_render`, `set_canvas_size`. Registered in `agent/tools/index.ts`. |
| Reference analysis | `agent/references.ts` | Vision prompt that turns reference images into a brand-neutral layout brief (normalised boxes, palette roles, copy angle, `doNotCopy`). |
| Snapshot round-trip | `agent/snapshots.ts` | Pending-request map so `review_render` can wait for the browser to post a rendered JPEG of the real page. |
| API | `api/routes.ts`, `index.ts` | Express router, static mounts for `/brands` and `/generated`, 40 MB JSON limit (reference images arrive as data URLs). |
| Web shell | `web/src/App.tsx`, `store.ts` | Polotno container with a custom Brand kit section first, then text/elements/upload/background/layers/size. Registers brand fonts from `fontUrls`. |
| Copilot panel | `web/src/components/CopilotPanel.tsx` | Chat, reference attach (upload, brand library, "canvas as ref"), ×N variants, Stop, brand switcher, zip export, new canvas. Dispatches every `AgentEvent`. Live lint of the active page, debounced 600 ms. |
| Lint panel / report card | `LintPanel.tsx`, `ReportCard.tsx` | Score ring, per-issue Fix, ⚡ Auto-fix (all deterministic fixes, no AI call), ✨ Fix with AI (sends a chat prompt). Report card with thumbnail, rationale, auto-fixes, still-flagged, passed. |
| Canvas bridge | `web/src/lib/canvas.ts` | `serializePage`/`serializeCanvas` (compact form), `applyOps`, `addPageFromJSON` (optionally replacing a page), `pageToDataURL`, `exportAllAsZip`. |
| Onboarding | `server/src/scripts/*` | `onboard`, `manifest`, `download` CLIs. See [brand-onboarding.md](brand-onboarding.md). |

## 5. Data model

All types live in `server/src/core/types.ts`; the web client mirrors the ones it needs in `web/src/lib/api.ts`.

### BrandKit (`brands/<id>/brand.json`)
| Field | Used by |
|---|---|
| `id`, `name`, `tagline` | prompt, UI header |
| `colors[]` `{name, hex, role}` | palette rule (nearest-colour fix), contrast fixes, renderer defaults (`colors[0]` is the dark text colour) |
| `fonts.headline/body/bodyBold` `{family, file}` + `notes` | text measurement, font rule, web font registration |
| `logo.assets` (variant → asset id), `colourways`, `minWidthRatio`, `preferredWidthRatio`, `clearSpace`, `placement`, `variantColors`, `pillColors` | renderer logo element, logo rule (count, size, colourway contrast, clear space, pill over imagery, hidden) |
| `layout.marginRatio`, `card`, `cta`, `headline`, `subhead`, `legal`, `recipes[]` | renderer sizing defaults, edge rule, tone rule, prompt recipes |
| `safeZones{key: {top,bottom,left,right}}` | safe-zone rule, keyed by aspect (e.g. `9:16`, `4:5`, `default`) |
| `voice`, `imagery`, `rules[]` | prompt only |
| `imageStyles{purpose: prefix}` | `generate_image` prompt prefix |

### Asset (`brands/<id>/assets.json`, one entry per image)
`id` (derived from the relative path), `category` (`logo | bloom | background | illustration | charm | product-ui | photo`),
`name`, `file`, `url` (`/brands/<id>/assets/...`), `width`, `height`, `hasAlpha`, `dominant` (hex over opaque pixels),
`colour` (nearest named colour), `description`, `tags[]`. The catalogue text in the prompt lists id, name, size, aspect,
alpha flag and tags grouped by category.

### CompactPage / CompactEl
The LLM-friendly form of a page. The editor produces it (`serializePage`), the linter reads it, and the server mirror
stores it. `CompactEl` carries `id, type, name, role, container, x, y, width, height` plus type-specific fields
(`text, fontSize, fontFamily, fill, align` / `src, assetId` / `subType, cornerRadius`) and `custom`. `role` comes from
`custom.role` and is how rules recognise headlines, CTAs, logos, cards and imagery.

### Op (the only way anyone changes an existing page)
```
{ op:'set', id, props } | { op:'delete', id } | { op:'add', element } | { op:'raise', id } | { op:'background', value }
```
Emitted by the planner (`update_design`), by lint fixes, and by the validator. Applied on the server with
`applyOpsCompact` and in the browser with `applyOps`. `expandContainerMoves` turns a `set x/y` on a card, logo pill or CTA
background into moves of its contents.

### Issue / LintResult / DesignReport
`Issue { id, rule, severity: error|warn|info, message, elementId?, fix?: Op[] }`.
`LintResult { score, issues[], passed[] }` where `passed` lists rule titles with no findings.
`DesignReport { name?, rationale?, score, checks[{rule, ok, detail?}], autoFixed[] }` is what the report card shows.

### Design spec (what the planner writes, `render/schema.ts`)
Top level: `name`, `rationale`, `background` (palette hex or a background-template asset id), `elements[]` back to
front. Element kinds: `image` (library `assetId` or generated `src`, with `role`), `shape` (`rect|circle|pill`), `card` /
`stack` containers whose children (`text`, `cta`, `checklist`, `spacer`) are stacked top-to-bottom with measured
heights, loose `text`, `cta`, `checklist`, and `logo` (`variant`, optional `pill`). Containers compute their own height;
`anchor:'bottom'` makes `y` the bottom edge.

### AgentEvent (NDJSON stream)
`status`, `page` (+`replacePageId`), `ops`, `lint`, `size`, `snapshot_request`, `report`, `message`, `error`, `done`.

## 6. API surface

All routes under `/api`. Brand resolution order: `x-brand-id` header, `?brand=`, `body.brandId`, `:id` param, then `xero`.

| Method, path | Purpose |
|---|---|
| `GET /health` | `{ok, rules, planner}` |
| `GET /brands` | `[{id, name, tagline}]` for folders with a `brand.json` |
| `GET /brands/:id` | BrandKit plus `fontUrls` for the browser to register |
| `GET /brands/:id/assets?q=&category=` | Full catalogue, or keyword search (limit 200) |
| `GET /brands/:id/references` | Reference ads in `brands/<id>/references/` |
| `GET /brands/:id/rules` | Lint rule titles |
| `POST /lint` `{page, width, height}` | Run the linter on one compact page (defaults 1080×1080) |
| `POST /analyze` `{images[]}` | Reference brief from the vision model |
| `POST /snapshot-reply` `{requestId, dataUrl}` | Browser answers a `snapshot_request` |
| `POST /snapshot` `{dataUrl, name}` | Save a snapshot under `/generated` (debugging) |
| `POST /agent` `AgentInput` | The copilot run; streams `AgentEvent` lines |

Static: `/brands/*` serves `BRANDS_DIR` (assets, fonts, references); `/generated/*` serves `server/generated` (images
from `generate_image`). The Vite dev server proxies `/api`, `/brands` and `/generated` to port 8787.

`AgentInput = { message, history (last 8 chat turns), canvas: CanvasState, references?: dataUrl[], variants? }`.

## 7. Extension points

| Need | Implement | Register |
|---|---|---|
| New brand | a folder in `brands/` (or `npm run onboard`) | automatic on next request (mtime cache) |
| Brand storage (DB, S3) | `IBrandRepository` | `brands/index.ts` |
| Planner / vision / image model | `IPlannerModel` / `IVisionModel` / `IImageModel` | `providers/index.ts` (env: `PLANNER_*`, `VISION_MODEL`, `IMAGE_MODEL`) |
| Brand rule | `LintRule` in `lint/rules/` | the array in `lint/index.ts` |
| Agent capability | `AgentTool` in `agent/tools/` | `defaultTools` in `agent/tools/index.ts` |
| Design element | a spec in `render/schema.ts` + a `case` in `renderer.ts` + a line in `DESIGN_SPEC_DOC` | — |

## 8. Key design decisions and trade-offs

**Structured spec instead of flat image generation.** The brief asks for an editable canvas and judges output
quality first. Image models mangle text, ignore brand fonts, produce no layers and give nothing a validator can check.
Writing a spec means text is real text in the licensed font, the logo is the actual file, every element has an id, and
the result can be linted, auto-fixed, undone and exported. Image generation stays where it adds value
(illustrations with transparent backgrounds, photos, backgrounds).

**Deterministic validator in front of the model.** Lint is instant, explainable and free. Errors are auto-fixed with
concrete ops (nearest palette colour, raise logo, move text back into its card, separate overlapping text). The
planner only sees what remains and is capped at one or two `update_design` rounds per page (four when the user is
editing), so runs stay short and never chase a perfect score.

**Measured layout in the renderer.** Containers stack children using real glyph metrics, so overlapping text cannot
come out of `create_design` regardless of what the model wrote. The cost is a smaller vocabulary than raw Polotno JSON;
in exchange the model writes less and gets it right more often.

**Server-side canvas mirror.** The run holds a compact copy of all pages and applies the same ops it streams. This
keeps tool results accurate without round-trips, at the cost of a divergence risk if a browser-side op fails (ops
are wrapped in try/catch and logged).

**Snapshot round-trip for visual review.** The browser renders with the real fonts and images, so `review_render`
asks it for a JPEG rather than rasterising on the server. This requires the editor to stay connected and the server to
be a single process; acceptable for a hackathon, replaceable with a headless renderer later.

**Filesystem brands.** One folder per tenant keeps onboarding a copy-and-run affair and makes the demo repo
self-contained. The repository interface is the seam for a database.

**Shared, rate-limited endpoints.** All provider calls go through `withRetry`; the planner's prompt is built once per
run and only rebuilt when the canvas size changes, which keeps prompt-cache hits high (logged per iteration).

## 9. Known limitations

- Autosave is browser-local; clearing site data loses work.
- `generate_image` output lives in `server/generated/` (git-ignored) and is not tied to a brand.
- `review_render` returns "Snapshot unavailable" after 15 s if the editor does not answer; the run continues.
- The linter reads the compact form, so it cannot see effects Polotno applies at render time (for example text that wraps differently in the browser than in opentype.js measurement).
- Tests cover the renderer and linter (`server/test`, vitest); the agent loop and web client are exercised manually.
