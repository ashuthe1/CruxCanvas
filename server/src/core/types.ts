/**
 * Shared domain types. Everything brand-specific flows through `BrandKit`,
 * so the rest of the system never knows which company it is working for.
 */

export type FontSpec = { family: string; file: string };

export type BrandColor = { name: string; hex: string; role: string };

export type BrandKit = {
  id: string;
  name: string;
  tagline?: string;
  colors: BrandColor[];
  fonts: { headline: FontSpec; body: FontSpec; bodyBold: FontSpec; notes?: string };
  logo: {
    /** variant name -> asset id */
    assets: Record<string, string>;
    /** which variant to use on which background class */
    colourways: Record<string, string>;
    aspectRatio?: number;
    minWidthRatio: number;
    preferredWidthRatio: number;
    clearSpace?: string;
    placement?: string;
    /** hex colour of each variant's artwork, used for contrast checks */
    variantColors?: Record<string, string>;
  };
  layout: {
    marginRatio: number;
    card: { fill: string; cornerRadiusRatio: number; paddingRatio: number; notes?: string };
    cta: { style: string; onLight: { bg: string; text: string }; onNavy?: { bg: string; text: string }; onDark?: { bg: string; text: string }; fontSizeRatio: number; notes?: string };
    headline: { fontSizeRatio: number; maxLines: number; maxChars: number; lineHeight: number };
    subhead: { fontSizeRatio: number; lineHeight: number };
    legal: { fontSizeRatio: number; color: string };
    productStrip?: { items: string[]; notes?: string };
    /** named layout recipes shown to the planner */
    recipes?: string[];
  };
  safeZones: Record<string, { top: number; bottom: number; left: number; right: number; note?: string }>;
  voice: { tone: string; headlinePatterns?: string[]; avoid?: string[] };
  imagery?: Record<string, string>;
  rules: string[];
  /** style prefixes for image generation, keyed by purpose */
  imageStyles?: Record<string, string>;
};

export type Asset = {
  id: string;
  category: string;
  name: string;
  file: string;
  url: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  dominant: string;
  colour?: string;
  description: string;
  tags: string[];
  /** crisp vector version of a bitmap logo, produced by `npm run vectorize` */
  vectorUrl?: string;
  vectorColours?: string[];
};

export type Op =
  | { op: 'set'; id: string; props: Record<string, any> }
  | { op: 'delete'; id: string }
  | { op: 'add'; element: any }
  | { op: 'raise'; id: string }
  | { op: 'background'; value: string };

export type Severity = 'error' | 'warn' | 'info';

export type Issue = {
  id: string;
  rule: string;
  severity: Severity;
  message: string;
  elementId?: string;
  fix?: Op[];
};

export type LintResult = { score: number; issues: Issue[]; passed: string[] };

/** Compact, LLM-friendly element (what the editor sends and what the linter reads) */
export type CompactEl = {
  id: string;
  type: string;
  name?: string;
  role?: string;
  container?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fill?: string;
  align?: string;
  src?: string;
  assetId?: string;
  subType?: string;
  cornerRadius?: number;
  custom?: any;
};

export type CompactPage = { id: string; background: string; elements: CompactEl[] };

export type CanvasState = {
  width: number;
  height: number;
  pages: CompactPage[];
  activePageId: string;
  selectedIds: string[];
};

/** Events streamed to the editor */
export type AgentEvent =
  | { type: 'status'; text: string }
  | { type: 'page'; page: any; replacePageId?: string }
  | { type: 'ops'; pageId: string; ops: Op[] }
  | { type: 'lint'; pageId: string; result: LintResult }
  | { type: 'size'; width: number; height: number }
  | { type: 'snapshot_request'; pageId: string; requestId: string }
  | { type: 'report'; pageId: string; report: DesignReport }
  /** clone sourcePageId as pageId; every element id becomes `${id}_${suffix}` (containers remapped too) */
  | { type: 'duplicate_page'; sourcePageId: string; pageId: string; suffix: string; custom: Record<string, any> }
  /** one controlled A/B variant finished (or was rejected because nothing changed) */
  | { type: 'variant'; pageId: string; sourcePageId: string; dimension: string; label: string; score: number; dropped: string[]; rejected?: string }
  | { type: 'message'; text: string }
  | { type: 'error'; text: string }
  | { type: 'done' };

/** Final validation / rationale card shown in the chat */
export type DesignReport = {
  name?: string;
  rationale?: string;
  score: number;
  checks: { rule: string; ok: boolean; detail?: string }[];
  autoFixed: string[];
};

/** Brand scan of a flat creative (uploaded image, reference, or a rendered page) */
export type ScanCheck = { rule: string; ok: boolean; severity: Severity; detail: string; fix?: string };
export type ScanElement = { type: string; text?: string; box: { x: number; y: number; w: number; h: number }; color?: string; background?: string; notes?: string };
export type ScanReport = {
  score: number;
  verdict: 'on-brand' | 'needs-work' | 'off-brand';
  width: number;
  height: number;
  aspect: string;
  summary: string;
  checks: ScanCheck[];
  extracted: {
    headline?: string;
    subhead?: string;
    cta?: string;
    legal?: string;
    logo: { present: boolean; variant?: string; widthRatio?: number; position?: string; notes?: string };
    fontsLookLikeBrand?: boolean;
    fontNotes?: string;
    layout: string;
    elements: ScanElement[];
  };
  palette: { detected: { hex: string; share: number; nearest: string; distance: number; onBrand: boolean }[]; coverageOnBrand: number };
  remakeBrief: string;
};

export type AgentInput = {
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  canvas: CanvasState;
  references?: string[];
  variants?: number;
};
