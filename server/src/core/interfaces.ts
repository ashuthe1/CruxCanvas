/**
 * Extension points. New brands, models, lint rules or agent tools plug in here
 * without touching the rest of the codebase (open/closed, dependency inversion).
 */
import type OpenAI from 'openai';
import type { Asset, BrandKit, CompactPage, Issue, LintResult, Op, AgentEvent, CanvasState } from './types.js';

// ---------- Brands ----------
export interface IBrandRepository {
  list(): Promise<Pick<BrandKit, 'id' | 'name' | 'tagline'>[]>;
  get(id: string): Promise<BrandKit>;
  assets(id: string): Promise<Asset[]>;
  references(id: string): Promise<{ name: string; url: string }[]>;
  /** absolute path of a brand file (fonts, assets) */
  resolve(id: string, relPath: string): string;
}

// ---------- Models ----------
export type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;
export type ToolDef = OpenAI.Chat.ChatCompletionTool;
export type PlannerResponse = { message: OpenAI.Chat.ChatCompletionMessage; usage?: any };

export interface IPlannerModel {
  readonly name: string;
  chat(messages: ChatMessage[], tools: ToolDef[], opts?: { temperature?: number; maxTokens?: number }): Promise<PlannerResponse>;
}

export interface IVisionModel {
  readonly name: string;
  /** structured JSON answer about one or more images */
  describeJSON(system: string, userText: string, images: string[], maxTokens?: number): Promise<any>;
  /** free-text answer about an image */
  describe(system: string, userText: string, image: string, maxTokens?: number): Promise<string>;
}

export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536';
export interface IImageModel {
  readonly name: string;
  generate(prompt: string, opts: { size: ImageSize; transparent: boolean }): Promise<Buffer>;
}

export type Providers = { planner: IPlannerModel; vision: IVisionModel; images: IImageModel };

// ---------- Lint ----------
export type LintContext = {
  brand: BrandKit;
  page: CompactPage;
  W: number;
  H: number;
  S: number;
  assets: Asset[];
};
export interface LintRule {
  readonly id: string;
  readonly title: string;
  run(ctx: LintContext): Omit<Issue, 'id'>[];
}

// ---------- Agent tools ----------
export type ToolContext = {
  brand: BrandKit;
  assets: Asset[];
  providers: Providers;
  canvas: { W: number; H: number };
  pages: Map<string, CompactPage>;
  activePageId: string;
  input: { message: string; variants?: number };
  userIsEditing: boolean;
  emit: (e: AgentEvent) => void;
  lint: (page: CompactPage) => LintResult;
  /** mutable per-run scratch (e.g. fix-round counters) */
  state: Record<string, any>;
  setCanvas: (W: number, H: number) => void;
};
export interface AgentTool {
  readonly definition: ToolDef;
  execute(args: any, ctx: ToolContext): Promise<string>;
}

export type { CanvasState, Op, LintResult };
