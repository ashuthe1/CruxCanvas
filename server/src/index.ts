import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { brand, getAssets, searchAssets } from './brand.js';
import { lintPage } from './lint.js';
import { runAgent } from './agent.js';
import { generateImage } from './images.js';
import { analyzeReferences } from './vision.js';
import { deliverSnapshot } from './snapshots.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '40mb' }));

const ROOT = path.resolve(process.cwd(), '..');
app.use('/assets', express.static(path.join(ROOT, 'assets'), { maxAge: '1d' }));
app.use('/generated', express.static(path.join(process.cwd(), 'generated'), { maxAge: '1d' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/brand', (_req, res) => res.json(brand));
app.get('/api/assets', (req, res) => {
  const q = String(req.query.q || '');
  const category = req.query.category ? String(req.query.category) : undefined;
  res.json(q || category ? searchAssets(q, category, 200) : getAssets());
});

app.get('/api/references', async (_req, res) => {
  const fs = await import('fs');
  const dir = path.join(ROOT, 'assets', 'references');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort() : [];
  res.json(files.map((f) => ({ name: f, url: `/assets/references/${f}` })));
});

app.post('/api/lint', (req, res) => {
  const { page, width, height } = req.body || {};
  if (!page) return res.status(400).json({ error: 'page required' });
  res.json(lintPage(page, width || 1080, height || 1080));
});

app.post('/api/analyze', async (req, res) => {
  try {
    res.json(await analyzeReferences(req.body.images || []));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/generate-image', async (req, res) => {
  try {
    res.json(await generateImage(req.body.prompt, req.body.purpose, req.body.size));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** The editor answers an agent's snapshot request here */
app.post('/api/snapshot-reply', (req, res) => {
  const { requestId, dataUrl } = req.body || {};
  res.json({ ok: deliverSnapshot(requestId, dataUrl) });
});

/** Save a canvas snapshot (data URL) to /generated — used for visual QA and debugging */
app.post('/api/snapshot', async (req, res) => {
  try {
    const { dataUrl, name } = req.body || {};
    const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl || '');
    if (!m) return res.status(400).json({ error: 'dataUrl required' });
    const fs = await import('fs');
    const file = path.join(process.cwd(), 'generated', `${(name || 'snap').replace(/[^a-z0-9_-]/gi, '')}.${m[1] === 'png' ? 'png' : 'jpg'}`);
    fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
    res.json({ file, url: `/generated/${path.basename(file)}` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Streaming agent endpoint: newline-delimited JSON events */
app.post('/api/agent', async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const ac = new AbortController();
  // NB: req 'close' fires once the body is consumed on modern Node; watch the response instead
  res.on('close', () => {
    if (!res.writableFinished) ac.abort();
  });
  const emit = (e: any) => {
    if (!res.writableEnded) res.write(JSON.stringify(e) + '\n');
  };
  try {
    await runAgent(req.body, emit, ac.signal);
  } catch (e: any) {
    console.error(e);
    emit({ type: 'error', text: e?.message || String(e) });
  } finally {
    emit({ type: 'done' });
    res.end();
  }
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => console.log(`Brand copilot server on http://localhost:${PORT} (${getAssets().length} assets)`));
