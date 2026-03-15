import type { Connector } from "./base.js";
import type { ColumnInfo, TableInfo } from "../types.js";
import path from "node:path";
import fs from "node:fs";
import duckdb from "duckdb";

interface CsvConfig {
  path: string;
}

export class CsvConnector implements Connector {
  readonly sourceType = "csv";
  sourceId = "";
  private config: CsvConfig | null = null;
  private db: duckdb.Database | null = null;
  private tables: string[] = [];

  async connect(config: Record<string, unknown>): Promise<void> {
    this.config = config as unknown as CsvConfig;
    const csvPath = path.resolve(this.config.path);
    this.sourceId = `csv:${path.basename(csvPath)}`;

    this.db = new duckdb.Database(":memory:");

    const stat = fs.statSync(csvPath);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(csvPath).filter((f) => f.endsWith(".csv"));
      for (const file of files) {
        const tableName = path.basename(file, ".csv").replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, "_");
        const filePath = path.join(csvPath, file);
        await this.run(
          `CREATE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${filePath}')`,
        );
        this.tables.push(tableName);
      }
    } else {
      const tableName = path
        .basename(csvPath, ".csv")
        .replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, "_");
      await this.run(
        `CREATE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${csvPath}')`,
      );
      this.tables.push(tableName);
    }
  }

  async listTables(): Promise<string[]> {
    return this.tables;
  }

  async getTableInfo(table: string): Promise<TableInfo> {
    const columns = await this.getColumns(table);
    const countResult = await this.all(`SELECT COUNT(*) as cnt FROM "${table}"`);
    const rowCount = (countResult[0] as { cnt: number }).cnt;

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

  async registerToDuckDB(_targetDb: unknown): Promise<string[]> {
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
