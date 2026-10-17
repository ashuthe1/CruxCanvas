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

const CHECKLIST = `Go through this checklist and report every failure as an issue:
1. OCCLUSION — is any text, logo, CTA or illustration partly or fully covered by another element (a card, image or shape drawn above it)? Compare the listing (lower z is behind) with what is actually visible. A logo that is partly hidden behind a card is an ERROR.
2. CLIPPING — is any text, logo, CTA, illustration or product shot cut by the canvas edge beyond a small intentional bleed? ERROR for text/logo/CTA, ERROR for illustrations if more than ~10% is lost.
3. CONTAINMENT — does every text and button sit fully inside the card it belongs to, with even padding? Text touching or spilling past the card edge is an ERROR.
4. OVERLAP — do any two text blocks, or text and a button, overlap or touch? ERROR.
5. READABILITY — is any text too small, low-contrast, or set on a busy image? Awkward line breaks (a single orphan word, a headline wrapping into 4+ lines, a CTA label wrapping) are WARN.
6. PLACEMENT — is the logo in a clear corner with breathing room, not straddling a card or sitting on the illustration? Is the CTA where the eye lands after the headline? WARN unless it is clearly broken.
7. COMPOSITION — large dead areas, elements floating with no alignment to the card or grid, imagery crammed into a corner, charms overlapping text. WARN.`;

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
