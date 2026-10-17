import { getBrandId } from './brand';

export type ElementOp =
  | { op: 'set'; id: string; props: Record<string, any> }
  | { op: 'delete'; id: string }
  | { op: 'add'; element: any }
  | { op: 'raise'; id: string }
  | { op: 'background'; value: string };

export type LintIssue = { id: string; rule: string; severity: 'error' | 'warn' | 'info'; message: string; elementId?: string; fix?: ElementOp[] };
export type LintResult = { score: number; issues: LintIssue[]; passed: string[] };

export type DesignReport = { name?: string; rationale?: string; score: number; checks: { rule: string; ok: boolean; detail?: string }[]; autoFixed: string[] };

export type AgentEvent =
  | { type: 'status'; text: string }
  | { type: 'page'; page: any; replacePageId?: string }
  | { type: 'ops'; pageId: string; ops: ElementOp[] }
  | { type: 'lint'; pageId: string; result: LintResult }
  | { type: 'size'; width: number; height: number }
  | { type: 'snapshot_request'; pageId: string; requestId: string }
  | { type: 'report'; pageId: string; report: DesignReport }
  | { type: 'message'; text: string }
  | { type: 'error'; text: string }
  | { type: 'done' };

export type Asset = { id: string; category: string; name: string; url: string; width: number; height: number; tags: string[]; hasAlpha?: boolean; dominant?: string; colour?: string };

export type Brand = {
  id: string;
  name: string;
  tagline?: string;
  colors: { name: string; hex: string; role: string }[];
  fonts: Record<string, any>;
  fontUrls: Record<string, { family: string; url: string }>;
  logo: { assets: Record<string, string> };
  layout: { recipes?: string[] };
  rules: string[];
};
export type BrandSummary = { id: string; name: string; tagline?: string };

function headers(extra: Record<string, string> = {}) {
  return { 'x-brand-id': getBrandId(), ...extra };
}
async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: headers() });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

export const listBrands = () => getJSON<BrandSummary[]>('/api/brands');
export const getBrand = (id = getBrandId()) => getJSON<Brand>(`/api/brands/${id}`);
export const getAssets = (id = getBrandId()) => getJSON<Asset[]>(`/api/brands/${id}/assets`);
export const getReferences = (id = getBrandId()) => getJSON<{ name: string; url: string }[]>(`/api/brands/${id}/references`);

export async function lintPage(page: any, width: number, height: number): Promise<LintResult> {
  const r = await fetch('/api/lint', { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ page, width, height }) });
  return r.json();
}

export type ScanCheck = { rule: string; ok: boolean; severity: 'error' | 'warn' | 'info'; detail: string; fix?: string };
export type ScanReport = {
  score: number;
  verdict: 'on-brand' | 'needs-work' | 'off-brand';
  width: number;
  height: number;
  aspect: string;
  summary: string;
  checks: ScanCheck[];
  extracted: { headline?: string; subhead?: string; cta?: string; legal?: string; logo: any; fontsLookLikeBrand?: boolean; fontNotes?: string; layout: string; elements: any[] };
  palette: { detected: { hex: string; share: number; nearest: string; distance: number; onBrand: boolean }[]; coverageOnBrand: number };
  remakeBrief: string;
};
export async function scanCreative(image: string): Promise<ScanReport> {
  const r = await fetch('/api/scan', { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ image }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `Scan failed (${r.status})`);
  return r.json();
}

export async function sendSnapshotReply(requestId: string, dataUrl: string) {
  await fetch('/api/snapshot-reply', { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ requestId, dataUrl }) });
}

export type AgentRequest = {
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  canvas: { width: number; height: number; pages: any[]; activePageId: string; selectedIds: string[] };
  references?: string[];
  variants?: number;
};

/** POST and stream newline-delimited JSON events */
export async function streamAgent(req: AgentRequest, onEvent: (e: AgentEvent) => void, signal?: AbortSignal) {
  const res = await fetch('/api/agent', { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(req), signal });
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
      } catch {}
    }
  }
}
