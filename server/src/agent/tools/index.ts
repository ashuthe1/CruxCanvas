import type { AgentTool } from '../../core/interfaces.js';
import { createDesignTool } from './createDesign.js';
import { updateDesignTool } from './updateDesign.js';
import { generateImageTool } from './generateImage.js';
import { searchAssetsTool, lintPageTool, setCanvasSizeTool, reviewRenderTool } from './misc.js';

/** Tool registry. Add a tool by implementing AgentTool and listing it here. */
export const defaultTools: AgentTool[] = [createDesignTool, updateDesignTool, generateImageTool, searchAssetsTool, lintPageTool, reviewRenderTool, setCanvasSizeTool];
