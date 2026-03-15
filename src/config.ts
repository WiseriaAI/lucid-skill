import type { LucidConfig } from "./types.js";

const DEFAULT_CONFIG: LucidConfig = {
  server: {
    name: "lucid-mcp",
    version: "0.1.0",
    transport: "stdio",
  },
  query: {
    maxRows: 1000,
    timeoutSeconds: 30,
    memoryLimit: "2GB",
  },
  semantic: {
    storePath: "./semantic_store",
  },
  catalog: {
    dbPath: "./lucid-catalog.db",
    autoProfile: true,
  },
  logging: {
    level: "info",
  },
};

let currentConfig: LucidConfig = { ...DEFAULT_CONFIG };

export function getConfig(): LucidConfig {
  return currentConfig;
}

export function updateConfig(partial: Partial<LucidConfig>): void {
  currentConfig = {
    ...currentConfig,
    ...partial,
    server: { ...currentConfig.server, ...partial.server },
    query: { ...currentConfig.query, ...partial.query },
    semantic: { ...currentConfig.semantic, ...partial.semantic },
    catalog: { ...currentConfig.catalog, ...partial.catalog },
    logging: { ...currentConfig.logging, ...partial.logging },
  };
}
