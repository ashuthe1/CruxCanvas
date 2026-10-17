import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { SectionTab } from 'polotno/side-panel';
import { getBrand, type Brand } from '../lib/api';
import { getBrandId, onBrandChange } from '../lib/brand';

/** Bridge: side panel -> copilot input */
export const PROMPT_EVENT = 'brandcopilot:prompt';
export function sendPrompt(text: string, send = false) {
  window.dispatchEvent(new CustomEvent(PROMPT_EVENT, { detail: { text, send } }));
}

const FORMATS = [
  { name: 'Instagram post', w: 1080, h: 1080 },
  { name: 'Instagram story', w: 1080, h: 1920 },
  { name: 'Feed 4:5', w: 1080, h: 1350 },
  { name: 'LinkedIn / Facebook', w: 1200, h: 628 },
  { name: 'X / Twitter', w: 1600, h: 900 },
  { name: 'Display 300×250', w: 600, h: 500 },
];

/** Parse "A) Name — description…" recipes from brand.json into cards */
function parseRecipes(recipes: string[] = []) {
  return recipes.map((r, i) => {
    const m = /^([A-Z])\)\s*(.+?)\s*(?:—|–|\s-\s)\s*(.*)$/s.exec(r.trim());
    const name = m ? m[2].trim() : `Layout ${i + 1}`;
    const desc = m ? m[3].trim() : r;
    const dark = /#(0|1)[0-9a-f]{5}/i.test(desc) && !/background #F|background #3E|background #FC|background #FD/i.test(desc);
    const card = /card/i.test(desc);
    const photo = /photo/i.test(desc);
    return { key: m ? m[1] : String(i + 1), name, desc, dark, card, photo, raw: r };
  });
}

function Schematic({ dark, card, photo }: { dark: boolean; card: boolean; photo: boolean }) {
  const bg = dark ? '#141414' : '#dbeafe';
  const fg = dark ? '#ffffff' : '#1e3a8a';
  return (
    <svg viewBox="0 0 80 80" width="100%" height="100%">
      <rect width="80" height="80" rx="6" fill={bg} />
      {card && <rect x="8" y="8" width="64" height="34" rx="4" fill="#fff" />}
      <rect x="14" y={card ? 14 : 12} width="40" height="5" rx="2" fill={card ? '#1e3a8a' : fg} />
      <rect x="14" y={card ? 22 : 20} width="28" height="5" rx="2" fill={card ? '#1e3a8a' : fg} />
      <rect x="14" y={card ? 31 : 29} width="18" height="6" rx="3" fill={dark ? '#f26524' : '#1e3a8a'} />
      {photo ? <rect x="0" y="46" width="80" height="34" fill={dark ? '#333' : '#93c5fd'} /> : <circle cx="58" cy="60" r="14" fill={dark ? '#6c63ff' : '#60a5fa'} />}
      <rect x="8" y="68" width="16" height="4" rx="2" fill={fg} />
    </svg>
  );
}

const TemplatesPanel = observer(({ store }: { store: any }) => {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [brandId, setBrandIdState] = useState(getBrandId());
  const [topic, setTopic] = useState('');
  useEffect(() => onBrandChange(setBrandIdState), []);
  useEffect(() => {
    getBrand(brandId).then(setBrand).catch(console.error);
  }, [brandId]);
  const recipes = parseRecipes(brand?.layout?.recipes);

  const use = (r: ReturnType<typeof parseRecipes>[number], n = 1) => {
    const subject = topic.trim() || 'our latest announcement';
    sendPrompt(`Create ${n > 1 ? `${n} variants` : 'a design'} about "${subject}" using the "${r.name}" layout recipe (recipe ${r.key}). Keep it on-brand and ready to post.`, false);
  };

  return (
    <div className="templates">
      <h4>Canvas size</h4>
      <div className="format-grid">
        {FORMATS.map((f) => (
          <button key={f.name} className={store.width === f.w && store.height === f.h ? 'on' : ''} onClick={() => store.setSize(f.w, f.h)} title={`${f.w}×${f.h}`}>
            <span className="fmt" style={{ aspectRatio: `${f.w}/${f.h}` }} />
            <small>{f.name}</small>
          </button>
        ))}
      </div>
      <h4>Layout recipes {brand ? `· ${brand.name}` : ''}</h4>
      <input className="bp6-input bp6-fill" placeholder="What is this design about? (e.g. Payroll launch)" value={topic} onChange={(e) => setTopic(e.target.value)} />
      <div className="recipe-list">
        {recipes.map((r) => (
          <div key={r.key} className="recipe">
            <div className="recipe-thumb">
              <Schematic dark={r.dark} card={r.card} photo={r.photo} />
            </div>
            <div className="recipe-body">
              <b>{r.name}</b>
              <span>{r.desc.slice(0, 110)}…</span>
              <div className="recipe-actions">
                <button className="btn-primary" onClick={() => use(r)}>
                  Use
                </button>
                <button className="btn-ghost" onClick={() => use(r, 3)}>
                  ×3
                </button>
              </div>
            </div>
          </div>
        ))}
        {!recipes.length && <div className="hint">No recipes in this brand yet. Add `layout.recipes` to brand.json.</div>}
      </div>
    </div>
  );
});

export const TemplatesSection = {
  name: 'templates',
  Tab: (props: any) => (
    <SectionTab name="Templates" {...props}>
      <span style={{ fontSize: 18 }}>▦</span>
    </SectionTab>
  ),
  Panel: TemplatesPanel,
};
