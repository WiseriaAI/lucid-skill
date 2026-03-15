import type { Connector } from "../connectors/base.js";
import type { TableInfo } from "../types.js";
import { CatalogStore } from "./store.js";

/**
 * Schema collector — gathers table/column metadata from connectors
 * and persists to the catalog store.
 */
export async function collectSchema(
  connector: Connector,
  store: CatalogStore,
): Promise<TableInfo[]> {
  const tables = await connector.listTables();
  const result: TableInfo[] = [];

  for (const tableName of tables) {
    const info = await connector.getTableInfo(tableName);
    result.push(info);

    // Persist to catalog
    store.upsertTableMeta(
      connector.sourceId,
      tableName,
      info.rowCount,
      info.columns.length,
    );

    for (const col of info.columns) {
      store.upsertColumnMeta(
        connector.sourceId,
        tableName,
        col.name,
        col.dtype,
        col.nullable,
        col.comment,
        col.sampleValues,
      );
    }
  }

  return result;
}
