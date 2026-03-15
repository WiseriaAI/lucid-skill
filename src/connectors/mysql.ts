import type { Connector } from "./base.js";
import type { ColumnInfo, ForeignKey, TableInfo } from "../types.js";
import mysql from "mysql2/promise";

interface MySQLConfig {
  host: string;
  port?: number;
  database: string;
  username: string;
  password: string;
}

export class MySQLConnector implements Connector {
  readonly sourceType = "mysql";
  sourceId = "";
  private config: MySQLConfig | null = null;
  private connection: mysql.Connection | null = null;

  async connect(config: Record<string, unknown>): Promise<void> {
    this.config = config as unknown as MySQLConfig;
    this.sourceId = `mysql:${this.config.database}`;

    this.connection = await mysql.createConnection({
      host: this.config.host,
      port: this.config.port ?? 3306,
      database: this.config.database,
      user: this.config.username,
      password: this.config.password,
    });
  }

  async listTables(): Promise<string[]> {
    const [rows] = await this.connection!.query("SHOW TABLES");
    return (rows as Record<string, string>[]).map((row) => Object.values(row)[0]);
  }

  async getTableInfo(table: string): Promise<TableInfo> {
    const columns = await this.getColumns(table);
    const foreignKeys = await this.getForeignKeys(table);

    const [countRows] = await this.connection!.query(
      `SELECT COUNT(*) as cnt FROM \`${table}\``,
    );
    const rowCount = (countRows as Array<{ cnt: number }>)[0].cnt;

    return {
      name: table,
      source: this.sourceId,
      rowCount,
      columns,
      foreignKeys: foreignKeys.length > 0 ? foreignKeys : undefined,
    };
  }

  async getSampleData(table: string, limit = 5): Promise<Record<string, unknown>[]> {
    const [rows] = await this.connection!.query(`SELECT * FROM \`${table}\` LIMIT ?`, [limit]);
    return rows as Record<string, unknown>[];
  }

  async registerToDuckDB(_db: unknown): Promise<string[]> {
    // MySQL data is queried directly via mysql2.
    // For cross-source JOIN, data would be loaded into DuckDB (future).
    return this.listTables();
  }

  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
      this.connection = null;
    }
  }

  getConnection(): mysql.Connection | null {
    return this.connection;
  }

  async executeQuery(sql: string): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
    const [rows, fields] = await this.connection!.query(sql);
    const columns = (fields as mysql.FieldPacket[]).map((f) => f.name);
    return { columns, rows: rows as Record<string, unknown>[] };
  }

  private async getColumns(table: string): Promise<ColumnInfo[]> {
    const [rows] = await this.connection!.query(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_COMMENT
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [this.config!.database, table],
    );

    const columnRows = rows as Array<{
      COLUMN_NAME: string;
      DATA_TYPE: string;
      IS_NULLABLE: string;
      COLUMN_COMMENT: string;
    }>;

    const columns: ColumnInfo[] = [];
    for (const col of columnRows) {
      const [sampleRows] = await this.connection!.query(
        `SELECT DISTINCT \`${col.COLUMN_NAME}\` FROM \`${table}\` WHERE \`${col.COLUMN_NAME}\` IS NOT NULL LIMIT 5`,
      );
      columns.push({
        name: col.COLUMN_NAME,
        dtype: col.DATA_TYPE,
        nullable: col.IS_NULLABLE === "YES",
        comment: col.COLUMN_COMMENT || null,
        sampleValues: (sampleRows as Record<string, unknown>[]).map(
          (r) => r[col.COLUMN_NAME],
        ),
      });
    }
    return columns;
  }

  private async getForeignKeys(table: string): Promise<ForeignKey[]> {
    const [rows] = await this.connection!.query(
      `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [this.config!.database, table],
    );

    return (
      rows as Array<{
        COLUMN_NAME: string;
        REFERENCED_TABLE_NAME: string;
        REFERENCED_COLUMN_NAME: string;
      }>
    ).map((r) => ({
      column: r.COLUMN_NAME,
      references: `${r.REFERENCED_TABLE_NAME}.${r.REFERENCED_COLUMN_NAME}`,
    }));
  }
}
