import { describe, it, expect } from 'vitest';
import type { CompactPage, Op } from '../src/core/types.js';
import { changesSomething, dimensionById, dimensions, validateVariantOps } from '../src/iterate/dimensions.js';
import { cloneCompact, remapOps } from '../src/iterate/iterate.js';

const page: CompactPage = {
  id: 'p1',
  background: '#3ECCFE',
  elements: [
    { id: 'card', type: 'figure', role: 'card', subType: 'rect', x: 76, y: 86, width: 928, height: 400, fill: '#FFFFFF' },
    { id: 'h', type: 'text', role: 'headline', container: 'card', x: 130, y: 140, width: 820, height: 160, text: 'Data in. Doubt out.', fontSize: 78, fontFamily: 'XeroHeadline', fill: '#000856' },
    { id: 'ctabg', type: 'figure', role: 'cta-bg', container: 'card', subType: 'rect', x: 130, y: 380, width: 260, height: 64, fill: '#000856' },
    { id: 'cta', type: 'text', role: 'cta', container: 'card', x: 130, y: 396, width: 260, height: 32, text: 'Try Xero for free', fontSize: 26, fontFamily: 'XeroBodyBold', fill: '#FFFFFF' },
    { id: 'img', type: 'image', role: 'illustration', x: 300, y: 560, width: 600, height: 500, src: '/brands/xero/a.png', assetId: 'illo_1' },
    { id: 'logo', type: 'image', role: 'logo', x: 800, y: 980, width: 216, height: 62, src: '/brands/xero/logo.png', assetId: 'logo_navy', custom: { role: 'logo', variant: 'navy', assetId: 'logo_navy' } },
  ],
};
const dim = (id: string) => dimensionById(id)!;

describe('winner iterations — op-set validation', () => {
  it('registers the five dimensions', () => {
    expect(dimensions.map((d) => d.id)).toEqual(['hook', 'colourway', 'cta', 'imagery', 'layout']);
  });

  it('hook: keeps headline text changes, strips colour/position and drops ops on other elements', () => {
    const raw: Op[] = [
      { op: 'set', id: 'h', props: { text: 'Cash flow without the suspense.', fill: '#FF0000', x: 10 } },
      { op: 'set', id: 'cta', props: { text: 'Get started' } },
      { op: 'background', value: '#000856' },
      { op: 'delete', id: 'img' },
    ];
    const { ops, dropped } = validateVariantOps(page, dim('hook'), raw);
    expect(ops).toEqual([{ op: 'set', id: 'h', props: { text: 'Cash flow without the suspense.' } }]);
    expect(dropped).toHaveLength(4);
    expect(changesSomething(page, ops)).toBe(true);
  });

  it('cta: only the CTA copy (and its pill width) may change', () => {
    const { ops } = validateVariantOps(page, dim('cta'), [
      { op: 'set', id: 'cta', props: { text: 'Start your free trial', fill: '#000000' } },
      { op: 'set', id: 'ctabg', props: { width: 320, fill: '#3ECCFE' } },
      { op: 'set', id: 'h', props: { text: 'nope' } },
    ]);
    expect(ops).toEqual([
      { op: 'set', id: 'cta', props: { text: 'Start your free trial' } },
      { op: 'set', id: 'ctabg', props: { width: 320 } },
    ]);
  });

  it('colourway: fills, background and logo variant swap pass; text and geometry do not', () => {
    const { ops, dropped } = validateVariantOps(page, dim('colourway'), [
      { op: 'background', value: '#000856' },
      { op: 'set', id: 'card', props: { fill: '#000E4A', x: 0 } },
      { op: 'set', id: 'logo', props: { src: '/brands/xero/logo-white.png', custom: { variant: 'white', assetId: 'logo_white', role: 'logo' } } },
      { op: 'set', id: 'h', props: { fill: '#FFFFFF', text: 'changed' } },
      { op: 'add', element: { type: 'figure', fill: '#000856' } },
    ]);
    expect(ops).toHaveLength(4);
    expect(ops.find((o) => o.op === 'set' && o.id === 'h')).toEqual({ op: 'set', id: 'h', props: { fill: '#FFFFFF' } });
    expect(dropped.some((d) => d.startsWith('add'))).toBe(true);
  });

  it('imagery: only image elements with imagery roles, never the logo', () => {
    const { ops, dropped } = validateVariantOps(page, dim('imagery'), [
      { op: 'set', id: 'img', props: { assetId: 'illo_2', height: 480 } },
      { op: 'set', id: 'logo', props: { assetId: 'illo_3' } },
      { op: 'add', element: { type: 'image', x: 0, y: 0, width: 300, custom: { role: 'charm' } } },
      { op: 'add', element: { type: 'text', text: 'hi' } },
    ]);
    expect(ops.map((o) => o.op)).toEqual(['set', 'add']);
    expect(dropped.some((d) => d.startsWith('set logo'))).toBe(true);
  });

  it('layout: geometry and raise only — no text, fill, src or background', () => {
    const { ops } = validateVariantOps(page, dim('layout'), [
      { op: 'set', id: 'card', props: { y: 560, fill: '#000856', text: 'x' } },
      { op: 'set', id: 'img', props: { y: 86, src: '/other.png' } },
      { op: 'raise', id: 'card' },
      { op: 'background', value: '#000856' },
    ]);
    expect(ops).toEqual([
      { op: 'set', id: 'card', props: { y: 560 } },
      { op: 'set', id: 'img', props: { y: 86 } },
      { op: 'raise', id: 'card' },
    ]);
  });

  it('rejects no-op variants (same values, unknown ids)', () => {
    const { ops } = validateVariantOps(page, dim('hook'), [
      { op: 'set', id: 'h', props: { text: 'Data in. Doubt out.' } },
      { op: 'set', id: 'ghost', props: { text: 'x' } },
    ]);
    expect(changesSomething(page, ops)).toBe(false);
  });

  it('clones a page with suffixed ids and remaps containers and ops', () => {
    const clone = cloneCompact(page, 'p1_v1', 'ab1');
    expect(clone.elements.map((e) => e.id)).toContain('h_ab1');
    expect(clone.elements.find((e) => e.id === 'h_ab1')?.container).toBe('card_ab1');
    expect(page.elements.find((e) => e.id === 'h')?.container).toBe('card');
    expect(remapOps([{ op: 'set', id: 'h', props: { text: 'x' } }, { op: 'background', value: '#fff' }], 'ab1')).toEqual([
      { op: 'set', id: 'h_ab1', props: { text: 'x' } },
      { op: 'background', value: '#fff' },
    ]);
  });
});
