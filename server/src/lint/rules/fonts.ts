import type { LintRule } from '../../core/interfaces.js';
import { label, role } from '../helpers.js';

export const fontsRule: LintRule = {
  id: 'fonts',
  title: 'Brand typefaces',
  run({ brand, page }) {
    const families = [brand.fonts.headline.family, brand.fonts.body.family, brand.fonts.bodyBold.family];
    const out = [];
    for (const el of page.elements) {
      if (el.type !== 'text' || !el.fontFamily || families.includes(el.fontFamily)) continue;
      const r = role(el);
      const target = r === 'headline' || r === 'stat' ? brand.fonts.headline.family : r === 'cta' || r === 'label' ? brand.fonts.bodyBold.family : brand.fonts.body.family;
      out.push({ rule: 'Non-brand font', severity: 'error' as const, elementId: el.id, message: `${label(el)} uses ${el.fontFamily}. Use ${target}.`, fix: [{ op: 'set' as const, id: el.id, props: { fontFamily: target } }] });
    }
    return out;
  },
};
