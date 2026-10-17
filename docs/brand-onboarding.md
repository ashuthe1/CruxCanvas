# Brand onboarding

How to add a tenant. One folder per brand under `brands/`; the server and editor pick it up without code changes.
The CLIs live in `server/src/scripts/` and run with `tsx`.

## Prerequisites

- `server/.env` with `OPENAI_API_KEY` (vision tagging and guideline reading). Without it the pipeline still runs, but assets get no descriptions or tags and `brand.json` is drafted from sampled colours and defaults only.
- For Google Drive sources: `gdown` on the PATH (`python3 -m pip install --user gdown`) and a folder shared as "anyone with the link".
- Optional: `TAGGING_MODEL` in `.env` (or `--tag-model`) to tag assets with a cheaper vision model such as `gpt-4.1-mini`. Guideline reading always uses `VISION_MODEL`.

## Commands

```bash
# from a Google Drive brand kit, optionally with a folder of reference ads
npm run onboard --prefix server -- --brand acme --name "Acme" --drive <folder-url> [--references <folder-url>]
```

```bash
# from a local folder (the bundled demo kit)
npm run onboard --prefix server -- --brand crux --name "Crux" --from brands/_incoming/crux-kit
```

```bash
# preview everything without writing
npm run onboard --prefix server -- --brand acme --name "Acme" --from path/to/kit --dry-run
```

Other flags: `--skip-download`, `--skip-tagging`, `--force` (regenerate an existing `brand.json`), `--concurrency 6`,
`--tag-model <model>`. `--from` resolves against the current directory, the directory npm was run from, and the repo
root. A local kit may be flat or contain `assets/` and `references/` subfolders.

Partial re-runs:

```bash
npm run manifest --prefix server -- --brand acme            # re-classify and tag assets (incremental)
```

```bash
npm run manifest --prefix server -- --brand acme --retag    # ignore cached tags
```

```bash
npm run download --prefix server -- --brand acme --drive <folder-url> [--references <folder-url>] [--max-passes 8]
```

## What the pipeline does

| Step | What happens | Code |
|---|---|---|
| 1 Create brand folder | Makes `brands/<id>/{assets,references,fonts}`. Copies placeholder fonts (Inter family: headline ExtraBold, body Regular/Bold) from `brands/_defaults/fonts` when the brand has none. | `onboard-brand.ts`, `draftBrand.installFonts` |
| 2 Fetch brand kit | Copies from `--from`, or downloads each Drive folder in repeated passes until the file count stops growing. Skips a folder that already has files. | `lib/drive.ts` |
| 3 Classify + tag | Walks every image. Category from folder names first, then file names (`logo`, `bloom`, `background`, `illustration`, `charm`, `product-ui`, `photo`). Guideline slides are detected by folder name (strong, skipped outright) or by file name / slide-like size (weak, the vision model decides). `sharp` gives width, height, alpha; the dominant colour is averaged over opaque pixels and snapped to a named colour. The vision model supplies name, one-line description, 4–8 tags, category and colour, 6 files in parallel. Tags are reused from the previous `assets.json` and from `.tagcache.json`, so re-runs only tag new files. | `lib/manifest.ts` |
| 4 Draft brand.json | Skipped when `brand.json` exists unless `--force`. Samples 6–10 palette colours from logo/bloom/background/charm assets. Reads up to six guideline slides (preferring colour, logo, typography and tone pages) for tagline, palette with roles, logo rules, typography notes, voice, rules and don'ts. Merges guideline palette first, then sampled colours that are not near-duplicates, and adds White if no light colour exists. Logo variants are the `logo`-category assets named by colour; colourways are derived from their luminance. Layout, safe zones, voice, rules, imagery and image styles come from `brands/_defaults/brand.defaults.json` with `{brand}`, `{Brand}`, `{primary}`, `{secondary}`, `{accent}`, `{light}`, `{dark}` placeholders filled. | `lib/draftBrand.ts`, `lib/palette.ts` |
| 5 Summary | Prints assets by category, the palette with swatches, logo variants, tagline and voice, then a **Review before demo** list of warnings. | `lib/ui.ts` |

## What it produces

```
brands/<id>/
  brand.json        the BrandKit (see docs/HLD.md §5)
  assets.json       one Asset per image: id, category, name, file, url, size, alpha, dominant, colour, description, tags
  .tagcache.json    vision results by asset id (lets re-runs skip tagging)
  assets/           the kit files, as downloaded or copied (sub-folders preserved; they drive classification)
  references/       reference ads shown in the editor's 🖼 Library picker
  fonts/            headline.ttf, body.ttf, bodybold.ttf
```

Asset ids are the relative path with non-alphanumerics collapsed to `_`, extension removed, truncated to 60 chars
(collisions get a numeric suffix and a warning). Asset URLs are `/brands/<id>/assets/<path>`.

## What to review before using the brand

Work through the warnings the summary prints, then check these by hand in `brands/<id>/brand.json`:

1. **Fonts.** Placeholder fonts are Inter. Drop the brand's licensed `.ttf` files into `fonts/` under the same three file names and keep the family names in `fonts.*.family`. The renderer measures text with these files; the editor loads them via `fontUrls`.
2. **Palette.** Sampled colours carry a role starting with "sampled from … — review". Fix hex values, give each colour a real role, and make sure `colors[0]` is the dark text colour (the renderer and `update_design` use it as the default fill). Mark the secondary colour's role with the word "secondary" if you want it as the default page background.
3. **Logo.** `logo.assets` must map variant names to the right asset ids, and there should be at least a light and a dark variant so the colourway rule can swap them. Check `minWidthRatio`, `preferredWidthRatio`, `placement`, `clearSpace`; add `pillColors` if the brand uses a holding pill over photos.
4. **Categories.** Open the Brand kit panel in the editor and scan each group. Anything misfiled hurts the planner (it chooses assets from the catalogue by category and tags). Fix the folder name or edit `category` in `assets.json`, then re-run `manifest`.
5. **Guideline slides** that slipped into the catalogue as `background` or `illustration`: move them to a folder whose name contains "guidelines" and re-run `manifest`.
6. **Recipes.** `layout.recipes` are the proven layouts shown to the planner. Write two or three that match the brand's real ads (the Xero file is a good template); they do more for output quality than any other field.
7. **Voice and rules.** `voice.tone`, `headlinePatterns`, `avoid` and `rules[]` are prompt-only; trim what the guideline reader got wrong.
8. **Safe zones.** Keys must match the aspect labels the safe-zone rule looks up (`9:16`, `4:5`, `default` in the Xero file).
9. **References.** Add a few real ads to `references/` so the reference-based flow has a library.

Then `npm run dev`, reload the editor, pick the brand in the switcher, and run the prompts from
[demo-script.md](demo-script.md). The Brand check tab should show a high score on the first generated page.

## How the brand reaches the app

`FsBrandRepository` lists every folder in `BRANDS_DIR` that has a `brand.json` and does not start with `_`
(`_defaults` and `_incoming` are therefore invisible). It caches by the newest mtime of `brand.json` and `assets.json`,
so edits are picked up on the next request without restarting the server.
