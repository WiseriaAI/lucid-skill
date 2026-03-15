import type { QueryFormat } from "../types.js";
import { QueryEngine } from "../query/engine.js";
import { formatQueryResult } from "../query/formatter.js";

/**
 * query tool handler.
 */
export async function handleQuery(
  params: Record<string, unknown>,
  engine: QueryEngine,
): Promise<string> {
  const sql = params.sql as string;
  const maxRows = (params.maxRows as number) ?? 100;
  const format = (params.format as QueryFormat) ?? "markdown";

  if (!sql) {
    throw new Error("sql parameter is required");
  }

  const result = await engine.execute(sql, maxRows);
  return formatQueryResult(result, format);
}
