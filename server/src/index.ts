import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { brandRepository, BRANDS_DIR } from './brands/index.js';
import { createProviders } from './providers/index.js';
import { defaultLintEngine } from './lint/index.js';
import { createApi } from './api/routes.js';
import { GENERATED_DIR } from './agent/tools/generateImage.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '40mb' }));

// brand files (assets, fonts, references) and generated images
app.use('/brands', express.static(BRANDS_DIR, { maxAge: '1d' }));
app.use('/generated', express.static(GENERATED_DIR, { maxAge: '1d' }));

const brands = brandRepository();
app.use('/api', createApi({ brands, providers: createProviders(), lint: defaultLintEngine }));

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, async () => {
  const list = await brands.list();
  console.log(`Brand copilot server on http://localhost:${PORT} — brands: ${list.map((b) => b.id).join(', ') || 'none'}`);
});
