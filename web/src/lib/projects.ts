/** Persisted editor sessions ("projects"): canvas + chat + reports + scans, per brand. */
import type { ScanReport } from './api';

export type ProjectStatus = 'draft' | 'in-progress' | 'review' | 'done';
export const STATUS_LABEL: Record<ProjectStatus, string> = { draft: 'Draft', 'in-progress': 'In progress', review: 'In review', done: 'Done' };

export type ProjectSummary = {
  id: string;
  brandId: string;
  title: string;
  status: ProjectStatus;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
  pageCount: number;
  score?: number;
  thumb?: string;
  lastMessage?: string;
  scanCount: number;
  tags: string[];
  usage?: import('./api').UsageTotals;
};
export type ScanRecord = { id: string; createdAt: string; source: 'upload' | 'library' | 'page'; thumb: string; report: ScanReport; remadePageId?: string };
export type Project = ProjectSummary & { canvas: any | null; messages: any[]; scans: ScanRecord[]; pageScores: Record<string, number> };

/** fetch JSON; idempotent calls retry briefly so a dev-server restart (502) doesn't blank the UI */
async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const idempotent = !init?.method || init.method === 'GET' || init.method === 'PUT';
  let lastErr: any;
  for (let attempt = 0; attempt < (idempotent ? 6 : 1); attempt++) {
    try {
      const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
      if (r.status >= 502 && r.status <= 504) throw Object.assign(new Error('server restarting'), { transient: true });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `${url}: ${r.status}`);
      return r.json();
    } catch (e: any) {
      lastErr = e;
      if (!idempotent || !(e.transient || e.name === 'TypeError')) throw e;
      await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
    }
  }
  throw lastErr;
}

export const listProjects = (brandId?: string) => j<ProjectSummary[]>(`/api/projects${brandId ? `?brand=${encodeURIComponent(brandId)}` : ''}`);
export const getProject = (id: string) => j<Project>(`/api/projects/${id}`);
export const createProject = (brandId: string, title?: string) => j<Project>('/api/projects', { method: 'POST', body: JSON.stringify({ brandId, title }) });
export const updateProject = (id: string, patch: Partial<Project>) => j<Project>(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
export const deleteProject = (id: string) => j<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' });
export const duplicateProject = (id: string) => j<Project>(`/api/projects/${id}/duplicate`, { method: 'POST' });
export const addProjectScan = (id: string, scan: Omit<ScanRecord, 'id' | 'createdAt'>) => j<ScanRecord>(`/api/projects/${id}/scans`, { method: 'POST', body: JSON.stringify(scan) });

export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** Which project the editor has open (survives reloads) */
const KEY = 'brandcopilot.projectId';
export const getOpenProjectId = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
export const setOpenProjectId = (id: string | null) => {
  try {
    id ? localStorage.setItem(KEY, id) : localStorage.removeItem(KEY);
  } catch {}
};
