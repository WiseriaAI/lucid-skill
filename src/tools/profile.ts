import { CatalogStore } from "../catalog/store.js";
import { QueryEngine } from "../query/engine.js";

/**
 * profile_data tool handler.
 * Runs DuckDB SUMMARIZE on a table and stores profiling results.
 */
export async function handleProfileData(
  params: Record<string, unknown>,
  catalog: CatalogStore,
  engine: QueryEngine,
): Promise<string> {
  // Support both snake_case and camelCase
  const tableName = (params.table_name ?? params.tableName) as string;
  let sourceId = (params.source_id ?? params.sourceId) as string | undefined;

  if (!tableName) {
    throw new Error("table_name is required");
  }

  // If no sourceId given, look up from catalog
  if (!sourceId) {
    const allTables = catalog.getTables();
    const match = allTables.find((t) => t.table_name === tableName);
    if (match) sourceId = match.source_id;
  }

  let rows: Array<Record<string, unknown>>;
  try {
    rows = (await engine.executeRaw(
      `SUMMARIZE SELECT * FROM "${tableName}"`,
    )) as Array<Record<string, unknown>>;
  } catch (err) {
    throw new Error(
      `Failed to profile table "${tableName}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Store profiling results if sourceId is known
  if (sourceId) {
    for (const row of rows) {
      const colName = String(row.column_name ?? row.column ?? "");
      if (colName) {
        catalog.updateProfilingData(sourceId, tableName, colName, {
          distinctCount: row.approx_unique != null ? Number(row.approx_unique) : undefined,
          nullRate: row.null_percentage != null ? Number(row.null_percentage) / 100 : undefined,
          minValue: row.min != null ? String(row.min) : undefined,
          maxValue: row.max != null ? String(row.max) : undefined,
        });
      }
    }
  }

  return JSON.stringify(
    {
      sourceId: sourceId ?? "unknown",
      tableName,
      profiledColumns: rows.length,
      summary: rows.map((r) => ({
        column: r.column_name ?? r.column,
        type: r.column_type ?? r.type,
        min: r.min,
        max: r.max,
        approxUnique: r.approx_unique,
        nullPercentage: r.null_percentage,
        avg: r.avg,
        std: r.std,
        q25: r.q25,
        q50: r.q50,
        q75: r.q75,
      })),
    },
    (_key, val) => typeof val === "bigint" ? String(val) : val,
    2,
  );
}
