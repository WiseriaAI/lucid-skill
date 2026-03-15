import type { QueryFormat, QueryResult } from "../types.js";

/**
 * Format query results into different output formats.
 */
export function formatQueryResult(result: QueryResult, format: QueryFormat): string {
  switch (format) {
    case "json":
      return formatJson(result);
    case "markdown":
      return formatMarkdown(result);
    case "csv":
      return formatCsv(result);
    default:
      return formatMarkdown(result);
  }
}

function formatJson(result: QueryResult): string {
  return JSON.stringify(
    {
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      truncated: result.truncated,
    },
    null,
    2,
  );
}

function formatMarkdown(result: QueryResult): string {
  if (result.columns.length === 0) {
    return "_No results_";
  }

  const header = `| ${result.columns.join(" | ")} |`;
  const separator = `| ${result.columns.map(() => "---").join(" | ")} |`;
  const rows = result.rows.map(
    (row) =>
      `| ${result.columns.map((col) => formatValue(row[col])).join(" | ")} |`,
  );

  const lines = [header, separator, ...rows];

  if (result.truncated) {
    lines.push("", `_Showing ${result.rows.length} of ${result.rowCount} rows_`);
  }

  return lines.join("\n");
}

function formatCsv(result: QueryResult): string {
  const header = result.columns.map(escapeCsvValue).join(",");
  const rows = result.rows.map((row) =>
    result.columns.map((col) => escapeCsvValue(formatValue(row[col]))).join(","),
  );
  return [header, ...rows].join("\n");
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function escapeCsvValue(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
