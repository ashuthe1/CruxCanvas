/**
 * Visual QA: the vision model looks at the real render and reports concrete layout defects the
 * structured linter cannot see (optical overlaps, cut-offs, unreadable text, cramped composition).
 * Findings reference element ids so the planner can fix them with ops.
 */
import type { IVisionModel } from '../core/interfaces.js';
import type { CompactPage } from '../core/types.js';

export type VisualIssue = { severity: 'error' | 'warn'; elementIds: string[]; problem: string; suggestion: string };
export type VisualQA = { ok: boolean; issues: VisualIssue[]; summary: string };

export function elementListing(page: CompactPage) {
  return page.elements
    .map((e) => `${e.id} ${e.role || e.type}${e.text ? ` "${(e.text || '').slice(0, 28)}"` : ''} @(${Math.round(e.x)},${Math.round(e.y)}) ${Math.round(e.width)}×${Math.round(e.height)}`)
    .join('\n');
}

export async function inspectRender(vision: IVisionModel, dataUrl: string, page: CompactPage, W: number, H: number, focus?: string): Promise<VisualQA> {
  const res = await vision.describeJSON(
    `You are a meticulous design QA reviewer looking at the ACTUAL render of a canvas. Report only real, visible defects.
Check: text overlapping other text or buttons; text or logos cut off by the canvas edge; text outside / spilling out of its card; illustrations or photos cut off awkwardly (more than a small intentional bleed); unreadable text (low contrast, too small); elements overlapping the logo; obvious misalignment or cramped spacing; large dead areas.
Return strict JSON: {"ok": true|false, "summary": "one sentence", "issues": [{"severity":"error"|"warn","elementIds":["id",...],"problem":"what is wrong, precisely","suggestion":"concrete fix with target coordinates when possible"}]}
Use the element ids and boxes provided to name elements. If nothing is wrong, return ok:true with an empty list.`,
    `Canvas ${W}×${H}. ${focus ? `Pay special attention to: ${focus}. ` : ''}Elements (id role "text" @(x,y) w×h):\n${elementListing(page)}`,
    [dataUrl],
    900,
  );
  const issues: VisualIssue[] = Array.isArray(res?.issues) ? res.issues.filter((i: any) => i && i.problem).map((i: any) => ({ severity: i.severity === 'error' ? 'error' : 'warn', elementIds: Array.isArray(i.elementIds) ? i.elementIds : [], problem: String(i.problem), suggestion: String(i.suggestion || '') })) : [];
  return { ok: !!res?.ok && issues.filter((i) => i.severity === 'error').length === 0, issues, summary: String(res?.summary || '') };
}
