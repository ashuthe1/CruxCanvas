# Brand Copilot — Agentic Image Editor

An AI copilot inside a real, layered image editor that designs **on-brand, fully editable** images for any
onboarded brand: create from a blank canvas, edit the current design, or recreate the style of reference ads with the
brand's own assets. Built for the GetCrux AI Hackathon (17 Oct 2026); Xero is the first tenant.

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
│ autosave per brand · zip export · snapshot replies     │        │                      generate_image · review_render · …      │
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
* **Reference** – attach an image (upload, the brand's reference library, or "canvas as ref"). The vision model
  produces a normalised layout brief which the planner re-targets with the brand's assets.

`review_render` closes the loop visually: the editor snapshots the real page, an art-director vision prompt critiques
it, the agent applies concrete fixes.

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
# from a local folder (e.g. the bundled demo kit)
npm run onboard --prefix server -- --brand crux --name "Crux" --from brands/_incoming/crux-kit
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
server/src/api          express routes
server/src/scripts      onboarding CLIs
server/test             vitest suites
web/src/components      CopilotPanel, LintPanel, ReportCard
web/src/sections        Brand kit side panel
web/src/lib             api client, brand selection, canvas ops, autosave
```
