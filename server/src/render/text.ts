/** Real text measurement with the brand's actual font files, so layouts never overlap. */
import opentype from 'opentype.js';
import type { BrandKit } from '../core/types.js';

const cache = new Map<string, opentype.Font | null>();

export class TextMeasurer {
  constructor(private brand: BrandKit, private resolve: (rel: string) => string) {}

  private font(family: string) {
    const key = `${this.brand.id}:${family}`;
    if (cache.has(key)) return cache.get(key)!;
    const spec = [this.brand.fonts.headline, this.brand.fonts.body, this.brand.fonts.bodyBold].find((f) => f.family === family);
    let f: opentype.Font | null = null;
    if (spec) {
      try {
        f = opentype.loadSync(this.resolve(spec.file));
      } catch (e) {
        console.warn('[text] font load failed', family, (e as Error).message);
      }
    }
    cache.set(key, f);
    return f;
  }

  width(text: string, family: string, fontSize: number, letterSpacing = 0) {
    const f = this.font(family);
    if (!f) return text.length * fontSize * 0.52;
    return f.getAdvanceWidth(text, fontSize) + letterSpacing * fontSize * Math.max(0, text.length - 1);
  }

  wrap(text: string, family: string, fontSize: number, maxWidth: number, letterSpacing = 0): string[] {
    const out: string[] = [];
    for (const para of text.split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      let line = '';
      for (const w of words) {
        const trial = line ? line + ' ' + w : w;
        if (this.width(trial, family, fontSize, letterSpacing) <= maxWidth || !line) line = trial;
        else {
          out.push(line);
          line = w;
        }
      }
      out.push(line);
    }
    return out;
  }

  measure(text: string, family: string, fontSize: number, maxWidth: number, lineHeight: number, letterSpacing = 0) {
    const lines = this.wrap(text, family, fontSize, maxWidth, letterSpacing);
    return { lines: lines.length, height: Math.ceil(lines.length * fontSize * lineHeight), widest: Math.max(...lines.map((l) => this.width(l, family, fontSize, letterSpacing))) };
  }

  /** Shrink font size until the text fits in maxLines (never below minSize). */
  fit(text: string, family: string, fontSize: number, maxWidth: number, lineHeight: number, maxLines: number, minSize: number, letterSpacing = 0) {
    let size = fontSize;
    while (size > minSize) {
      const m = this.measure(text, family, size, maxWidth, lineHeight, letterSpacing);
      if (m.lines <= maxLines && m.widest <= maxWidth) return { size, ...m };
      size = Math.round(size * 0.94);
    }
    return { size: minSize, ...this.measure(text, family, minSize, maxWidth, lineHeight, letterSpacing) };
  }
}
