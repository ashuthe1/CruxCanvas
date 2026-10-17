/**
 * "Winner iterations": controlled A/B variants of a page where exactly ONE dimension changes.
 * Each dimension is a small registry entry: what the planner is told to vary, and a whitelist of
 * ops/props the validator lets through so nothing else drifts. Brand facts come from the BrandKit.
 */
import type { Asset, BrandKit, CompactEl, CompactPage, Op } from '../core/types.js';
import { IMAGE_ROLES, role } from '../lint/helpers.js';

export type DimensionId = 'hook' | 'colourway' | 'cta' | 'imagery' | 'layout';

export type IterationDimension = {
  id: DimensionId;
  label: string;
  /** short UI description */
  blurb: string;
  /** planner instructions for this dimension (brand-aware) */
  brief(brand: BrandKit, assets: Asset[], page: CompactPage, W: number, H: number): string;
  /** which elements may be touched by "set" ops */
  targets(el: CompactEl): boolean;
  /** which props may change on a target */
  props: Set<string>;
  /** whether add/delete/raise/background ops are allowed, and for which elements */
  allowAdd?: (el: any) => boolean;
  allowDelete?: (el: CompactEl) => boolean;
  allowRaise?: boolean;
  allowBackground?: boolean;
};

const TEXT_ROLES = new Set(['headline', 'subhead', 'body', 'label', 'stat', 'legal']);
const isText = (el: CompactEl) => el.type === 'text';
const isImagery = (el: CompactEl) => (el.type === 'image' || el.type === 'svg') && IMAGE_ROLES.has(role(el));
const isLogo = (el: CompactEl) => role(el) === 'logo';
const textOf = (page: CompactPage, r: string) => page.elements.filter((e) => isText(e) && role(e) === r).map((e) => `${e.id}: "${e.text}"`).join('; ') || 'none';

export const hookDimension: IterationDimension = {
  id: 'hook',
  label: 'Hook',
  blurb: 'New headline angle, same design',
  brief: (brand, _assets, page) =>
    `Rewrite the HEADLINE (and the subhead if there is one) with a genuinely different hook — a new angle, promise or proof, not a paraphrase. Current headline: ${textOf(page, 'headline')}. Subhead: ${textOf(page, 'subhead')}.
Voice: ${brand.voice.tone} Patterns: ${(brand.voice.headlinePatterns || []).join(' | ')}. Avoid: ${(brand.voice.avoid || []).join(', ')}. Headline ≤ ${brand.layout.headline.maxChars} chars, ≤ ${brand.layout.headline.maxLines} lines at its current font size, sentence case unless the brand uses uppercase. Keep the headline roughly the same length as the original so it still fits its box. Only change "text" (you may lower fontSize slightly if the new line is longer).`,
  targets: (el) => isText(el) && TEXT_ROLES.has(role(el)) && role(el) !== 'legal',
  props: new Set(['text', 'fontSize', 'height']),
};

export const ctaDimension: IterationDimension = {
  id: 'cta',
  label: 'CTA',
  blurb: 'Different call-to-action copy',
  brief: (brand, _a, page) =>
    `Change ONLY the call-to-action copy. Current CTA: ${textOf(page, 'cta')}. Brand CTA guidance: ${brand.layout.cta.notes || 'short imperative copy'}. Use a different verb/intent (try vs learn vs start vs compare vs book a demo), 2–4 words, no exclamation marks. Keep it close to the original length so the pill still fits; if it is longer you may widen the matching cta-bg pill (same group) by setting its width.`,
  targets: (el) => (isText(el) && role(el) === 'cta') || role(el) === 'cta-bg',
  props: new Set(['text', 'fontSize', 'width', 'x', 'height']),
};

export const colourwayDimension: IterationDimension = {
  id: 'colourway',
  label: 'Colourway',
  blurb: 'Another brand palette combination',
  brief: (brand, assets, page) => {
    const logos = page.elements.filter(isLogo).map((l) => `${l.id} (variant ${l.custom?.variant || '?'})`).join(', ') || 'none';
    const logoAssets = Object.entries(brand.logo.assets).map(([v, id]) => {
      const a = assets.find((x) => x.id === id);
      return a ? `${v}: assetId ${id} src ${a.url}` : `${v}: assetId ${id}`;
    });
    return `Recolour the design into a DIFFERENT brand colourway: change the page background ({op:"background",value}) and the fill of cards, shapes, blooms-as-shapes, CTA pill and text so everything stays legible (WCAG 4.5:1 for text). Palette (use these hexes only): ${brand.colors.map((c) => `${c.name} ${c.hex} — ${c.role}`).join('; ')}. Logo colourways: ${JSON.stringify(brand.logo.colourways)}. Current background ${page.background}; logo elements: ${logos}. If the new background needs another logo variant, set the logo's assetId and custom {variant, assetId, role:"logo"} using: ${logoAssets.join(' | ')}. Blooms/background images may be swapped for the same shape in another palette colour by setting assetId (never invent a src). Do NOT change any text, position or size. Do not add or delete elements.`;
  },
  targets: () => true,
  props: new Set(['fill', 'src', 'assetId', 'custom', 'variant', 'opacity']),
  allowBackground: true,
};

export const imageryDimension: IterationDimension = {
  id: 'imagery',
  label: 'Imagery',
  blurb: 'Swap the illustration / photo / product shot',
  brief: (brand, _assets, page) => {
    const imgs = page.elements.filter(isImagery).map((e) => `${e.id} role=${role(e)} assetId=${e.assetId || '-'} @${e.x},${e.y} ${e.width}x${e.height}`).join('; ') || 'none';
    return `Swap the IMAGERY for different library assets of the same kind (illustration→another illustration, product-ui→another product shot, bloom→another bloom, charm→another charm) that tell the story differently. Current imagery: ${imgs}. Pick asset ids from the catalogue in the system prompt and set "assetId" (src/custom will be filled in). Keep each image's x/y/width; you may change height to match the new asset's aspect ratio or shift x/y a little to keep it in place. Never pick the same asset the page already uses. If a role has no alternative in the library, leave that element unchanged. Do not touch text, colours or the logo. ${brand.imagery ? `Imagery guidance: ${JSON.stringify(brand.imagery)}` : ''}`;
  },
  targets: (el) => isImagery(el),
  props: new Set(['assetId', 'src', 'custom', 'x', 'y', 'width', 'height', 'rotation', 'opacity']),
  allowAdd: (el) => (el?.type === 'image' || el?.type === 'svg') && IMAGE_ROLES.has(el?.custom?.role || el?.role || ''),
  allowDelete: (el) => isImagery(el),
};

export const layoutDimension: IterationDimension = {
  id: 'layout',
  label: 'Layout',
  blurb: 'Same content, another layout recipe',
  brief: (brand, _a, page, W, H) =>
    `Re-arrange the SAME elements into a different composition (e.g. ${(brand.layout.recipes || []).map((r) => r.split(/—|–| - /)[0].trim()).slice(0, 6).join('; ') || 'swap the sides, stack vertically, move the card to the bottom, move imagery to the top'}). Canvas ${W}x${H}. Only change x, y, width, height (and rotation/align) of elements. Cards: when you move or resize a card, move its contents with it so text stays inside the card with padding; keep text blocks at least 0.015×min(W,H) apart vertically. Keep the logo in a corner at the margin (${Math.round(W * brand.layout.marginRatio)}px) and the imagery out of the text. Do not change text, colours, fonts or assets. You may "raise" an element to change stacking.`,
  targets: () => true,
  props: new Set(['x', 'y', 'width', 'height', 'rotation', 'align', 'fontSize']),
  allowRaise: true,
};

/** Dimension registry: add a dimension by listing it here. */
export const dimensions: IterationDimension[] = [hookDimension, colourwayDimension, ctaDimension, imageryDimension, layoutDimension];
export const dimensionById = (id: string) => dimensions.find((d) => d.id === id);

export type ValidatedOps = { ops: Op[]; dropped: string[] };

/**
 * Keep only the ops a dimension allows, so a variant changes exactly that dimension.
 * Disallowed props are stripped (the op survives if anything is left); disallowed ops are dropped.
 */
export function validateVariantOps(page: CompactPage, dim: IterationDimension, raw: Op[]): ValidatedOps {
  const ops: Op[] = [];
  const dropped: string[] = [];
  const byId = new Map(page.elements.map((e) => [e.id, e]));
  for (const op of raw || []) {
    if (!op || typeof op !== 'object') continue;
    if (op.op === 'set') {
      const el = byId.get(op.id);
      if (!el) {
        dropped.push(`set ${op.id}: unknown element`);
        continue;
      }
      if (!dim.targets(el)) {
        dropped.push(`set ${op.id}: ${role(el) || el.type} is outside the "${dim.label}" dimension`);
        continue;
      }
      const props: Record<string, any> = {};
      const removed: string[] = [];
      for (const [k, v] of Object.entries(op.props || {})) (dim.props.has(k) ? (props[k] = v) : removed.push(k));
      if (removed.length) dropped.push(`set ${op.id}: ignored ${removed.join(', ')}`);
      if (Object.keys(props).length) ops.push({ op: 'set', id: op.id, props });
    } else if (op.op === 'background') {
      if (dim.allowBackground && typeof op.value === 'string') ops.push(op);
      else dropped.push('background: not part of this dimension');
    } else if (op.op === 'raise') {
      if (dim.allowRaise && byId.has(op.id)) ops.push(op);
      else dropped.push(`raise ${op.id}: not part of this dimension`);
    } else if (op.op === 'add') {
      if (dim.allowAdd?.(op.element)) ops.push(op);
      else dropped.push(`add ${op.element?.type || '?'}: not part of this dimension`);
    } else if (op.op === 'delete') {
      const el = byId.get(op.id);
      if (el && dim.allowDelete?.(el)) ops.push(op);
      else dropped.push(`delete ${op.id}: not part of this dimension`);
    } else {
      dropped.push(`${(op as any).op}: unknown op`);
    }
  }
  return { ops, dropped };
}

/** True when the op set would visibly change the page (otherwise the variant is a no-op and is rejected) */
export function changesSomething(page: CompactPage, ops: Op[]) {
  const byId = new Map(page.elements.map((e) => [e.id, e]));
  return ops.some((op) => {
    if (op.op === 'set') {
      const el: any = byId.get(op.id);
      return !!el && Object.entries(op.props).some(([k, v]) => JSON.stringify(el[k]) !== JSON.stringify(v));
    }
    if (op.op === 'background') return op.value !== page.background;
    return true;
  });
}
