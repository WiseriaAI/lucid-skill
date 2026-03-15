import duckdb from "duckdb";
import type { QueryResult } from "../types.js";
import { getConfig } from "../config.js";
import { checkSqlSafety } from "./safety.js";

/**
 * DuckDB-based query engine for executing SQL queries.
 */
export class QueryEngine {
  private db: duckdb.Database;

  constructor(db?: duckdb.Database) {
    this.db = db ?? new duckdb.Database(":memory:");
  }

  getDatabase(): duckdb.Database {
    return this.db;
  }

  /**
   * Execute a read-only SQL query with safety checks.
   */
  async execute(sql: string, maxRows?: number): Promise<QueryResult> {
    const config = getConfig();
    const limit = maxRows ?? config.query.maxRows;

    // Safety check
    const check = checkSqlSafety(sql);
    if (!check.safe) {
      throw new Error(`SQL safety check failed: ${check.reason}`);
    }

    // Wrap with LIMIT if not already present
    const wrappedSql = this.wrapWithLimit(sql, limit);

    const rows = await this.all(wrappedSql);
    const typedRows = rows as Record<string, unknown>[];
    const columns = typedRows.length > 0 ? Object.keys(typedRows[0]) : [];

    // Check if results were truncated by querying without limit
    let totalCount = typedRows.length;
    let truncated = false;
    if (typedRows.length === limit) {
      try {
        const countResult = await this.all(
          `SELECT COUNT(*) as cnt FROM (${sql}) AS _count_subquery`,
        );
        totalCount = (countResult[0] as { cnt: number }).cnt;
        truncated = totalCount > limit;
      } catch {
        // If count query fails, just use what we have
        truncated = typedRows.length === limit;
      }
    }

    return {
      columns,
      rows: typedRows,
      rowCount: totalCount,
      truncated,
    };
  }

  /**
   * Execute raw SQL (for internal use like CREATE TABLE, SUMMARIZE, etc.)
   */
  async executeRaw(sql: string): Promise<unknown[]> {
    return this.all(sql);
  }

  /**
   * Run a statement that doesn't return rows.
   */
  async run(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, (err: Error | null) => (err ? reject(err) : resolve()));
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private all(sql: string): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, (err: Error | null, rows: unknown[]) =>
        err ? reject(err) : resolve(rows),
      );
    });
  }

  private wrapWithLimit(sql: string, limit: number): string {
    const upperSql = sql.trim().toUpperCase();
    // Simple check: if SQL already has a LIMIT clause, don't add another
    if (/\bLIMIT\s+\d+\s*$/i.test(sql.trim())) {
      return sql;
    }
    return `${sql.trim()} LIMIT ${limit}`;
  }
}
