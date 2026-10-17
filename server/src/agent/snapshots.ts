/**
 * Round-trip to the browser: the agent asks the editor for a rendered snapshot of a page
 * (the real canvas, fonts and all) so a vision model can review it.
 */
const pending = new Map<string, { resolve: (dataUrl: string | null) => void; timer: NodeJS.Timeout }>();

export function waitForSnapshot(requestId: string, timeoutMs = 15000): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve(null);
    }, timeoutMs);
    pending.set(requestId, { resolve, timer });
  });
}

export function deliverSnapshot(requestId: string, dataUrl: string) {
  const p = pending.get(requestId);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(requestId);
  p.resolve(dataUrl);
  return true;
}
