import { describe, it, expect } from 'vitest';
import path from 'path';
import { FsBrandRepository } from '../src/brands/fsBrandRepository.js';
import { defaultLintEngine, LintEngine, applyOpsCompact, expandContainerMoves } from '../src/lint/index.js';
import type { CompactPage } from '../src/core/types.js';

const repo = new FsBrandRepository(path.resolve(__dirname, '..', '..', 'brands'));
const W = 1080, H = 1080;

const text = (id: string, x: number, y: number, w: number, h: number, extra: any = {}) => ({ id, type: 'text', role: 'body', x, y, width: w, height: h, text: 'hello world', fontSize: 28, fontFamily: 'XeroBody', fill: '#000856', ...extra });

async function lint(page: CompactPage) {
  return defaultLintEngine.run(await repo.get('xero'), await repo.assets('xero'), page, W, H);
}

describe('LintEngine', () => {
  it('flags off-palette colours and fixes to the nearest brand colour', async () => {
    const page: CompactPage = { id: 'p', background: '#3ECCFE', elements: [text('t1', 100, 100, 500, 40, { fill: '#FF0000' })] };
    const res = await lint(page);
    const issue = res.issues.find((i) => i.rule === 'Off-palette colour')!;
    expect(issue).toBeTruthy();
    expect(issue.fix?.[0]).toMatchObject({ op: 'set', id: 't1' });
    applyOpsCompact(page, issue.fix!);
    expect((await lint(page)).issues.find((i) => i.rule === 'Off-palette colour')).toBeUndefined();
  });

  it('flags overlapping text and the fix separates them', async () => {
    const page: CompactPage = { id: 'p', background: '#FFFFFF', elements: [text('a', 100, 100, 600, 60), text('b', 100, 130, 600, 60)] };
    const res = await lint(page);
    const issue = res.issues.find((i) => i.rule === 'Overlapping text')!;
    expect(issue).toBeTruthy();
    applyOpsCompact(page, issue.fix!);
    expect((await lint(page)).issues.find((i) => i.rule === 'Overlapping text')).toBeUndefined();
  });

  it('pulls strayed text back inside its card', async () => {
    const page: CompactPage = {
      id: 'p',
      background: '#3ECCFE',
      elements: [
        { id: 'card', type: 'figure', role: 'card', subType: 'rect', x: 76, y: 300, width: 928, height: 300, fill: '#FFFFFF' },
        text('h', 130, 120, 820, 80, { role: 'headline', container: 'card', fontFamily: 'XeroHeadline' }),
      ],
    };
    const res = await lint(page);
    const issue = res.issues.find((i) => i.rule === 'Text outside card')!;
    expect(issue).toBeTruthy();
    applyOpsCompact(page, issue.fix!);
    const h = page.elements.find((e) => e.id === 'h')!;
    expect(h.y).toBeGreaterThanOrEqual(300);
  });

  it('moves a card together with its contents', () => {
    const page: CompactPage = {
      id: 'p',
      background: '#3ECCFE',
      elements: [
        { id: 'card', type: 'figure', role: 'card', subType: 'rect', x: 76, y: 86, width: 928, height: 300, fill: '#FFFFFF' },
        text('h', 130, 140, 820, 80, { container: 'card' }),
      ],
    };
    const ops = expandContainerMoves(page, [{ op: 'set', id: 'card', props: { y: 286 } }]);
    expect(ops).toHaveLength(2);
    expect(ops[1]).toMatchObject({ op: 'set', id: 'h', props: { y: 340 } });
  });

  it('collects only error fixes for the validator', async () => {
    const page: CompactPage = { id: 'p', background: '#3ECCFE', elements: [text('t1', 100, 100, 500, 40, { fill: '#FF0000' }), text('t2', 100, 1060, 500, 40)] };
    const res = await lint(page);
    const { ops, fixed } = LintEngine.collectFixes(res, ['error']);
    expect(fixed).toContain('Off-palette colour');
    expect(ops.every((o) => o.op !== 'background')).toBe(true);
  });
});
