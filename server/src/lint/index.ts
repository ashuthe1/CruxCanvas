import { LintEngine } from './engine.js';
import { paletteRule } from './rules/palette.js';
import { fontsRule } from './rules/fonts.js';
import { logoRule } from './rules/logo.js';
import { contrastRule, textSizeRule, toneRule, textOverlapRule, ctaRule } from './rules/text.js';
import { edgesRule, safeZoneRule, cardContentsRule, imageOverTextRule, onCanvasRule } from './rules/layout.js';

/** Default rule registry. Order matters only for the "passed" list in reports. */
export const defaultLintEngine = new LintEngine([
  paletteRule,
  fontsRule,
  logoRule,
  contrastRule,
  textSizeRule,
  textOverlapRule,
  cardContentsRule,
  imageOverTextRule,
  onCanvasRule,
  edgesRule,
  safeZoneRule,
  toneRule,
  ctaRule,
]);

export { LintEngine } from './engine.js';
export * from './helpers.js';
