import type { QueryEngine } from "../query/engine.js";
import { CatalogStore } from "./store.js";

interface ProfileRow {
  column_name: string;
  column_type: string;
  min: string | null;
  max: string | null;
  approx_unique: number;
  avg: string | null;
  std: string | null;
  q25: string | null;
  q50: string | null;
  q75: string | null;
  count: number;
  null_percentage: number;
}

/**
 * Data profiler using DuckDB SUMMARIZE.
 */
export async function profileTable(
  engine: QueryEngine,
  sourceId: string,
  tableName: string,
  store: CatalogStore,
): Promise<ProfileRow[]> {
  const rows = (await engine.executeRaw(
    `SUMMARIZE SELECT * FROM "${tableName}"`,
  )) as ProfileRow[];

  // Persist profiling results to catalog
  for (const row of rows) {
    store.updateProfilingData(sourceId, tableName, row.column_name, {
      distinctCount: row.approx_unique,
      nullRate: row.null_percentage / 100,
      minValue: row.min ?? undefined,
      maxValue: row.max ?? undefined,
    });
  }

  return rows;
}
