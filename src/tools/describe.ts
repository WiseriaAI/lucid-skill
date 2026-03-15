import { CatalogStore } from "../catalog/store.js";
import { QueryEngine } from "../query/engine.js";

/**
 * describe_table tool handler.
 * Accepts either { tableName } or { sourceId, tableName }
 */
export async function handleDescribeTable(
  params: Record<string, unknown>,
  catalog: CatalogStore,
  engine?: QueryEngine,
): Promise<string> {
  // Support both snake_case (MCP convention) and camelCase
  const tableName = (params.table_name ?? params.tableName) as string;
  let sourceId = (params.source_id ?? params.sourceId) as string | undefined;

  if (!tableName) {
    throw new Error("table_name is required");
  }

  // If no sourceId given, look up the table from catalog
  if (!sourceId) {
    const allTables = catalog.getTables();
    const match = allTables.find((t) => t.table_name === tableName);
    if (!match) {
      throw new Error(`Table "${tableName}" not found in any connected source`);
    }
    sourceId = match.source_id;
  }

  const columns = catalog.getColumns(sourceId, tableName);
  if (columns.length === 0) {
    throw new Error(`Table "${tableName}" not found in source "${sourceId}"`);
  }

  // Get sample data if engine available
  let sampleData: Record<string, unknown>[] = [];
  if (engine && (params.include_sample !== false)) {
    const sampleRows = Number(params.sample_rows ?? 5);
    try {
      const result = await engine.executeRaw(
        `SELECT * FROM "${tableName}" LIMIT ${sampleRows}`,
      );
      sampleData = result as Record<string, unknown>[];
    } catch {
      // Sample data is optional — ignore errors
    }
  }

  return JSON.stringify(
    {
      sourceId,
      tableName,
      rowCount: catalog.getTables(sourceId).find((t) => t.table_name === tableName)?.row_count,
      columns: columns.map((c) => ({
        name: c.column_name,
        dtype: c.dtype,
        nullable: c.nullable === 1,
        comment: c.comment,
        sampleValues: c.sample_values ? JSON.parse(c.sample_values) : [],
        distinctCount: c.distinct_count,
        nullRate: c.null_rate,
        minValue: c.min_value,
        maxValue: c.max_value,
      })),
      sampleData,
    },
    (_key, val) => typeof val === "bigint" ? String(val) : val,
    2,
  );
}
