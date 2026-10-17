import type { LintRule } from '../../core/interfaces.js';
import { nearestPalette } from '../../core/color.js';
import { IMAGE_ROLES, label, role } from '../helpers.js';

const TOLERANCE = 40;

export const paletteRule: LintRule = {
  id: 'palette',
  title: 'Brand palette',
  run({ brand, page }) {
    const out = [];
    const palette = brand.colors.map((c) => ({ name: c.name, hex: c.hex.toUpperCase() }));
    if (page.background?.startsWith('#')) {
      const near = nearestPalette(page.background, palette);
      if (near && near.distance > TOLERANCE)
        out.push({ rule: 'Off-palette background', severity: 'error' as const, message: `Page background ${page.background} is not a brand colour. Nearest: ${near.name} ${near.hex}.`, fix: [{ op: 'background' as const, value: near.hex }] });
    }
    for (const el of page.elements) {
      if ((el.type === 'text' || el.type === 'figure') && el.fill && !IMAGE_ROLES.has(role(el))) {
        const near = nearestPalette(el.fill, palette);
        if (near && near.distance > TOLERANCE)
          out.push({ rule: 'Off-palette colour', severity: 'error' as const, elementId: el.id, message: `${label(el)} uses ${el.fill}. Nearest brand colour: ${near.name} ${near.hex}.`, fix: [{ op: 'set' as const, id: el.id, props: { fill: near.hex } }] });
      }
    }
    return out;
  },
};
