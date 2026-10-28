// Embedding the server: build the tools once, then serve them over any MCP transport.
export { API } from './generated/api.js';
export type { Api, Operation, Param, Type } from './generated/model.js';
export { annotations, DEFAULT_TOOLSETS, TOOLSETS, toolName, toolsetOf, type Annotations, type Toolset } from './catalog.js';
export { buildTools, toolsetNames, ToolInputError, type Tool, type ToolOptions } from './tools.js';
export { createServer, errorInfo, INSTRUCTIONS, makeClient, type ClientConfig, type ServerContext } from './server.js';
export { startHttp, type HttpOptions, type RunningHttp } from './http.js';
export { DOCS_DIR, loadDocs, type DocPage } from './docs.js';
export { VERSION } from './version.js';
