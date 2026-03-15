import type { Connector } from "./base.js";
import type { ColumnInfo, TableInfo } from "../types.js";
import path from "node:path";
import duckdb from "duckdb";

interface ExcelConfig {
  path: string;
  sheets?: string[];
}

export class ExcelConnector implements Connector {
  readonly sourceType = "excel";
  sourceId = "";
  private config: ExcelConfig | null = null;
  private db: duckdb.Database | null = null;
  private tables: string[] = [];
  private filePath = "";
  private tableSheets = new Map<string, string | null>();

  async connect(config: Record<string, unknown>): Promise<void> {
    this.config = config as unknown as ExcelConfig;
    this.filePath = path.resolve(this.config.path);
    const fileName = path.basename(this.filePath, path.extname(this.filePath));
    this.sourceId = `excel:${fileName}`;

    this.db = new duckdb.Database(":memory:");
    await this.run("INSTALL spatial; LOAD spatial;");

    const sheets = this.config.sheets;
    if (sheets && sheets.length > 0) {
      for (const sheet of sheets) {
        const tableName = `${fileName}_${sheet}`.replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, "_");
        await this.run(
          `CREATE TABLE "${tableName}" AS SELECT * FROM read_xlsx('${this.filePath}', sheet='${sheet}')`,
        );
        this.tables.push(tableName);
        this.tableSheets.set(tableName, sheet);
      }
    } else {
      // Load all sheets - try default first
      const tableName = fileName.replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, "_");
      await this.run(
        `CREATE TABLE "${tableName}" AS SELECT * FROM read_xlsx('${this.filePath}')`,
      );
      this.tables.push(tableName);
      this.tableSheets.set(tableName, null);
    }
  }

  async listTables(): Promise<string[]> {
    return this.tables;
  }

  async getTableInfo(table: string): Promise<TableInfo> {
    const columns = await this.getColumns(table);
    const countResult = await this.all(`SELECT COUNT(*) as cnt FROM "${table}"`);
    const rowCount = Number((countResult[0] as { cnt: number | bigint }).cnt);

    return {
      name: table,
      source: this.sourceId,
      rowCount,
      columns,
    };
  }

  async getSampleData(table: string, limit = 5): Promise<Record<string, unknown>[]> {
    return this.all(`SELECT * FROM "${table}" LIMIT ${limit}`) as Promise<
      Record<string, unknown>[]
    >;
  }

  async registerToDuckDB(targetDb: unknown): Promise<string[]> {
    const db = targetDb as duckdb.Database;
    const runOnTarget = (sql: string) =>
      new Promise<void>((resolve, reject) => {
        db.run(sql, (err: Error | null) => (err ? reject(err) : resolve()));
      });

    await runOnTarget("INSTALL spatial; LOAD spatial;");

    for (const [tableName, sheet] of this.tableSheets) {
      const sheetClause = sheet ? `, sheet='${sheet}'` : "";
      await runOnTarget(
        `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_xlsx('${this.filePath}'${sheetClause})`,
      );
    }
    return this.tables;
  }

  async close(): Promise<void> {
    if (this.db) {
      await new Promise<void>((resolve, reject) => {
        this.db!.close((err) => (err ? reject(err) : resolve()));
      });
      this.db = null;
    }
  }

  getDatabase(): duckdb.Database | null {
    return this.db;
  }

  private run(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db!.run(sql, (err: Error | null) => (err ? reject(err) : resolve()));
    });
  }

  private all(sql: string): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      this.db!.all(sql, (err: Error | null, rows: unknown[]) =>
        err ? reject(err) : resolve(rows),
      );
    });
  }

  private async getColumns(table: string): Promise<ColumnInfo[]> {
    const pragmaRows = (await this.all(`PRAGMA table_info('${table}')`)) as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;

    const columns: ColumnInfo[] = [];
    for (const row of pragmaRows) {
      const sampleResult = (await this.all(
        `SELECT DISTINCT "${row.name}" FROM "${table}" WHERE "${row.name}" IS NOT NULL LIMIT 5`,
      )) as Record<string, unknown>[];
      columns.push({
        name: row.name,
        dtype: row.type,
        nullable: row.notnull === 0,
        comment: null,
        sampleValues: sampleResult.map((r) => r[row.name]),
      });
    }
    return columns;
  }
}
