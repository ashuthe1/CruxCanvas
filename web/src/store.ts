import { createStore } from 'polotno/model/store';
import type { Brand } from './lib/api';

// Polotno demo key (development). Replace with your own key from polotno.com/cabinet.
export const store = createStore({ key: 'nFA5H9elEytDyPyvKL7T', showCredit: true });

store.setSize(1080, 1080);
store.addPage();

/** Register the active brand's self-hosted fonts so the canvas renders them. */
export function registerBrandFonts(brand: Brand) {
  for (const f of Object.values(brand.fontUrls || {})) {
    if (!store.fonts.some((x: any) => x.fontFamily === f.family)) store.addFont({ fontFamily: f.family, url: f.url });
  }
}

export type StoreType = typeof store;

// handy for debugging / demos in the console
(window as any).store = store;
