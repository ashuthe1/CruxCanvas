/**
 * Round-trips to the browser during an agent run:
 *  - snapshot: the editor renders a page (real canvas, fonts and all) for visual QA
 *  - state:    the editor sends its current structured canvas so the server mirror can be re-synced
 *              before final validation (guards against any op the client applied differently)
 */
const pending = new Map<string, { resolve: (payload: any) => void; timer: NodeJS.Timeout }>();

function wait<T>(requestId: string, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve(null);
    }, timeoutMs);
    pending.set(requestId, { resolve, timer });
  });
}
function deliver(requestId: string, payload: any) {
  const p = pending.get(requestId);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(requestId);
  p.resolve(payload);
  return true;
}

export const waitForSnapshot = (requestId: string, timeoutMs = 15000) => wait<string>(requestId, timeoutMs);
export const deliverSnapshot = (requestId: string, dataUrl: string) => deliver(requestId, dataUrl);
export const waitForState = (requestId: string, timeoutMs = 8000) => wait<any>(requestId, timeoutMs);
export const deliverState = (requestId: string, canvas: any) => deliver(requestId, canvas);
