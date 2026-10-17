/** Persistent workspace objects: a project is one editor session (canvas + chat + scans). */
import type { ScanReport } from '../core/types.js';

export type ProjectStatus = 'draft' | 'in-progress' | 'review' | 'done';

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
  /** running model-usage total for the session (estimate) */
  usage?: import('../core/usage.js').UsageTotals;
};

export type ScanRecord = { id: string; createdAt: string; source: 'upload' | 'library' | 'page'; thumb: string; report: ScanReport; remadePageId?: string };

export type Project = ProjectSummary & {
  canvas: any | null;
  messages: any[];
  scans: ScanRecord[];
  pageScores: Record<string, number>;
};

export interface IProjectRepository {
  list(brandId?: string): Promise<ProjectSummary[]>;
  get(id: string): Promise<Project>;
  create(input: Partial<Project> & { brandId: string }): Promise<Project>;
  update(id: string, patch: Partial<Project>): Promise<Project>;
  remove(id: string): Promise<void>;
  addScan(id: string, scan: Omit<ScanRecord, 'id' | 'createdAt'>): Promise<ScanRecord>;
}
