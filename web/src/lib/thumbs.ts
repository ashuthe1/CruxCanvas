/**
 * Project card thumbnails. Captured at a fixed long edge (not a fixed fraction of the page) so a
 * 1080px post and a 1200px banner both come out sharp on a retina dashboard card, and existing
 * projects with old low-res thumbs are re-rendered once in an offscreen store.
 */
import { createStore } from 'polotno/model/store';
import type { StoreType } from '../store';
import { getBrand } from './api';
import { getProject, updateProject, type ProjectSummary } from './projects';

/** Long edge of a stored thumbnail, in pixels: enough for a ~400px card at 2x DPR. */
export const THUMB_EDGE = 800;
/** Anything narrower than this was captured by the old 0.18 ratio and gets re-rendered. */
const STALE_BELOW = 400;

/** Render one page as a card thumbnail. quickMode only ever raises the element pixel ratio, so the canvas stays crisp. */
export async function pageThumbnail(store: StoreType, pageId: string) {
  const page: any = store.pages.find((p: any) => p.id === pageId);
  const w = Number(page?.computedWidth) || store.width;
  const h = Number(page?.computedHeight) || store.height;
  const pixelRatio = Math.min(1, THUMB_EDGE / Math.max(w, h));
  return store.toDataURL({ pageId, pixelRatio, mimeType: 'image/jpeg', quality: 0.85, quickMode: true } as any);
}

function imageWidth(src: string) {
  return new Promise<number>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth);
    img.onerror = () => resolve(0);
    img.src = src;
  });
}

const checked = new Set<string>();
let offscreen: StoreType | null = null;

/** Store used for background re-renders. Polotno can only export pages that have a mounted <Workspace />, so the dashboard mounts one off-screen for this store. */
export function getOffscreenStore(): StoreType {
  if (!offscreen) offscreen = createStore({ key: 'nFA5H9elEytDyPyvKL7T', showCredit: false }) as StoreType;
  return offscreen;
}

/**
 * One-time upgrade: re-render stale (or missing) thumbnails for the listed projects in an offscreen
 * store and persist them. Runs sequentially; `onUpdate` lets the dashboard swap each card in place.
 */
export async function upgradeStaleThumbs(projects: ProjectSummary[], onUpdate: (id: string, thumb: string) => void) {
  for (const p of projects) {
    if (checked.has(p.id) || !p.pageCount) continue;
    checked.add(p.id);
    try {
      if (p.thumb && (await imageWidth(p.thumb)) >= STALE_BELOW) continue;
      const full = await getProject(p.id);
      const pages = full.canvas?.pages || [];
      const first = pages.find((pg: any) => pg.children?.length);
      if (!first) continue;
      const s = getOffscreenStore();
      try {
        const brand = await getBrand(p.brandId);
        for (const f of Object.values(brand.fontUrls || {})) {
          if (!s.fonts.some((x: any) => x.fontFamily === f.family)) s.addFont({ fontFamily: f.family, url: f.url });
        }
      } catch {}
      s.loadJSON(full.canvas);
      await s.waitLoading?.();
      await new Promise((r) => setTimeout(r, 150));
      const thumb = await pageThumbnail(s, first.id);
      await updateProject(p.id, { thumb });
      onUpdate(p.id, thumb);
    } catch (e) {
      console.warn('thumbnail upgrade failed', p.id, e);
    }
  }
}
