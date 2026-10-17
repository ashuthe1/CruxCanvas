import { Router } from 'express';
import type { IProjectRepository } from './types.js';

/** /api/projects — persisted editor sessions (canvas, chat, reports, scans) per brand */
export function createProjectsApi(repo: IProjectRepository) {
  const r = Router();
  const wrap = (fn: (req: any, res: any) => Promise<any>) => (req: any, res: any) => fn(req, res).catch((e: any) => res.status(e.status || 500).json({ error: e.message || String(e) }));

  r.get('/', wrap(async (req, res) => res.json(await repo.list(req.query.brand ? String(req.query.brand) : undefined))));
  r.post('/', wrap(async (req, res) => {
    const brandId = req.body?.brandId || req.headers['x-brand-id'];
    if (!brandId) return res.status(400).json({ error: 'brandId required' });
    res.json(await repo.create({ ...req.body, brandId }));
  }));
  r.get('/:id', wrap(async (req, res) => res.json(await repo.get(req.params.id))));
  r.put('/:id', wrap(async (req, res) => res.json(await repo.update(req.params.id, req.body || {}))));
  r.delete('/:id', wrap(async (req, res) => {
    await repo.remove(req.params.id);
    res.json({ ok: true });
  }));
  r.post('/:id/duplicate', wrap(async (req, res) => {
    const p = await repo.get(req.params.id);
    res.json(await repo.create({ brandId: p.brandId, title: `${p.title} (copy)`, canvas: p.canvas, messages: p.messages, pageScores: p.pageScores, tags: p.tags, thumb: p.thumb }));
  }));
  r.post('/:id/scans', wrap(async (req, res) => res.json(await repo.addScan(req.params.id, req.body))));
  return r;
}
