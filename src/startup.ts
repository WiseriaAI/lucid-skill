/**
 * Auto-restore: on server startup, re-connect all previously connected sources
 * and rebuild the semantic index from persisted YAML files.
 */

import type { CatalogStore } from "./catalog/store.js";
import type { QueryEngine } from "./query/engine.js";
import type { QueryRouter } from "./query/router.js";
import type { SemanticIndex } from "./semantic/index.js";
import { ExcelConnector } from "./connectors/excel.js";
import { CsvConnector } from "./connectors/csv.js";
import { MySQLConnector } from "./connectors/mysql.js";
import { collectSchema } from "./catalog/schema.js";
import { listAllSemantics } from "./semantic/layer.js";
import { getConnectors } from "./tools/connect.js";

/**
 * Restore all previously connected sources from the catalog.
 * Called once at server startup.
 */
export async function autoRestoreConnections(
  catalog: CatalogStore,
  engine: QueryEngine,
  router: QueryRouter,
  semanticIndex: SemanticIndex,
): Promise<{ restored: number; failed: string[] }> {
  const sources = catalog.getSources();
  let restored = 0;
  const failed: string[] = [];

  for (const source of sources) {
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(source.config);
    } catch {
      failed.push(`${source.id}: invalid config JSON`);
      continue;
    }

    try {
      let connector;
      switch (source.type) {
        case "excel":
          connector = new ExcelConnector();
          break;
        case "csv":
          connector = new CsvConnector();
          break;
        case "mysql":
          connector = new MySQLConnector();
          break;
        default:
          failed.push(`${source.id}: unknown type ${source.type}`);
          continue;
      }

      await connector.connect(config);

      // Register in global connectors map
      getConnectors().set(source.id, connector);

      // Register tables into DuckDB engine
      await connector.registerToDuckDB(engine.getDatabase());

      // Register in query router
      const tables = await connector.listTables();
      router.registerConnector(source.id, connector, tables);

      restored++;
    } catch (err) {
      // Connection failures are non-fatal (file moved, DB down, etc.)
      failed.push(`${source.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Rebuild semantic index from persisted YAML files
  rebuildSemanticIndex(semanticIndex);

  return { restored, failed };
}

/**
 * Rebuild BM25 semantic index from all YAML files in semantic_store/.
 * Called after connections are restored.
 */
function rebuildSemanticIndex(semanticIndex: SemanticIndex): void {
  const allSemantics = listAllSemantics();
  for (const semantic of allSemantics) {
    try {
      semanticIndex.indexTable(semantic.source, semantic.table, semantic);
    } catch {
      // Non-fatal
    }
  }
}
