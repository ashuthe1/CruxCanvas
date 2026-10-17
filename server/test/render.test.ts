import { describe, it, expect } from 'vitest';
import path from 'path';
import { FsBrandRepository } from '../src/brands/fsBrandRepository.js';
import { DesignRenderer } from '../src/render/renderer.js';
import { DesignSchema } from '../src/render/schema.js';
import { defaultLintEngine, compactFromPage, overlaps } from '../src/lint/index.js';

const repo = new FsBrandRepository(path.resolve(__dirname, '..', '..', 'brands'));
const W = 1080, H = 1080;

async function setup() {
  const brand = await repo.get('xero');
  const assets = await repo.assets('xero');
  const renderer = new DesignRenderer(brand, assets, (rel) => repo.resolve('xero', rel));
  return { brand, assets, renderer };
}

const longHeadline = 'Payroll that runs itself while you run your business and keep every weekend free';

describe('DesignRenderer', () => {
  it('stacks card children with measured heights so text never overlaps', async () => {
    const { renderer } = await setup();
    const design = DesignSchema.parse({
      background: '#3ECCFE',
      elements: [
        { kind: 'card', x: 76, y: 86, width: 928, children: [
          { kind: 'text', role: 'headline', text: longHeadline },
          { kind: 'text', role: 'subhead', text: 'Auto-sync timesheets, calculate pay and file with HMRC in a few clicks.' },
          { kind: 'cta', text: 'Try Xero for free' },
        ] },
      ],
    });
    const page = renderer.render(design, W, H);
    const texts = page.children.filter((c: any) => c.type === 'text');
    expect(texts.length).toBe(3);
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) expect(overlaps(texts[i], texts[j], -1)).toBe(false);
    const card = page.children.find((c: any) => c.custom?.role === 'card');
    for (const t of texts) {
      expect(t.y).toBeGreaterThanOrEqual(card.y);
      expect(t.y + t.height).toBeLessThanOrEqual(card.y + card.height + 1);
      expect(t.custom.container).toBe(card.id);
    }
  });

  it('shrinks a long headline to fit maxLines', async () => {
    const { renderer, brand } = await setup();
    const page = renderer.render(DesignSchema.parse({ elements: [{ kind: 'stack', x: 60, y: 60, width: 960, children: [{ kind: 'text', role: 'headline', text: longHeadline, maxLines: 2 }] }] }), W, H);
    const h = page.children.find((c: any) => c.type === 'text');
    expect(h.fontSize).toBeLessThan(Math.round(W * brand.layout.headline.fontSizeRatio));
  });

  it('keeps the logo on top and at least the minimum width', async () => {
    const { renderer, brand } = await setup();
    const page = renderer.render(DesignSchema.parse({
      elements: [
        { kind: 'logo', variant: 'navy', x: 60, y: 940, width: 40 },
        { kind: 'image', role: 'illustration', assetId: 'nope', x: 0, y: 0, width: 100 },
        { kind: 'shape', shape: 'rect', x: 0, y: 900, width: 1080, height: 180, color: '#000856' },
      ],
    }), W, H);
    const last = page.children[page.children.length - 1];
    expect(last.custom.role).toBe('logo');
    expect(last.width).toBeGreaterThanOrEqual(W * brand.logo.minWidthRatio);
  });

  it('nudges imagery below a text container instead of covering it', async () => {
    const { renderer } = await setup();
    const asset = (await repo.assets('xero')).find((a) => a.category === 'illustration')!;
    const page = renderer.render(DesignSchema.parse({
      elements: [
        { kind: 'card', x: 76, y: 86, width: 928, children: [{ kind: 'text', role: 'headline', text: 'Data in. Doubt out.' }] },
        { kind: 'image', role: 'illustration', assetId: asset.id, x: 200, y: 150, width: 700 },
      ],
    }), W, H);
    const card = page.children.find((c: any) => c.custom?.role === 'card');
    const img = page.children.find((c: any) => c.custom?.role === 'illustration');
    expect(img.y).toBeGreaterThanOrEqual(card.y + card.height);
  });

  it('cover-crops photos into their box', async () => {
    const { renderer } = await setup();
    const page = renderer.render(DesignSchema.parse({ elements: [{ kind: 'image', role: 'photo', src: '/generated/x.png', x: 0, y: 500, width: 1080, height: 580 }] }), W, H);
    const img = page.children[0];
    expect(img.height).toBe(580);
    expect(img.cropWidth).toBeDefined();
  });

  it('produces pages the linter scores highly', async () => {
    const { renderer, brand, assets } = await setup();
    const page = renderer.render(DesignSchema.parse({
      background: '#3ECCFE',
      elements: [
        { kind: 'card', x: 76, y: 86, width: 928, children: [{ kind: 'text', role: 'headline', text: 'Run your business, not your books.' }, { kind: 'cta', text: 'Find out more' }] },
        { kind: 'logo', variant: 'navy', x: 760, y: 960, width: 240 },
      ],
    }), W, H);
    const res = defaultLintEngine.run(brand, assets, compactFromPage(page), W, H);
    expect(res.score).toBeGreaterThanOrEqual(90);
  });
});
