import type { TableInfo } from "../types.js";

/**
 * Base interface for all data source connectors.
 */
export interface Connector {
  readonly sourceType: string;
  readonly sourceId: string;

  connect(config: Record<string, unknown>): Promise<void>;
  listTables(): Promise<string[]>;
  getTableInfo(table: string): Promise<TableInfo>;
  getSampleData(table: string, limit?: number): Promise<Record<string, unknown>[]>;
  registerToDuckDB(db: unknown): Promise<string[]>;
  close(): Promise<void>;
}
