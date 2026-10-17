import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { SectionTab } from 'polotno/side-panel';
import { getAssets, getBrand, type Asset, type Brand } from '../lib/api';

const CATEGORY_LABELS: Record<string, string> = {
  logo: 'Logos',
  bloom: 'Blooms',
  background: 'Background templates',
  illustration: 'Illustrations',
  charm: 'Charms',
  'product-ui': 'Product UI',
  photo: 'Photos',
};

const BrandPanel = observer(({ store }: { store: any }) => {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    getAssets().then(setAssets).catch(console.error);
    getBrand().then(setBrand).catch(console.error);
  }, []);

  const groups = useMemo(() => {
    const g: Record<string, Asset[]> = {};
    for (const a of assets) {
      if (q && !(a.name + ' ' + a.tags.join(' ')).toLowerCase().includes(q.toLowerCase())) continue;
      (g[a.category] ||= []).push(a);
    }
    return g;
  }, [assets, q]);

  const addAsset = (a: Asset) => {
    const page = store.activePage;
    if (!page) return;
    const maxW = store.width * 0.5;
    const scale = Math.min(1, maxW / a.width);
    const w = a.width * scale;
    const h = a.height * scale;
    page.addElement({
      type: a.url.endsWith('.svg') ? 'svg' : 'image',
      src: a.url,
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
      <input
        className="bp6-input bp6-fill"
        placeholder="Search brand assets…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {brand && (
        <>
          <h4>Brand colours</h4>
          <div className="swatches">
            {brand.colors.map((c) => (
              <button key={c.hex} title={`${c.name} ${c.hex} (${c.role})`} style={{ background: c.hex }} onClick={() => setBg(c.hex)} />
            ))}
          </div>
        </>
      )}
      {Object.entries(groups).map(([cat, items]) => (
        <div key={cat}>
          <h4>
            {CATEGORY_LABELS[cat] || cat} <span style={{ color: '#9ca3af' }}>({items.length})</span>
          </h4>
          <div className="asset-grid">
            {items.map((a) => (
              <button key={a.id} title={a.name} onClick={() => addAsset(a)}>
                <img src={a.url} alt={a.name} loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      ))}
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
