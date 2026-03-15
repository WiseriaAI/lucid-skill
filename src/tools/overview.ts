import type { CatalogStore } from "../catalog/store.js";
import type { SemanticIndex } from "../semantic/index.js";
import { getConnectors } from "./connect.js";

/**
 * get_overview tool handler.
 * Returns a snapshot of all connected sources, tables, and semantic layer status.
 */
export function handleGetOverview(
  catalog: CatalogStore,
  semanticIndex: SemanticIndex,
): string {
  const sources = catalog.getSources();
  const activeConnectorIds = new Set(getConnectors().keys());

  const sourceList = sources.map((s) => {
    const tables = catalog.getTables(s.id);
    return {
      sourceId: s.id,
      type: s.type,
      connected: activeConnectorIds.has(s.id),
      tables: tables.map((t) => ({
        name: t.table_name,
        rowCount: t.row_count,
        columnCount: t.column_count,
        semanticStatus: t.semantic_status,
      })),
    };
  });

  const totalTables = sourceList.reduce((sum, s) => sum + s.tables.length, 0);
  const semanticIndexedCount = semanticIndex.count();

  return JSON.stringify(
    {
      sources: sourceList,
      summary: {
        totalSources: sourceList.length,
        activeSources: sourceList.filter((s) => s.connected).length,
        totalTables,
        semanticIndexedTables: semanticIndexedCount,
      },
    },
    null,
    2,
  );
}
