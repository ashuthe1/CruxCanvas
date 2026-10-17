# Brand Copilot — Agentic Image Editor

An AI copilot inside a real, layered image editor that designs **on-brand, fully editable** images for any
onboarded brand: create from a blank canvas, edit the current design, or recreate the style of reference ads with the
brand's own assets. Built for the GetCrux AI Hackathon (17 Oct 2026). Two tenants ship in the repo: **Xero** (the provided brand kit) and **GetCrux** (onboarded from getcrux.ai and its LinkedIn page with the onboarding script).

> "Create 4 different images like this." → four editable pages, each validated against the brand rules, in ~60 s.

## Why it's built this way

Output quality is the first judging criterion and the brief demands an **editable canvas**. Prompting an image model
and pasting a flat PNG fails both: mangled text, off-brand fonts, no layers, nothing enforceable. So the copilot never
paints pixels for text. It writes a **structured design spec** → the renderer turns it into real canvas layers (text in
the brand fonts, shapes, the actual logo files, library illustrations) → a **deterministic validator** lints it and
auto-fixes errors → the agent only deals with judgement calls. Image generation is used where it adds value: bespoke
illustrations (transparent PNG) and photos, never for typography.

## Architecture

```
┌──────────── web (Vite + React + Polotno) ─────────────┐        ┌──────────────── server (Node/Express, TS) ─────────────────┐
│ brand switcher · Brand kit panel · copilot chat        │        │ api/routes.ts        brand-scoped REST + NDJSON agent stream │
│ report cards (rationale, auto-fixes, checks)           │ ◄────► │ agent/runAgent.ts    planner loop + tool registry            │
│ Brand check tab (live lint, ⚡auto-fix, ✨fix with AI) │        │ agent/tools/*        create_design · update_design ·         │
│ ⑂ Iterate picker + comparison grid (keep / discard)    │        │                      generate_image · review_render · …      │
│ autosave per brand · zip export · snapshot replies     │        │ iterate/             dimension registry + op-set validator   │
└────────────────────────────────────────────────────────┘        │ render/renderer.ts   design spec → layers (font metrics,     │
                                                                  │                      stacking, cropping, collision nudging)  │
  brands/<id>/            one folder per tenant                   │ lint/engine.ts       rule registry → issues + fix ops        │
    brand.json            palette, fonts, logo rules, recipes…    │ lint/rules/*         palette · fonts · logo · contrast ·     │
    assets.json           tagged asset catalogue (generated)      │                      overlap · card contents · safe zones…  │
    assets/ fonts/ refs/  the files                               │ brands/              IBrandRepository (filesystem today)     │
                                                                  │ providers/           IPlannerModel · IVisionModel · IImageModel│
  Planner: DeepSeek-V4-Pro (OpenAI-compatible, tools)             │ scripts/             onboarding: download → tag → draft rules │
  Vision: gpt-4.1 · Images: gpt-image-1                           └──────────────────────────────────────────────────────────────┘
```

### Extension points (SOLID)
| Need | Implement | Register |
|---|---|---|
| New brand | drop a folder in `brands/` (or run onboarding) | automatic |
| New brand storage (DB, S3) | `IBrandRepository` | `brands/index.ts` |
| New planner / vision / image model | `IPlannerModel` / `IVisionModel` / `IImageModel` | `providers/index.ts` |
| New brand rule | `LintRule` (one file) | `lint/index.ts` |
| New agent capability | `AgentTool` (one file) | `agent/tools/index.ts` |
| New A/B test dimension | `IterationDimension` (brief + op whitelist) | `iterate/dimensions.ts` |
| New design element | add to `render/schema.ts` + a case in `renderer.ts` | — |

Everything brand-specific flows through the `BrandKit` type; no module knows which company it serves. The user picks
their company in the UI (persisted per browser); every API call carries `x-brand-id`.

### The design spec (what the LLM writes)
A small, brand-aware vocabulary instead of raw canvas JSON: `card`/`stack` containers that auto-stack `text`, `cta`,
`checklist` children with measured heights; `image` (library `assetId` or generated `src`); `logo` with colourway +
optional pill; `shape`. The renderer applies brand defaults, shrinks headlines to fit, cover-crops photos with a
face-safe focus, nudges imagery out of text, parks charms on card corners, clamps key elements on-canvas and keeps the
wordmark on top. Nothing the model writes can produce overlapping text.

### The validator (deterministic, instant, explainable)
13 rules: palette (nearest-colour fix), fonts, logo count/size/colourway/clear space/pill/hidden, text contrast
(WCAG 4.5:1), minimum text size, overlapping text, text outside its card, imagery covering text, cut-off elements, edge
margins, Meta 9:16 / 4:5 safe zones, headline tone, single CTA. Every issue carries fix ops. Every design passes through
`validateAndFix` before it reaches the editor and again at the end of the run; the chat shows a **report card** per
design with the rationale, what was auto-fixed, what's still flagged and the checks passed.

### Three modes, one loop
* **Blank** – prompt → design spec → page. `×N` creates N meaningfully different variants as pages.
* **Edit** – the active page (and selection) is serialised compactly into context; the agent emits targeted
  `set/delete/add/raise` ops on existing element ids. Moving a card moves its contents. Undo works.
* **Templates** – the Templates side panel lists the brand's layout recipes as cards (with canvas-size presets); one click drafts the prompt for the copilot.
* **Reference** – attach an image (upload, the brand's reference library, or "canvas as ref"). The vision model
  produces a normalised layout brief which the planner re-targets with the brand's assets.

`review_render` closes the loop visually: the editor snapshots the real page, an art-director vision prompt critiques
it, the agent applies concrete fixes.

### Brand scan (inspired by GetCrux's "free brand scan")
Drop any creative, pick a reference, or scan the current page as pixels. `POST /api/scan` samples the image's palette
with sharp (coverage of brand colours, neutrals tolerated), asks the vision model to extract copy, element boxes, logo
presence/variant/size and typography impressions (with the brand's own logo as a comparison image), then runs
deterministic checks: palette, logo present/size/placement/colourway, typefaces, headline length and tone, single CTA,
text contrast, safe zones and margins. The report scores the creative, lists fixes, shows detected colours against the
palette and the extracted copy. **Remake on-brand** feeds the scanned image as a reference plus the fix list to the
copilot, which rebuilds it as an editable page.

### Winner iterations (inspired by GetCrux's creative-testing loop)
Marketers don't want four random variants, they want to learn *what* moved the needle. **⑂ Iterate** (copilot header, or
the chip on any report card) duplicates the current page N times and changes **exactly one dimension per copy**: a new
**hook** (headline angle), another brand **colourway**, different **CTA** copy, swapped **imagery**, or another
**layout** recipe. `POST /api/iterate` streams the same events as the agent: a `duplicate_page` event per variant (the
editor clones the page with suffixed element ids), then one planner call per dimension returns an op set per variant.
Each op set passes a deterministic whitelist (`validateVariantOps`: a hook variant may only change headline/subhead
text, a colourway variant only fills, background and logo colourway, a layout variant only geometry…), out-of-scope
changes are dropped and reported, text is re-measured with the real fonts and the card re-stacked, and the page goes
through the usual `validateAndFix`. Variant pages carry `custom.variantOf` and `custom.dimension`. The comparison grid
shows the original and every variant side by side with lint scores, the dimension tested and the ignored changes;
**keep** / **discard** per variant. The chat can trigger it too (`iterate_design` tool: "give me 3 headline variants").

### Workspace persistence & dashboard
Every editor session is a **project** persisted through `/api/projects` (file-backed `IProjectRepository`, swappable for a
DB): canvas JSON, page scores, a thumbnail, the full copilot conversation including report cards, and every brand scan
with its report. The **dashboard** (home screen) lists sessions across brands with thumbnails, average brand score,
status (draft / in progress / in review / done), stars, search, duplicate / rename / delete, and a "recent brand scans"
feed. Opening a session restores the canvas and the chat exactly where you left off; the editor top bar shows the
title, star, status and last-saved time. Autosave is debounced and survives dev-server restarts.

## Run it

```bash
npm run setup                          # installs server + web
cp server/.env.example server/.env     # add keys
npm run dev                            # api :8787, web :5173
npm test --prefix server               # renderer + linter tests (vitest)
```

Polotno runs on its public demo key; drop your own key into `web/src/store.ts` to remove the trial banner.

## Onboarding a new brand

```bash
# from a Google Drive brand kit (downloads, tags every asset with vision, drafts brand.json)
npm run onboard --prefix server -- --brand acme --name "Acme" --drive <folder-url> [--references <folder-url>]
# from a local folder (e.g. the bundled GetCrux kit gathered from getcrux.ai + LinkedIn)
npm run onboard --prefix server -- --brand getcrux --name "GetCrux" --from brands/_incoming/getcrux-kit
# re-tag an existing brand's assets
npm run manifest --prefix server -- --brand xero
```

The pipeline: download → classify + tag each image (sharp metadata, opaque-pixel colour, vision description/tags) →
sample the palette and read guideline pages to draft `brand.json` → print a review summary. Then refresh the editor and
pick the brand from the switcher.

## Repo map
```
brands/                 tenant workspaces (xero = real kit; _incoming = kits waiting to be onboarded)
server/src/core         types + interfaces (the contracts)
server/src/brands       repository implementations
server/src/providers    model adapters
server/src/render       spec schema, text measurement, renderer
server/src/lint         engine + rules
server/src/agent        prompt, tools, loop, reference analysis, snapshot round-trip
server/src/iterate      winner iterations: dimension registry, op-set validator, runner
server/src/api          express routes
server/src/scripts      onboarding CLIs
server/test             vitest suites
web/src/components      CopilotPanel, LintPanel, ReportCard, IteratePanel (picker + comparison grid)
web/src/sections        Brand kit side panel
web/src/lib             api client, brand selection, canvas ops, autosave
```

# Flow
```
The end-to-end flow
1. The request leaves the editor (web/src/components/CopilotPanel.tsx → lib/api.ts)
When you press Send, the client builds one JSON payload:
* your message and the last 8 chat turns
* a compact serialisation of the canvas: every page, every element with id, type, role, box, text, font, colour, plus which element is selected (lib/canvas.ts, serializePage). This is how the model "sees" the design without pixels.
* any reference images as data URLs, and the variant count
It POSTs to /api/agent with the x-brand-id header and reads back a newline-delimited stream of events.
2. The server prepares the brain (server/src/agent/runAgent.ts)
* Loads the brand kit and asset catalogue for that tenant from brands/<id>/.
* If references were attached, calls the vision model (gpt-4.1) once to turn them into a brand-neutral layout brief: normalised boxes, palette, copy, hierarchy. DeepSeek cannot see images, so this is the bridge.
* Builds the system prompt (agent/prompt.ts): brand rules, palette, fonts, logo rules, the full asset catalogue with ids and tags, the design-spec vocabulary, and the brand's layout recipes.
3. The text model plans with tools (DeepSeek V4-Pro through the OpenAI-compatible adapter in providers/)
The loop sends the messages plus tool definitions. Each reply either contains tool calls or a final summary. Tools are the only way it can touch the canvas:
Tool	What happens
set_canvas_size	emits a size event; the editor resizes the store
generate_image	calls the image model (see step 4)
create_design	the model writes a design spec; server renders, validates, emits a page
update_design	targeted ops on existing element ids
review_render	asks the editor for a real snapshot, sends it to the vision model for critique
Slow pure tools like image generation run concurrently; canvas-mutating tools run in order.
4. The image model (agent/tools/generateImage.ts → gpt-image-1)
The model never generates text in pixels. It asks for a subject only, e.g. "candid florist in her shop". The server prepends the brand's image style from brand.json (palette, flat vector or editorial photo, transparent background for illustrations), picks the size the layout needs, and saves the PNG under server/generated/. The tool returns a URL and dimensions, and the planner places it as an ordinary image element in its spec.
5. Rendering: design spec to editable layers (render/renderer.ts)
The spec is a small vocabulary: cards and stacks with text and CTA children, images by asset id or generated URL, logo by variant, shapes, checklists. The renderer turns it into Polotno page JSON:
* Real font metrics from the brand's TTF files via opentype.js measure every text block, so cards auto-size and headlines shrink to fit.
* Photos are cover-cropped into their box with a face-safe focus. Charms park on card corners. Imagery is nudged out of text areas and the logo's clear space. The wordmark is forced on top and clamped on canvas.
* Every layer gets custom.role (headline, cta, logo…) and container tags, which the linter and later edits rely on.
6. Validation before anything reaches you (agent/tools/createDesign.ts → lint/)
The rendered page runs through 13 deterministic rules. Error-level fixes and safe positional nudges are applied automatically on the server's mirror of the page, then the page is re-linted. The result is a report card: score, rationale, what was auto-fixed, what remains. The model only sees the remaining items.
7. Events become canvas (CopilotPanel.handleEvent → lib/canvas.ts)
The stream carries page (add or replace a Polotno page), ops (set, delete, raise, add on element ids, applied through the store so undo works), lint, report, status, snapshot_request and message. Polotno renders the layers with the registered brand fonts. Because they are normal layers, you can drag, retype or recolour anything afterwards.
8. After the loop
A final validation pass runs on every page touched, the summary message arrives, the live Brand check re-lints the active page, and now the project autosaves canvas, chat, scores and scans to /api/projects.
Brand scan is the same machinery in reverse: sharp samples the pixels, the vision model extracts copy and boxes, the checks score it, and "Remake" feeds the image back into step 1 as a reference.
Resuming the dashboard test once the API stops restarting.
Scanning a library creative to verify scans persist to the session, then checking the dashboard feed.
```