/**
 * File-backed project store: data/projects/<id>.json (one file per project, thumbnails inline).
 * Swap for a DB by implementing IProjectRepository.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { IProjectRepository, Project, ProjectSummary, ScanRecord } from './types.js';

const SUMMARY_KEYS: (keyof ProjectSummary)[] = ['id', 'brandId', 'title', 'status', 'starred', 'createdAt', 'updatedAt', 'pageCount', 'score', 'thumb', 'lastMessage', 'scanCount', 'tags'];

export class FsProjectRepository implements IProjectRepository {
  constructor(public readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }
  private file(id: string) {
    if (!/^[a-z0-9_-]+$/i.test(id)) throw Object.assign(new Error('invalid project id'), { status: 400 });
    return path.join(this.dir, `${id}.json`);
  }
  private read(id: string): Project {
    const f = this.file(id);
    if (!fs.existsSync(f)) throw Object.assign(new Error('project not found'), { status: 404 });
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  private write(p: Project) {
    fs.writeFileSync(this.file(p.id), JSON.stringify(p));
  }
  private summary(p: Project): ProjectSummary {
    const s: any = {};
    for (const k of SUMMARY_KEYS) s[k] = (p as any)[k];
    return s;
  }
  private derive(p: Project) {
    const pages: any[] = p.canvas?.pages || [];
    p.pageCount = pages.filter((pg) => pg.children?.length).length;
    const scores = Object.values(p.pageScores || {});
    p.score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : undefined;
    p.scanCount = (p.scans || []).length;
    const lastAssistant = [...(p.messages || [])].reverse().find((m) => m.kind === 'assistant');
    p.lastMessage = lastAssistant?.text?.slice(0, 140);
    return p;
  }

  async list(brandId?: string) {
    const out: ProjectSummary[] = [];
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const p = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as Project;
        if (brandId && p.brandId !== brandId) continue;
        out.push(this.summary(p));
      } catch {}
    }
    return out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }
  async get(id: string) {
    return this.read(id);
  }
  async create(input: Partial<Project> & { brandId: string }) {
    const now = new Date().toISOString();
    const p: Project = this.derive({
      id: randomUUID().slice(0, 10),
      brandId: input.brandId,
      title: input.title || 'Untitled design',
      status: input.status || 'draft',
      starred: !!input.starred,
      createdAt: now,
      updatedAt: now,
      pageCount: 0,
      scanCount: 0,
      tags: input.tags || [],
      canvas: input.canvas ?? null,
      messages: input.messages || [],
      scans: input.scans || [],
      pageScores: input.pageScores || {},
    });
    this.write(p);
    return p;
  }
  async update(id: string, patch: Partial<Project>) {
    const p = this.read(id);
    const allowed: (keyof Project)[] = ['title', 'status', 'starred', 'tags', 'canvas', 'messages', 'pageScores', 'thumb', 'brandId'];
    for (const k of allowed) if (k in patch) (p as any)[k] = (patch as any)[k];
    p.updatedAt = new Date().toISOString();
    this.write(this.derive(p));
    return p;
  }
  async remove(id: string) {
    const f = this.file(id);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  async addScan(id: string, scan: Omit<ScanRecord, 'id' | 'createdAt'>) {
    const p = this.read(id);
    const rec: ScanRecord = { id: randomUUID().slice(0, 8), createdAt: new Date().toISOString(), ...scan };
    p.scans = [rec, ...(p.scans || [])].slice(0, 30);
    p.updatedAt = rec.createdAt;
    this.write(this.derive(p));
    return rec;
  }
}
