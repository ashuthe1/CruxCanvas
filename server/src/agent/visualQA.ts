/**
 * Visual QA: the vision model looks at the real render and reports concrete layout defects the
 * structured linter cannot see (optical overlaps, occlusion, cut-offs, unreadable text, awkward
 * wraps, cramped or unbalanced composition). Findings reference element ids so the planner can
 * fix them with ops.
 */
import type { IVisionModel } from '../core/interfaces.js';
import type { CompactPage } from '../core/types.js';

export type VisualIssue = { severity: 'error' | 'warn'; elementIds: string[]; problem: string; suggestion: string };
export type VisualQA = { ok: boolean; issues: VisualIssue[]; summary: string };

/** z-order listing: first = back, last = front — the model must know what can cover what */
export function elementListing(page: CompactPage) {
  return page.elements
    .map((e, i) => `z${i} ${e.id} ${e.role || e.type}${e.text ? ` "${(e.text || '').slice(0, 28)}"` : ''} @(${Math.round(e.x)},${Math.round(e.y)}) ${Math.round(e.width)}×${Math.round(e.height)}`)
    .join('\n');
}

const CHECKLIST = `Go through this checklist and report every failure as an issue (ERROR = must fix, WARN = should fix):
1. OCCLUSION — is any text, logo, CTA, charm or illustration partly or fully covered by another element (a card, image or shape drawn above it)? Compare the listing (lower z is behind) with what is actually visible. Anything partly hidden is an ERROR.
2. CLIPPING — is any text, logo, CTA, illustration or product shot cut by the canvas edge beyond a small intentional bleed? ERROR for text/logo/CTA/charm; ERROR for illustrations or product shots losing more than ~10%.
3. VISIBILITY — is every listed element actually visible (not zero-size, not transparent, not the same colour as its background, not rendered as a broken-image box or placeholder)? ERROR.
4. CONTAINMENT — does every text and button sit fully inside the card it belongs to, with even padding on all sides? Text touching or spilling past the card edge is an ERROR; uneven padding is a WARN.
5. OVERLAP — do any two text blocks, or text and a button, or a charm and text, overlap or touch? ERROR.
6. ALIGNMENT — are the left edges of the label, headline, subhead and CTA inside a card aligned to one vertical line? Are the logo and the card aligned to the same outer margin? Is the vertical rhythm consistent (similar gaps between stacked items, nothing jammed or floating)? Misaligned by more than a few pixels is a WARN; clearly ragged is an ERROR.
7. READABILITY — is any text too small, low-contrast, or set over a busy image or a bloom edge? Awkward line breaks (an orphan word on its own line, a headline wrapping into 4+ lines, a CTA label wrapping or clipped inside its pill, text truncated with an ellipsis) are WARN; unreadable text is an ERROR.
8. IMAGE QUALITY — pixelated or blurry imagery (upscaled too far), an awkward crop (a face or product cut in half), distorted/stretched images or logos. ERROR for distortion and cut faces, WARN for softness.
9. PLACEMENT — logo in a clear corner with breathing room, not straddling a card or sitting on the illustration; the CTA where the eye lands after the headline; imagery anchored to an edge or the card, not drifting mid-air. WARN unless clearly broken.
10. COMPOSITION & BALANCE — large dead areas, everything crammed into one half, charms as clutter, unbalanced margins (e.g. 20 px on one side, 120 px on the other). WARN.
11. BRAND SENSE — colours or shapes that obviously fight the brand look described by the palette (e.g. off-palette fills, neon accents). WARN.`;

export async function inspectRender(vision: IVisionModel, dataUrl: string, page: CompactPage, W: number, H: number, focus?: string): Promise<VisualQA> {
  const res = await vision.describeJSON(
    `You are a meticulous design QA reviewer looking at the ACTUAL render of a canvas (the image) together with the layer listing. Report only real, visible defects — be strict about anything hidden, cut or overlapping, lenient about taste.
${CHECKLIST}
Return strict JSON: {"ok": true|false, "summary": "one sentence", "issues": [{"severity":"error"|"warn","elementIds":["id",...],"problem":"what is wrong, precisely, with numbers where useful","suggestion":"concrete fix with target coordinates (absolute px) or a z-order change"}]}
Name elements by the ids in the listing. ok must be false if any ERROR exists. If nothing is wrong, return ok:true with an empty list.`,
    `Canvas ${W}×${H} px. ${focus ? `The user just asked: "${focus}". ` : ''}Layers from back to front:\n${elementListing(page)}`,
    [dataUrl],
    1100,
  );
  const issues: VisualIssue[] = Array.isArray(res?.issues) ? res.issues.filter((i: any) => i && i.problem).map((i: any) => ({ severity: i.severity === 'error' ? 'error' : 'warn', elementIds: Array.isArray(i.elementIds) ? i.elementIds : [], problem: String(i.problem), suggestion: String(i.suggestion || '') })) : [];
  return { ok: issues.filter((i) => i.severity === 'error').length === 0, issues, summary: String(res?.summary || '') };
}
