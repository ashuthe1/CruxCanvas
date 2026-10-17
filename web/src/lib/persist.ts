/** Autosave the canvas per brand so a reload never loses work. */
import type { StoreType } from '../store';

const key = (brandId: string) => `brandcopilot.canvas.${brandId}`;

export function restoreCanvas(store: StoreType, brandId: string) {
  try {
    const raw = localStorage.getItem(key(brandId));
    if (!raw) return false;
    const json = JSON.parse(raw);
    if (!json?.pages?.length) return false;
    store.loadJSON(json);
    return true;
  } catch {
    return false;
  }
}

export function startAutosave(store: StoreType, brandId: () => string) {
  let t: any;
  return store.on('change', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      try {
        localStorage.setItem(key(brandId()), JSON.stringify(store.toJSON()));
      } catch {}
    }, 800);
  });
}

export function clearCanvas(store: StoreType, brandId: string) {
  try {
    localStorage.removeItem(key(brandId));
  } catch {}
  const w = store.width, h = store.height;
  store.loadJSON({ width: w, height: h, pages: [] });
  store.setSize(w, h);
  store.addPage();
}
