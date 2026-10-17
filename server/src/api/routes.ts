import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import type { IBrandRepository, Providers } from '../core/interfaces.js';
import { LintEngine } from '../lint/index.js';
import { runAgent } from '../agent/runAgent.js';
import { defaultTools } from '../agent/tools/index.js';
import { deliverSnapshot } from '../agent/snapshots.js';
import { analyzeReferences } from '../agent/references.js';
import { searchAssets } from '../brands/index.js';
import { GENERATED_DIR } from '../agent/tools/generateImage.js';
import { scanCreative } from '../scan/brandScan.js';
import { iteratePage } from '../iterate/iterate.js';
import { dimensions } from '../iterate/dimensions.js';

export type ApiDeps = { brands: IBrandRepository; providers: Providers; lint: LintEngine };

/** Brand is selected per request: header x-brand-id, ?brand=, or body.brandId */
function brandIdOf(req: any): string {
  return String(req.headers['x-brand-id'] || req.query.brand || req.body?.brandId || req.params.id || 'xero');
}

export function createApi(deps: ApiDeps) {
  const r = Router();
  const wrap = (fn: (req: any, res: any) => Promise<any>) => (req: any, res: any) =>
    fn(req, res).catch((e: any) => res.status(e.status || 500).json({ error: e.message || String(e) }));

  r.get('/health', (_req, res) => res.json({ ok: true, rules: deps.lint.ruleTitles.length, planner: deps.providers.planner.name }));

  // ---- brands ----
  r.get('/brands', wrap(async (_req, res) => res.json(await deps.brands.list())));
  r.get('/brands/:id', wrap(async (req, res) => {
    const b = await deps.brands.get(req.params.id);
    res.json({ ...b, fontUrls: Object.fromEntries(Object.entries(b.fonts).filter(([k]) => k !== 'notes').map(([k, v]: any) => [k, { family: v.family, url: `/brands/${b.id}/${v.file}` }])) });
  }));
  r.get('/brands/:id/assets', wrap(async (req, res) => {
    const assets = await deps.brands.assets(req.params.id);
    const q = String(req.query.q || ''), category = req.query.category ? String(req.query.category) : undefined;
    res.json(q || category ? searchAssets(assets, q, category, 200) : assets);
  }));
  r.get('/brands/:id/references', wrap(async (req, res) => res.json(await deps.brands.references(req.params.id))));
  r.get('/brands/:id/rules', wrap(async (_req, res) => res.json(deps.lint.ruleTitles)));

  // ---- lint ----
  r.post('/lint', wrap(async (req, res) => {
    const { page, width, height } = req.body || {};
    if (!page) return res.status(400).json({ error: 'page required' });
    const id = brandIdOf(req);
    res.json(deps.lint.run(await deps.brands.get(id), await deps.brands.assets(id), page, width || 1080, height || 1080));
  }));

  r.post('/analyze', wrap(async (req, res) => res.json(await analyzeReferences(deps.providers.vision, req.body.images || []))));

  // ---- brand scan: audit any flat creative against the brand ----
  r.post('/scan', wrap(async (req, res) => {
    const id = brandIdOf(req);
    const image = req.body?.image;
    if (!image) return res.status(400).json({ error: 'image (data URL) required' });
    const report = await scanCreative(image, { brand: await deps.brands.get(id), assets: await deps.brands.assets(id), vision: deps.providers.vision, resolve: (rel) => deps.brands.resolve(id, rel) });
    res.json(report);
  }));

  // ---- snapshots (visual review round-trip + debugging) ----
  r.post('/snapshot-reply', (req, res) => res.json({ ok: deliverSnapshot(req.body?.requestId, req.body?.dataUrl) }));
  r.post('/snapshot', (req, res) => {
    const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(req.body?.dataUrl || '');
    if (!m) return res.status(400).json({ error: 'dataUrl required' });
    const file = path.join(GENERATED_DIR, `${String(req.body.name || 'snap').replace(/[^a-z0-9_-]/gi, '')}.${m[1] === 'png' ? 'png' : 'jpg'}`);
    fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
    res.json({ file, url: `/generated/${path.basename(file)}` });
  });

  /** NDJSON event stream shared by the agent and the iteration runner */
  const stream = (run: (emit: (e: any) => void, signal: AbortSignal) => Promise<any>) => async (_req: any, res: any) => {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
    const ac = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) ac.abort();
    });
    const emit = (e: any) => {
      if (!res.writableEnded) res.write(JSON.stringify(e) + '\n');
    };
    try {
      await run(emit, ac.signal);
    } catch (e: any) {
      console.error(e);
      emit({ type: 'error', text: e?.message || String(e) });
    } finally {
      emit({ type: 'done' });
      res.end();
    }
  };

  // ---- agent (NDJSON stream) ----
  r.post('/agent', (req, res) => stream((emit, signal) => runAgent(req.body, { brandId: brandIdOf(req), brands: deps.brands, providers: deps.providers, lint: deps.lint, tools: defaultTools }, emit, signal))(req, res));

  // ---- winner iterations: controlled A/B variants of one page (NDJSON stream) ----
  r.get('/iterate/dimensions', (_req, res) => res.json(dimensions.map((d) => ({ id: d.id, label: d.label, blurb: d.blurb }))));
  r.post('/iterate', (req, res) => stream((emit, signal) => iteratePage(req.body, { brandId: brandIdOf(req), brands: deps.brands, providers: deps.providers, lint: deps.lint }, emit, signal))(req, res));

  return r;
}
