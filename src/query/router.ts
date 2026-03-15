import type { QueryResult } from "../types.js";
import type { Connector } from "../connectors/base.js";
import type { MySQLConnector } from "../connectors/mysql.js";
import { QueryEngine } from "./engine.js";
import { checkSqlSafety } from "./safety.js";

/**
 * Query router — decides whether to execute via MySQL directly or DuckDB.
 * MVP: all queries go through DuckDB (file sources) or MySQL (if single MySQL source).
 */
export class QueryRouter {
  private connectors: Map<string, Connector> = new Map();
  private engine: QueryEngine;

  constructor(engine: QueryEngine) {
    this.engine = engine;
  }

  registerConnector(sourceId: string, connector: Connector): void {
    this.connectors.set(sourceId, connector);
  }

  /**
   * Route and execute a query.
   * For MVP: if only MySQL sources, route to MySQL; otherwise use DuckDB.
   */
  async route(sql: string, maxRows?: number): Promise<QueryResult> {
    const check = checkSqlSafety(sql);
    if (!check.safe) {
      throw new Error(`SQL safety check failed: ${check.reason}`);
    }

    // MVP: always use the query engine (DuckDB)
    // MySQL direct routing will be added in Sprint 3
    return this.engine.execute(sql, maxRows);
  }

  getEngine(): QueryEngine {
    return this.engine;
  }
}
