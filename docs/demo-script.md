# 5-minute judge demo

Setup before the judges arrive: `npm run dev`, editor open at `http://localhost:5173`, brand switcher on **Xero**, a
blank 1080×1080 page (✚ in the copilot header clears the autosaved canvas), the Chat tab visible. Have one reference ad
from the 🖼 Library in mind. Keep the server terminal visible if you want to show per-iteration latency and cached tokens.

The prompts below are the chat's suggestion chips. The chips hide after the first exchange, so type the later ones (or paste from here).

| Time | Beat | Prompt / action | What to point at |
|---|---|---|---|
| 0:00 | The premise | — | "An AI copilot inside a real editor. It never paints text; it writes a design spec, the renderer builds real layers, a validator enforces the brand." Show the Brand kit panel: palette, logos, blooms, product UI, all tagged. |
| 0:30 | Create from blank | `Create a 1080×1080 Instagram post announcing a new Xero feature` | Status stream (Planning → Composing → Validating). The page appears as editable layers: click the headline, it is real text in XeroHeadline. The report card: score, "why?" shows rationale, auto-fixes and the checks passed. |
| 1:30 | Edit with ops | Select the headline, then `Make the headline punchier and move the logo to the bottom right` | Only the targeted elements change; "Edit applied" report card. Press ⌘Z: undo works because ops are applied to live elements. |
| 2:15 | Reference variants | 🖼 Library → click a reference ad → set ×4 → `Create 4 different images like this` | "Analysing 1 reference image…" then four pages in the timeline, each with its own report card and thumbnail. Point out different colourways, blooms and copy angles, and that the Xero wordmark and fonts are real files, not the reference's. |
| 3:30 | Format change | On one variant: `Turn this into a 1080×1920 Story and make it Meta-safe` | Canvas resizes (`set_canvas_size`), the planner re-lays the content inside the 9:16 safe zone. Open Brand check: "Platform safe zones" is one of the listed checks. |
| 4:15 | The validator | Brand check tab. Drag the logo over the headline, or set a text colour off-palette with the Polotno toolbar. | The score drops live; each issue has a Fix. ⚡ Auto-fix applies every deterministic fix instantly with no model call. ✨ Fix with AI hands the judgement calls to the copilot. |
| 4:40 | Multi-tenant and export | Brand switcher → **Crux**; ⬇ zip export on Xero | Same code, different brand kit: the panel, prompt and rules all come from `brands/crux/`. ⬇ downloads every page as PNG in a zip. |
| 4:55 | Close | — | Extension points table in the README: new brand = folder, new rule = one file, new tool = one file, new model = one adapter. |

## If something goes wrong

- **Planner slow or 429.** Provider calls retry four times with backoff while the status line stays on "Thinking…". If a run stalls, press **Stop** and resend; the canvas is unchanged until a `page` or `ops` event arrives.
- **Reference analysis fails.** The run says "Reference analysis failed, continuing without it" and still produces designs from the prompt.
- **`review_render` times out.** After 15 s the tool reports the snapshot as unavailable and the run continues.
- **Canvas state looks wrong after a reload.** Autosave is per brand in `localStorage`; ✚ clears it.
- **Polotno trial banner.** The store uses the public demo key (`web/src/store.ts`); mention it is a licensing banner, not part of the product.

## Extra prompts if there is time

- `Create a 1200×628 LinkedIn ad with a 3-month free offer` (format + offer copy, CTA rule)
- Toggle **canvas as ref** on a finished page and ask for `Create 4 different images like this` (variants from your own design)
- `Fix all brand compliance issues on the current page, including the judgement calls.` (what ✨ Fix with AI sends)
