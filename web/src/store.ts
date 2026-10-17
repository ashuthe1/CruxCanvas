import { createStore } from 'polotno/model/store';

// Polotno demo key: free for development/non-commercial use. Get your own at polotno.com/cabinet
export const store = createStore({ key: 'nFA5H9elEytDyPyvKL7T', showCredit: true });

store.setSize(1080, 1080);
store.addPage();

// Self-hosted brand fonts. Family names are shared with the server's design renderer.
export const BRAND_FONTS = [
  { fontFamily: 'XeroHeadline', url: '/fonts/headline.ttf' }, // Inter Tight 800
  { fontFamily: 'XeroBody', url: '/fonts/body.ttf' }, // Inter 500
  { fontFamily: 'XeroBodyBold', url: '/fonts/bodybold.ttf' }, // Inter 700
];
for (const f of BRAND_FONTS) store.addFont(f);

export type StoreType = typeof store;

// handy for debugging / demos in the console
(window as any).store = store;
