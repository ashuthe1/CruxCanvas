import { openai, MODELS, withRetry } from './llm.js';

/**
 * Turn reference images into a structured brief the (text-only) planner can use.
 * Positions are normalised 0..1 so the planner can re-target any canvas size.
 */
export async function analyzeReferences(dataUrls: string[]): Promise<any> {
  const res = await withRetry(() =>
    openai.chat.completions.create({
      model: MODELS.vision,
      max_tokens: 1800,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a senior art director reverse-engineering reference ads so a layout engine can recreate the style with a different brand's assets.
Return strict JSON:
{
 "summary": "2 sentences on the overall look",
 "aspect": "square|portrait|landscape|story",
 "palette": [{"hex":"#..","usage":"background|card|headline|cta|accent"}],
 "layoutRecipe": "step-by-step description of the composition (what sits where, in reading order)",
 "elements": [
   {"type":"background|shape|card|headline|subhead|body|cta|logo|photo|illustration|icon|badge|legal|list",
    "box":{"x":0..1,"y":0..1,"w":0..1,"h":0..1}, "text":"if any", "notes":"colour/style/alignment"}
 ],
 "typography": {"headlineStyle":"weight, case, size relative to canvas, line-height, alignment", "bodyStyle":"..."},
 "copyAngle": "what the message is doing (benefit, proof, contrast, offer...)",
 "tone": "voice description",
 "imagery": "photo/illustration/product shot? subject, crop, position",
 "doNotCopy": ["things that are brand-specific to the reference and should be swapped for the target brand assets"]
}
Be precise about boxes. If multiple images are given, describe the shared system and note variations.`,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Analyse ${dataUrls.length} reference image(s).` },
            ...dataUrls.slice(0, 4).map((u) => ({ type: 'image_url' as const, image_url: { url: u, detail: 'high' as const } })),
          ],
        },
      ],
    }),
  );
  try {
    return JSON.parse(res.choices[0].message.content || '{}');
  } catch {
    return { summary: res.choices[0].message.content };
  }
}

/** Optional visual QA of a rendered page */
export async function critiqueRender(dataUrl: string, brief: string): Promise<string> {
  const res = await withRetry(() =>
    openai.chat.completions.create({
      model: MODELS.vision,
      max_tokens: 400,
      messages: [
        { role: 'system', content: 'You are a brand design reviewer. Give at most 4 terse, concrete fixes (overlaps, cramped text, misalignment, empty areas, hierarchy). If it looks good say "LGTM".' },
        { role: 'user', content: [{ type: 'text', text: brief }, { type: 'image_url', image_url: { url: dataUrl } }] },
      ],
    }),
  );
  return res.choices[0].message.content || '';
}
