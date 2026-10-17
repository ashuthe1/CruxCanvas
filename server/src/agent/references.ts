import type { IVisionModel } from '../core/interfaces.js';

/** Turn reference images into a structured, brand-neutral layout brief (positions normalised 0..1). */
export function analyzeReferences(vision: IVisionModel, dataUrls: string[]) {
  return vision.describeJSON(
    `You are a senior art director reverse-engineering reference ads so a layout engine can recreate the style with a different brand's assets.
Return strict JSON:
{
 "summary": "2 sentences on the overall look",
 "aspect": "square|portrait|landscape|story",
 "palette": [{"hex":"#..","usage":"background|card|headline|cta|accent"}],
 "layoutRecipe": "step-by-step description of the composition (what sits where, in reading order)",
 "elements": [ {"type":"background|shape|card|headline|subhead|body|cta|logo|photo|illustration|icon|badge|legal|list", "box":{"x":0..1,"y":0..1,"w":0..1,"h":0..1}, "text":"if any", "notes":"colour/style/alignment"} ],
 "typography": {"headlineStyle":"weight, case, size relative to canvas, line-height, alignment", "bodyStyle":"..."},
 "copyAngle": "what the message is doing (benefit, proof, contrast, offer...)",
 "tone": "voice description",
 "imagery": "photo/illustration/product shot? subject, crop, position",
 "doNotCopy": ["things that are brand-specific to the reference and should be swapped for the target brand assets"]
}
Be precise about boxes. If multiple images are given, describe the shared system and note variations.`,
    `Analyse ${dataUrls.length} reference image(s).`,
    dataUrls,
    1800,
  );
}
