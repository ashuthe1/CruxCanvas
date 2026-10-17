/**
 * Real text measurement with the actual brand font files, so layouts never overlap.
 */
import path from 'path';
import opentype from 'opentype.js';
import { brand } from './brand.js';

const FONT_DIR = path.resolve(process.cwd(), '..', 'web', 'public', 'fonts');
const FILES: Record<string, string> = {
  [brand.fonts.headline]: 'headline.ttf',
  [brand.fonts.body]: 'body.ttf',
  [brand.fonts.bodyBold]: 'bodybold.ttf',
};
const fonts = new Map<string, opentype.Font>();
for (const [family, file] of Object.entries(FILES)) {
  try {
    fonts.set(family, opentype.loadSync(path.join(FONT_DIR, file)));
  } catch (e) {
    console.warn('font load failed', family, e);
  }
}

export function textWidth(text: string, family: string, fontSize: number, letterSpacing = 0) {
  const f = fonts.get(family);
  if (!f) return text.length * fontSize * 0.52;
  return f.getAdvanceWidth(text, fontSize) + letterSpacing * fontSize * Math.max(0, text.length - 1);
}

/** Greedy word wrap. Returns the lines. */
export function wrap(text: string, family: string, fontSize: number, maxWidth: number, letterSpacing = 0): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const trial = line ? line + ' ' + w : w;
      if (textWidth(trial, family, fontSize, letterSpacing) <= maxWidth || !line) line = trial;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

export function measure(text: string, family: string, fontSize: number, maxWidth: number, lineHeight: number, letterSpacing = 0) {
  const lines = wrap(text, family, fontSize, maxWidth, letterSpacing);
  return { lines: lines.length, height: Math.ceil(lines.length * fontSize * lineHeight), widest: Math.max(...lines.map((l) => textWidth(l, family, fontSize, letterSpacing))) };
}

/** Shrink font size until the text fits in maxLines (and never below minSize). */
export function fit(text: string, family: string, fontSize: number, maxWidth: number, lineHeight: number, maxLines: number, minSize: number, letterSpacing = 0) {
  let size = fontSize;
  while (size > minSize) {
    const m = measure(text, family, size, maxWidth, lineHeight, letterSpacing);
    if (m.lines <= maxLines && m.widest <= maxWidth) return { size, ...m };
    size = Math.round(size * 0.94);
  }
  return { size: minSize, ...measure(text, family, minSize, maxWidth, lineHeight, letterSpacing) };
}
