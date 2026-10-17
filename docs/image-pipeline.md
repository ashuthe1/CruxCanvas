# Image pipeline: how pictures are made, placed, kept sharp and kept cheap

This is the end-to-end story of every pixel the copilot produces or touches. It complements
[flows.md](flows.md) (sequence diagrams) and [architecture.md](architecture.md) (components).

## 1. Three sources of imagery

| Source | When it is used | Where it lives |
|---|---|---|
| **Brand library assets** (logos, blooms/shapes, illustrations, product UI, backgrounds) | First choice, always. The planner only sees ids + tags and picks by id. | `brands/<id>/assets/**`, catalogued in `assets.json` |
| **Generated images** (gpt-image-1) | Only when no library asset fits: a photo of a person/scene, a bespoke illustration, an abstract background. | `server/generated/<id>.png`, served at `/generated/…` |
| **Reference / scanned images** (uploads, LinkedIn captures, canvas snapshots) | Never placed on the canvas. They are *read* by the vision model to produce a layout brief or a scan report. | kept in memory for the request; scan thumbnails are stored on the project |

Text is **never** rasterised into an image. Headlines, CTAs and labels are live text layers in the brand fonts, which is
what makes designs editable and brand rules enforceable.

## 2. Library assets: the onboarding pipeline

```
download (gdown)  →  classify + tag  →  colour sampling  →  draft brand.json  →  vectorise logos
```

1. **Download / copy** the kit (`npm run download` or `--from <dir>`), retrying until Drive stops rate-limiting.
2. **Classify + tag** every image (`scripts/lib/manifest.ts`): category from folder-name heuristics, else the vision model
   choosing from a fixed list; guideline slides are detected and set aside; each asset gets `width/height/hasAlpha`
   (sharp), a dominant colour computed over *opaque pixels only* mapped to a named colour, a short name, a description and
   tags. Tagging uses the cheap `gpt-4.1-mini` with 6 concurrent workers and an on-disk cache, so re-runs are free.
3. **Draft brand.json** from a sampled palette plus, when guideline pages exist, a vision pass that extracts hexes with
   roles, logo rules, typography and voice. Everything is reviewable and curated by hand afterwards (Xero and GetCrux
   both are).
4. **Vectorise logos** (`npm run vectorize -- --brand <id>`): bitmap wordmarks in brand kits are often tiny (Xero ships
   210×60 px PNGs). Each logo is upscaled 6× with Lanczos, split into its colour layers, traced with potrace into SVG
   paths and recorded as `vectorUrl` on the asset. The renderer and the Brand kit panel then place an `svg` layer, so
   the mark is crisp at any zoom or export size. This is the fix for the "soft logo" you see when a 210 px bitmap is
   exported at 2160 px.

## 3. Generated images: when, how, and what we control

### Decision
The planner's system prompt says: pick library assets by id; call `generate_image` only when the layout needs a person,
a specific scene, or a bespoke illustration no asset covers. When several images are needed it requests them in one turn
so they generate **in parallel** (`runAgent` runs pure tools concurrently).

### Prompt composition (`agent/tools/generateImage.ts`)
```
<brand.imageStyles[purpose]>        ← palette hexes, medium (flat vector / editorial photo), mood, "no text or logos",
                                       transparent background for illustrations/charms, face framing for photos
Subject: <what the planner asked for>
```
The style prefix is brand data, not code, so a new tenant gets its own look by editing `brand.json`.

### Size and format
| Purpose | Size | Background | Why |
|---|---|---|---|
| illustration, charm | 1024×1024 | transparent PNG | layered over cards/blooms without a box |
| photo, wide box | 1536×1024 | opaque PNG | full-width strips and landscape posts |
| photo, tall box | 1024×1536 | opaque PNG | portrait halves and Stories |
| background | 1536×1024 | opaque PNG | stretched to the canvas |

The planner is told to match the generation size to the box it will fill. Photos are then **cover-cropped** by the
renderer into their box (`cropX/cropY/cropWidth/cropHeight`) with the focus slightly above centre, and the photo style
asks for headroom, so faces survive the crop.

### Quality vs cost knobs
| Knob | Setting | Effect |
|---|---|---|
| `quality` | `medium` | ~⅓ the cost and latency of `high`; enough for 1080-px social canvases. Set `IMAGE_QUALITY=high` for print/hero work. |
| library first | prompt rule | most designs use **zero** generations; a 4-variant run typically generates 1 photo, reused across variants when sensible |
| parallel generation | `runAgent` | three photos take ~25 s instead of ~75 s |
| `n: 1`, PNG, no upscaling | fixed | one image per call; PNG keeps flat colours clean (JPEG would ring on edges) |
| transparent only for illustrations | fixed | opaque photos compress better and render faster |
| file cache | `server/generated/` | generated files are referenced by URL; duplicating or iterating a page never regenerates |

### Placement rules that protect quality
* Images keep their artwork's proportions: the renderer derives height from the asset; `update_design` and the
  iteration op sanitiser complete a missing dimension; the linter's **Logo distorted** rule catches drift.
* Small bitmaps are never blown up beyond 1.5× their pixels in iterations.
* Imagery is nudged out of text containers and out of the logo's clear space; the logo is always on top.

## 4. Rendering and export
* The canvas is Polotno (Konva). Layers are plain JSON, so every image is referenced by URL and drawn at its layer size.
* Brand fonts are self-hosted TTFs registered per brand; the server measures text with the same files (opentype.js),
  which is why cards auto-size and headlines shrink to fit without overlap.
* Previews: dashboard thumbnails at 18 % JPEG, report-card thumbs at 12 %, iteration grid cards at 70 % (the earlier 25 %
  looked soft and was mistaken for degraded pages). **Export** (⬇ zip) renders PNG at `pixelRatio: 2` (2160 px for a
  1080 canvas); vector logos and live text stay sharp, bitmaps are drawn at their native resolution.

## 5. How a design is created, updated and improved

| Flow | Trigger | What the model receives | What comes back | Validation |
|---|---|---|---|---|
| **Create** | prompt on an empty page / "×N" | brand kit, asset catalogue, compact canvas, optional reference brief | `create_design` spec → rendered page | lint + auto-fix before the page reaches the editor; report card |
| **Edit** | prompt with/without a selection | same, plus `selectedIds` | `update_design` ops on existing ids (set / delete / raise / add) | ops applied to the server mirror, re-lint, auto-fix, report |
| **Visual review** | planner decides, or single hero designs | a real canvas snapshot via the editor | art-director critique → more ops | same |
| **Winner iterations** | ⑂ Iterate | the page + one dimension brief per variant | one op set per variant, filtered to the dimension's whitelist | per-variant lint + report, grid with keep/discard |
| **Brand scan → Remake** | Scan tab | the scanned image as a reference + the fix list | a new `create_design` page | same as Create |
| **Manual edits** | designer drags/retypes | nothing (no model) | live lint on every change; ⚡ Auto-fix applies deterministic fixes | — |

Every path converges on the same validator (`validateAndFix`), so the quality bar is identical whether a page came from
a prompt, an iteration, a remake or a human.

## 6. Cost sheet (typical, per request)

| Operation | Model calls | Approx. tokens / images | Wall time |
|---|---|---|---|
| Single design, no photo | 2–3 DeepSeek turns (prompt-cached ~9k tokens) | ~12k in / 1k out | 8–15 s |
| Single design with a photo | + 1 gpt-image-1 (medium) | +1 image | +12–20 s |
| 4 variants from a reference | 1 gpt-4.1 vision (brief) + 4–6 DeepSeek turns + 0–2 images | ~25k in / 4k out | 45–75 s |
| Iteration (3 variants) | 3 small DeepSeek turns in parallel | ~12k each | 10–15 s |
| Brand scan | 1 gpt-4.1 vision | ~2k + 2 images | 4–6 s |
| Asset tagging (onboarding) | 1 gpt-4.1-mini per asset | ~400 each | 90 assets ≈ 40 s |

DeepSeek prompt caching keeps the big system prompt (brand + catalogue) nearly free after the first turn; the catalogue
is sent as compact one-line entries for that reason.

## 7. Known limits and next steps
* Face-aware cropping is by prompt framing, not detection; a landmark detector would make photo crops reliable.
* Generated illustrations are 1024 px; on a 2× export they are drawn at ~2000 px and look slightly soft. `quality: high`
  or a one-off upscaler on export would close that gap.
* Potrace tracing smooths 60-px bitmaps well but is not a substitute for the brand's real vector files; the onboarding
  script should accept `.svg` logos directly when a tenant has them (it already serves SVG assets).

## 8. Transparency and the visual QA loop (how an edit really runs)

```
user message ─► observe: structured canvas (ids, boxes, text, selection)
             ─► look: vision inspects a snapshot of the ACTIVE page → defects list (overlaps, cut-offs, unreadable)
             ─► plan/act: planner calls update_design {rationale, ops} → ops applied, card contents re-stacked,
                           validator (lint + auto-fix) → report card
             ─► final validation on every touched page
             ─► visual QA: editor renders the page → vision checks pixels → defects? feed back → fix → re-check (≤2 rounds)
             ─► summary
```

* Every step is streamed as a `trace` event and shown in the chat as a collapsible **steps** block: what the agent saw
  (element list), what the vision check found, the planner's rationale and the exact ops, what the validator fixed,
  and what the final visual QA concluded. Click a step to expand its payload.
* The snapshot is sent on every edit as `canvasSnapshot` and labelled *current render observations* — defects to fix,
  never a style to copy. The "canvas as ref" chip is the only path that treats the canvas as a reference, and it is
  one-shot.
* Spatial language is turned into arithmetic in the prompt ("bottom of the card" = card.y + card.height − padding −
  height), and card contents are re-flowed after every edit so a moved label can never land on the CTA.
* New deterministic rules close the gaps the transcript exposed: *Text over a button* and *Image cut off*.
