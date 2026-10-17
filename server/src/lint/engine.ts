/**
 * Deterministic brand linter: runs a registry of rules and scores the page.
 * Rules are small, independent modules (see ./rules) — add one, register it, done.
 */
import type { LintContext, LintRule } from '../core/interfaces.js';
import type { Asset, BrandKit, CompactPage, Issue, LintResult, Op } from '../core/types.js';

const WEIGHTS = { error: 15, warn: 7, info: 3 };

export class LintEngine {
  constructor(private rules: LintRule[]) {}

  get ruleTitles() {
    return this.rules.map((r) => r.title);
  }

  run(brand: BrandKit, assets: Asset[], page: CompactPage, W: number, H: number): LintResult {
    const ctx: LintContext = { brand, assets, page, W, H, S: Math.min(W, H) };
    const issues: Issue[] = [];
    const passed: string[] = [];
    let n = 0;
    for (const rule of this.rules) {
      let found: Omit<Issue, 'id'>[] = [];
      try {
        found = rule.run(ctx);
      } catch (e) {
        console.warn(`[lint] rule ${rule.id} failed`, e);
      }
      if (found.length === 0) passed.push(rule.title);
      for (const i of found) issues.push({ id: `i${++n}`, ...i });
    }
    const score = Math.max(0, 100 - issues.reduce((s, i) => s + WEIGHTS[i.severity], 0));
    return { score, issues, passed };
  }

  /** Warn-level rules whose fixes are pure, safe position nudges — the validator applies them too */
  static SAFE_WARN_RULES = /^(Too close to edge|Safe zone|Text too small|Ragged alignment)/;

  /** Collect the auto-fix ops for issues of the given severities (deduped per element/prop) */
  static collectFixes(result: LintResult, severities: Issue['severity'][] = ['error'], includeSafeWarns = false): { ops: Op[]; fixed: string[] } {
    const ops: Op[] = [];
    const fixed: string[] = [];
    const seen = new Set<string>();
    for (const i of result.issues) {
      const wanted = severities.includes(i.severity) || (includeSafeWarns && i.severity === 'warn' && LintEngine.SAFE_WARN_RULES.test(i.rule));
      if (!i.fix || !wanted) continue;
      let used = false;
      for (const op of i.fix) {
        const key = op.op === 'set' ? `${op.id}:${Object.keys(op.props).sort().join(',')}` : op.op === 'delete' ? `del:${op.id}` : op.op === 'background' ? 'bg' : `add:${Math.random()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        ops.push(op);
        used = true;
      }
      if (used) fixed.push(i.rule);
    }
    return { ops, fixed };
  }
}
