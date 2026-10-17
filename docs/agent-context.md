# What the agent sees, and how it changes the canvas

Use this to explain the mechanics precisely. Everything here is what the code does today.

## 1. The canvas as the agent receives it

The editor never sends Polotno's raw JSON. On every message `serializeCanvas` (`web/src/lib/canvas.ts`) builds a
compact structure:

```json
{
  "width": 1080, "height": 1080,
  "activePageId": "YIoIw5fdhn",
  "selectedIds": ["el_4e5a741c"],
  "pages": [{
    "id": "YIoIw5fdhn", "background": "#000856",
    "elements": [
      { "id": "el_1ee6a80d", "type": "image",  "role": "bloom",    "x": -120, "y": -80, "width": 680, "height": 460, "assetId": "06_Shapes_…" },
      { "id": "el_03d4967b", "type": "figure", "role": "card",     "x": 55,   "y": 60,  "width": 820, "height": 494, "fill": "#FFFFFF" },
      { "id": "el_4e5a741c", "type": "text",   "role": "label",    "x": 111,  "y": 114, "width": 748, "height": 30,
        "text": "NEW FEATURE", "fontSize": 24, "fontFamily": "XeroBodyBold", "fill": "#1868D8", "container": "el_03d4967b" },
      { "id": "el_a1923852", "type": "figure", "role": "cta-bg",   "x": 111,  "y": 409, "width": 211, "height": 57, "group": "7f3a" },
      { "id": "el_23536e25", "type": "text",   "role": "cta",      "x": 111,  "y": 421, "width": 211, "height": 32, "text": "Try it free", "group": "7f3a" },
      { "id": "el_23c…",     "type": "svg",    "role": "logo",     "x": 770,  "y": 100, "width": 190, "height": 54,  "assetId": "10_Logo_02_…" }
    ]
  }]
}
```

* **Coordinates** are absolute canvas pixels, origin top-left, `y` grows downward. `width`/`height` are the layer's box.
* **Layer order is the array order**: index 0 is the back, the last element is the front. The visual-QA prompt lists
  them as `z0 … zN` so the model knows what can cover what.
* **role** (`headline`, `cta`, `logo`, `card`, `illustration`…) is what the copilot stamped on the layer when it created
  it; the linter and the planner reason about roles, not layer names.
* **container** ties a text/CTA to the card it lives in; **group** ties a CTA pill to its text. These let the server
  move a card with its contents and re-flow children without ever guessing from geometry.
* **selectedIds** is what you have selected in the editor; the prompt tells the planner the selection is the target.
* Only the active page carries full elements; other pages are sent as counts, to keep the prompt small.

## 2. What the agent additionally *looks at*

* **Snapshot of the active page** (`canvasSnapshot`, JPEG at 75 % of canvas size) on every edit. The vision model runs
  a fixed checklist (occlusion, clipping, containment, overlap, readability, placement, composition) and returns
  defects with element ids. The planner receives them as *current render observations* — defects to fix, never a style
  to copy. Only the one-shot "canvas as ref" chip turns the canvas into a reference brief.
* **Brand kit and asset catalogue** in the system prompt: palette with roles, fonts, logo rules, layout recipes, voice,
  and one line per asset (`id | name | size | tags`).

## 3. How a change is expressed

The planner answers with tool calls, never with canvas JSON:

* `create_design({ design })` — a small spec (`card`/`stack` containers with `text`/`cta`/`checklist` children, `image`
  by asset id or generated URL, `logo` by variant, `shape`). The server renders it to layers with real font metrics.
* `update_design({ pageId, rationale, ops })` — ops on existing ids:
  `set {id, props}` (x, y, width, height, text, fontSize, fill, src…), `delete`, `raise` (bring to front), `add`,
  `background`. The rationale is shown in the trace.

Before ops reach the editor the server: completes missing image dimensions to keep aspect ratios, expands a card move to
its contents, applies the ops to its mirror, **re-stacks card children** (pill + text as one unit), runs the validator,
and auto-applies error fixes. The editor applies the same ops through the Polotno store, so undo works.

## 4. How the result is verified

1. **Deterministic validator** (15 rules) on the server mirror — palette, fonts, logo present/size/colourway/clear
   space/hidden/overlapping a card, contrast, text size, overlapping text, text over a button, text outside its card,
   image over text, image cut off, cut off by the canvas edge, edge margins, safe zones, tone, single CTA. Each issue
   carries fix ops.
2. **Editor state sync** — before final validation the server asks the editor for its real structured canvas and
   replaces its mirror with it (editor wins). This closes the gap where the server believed an op had applied
   differently from the editor.
3. **Visual QA** — the editor renders the page, the vision checklist runs on the pixels, errors are fed back to the
   planner with the layer listing, it fixes, and the render is checked again (bounded to two rounds).

## 5. Where it can still be wrong

* The planner computes positions from numbers; if it mis-reads the canvas it can place something badly — the validator
  and visual QA exist to catch that, and the trace shows exactly which step produced which coordinates.
* The vision checklist is a model judgement; it is strict on hidden/cut/overlapping items and lenient on taste.
* Snapshots are 75 % scale JPEGs; sub-pixel issues are invisible to it by design.
