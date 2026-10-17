export type AgentEvent =
  | { type: 'status'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'page'; page: any; replacePageId?: string }
  | { type: 'ops'; pageId: string; ops: ElementOp[] }
  | { type: 'lint'; pageId: string; result: LintResult }
  | { type: 'message'; text: string }
  | { type: 'size'; width: number; height: number }
  | { type: 'snapshot_request'; pageId: string; requestId: string }
  | { type: 'error'; text: string }
  | { type: 'done' };

export type ElementOp =
  | { op: 'set'; id: string; props: Record<string, any> }
  | { op: 'delete'; id: string }
  | { op: 'add'; element: any }
  | { op: 'background'; value: string };

export type LintIssue = {
  id: string;
  rule: string;
  severity: 'error' | 'warn' | 'info';
  message: string;
  elementId?: string;
  fix?: ElementOp[];
};
export type LintResult = { score: number; issues: LintIssue[] };

export type Asset = {
  id: string;
  category: string;
  name: string;
  url: string;
  width: number;
  height: number;
  tags: string[];
  hasAlpha?: boolean;
  dominant?: string;
};

export type Brand = {
  name: string;
  colors: { name: string; hex: string; role: string }[];
  fonts: { headline: string; body: string };
  logo: Record<string, any>;
  rules: string[];
};

export async function getBrand(): Promise<Brand> {
  return (await fetch('/api/brand')).json();
}
export async function getAssets(): Promise<Asset[]> {
  return (await fetch('/api/assets')).json();
}
export async function lintPage(page: any, width: number, height: number): Promise<LintResult> {
  const r = await fetch('/api/lint', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page, width, height }),
  });
  return r.json();
}

export type AgentRequest = {
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  canvas: {
    width: number;
    height: number;
    pages: any[]; // compact serialization
    activePageId: string;
    selectedIds: string[];
  };
  references?: string[]; // data URLs
  variants?: number;
};

/** POST and stream newline-delimited JSON events */
export async function streamAgent(req: AgentRequest, onEvent: (e: AgentEvent) => void, signal?: AbortSignal) {
  const res = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) {
    onEvent({ type: 'error', text: `Server error ${res.status}` });
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line));
      } catch {
        /* ignore partial */
      }
    }
  }
}
