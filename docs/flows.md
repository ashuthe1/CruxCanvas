# Flows

Sequence diagrams for the five main paths. Participants map to code:
**Editor** = `web/src/components/CopilotPanel.tsx` + `web/src/lib/canvas.ts`, **API** = `server/src/api/routes.ts`,
**Agent** = `server/src/agent/runAgent.ts`, **Tool** = `server/src/agent/tools/*`, **Renderer** =
`server/src/render/renderer.ts`, **Lint** = `server/src/lint/engine.ts` via `validateAndFix`, **Planner / Vision /
Images** = `server/src/providers/*`.

Every run starts the same way: the editor serialises all pages compactly, sends `POST /api/agent` with the brand id
header, and applies each streamed `AgentEvent` as it arrives. Each diagram below shows what differs.

## 1. Create from blank

Prompt: "Create a 1080×1080 Instagram post announcing a new Xero feature". The active page is empty, so the planner is
told to pass `replacePageId` and fill it instead of adding a page.

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant E as Editor
    participant A as API /api/agent
    participant R as Agent loop
    participant P as Planner (DeepSeek)
    participant T as create_design
    participant D as Renderer
    participant L as Lint + auto-fix

    U->>E: types prompt, Send
    E->>A: POST canvas state + message (NDJSON stream opens)
    A->>R: runAgent(input, brand, assets)
    R->>R: build system prompt (brand brief, asset catalogue, spec doc, recipes)
    R-->>E: status "Planning the design…"
    R->>P: chat(messages, tool defs)
    P-->>R: tool_call create_design(design, replacePageId)
    R->>T: execute(args)
    T->>T: zod DesignSchema.safeParse
    T->>D: render(spec, W, H)
    D-->>T: Polotno page JSON (measured text, stacked cards, logo on top)
    T->>L: validateAndFix(compact page)
    L-->>T: fix ops applied to mirror, DesignReport
    T->>T: write fixed x/y/fill/text back into page JSON
    T-->>E: event page (replacePageId)
    T-->>E: event lint, event report
    T-->>R: "Created page p_…  Elements: … Brand lint: score …"
    R->>P: chat(messages + tool result)
    P-->>R: final text, no tool calls
    R->>L: final validateAndFix on touched pages
    R-->>E: event lint (+ report if anything was fixed)
    R-->>E: event message, event done
    E->>E: addPageFromJSON, show report card with thumbnail
```

Notes
- With `variants > 1` the user message adds "VARIANTS REQUESTED: N" and the planner calls `create_design` N times; each call adds a page and emits its own report card.
- `set_canvas_size` may precede `create_design` when the prompt names a format; it emits a `size` event and rebuilds the system prompt for the new dimensions.
- `generate_image` may be called first when no library asset fits; its `/generated/<id>.png` URL is then used as an image `src` in the spec.

## 2. Edit the current page with ops

Prompt: "Make the headline punchier and move the logo to the bottom right", with or without a selection. The active
page has elements, so `userIsEditing` is true and the planner is told to use `update_design` with precise ops on
existing ids. Up to four `update_design` rounds per page are allowed in this mode.

```mermaid
sequenceDiagram
    autonumber
    participant E as Editor
    participant R as Agent loop
    participant P as Planner
    participant T as update_design
    participant H as lint helpers
    participant L as Lint + auto-fix

    E->>R: POST canvas (active page elements + selectedIds) + message
    R->>P: chat (CANVAS STATE lists the active page's elements)
    P-->>R: tool_call update_design(pageId, ops)
    R->>T: execute(args)
    T->>T: round counter for pageId (max 4 when editing)
    T->>T: fill defaults on "add" ops (brand font, dark colour, asset src)
    T->>H: expandContainerMoves(page, ops)
    H-->>T: card/pill moves expanded to their contents
    T->>H: applyOpsCompact(mirror page, ops)
    T-->>E: event ops (pageId, ops)
    E->>E: applyOps: el.set / delete / moveTop / addElement / background
    T->>L: validateAndFix(page, emitOps = true)
    L-->>E: event ops (auto-fixes), event lint, event report "Edit applied"
    T-->>R: "Applied N ops… Brand lint: …"
    R->>P: chat
    P-->>R: summary text
    R-->>E: final lint, message, done
```

Notes
- The browser applies ops on live Polotno elements, so Polotno's undo history captures each change.
- Lint fixes emitted here are ordinary `ops` events; the editor cannot tell them from planner edits, which is why the report card lists `autoFixed` separately.
- ✨ Fix with AI in the Brand check tab is this same flow with the prompt "Fix all brand compliance issues on the current page, including the judgement calls."

## 3. Reference-based variants

Prompt: "Create 4 different images like this" with one or more reference images attached (file upload, the brand's
`references/` library, or a JPEG of the current page when "canvas as ref" is on) and ×4 selected.

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant E as Editor
    participant R as Agent loop
    participant V as Vision (gpt-4.1)
    participant P as Planner
    participant T as create_design ×4
    participant I as generate_image

    U->>E: attach reference(s), set ×4, Send
    E->>E: files → data URLs (library images fetched then converted)
    E->>R: POST message, references[], variants 4, canvas
    R-->>E: status "Analysing 1 reference image…"
    R->>V: analyzeReferences → describeJSON(art-director prompt, images)
    V-->>R: layout brief (aspect, palette roles, layoutRecipe, element boxes 0..1, typography, copyAngle, doNotCopy)
    R->>R: user message = REFERENCE BRIEF + CANVAS STATE + "VARIANTS REQUESTED: 4" + request
    R->>P: chat
    loop 4 variants, different layout / colourway / imagery / copy angle
        P-->>R: tool_call create_design(design)
        opt no library asset fits
            R->>I: generate_image(prompt, purpose)
            I-->>R: {src:/generated/…png, width, height}
        end
        R->>T: render → validateAndFix → events page, lint, report
        T-->>R: tool result
        R->>P: chat
    end
    P-->>R: one line per variant
    R-->>E: final validation, message, done
```

Notes
- If reference analysis throws, the run continues without the brief and says so in a status line.
- The brief is brand-neutral by construction: boxes are normalised, and `doNotCopy` lists reference-specific items the planner must swap for the target brand's assets.
- The vision call accepts up to six images at `detail: high`.

## 4. Visual review snapshot round-trip

`review_render` lets the planner see the page as the browser actually renders it (real fonts, cropped photos) and get
up to four concrete fixes from an art-director prompt. The server never rasterises; it asks the editor.

```mermaid
sequenceDiagram
    autonumber
    participant P as Planner
    participant R as Agent loop
    participant T as review_render
    participant S as snapshots.ts
    participant E as Editor
    participant A as API /api/snapshot-reply
    participant V as Vision

    P-->>R: tool_call review_render(pageId, brief)
    R->>T: execute
    T->>S: waitForSnapshot(requestId, 15 s)
    T-->>E: event snapshot_request {pageId, requestId}
    E->>E: await store.waitLoading(), pageToDataURL(pageId, 0.6, jpeg)
    E->>A: POST {requestId, dataUrl}
    A->>S: deliverSnapshot(requestId, dataUrl)
    S-->>T: dataUrl (or null on timeout)
    alt snapshot received
        T->>V: describe(reviewer prompt, canvas + element list, image)
        V-->>T: "LGTM" or up to 4 fixes
        T-->>R: "Visual review: … apply with update_design"
        R->>P: chat
        P-->>R: update_design ops (flow 2) or finish
    else timeout
        T-->>R: "Snapshot unavailable, skip visual review."
    end
```

Notes
- The pending map is in-process, so the reply must reach the same server that emitted the request.
- The element list sent with the image carries ids and boxes so the critique can be turned into ops without guessing.

## 5. Brand onboarding pipeline

`npm run onboard --prefix server -- --brand <id> --name "<Name>" (--drive <url> [--references <url>] | --from <dir>)`.
Five steps, each printed with a progress line; a dry run computes everything and writes nothing.

```mermaid
sequenceDiagram
    autonumber
    participant O as onboard-brand.ts
    participant F as brands/<id>/
    participant G as Google Drive (gdown)
    participant M as manifest.ts
    participant V as Vision (tagging + guidelines)
    participant B as draftBrand.ts

    O->>F: 1 create dir, assets/, references/, fonts/ and copy placeholder fonts from brands/_defaults
    alt --from local dir
        O->>F: 2 copy assets (and references/ if nested)
    else --drive / --references
        O->>G: 2 download folder(s), repeated passes until the file count is stable
        G-->>F: files
    end
    O->>M: 3 buildManifest(assetsDir)
    loop every image, 6 workers
        M->>M: classifyPath (folder/file-name → category, guideline strong/weak)
        M->>M: sharp metadata, opaque-pixel dominant colour, nearest named colour
        alt tags cached in assets.json or .tagcache.json
            M->>M: reuse
        else vision available
            M->>V: tagImage (name, description, tags, category, colour, isGuideline)
        end
    end
    M-->>F: assets.json + .tagcache.json (guideline slides set aside)
    O->>B: 4 draftBrand(assets, guidelines) unless brand.json exists and no --force
    B->>B: sample palette from logo/bloom/background/charm assets
    B->>V: readGuidelines (up to 6 slides → tagline, palette, logo rules, typography, voice, rules, don'ts)
    B->>B: merge palette, pick logo variants by colour, fill brand.defaults.json placeholders
    B-->>F: brand.json
    O->>O: 5 summary tables (categories, palette, logo variants) + "Review before demo" warnings
```

Notes
- `npm run manifest` re-runs step 3 alone (incremental; `--retag` forces re-tagging). `npm run download` re-runs step 2 alone.
- The server picks the new brand up without a restart; the editor lists it in the brand switcher after a reload.
- Details of what to review are in [brand-onboarding.md](brand-onboarding.md).
