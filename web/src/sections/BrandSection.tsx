import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { SectionTab } from 'polotno/side-panel';
import { getAssets, getBrand, type Asset, type Brand } from '../lib/api';
import { getBrandId, onBrandChange } from '../lib/brand';

const CATEGORY_LABELS: Record<string, string> = {
  logo: 'Logos',
  bloom: 'Shapes & blooms',
  background: 'Background templates',
  illustration: 'Illustrations',
  charm: 'Charms & icons',
  'product-ui': 'Product UI',
  photo: 'Photos',
};
const ORDER = ['logo', 'illustration', 'photo', 'product-ui', 'charm', 'bloom', 'background'];

const BrandPanel = observer(({ store }: { store: any }) => {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [q, setQ] = useState('');
  const [brandId, setBrandIdState] = useState(getBrandId());

  useEffect(() => onBrandChange(setBrandIdState), []);
  useEffect(() => {
    getAssets(brandId).then(setAssets).catch(console.error);
    getBrand(brandId).then(setBrand).catch(console.error);
  }, [brandId]);

  const groups = useMemo(() => {
    const g: Record<string, Asset[]> = {};
    for (const a of assets) {
      if (q && !(a.name + ' ' + a.tags.join(' ') + ' ' + (a.colour || '')).toLowerCase().includes(q.toLowerCase())) continue;
      (g[a.category] ||= []).push(a);
    }
    return Object.entries(g).sort(([a], [b]) => (ORDER.indexOf(a) + 99) % 99 - ((ORDER.indexOf(b) + 99) % 99));
  }, [assets, q]);

  const addAsset = (a: Asset) => {
    const page = store.activePage;
    if (!page) return;
    const maxW = store.width * (a.category === 'logo' ? 0.22 : 0.5);
    const scale = Math.min(1, maxW / a.width);
    const w = a.width * scale, h = a.height * scale;
    const src = a.vectorUrl || a.url; // vectorised logos stay crisp at any size
    page.addElement({
      type: src.endsWith('.svg') ? 'svg' : 'image',
      src,
      x: (store.width - w) / 2,
      y: (store.height - h) / 2,
      width: w,
      height: h,
      name: a.name,
      custom: { assetId: a.id, role: a.category },
    });
  };

  const setBg = (hex: string) => store.activePage?.set({ background: hex });

  return (
    <div className="brand-assets">
      {brand && (
        <div className="brand-head">
          <b>{brand.name}</b>
          {brand.tagline && <span>{brand.tagline}</span>}
        </div>
      )}
      <input className="bp6-input bp6-fill" placeholder="Search brand assets…" value={q} onChange={(e) => setQ(e.target.value)} />
      {brand && (
        <>
          <h4>Brand colours</h4>
          <div className="swatches">
            {brand.colors.map((c) => (
              <button key={c.hex} title={`${c.name} ${c.hex} — ${c.role}\nClick: set page background`} style={{ background: c.hex }} onClick={() => setBg(c.hex)} />
            ))}
          </div>
        </>
      )}
      {groups.map(([cat, items]) => (
        <div key={cat}>
          <h4>
            {CATEGORY_LABELS[cat] || cat} <span style={{ color: '#9ca3af' }}>({items.length})</span>
          </h4>
          <div className="asset-grid">
            {items.map((a) => (
              <button key={a.id} title={`${a.name}\n${a.tags.join(', ')}`} onClick={() => addAsset(a)}>
                <img src={a.url} alt={a.name} loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      ))}
      {!assets.length && <div className="hint">No assets yet. Run the onboarding script for this brand.</div>}
    </div>
  );
});

export const BrandSection = {
  name: 'brand',
  Tab: (props: any) => (
    <SectionTab name="Brand kit" {...props}>
      <span style={{ fontSize: 18 }}>◆</span>
    </SectionTab>
  ),
  Panel: BrandPanel,
};
