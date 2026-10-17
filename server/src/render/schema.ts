/** The design spec vocabulary the planner writes. Small, brand-aware, validated with zod. */
import { z } from 'zod';

const num = z.number();

export const TextSpec = z.object({
  kind: z.literal('text'),
  role: z.enum(['headline', 'subhead', 'body', 'label', 'legal', 'stat']).optional(),
  text: z.string(),
  x: num.optional(), y: num.optional(), width: num.optional(),
  fontSize: num.optional(),
  maxLines: num.optional(),
  font: z.enum(['headline', 'body', 'bodyBold']).optional(),
  color: z.string().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  lineHeight: num.optional(),
  letterSpacing: num.optional(),
});
export const ImageSpec = z.object({
  kind: z.literal('image'),
  role: z.enum(['background', 'bloom', 'photo', 'illustration', 'charm', 'product-ui', 'decor']).optional(),
  assetId: z.string().optional(),
  src: z.string().optional(),
  x: num, y: num, width: num, height: num.optional(),
  rotation: num.optional(),
  flipX: z.boolean().optional(),
  opacity: num.optional(),
  cornerRadius: num.optional(),
});
export const ShapeSpec = z.object({
  kind: z.literal('shape'),
  shape: z.enum(['rect', 'circle', 'pill']),
  x: num, y: num, width: num, height: num,
  color: z.string(),
  cornerRadius: num.optional(),
  opacity: num.optional(),
  rotation: num.optional(),
  role: z.string().optional(),
});
export const CtaSpec = z.object({
  kind: z.literal('cta'),
  text: z.string(),
  x: num.optional(), y: num.optional(),
  bg: z.string().optional(),
  color: z.string().optional(),
  fontSize: num.optional(),
  width: num.optional(),
});
export const LogoSpec = z.object({
  kind: z.literal('logo'),
  variant: z.string(),
  x: num, y: num, width: num,
  pill: z.string().optional(),
});
export const ChecklistSpec = z.object({
  kind: z.literal('checklist'),
  items: z.array(z.string()).min(1).max(6),
  x: num.optional(), y: num.optional(),
  color: z.string().optional(),
  fontSize: num.optional(),
  columns: num.optional(),
  checkColor: z.string().optional(),
});
export const SpacerSpec = z.object({ kind: z.literal('spacer'), height: num });

export const ChildSpec = z.discriminatedUnion('kind', [TextSpec, CtaSpec, ChecklistSpec, SpacerSpec]);

/** Vertical flow container. `card` draws a rounded rect behind it; `stack` is invisible. */
export const ContainerSpec = z.object({
  kind: z.enum(['card', 'stack']),
  x: num, y: num, width: num,
  height: num.optional(),
  padding: num.optional(),
  gap: num.optional(),
  color: z.string().optional(),
  cornerRadius: num.optional(),
  align: z.enum(['left', 'center']).optional(),
  anchor: z.enum(['top', 'bottom']).optional(),
  children: z.array(ChildSpec).default([]),
});

export const DesignSchema = z.object({
  name: z.string().optional(),
  rationale: z.string().optional(),
  width: num.optional(),
  height: num.optional(),
  background: z.string().optional(),
  elements: z.array(z.discriminatedUnion('kind', [TextSpec, ImageSpec, ShapeSpec, ContainerSpec, CtaSpec, LogoSpec, ChecklistSpec])),
});
export type Design = z.infer<typeof DesignSchema>;
export type TextEl = z.infer<typeof TextSpec>;
export type CtaEl = z.infer<typeof CtaSpec>;
export type ChecklistEl = z.infer<typeof ChecklistSpec>;
export type ContainerEl = z.infer<typeof ContainerSpec>;

/** Human-readable schema shown to the planner */
export const DESIGN_SPEC_DOC = `{
 "name": "short name", "rationale": "one sentence on why this layout/copy serves the brief",
 "background": "#hex from palette OR a background-template asset id",
 "elements": [  // back to front
  {"kind":"image","role":"bloom|photo|illustration|charm|product-ui|decor","assetId":"...","x":..,"y":..,"width":..,"height"?:..,"rotation"?:..,"flipX"?:true,"opacity"?:..},
  {"kind":"image","role":"illustration","src":"/generated/...png","x":..,"y":..,"width":..},   // from generate_image
  {"kind":"card","x":..,"y":..,"width":..,"padding"?:..,"gap"?:..,"color"?:"#FFFFFF","align"?:"left|center","anchor"?:"top|bottom","children":[ ...text/cta/checklist/spacer... ]},
  {"kind":"stack","x":..,"y":..,"width":..,"gap"?:..,"align"?:"left|center","anchor"?:"top|bottom","children":[ ... ]},   // like card, no background rect
  {"kind":"shape","shape":"rect|circle|pill","x":..,"y":..,"width":..,"height":..,"color":"#hex","opacity"?:..,"rotation"?:..},
  {"kind":"logo","variant":"<logo variant>","x":..,"y":..,"width":..,"pill"?:"<pill colour name>"},
  {"kind":"checklist","items":["..."],"x":..,"y":..,"color"?:"#hex","columns"?:2}
 ]
}
Children of card/stack (laid out top-to-bottom automatically; heights are measured with the real fonts; headline auto-shrinks to fit maxLines):
  {"kind":"text","role":"headline|subhead|body|label|legal|stat","text":"...","fontSize"?:..,"maxLines"?:3,"color"?:"#hex","align"?:..}
  {"kind":"cta","text":"...","bg"?:"#hex","color"?:"#hex"} | {"kind":"checklist","items":[...]} | {"kind":"spacer","height":..}
ALWAYS put headline/subhead/CTA inside one card or stack — never as loose text — so they cannot overlap. Loose text/cta (with x,y,width) is only for isolated labels (legal line, a badge). Container height is computed from content ("height" is a minimum). With anchor:"bottom", y is the container's bottom edge.`;
