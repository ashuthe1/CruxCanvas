# Brand Copilot — Agentic Image Editor (GetCrux AI Hackathon, 17 Oct 2026)

An AI copilot that lives inside a real, layered image editor and designs **on-brand, fully editable** images for Xero:
create from a blank canvas, edit the current design, or recreate the style of reference ads with the brand's own assets.

> "Create 4 different images like this." → four editable pages, each lint-checked against the brand guidelines, in ~60 s.

## Why it's built this way

Judging criterion #1 is output quality and the brief demands an **editable canvas**. Prompting an image model and
pasting a flat PNG fails both: mangled text, off-brand fonts, no layers, nothing enforceable. So the copilot never
paints pixels for text. It writes a **structured design spec** → we render it to real canvas layers (text in the
brand fonts, shapes, the actual logo files, library illustrations and blooms) → a **deterministic brand linter**
scores it → the agent fixes what matters. Image generation is used only where it adds value: bespoke illustrations
(transparent PNG) and photos, never for typography.

## Architecture

```
┌──────────────── web (Vite + React + Polotno) ────────────────┐      ┌──────────── server (Node/Express) ────────────┐
│  Polotno canvas  ◄── page JSON / element ops ──────────────── │ ◄──  │  /api/agent  (NDJSON stream of events)          │
│  Brand kit panel (assets, palette)                            │      │   └─ agent.ts  DeepSeek-V4-Pro tool loop        │
│  Copilot chat (refs, canvas-as-ref, ×N variants)              │ ──►  │        tools: create_design · update_design     │
│  Brand check tab (live lint score + one-click fixes)          │      │               generate_image · search_assets    │
│  snapshot replies for visual review ─────────────────────────►│      │               review_render · set_canvas_size   │
└───────────────────────────────────────────────────────────────┘      │   ├─ render.ts  design spec → Polotno layers    │
                                                                       │   │     real font metrics (opentype.js), auto-  │
   DeepSeek V4-Pro (Azure, text + tools)  ── planner/executor          │   │     stacking cards, cover-crop, collision   │
   gpt-4.1 (vision)   ── reference analysis, visual critique           │   │     nudging, logo always on top             │
   gpt-image-1        ── illustrations (transparent) & photos          │   ├─ lint.ts    brand rules → issues + fixes    │
                                                                       │   ├─ vision.ts  reference brief / critique      │
   data/brand.json  curated rules (palette, fonts, logo, safe zones)   │   └─ images.ts  brand-styled generation         │
   data/assets.json 90 tagged assets (sharp + vision tagging)          └────────────────────────────────────────────────┘
```

### The design spec (what the LLM writes)
A small, brand-aware vocabulary instead of raw canvas JSON: `card`/`stack` containers that auto-stack
`text`, `cta`, `checklist` children with measured heights; `image` (library `assetId` or generated `src`);
`logo` with colourway + optional pill; `shape`. The renderer applies brand defaults (fonts, sizes, colours), shrinks
headlines to fit, cover-crops photos with a face-safe focus, nudges imagery out of text, parks charms on card
corners and keeps the wordmark on top. Nothing the model writes can produce overlapping text.

### The brand linter (deterministic, instant)
Palette (with nearest-colour fix), fonts, exactly one logo, minimum logo size, logo colourway vs background,
logo clear space, logo over photos (pill), text contrast (WCAG 4.5:1), minimum text size, edge margins, Meta 9:16 /
4:5 safe zones, image-over-text collisions, headline length/case/tone, single CTA. Every issue carries an auto-fix op
so the **Brand check** tab can fix with one click; the agent gets the same report after every change.

### Three modes, one loop
* **Blank** – prompt → design spec → page. `×N` creates N meaningfully different variants as pages.
* **Edit** – the active page (and selection) is serialised compactly into context; the agent emits targeted
  `set/delete/add` ops on existing element ids. Undo works because they're normal canvas edits.
* **Reference** – attach an image (upload, the bundled reference library, or "canvas as ref"). gpt-4.1 produces a
  normalised layout brief (boxes 0‥1, palette, hierarchy, copy angle) which DeepSeek re-targets with Xero assets.

### Self-review
`review_render` asks the editor for a snapshot of the *actual* rendered page, has the vision model critique it as an
art director, and the agent applies concrete fixes. Prompt caching on DeepSeek keeps each iteration ~3–4 s.

## Run it

```bash
npm run setup                # installs server + web
cp server/.env.example server/.env   # add the hackathon keys
npm run dev                  # api on :8787, web on :5173
```

Optional: `npm run manifest --prefix server` rebuilds `data/assets.json` (vision-tags every brand asset).

The brand kit and reference ads live in `assets/` (downloaded from the hackathon Drive folders).
Polotno runs on its public demo key; drop your own free key into `web/src/store.ts` to remove the trial banner.

## Demo script
1. **Blank** – "Create a 1080×1080 Instagram post announcing Xero Payroll" → on-brand card-on-bloom layout, score 100.
2. **Variants** – pick a reference from 🖼 Library, "Create 4 different images like this", ×4 → four pages.
3. **Edit** – select the headline, "make it punchier and move the logo bottom-left" → surgical ops, undoable.
4. **Compliance** – drag the logo tiny / recolour a shape off-palette → Brand check flags it → Fix.
5. **Format** – "Make this a Story" → canvas becomes 1080×1920, safe-zone lint kicks in.

## Repo map
```
server/src/agent.ts     tool loop + system prompt (brand, catalogue, layout recipes)
server/src/render.ts    design spec → Polotno page (measurement, stacking, cropping)
server/src/lint.ts      brand rules
server/src/text.ts      opentype.js measurement / fit
server/src/vision.ts    reference brief, render critique
server/src/images.ts    gpt-image generation with brand style prefixes
server/src/build-manifest.ts  asset catalogue builder
server/data/brand.json  curated brand rules
web/src/components/CopilotPanel.tsx  chat, events → canvas
web/src/components/LintPanel.tsx     brand check UI
web/src/sections/BrandSection.tsx    brand kit side panel
web/src/lib/canvas.ts   compact serialisation + op application
```
