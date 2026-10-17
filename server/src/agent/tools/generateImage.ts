import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import type { AgentTool } from '../../core/interfaces.js';

export const GENERATED_DIR = path.join(process.cwd(), 'generated');
fs.mkdirSync(GENERATED_DIR, { recursive: true });

export const generateImageTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'generate_image',
      description: 'Generate a raster image in the brand style. Use for bespoke illustrations (transparent bg), photos of people/scenes, or abstract backgrounds. Returns {src,width,height} to use in an image element.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Subject description only; brand style is added automatically.' },
          purpose: { type: 'string', enum: ['illustration', 'photo', 'background', 'charm'] },
          size: { type: 'string', enum: ['1024x1024', '1536x1024', '1024x1536'] },
        },
        required: ['prompt', 'purpose'],
      },
    },
  },
  async execute(args, ctx) {
    const purpose = args.purpose || 'illustration';
    ctx.emit({ type: 'status', text: `Generating ${purpose}: ${String(args.prompt).slice(0, 60)}…` });
    const style = ctx.brand.imageStyles?.[purpose] || ctx.brand.imageStyles?.illustration || `In the ${ctx.brand.name} brand style. No text or logos.`;
    const transparent = purpose === 'illustration' || purpose === 'charm';
    const buf = await ctx.providers.images.generate(`${style}\n\nSubject: ${args.prompt}`, { size: args.size || '1024x1024', transparent });
    const id = randomUUID().slice(0, 10);
    const file = path.join(GENERATED_DIR, `${id}.png`);
    await sharp(buf).png().toFile(file);
    const meta = await sharp(file).metadata();
    return JSON.stringify({ src: `/generated/${id}.png`, width: meta.width || 1024, height: meta.height || 1024, note: 'Use as {"kind":"image","src":...}. Set width in canvas px; height follows aspect.' });
  },
};
