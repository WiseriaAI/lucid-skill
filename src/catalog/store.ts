import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { SemanticStatus, JoinPath, CacheMeta } from "../types.js";
import { getConfig } from "../config.js";

/**
 * SQLite-based metadata catalog store.
 */
export class CatalogStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const config = getConfig();
    const resolvedPath = dbPath ?? config.catalog.dbPath;
    // Ensure parent directory exists (critical when running from arbitrary cwd)
    const dir = path.dirname(resolvedPath);
    if (dir && dir !== ".") {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(resolvedPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL,
        config      TEXT NOT NULL,
        connected_at TEXT,
        updated_at  TEXT
      );

      CREATE TABLE IF NOT EXISTS tables_meta (
        source_id    TEXT NOT NULL,
        table_name   TEXT NOT NULL,
        row_count    INTEGER,
        column_count INTEGER,
        semantic_status TEXT DEFAULT 'not_initialized',
        profiled_at  TEXT,
        PRIMARY KEY (source_id, table_name)
      );

      CREATE TABLE IF NOT EXISTS columns_meta (
        source_id     TEXT NOT NULL,
        table_name    TEXT NOT NULL,
        column_name   TEXT NOT NULL,
        dtype         TEXT,
        nullable      INTEGER,
        comment       TEXT,
        distinct_count INTEGER,
        null_rate     REAL,
        min_value     TEXT,
        max_value     TEXT,
        sample_values TEXT,
        profiled_at   TEXT,
        PRIMARY KEY (source_id, table_name, column_name)
      );

      CREATE TABLE IF NOT EXISTS join_paths (
        path_id        TEXT PRIMARY KEY,
        source_id      TEXT NOT NULL,
        table_a        TEXT NOT NULL,
        table_b        TEXT NOT NULL,
        join_type      TEXT NOT NULL DEFAULT 'INNER',
        join_condition TEXT NOT NULL,
        confidence     REAL NOT NULL,
        signal_source  TEXT NOT NULL,
        sql_template   TEXT NOT NULL,
        version        INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS domain_cache_meta (
        datasource_id  TEXT PRIMARY KEY,
        schema_hash    TEXT NOT NULL,
        last_computed  INTEGER NOT NULL,
        dirty          INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS embeddings (
        source_id    TEXT NOT NULL,
        table_name   TEXT NOT NULL,
        vector       BLOB NOT NULL,
        model_id     TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        updated_at   TEXT,
        PRIMARY KEY (source_id, table_name)
      );
    `);
  }

  upsertSource(
    id: string,
    type: string,
    config: Record<string, unknown>,
  ): void {
    // Strip sensitive fields from config before storing
    const safeConfig = { ...config };
    delete safeConfig.password;

    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO sources (id, type, config, connected_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET config=?, updated_at=?`,
      )
      .run(
        id,
        type,
        JSON.stringify(safeConfig),
        now,
        now,
        JSON.stringify(safeConfig),
        now,
      );
  }

  upsertTableMeta(
    sourceId: string,
    tableName: string,
    rowCount: number,
    columnCount: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO tables_meta (source_id, table_name, row_count, column_count, semantic_status)
         VALUES (?, ?, ?, ?, 'not_initialized')
         ON CONFLICT(source_id, table_name) DO UPDATE SET row_count=?, column_count=?`,
      )
      .run(sourceId, tableName, rowCount, columnCount, rowCount, columnCount);
  }

  upsertColumnMeta(
    sourceId: string,
    tableName: string,
    columnName: string,
    dtype: string,
    nullable: boolean,
    comment: string | null,
    sampleValues: unknown[],
  ): void {
    // Serialize sample values safely: convert BigInt → string to avoid JSON.stringify failure
    const safeSamples = JSON.stringify(sampleValues, (_key, val) =>
      typeof val === "bigint" ? String(val) : val,
    );
    this.db
      .prepare(
        `INSERT INTO columns_meta (source_id, table_name, column_name, dtype, nullable, comment, sample_values)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_id, table_name, column_name) DO UPDATE SET
           dtype=?, nullable=?, comment=?, sample_values=?`,
      )
      .run(
        sourceId,
        tableName,
        columnName,
        dtype,
        nullable ? 1 : 0,
        comment,
        safeSamples,
        dtype,
        nullable ? 1 : 0,
        comment,
        safeSamples,
      );
  }

  updateSemanticStatus(
    sourceId: string,
    tableName: string,
    status: SemanticStatus,
  ): void {
    this.db
      .prepare(
        `UPDATE tables_meta SET semantic_status = ? WHERE source_id = ? AND table_name = ?`,
      )
      .run(status, sourceId, tableName);
  }

  updateProfilingData(
    sourceId: string,
    tableName: string,
    columnName: string,
    data: {
      distinctCount?: number;
      nullRate?: number;
      minValue?: string;
      maxValue?: string;
    },
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE columns_meta SET
           distinct_count = COALESCE(?, distinct_count),
           null_rate = COALESCE(?, null_rate),
           min_value = COALESCE(?, min_value),
           max_value = COALESCE(?, max_value),
           profiled_at = ?
         WHERE source_id = ? AND table_name = ? AND column_name = ?`,
      )
      .run(
        data.distinctCount ?? null,
        data.nullRate ?? null,
        data.minValue ?? null,
        data.maxValue ?? null,
        now,
        sourceId,
        tableName,
        columnName,
      );

    // Update table profiled_at
    this.db
      .prepare(
        `UPDATE tables_meta SET profiled_at = ? WHERE source_id = ? AND table_name = ?`,
      )
      .run(now, sourceId, tableName);
  }

  getSources(): Array<{ id: string; type: string; config: string }> {
    return this.db.prepare("SELECT id, type, config FROM sources").all() as Array<{
      id: string;
      type: string;
      config: string;
    }>;
  }

  getTables(
    sourceId?: string,
  ): Array<{
    source_id: string;
    table_name: string;
    row_count: number;
    column_count: number;
    semantic_status: string;
  }> {
    if (sourceId) {
      return this.db
        .prepare("SELECT * FROM tables_meta WHERE source_id = ?")
        .all(sourceId) as Array<{
        source_id: string;
        table_name: string;
        row_count: number;
        column_count: number;
        semantic_status: string;
      }>;
    }
    return this.db.prepare("SELECT * FROM tables_meta").all() as Array<{
      source_id: string;
      table_name: string;
      row_count: number;
      column_count: number;
      semantic_status: string;
    }>;
  }

  getColumns(
    sourceId: string,
    tableName: string,
  ): Array<{
    column_name: string;
    dtype: string;
    nullable: number;
    comment: string | null;
    sample_values: string;
    distinct_count: number | null;
    null_rate: number | null;
    min_value: string | null;
    max_value: string | null;
  }> {
    return this.db
      .prepare(
        "SELECT * FROM columns_meta WHERE source_id = ? AND table_name = ?",
      )
      .all(sourceId, tableName) as Array<{
      column_name: string;
      dtype: string;
      nullable: number;
      comment: string | null;
      sample_values: string;
      distinct_count: number | null;
      null_rate: number | null;
      min_value: string | null;
      max_value: string | null;
    }>;
  }

  saveEmbedding(
    sourceId: string,
    tableName: string,
    vector: Float32Array,
    modelId: string,
    contentHash: string,
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO embeddings (source_id, table_name, vector, model_id, content_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_id, table_name) DO UPDATE SET
           vector=?, model_id=?, content_hash=?, updated_at=?`,
      )
      .run(
        sourceId,
        tableName,
        Buffer.from(vector.buffer),
        modelId,
        contentHash,
        now,
        Buffer.from(vector.buffer),
        modelId,
        contentHash,
        now,
      );
  }

  getEmbedding(
    sourceId: string,
    tableName: string,
  ): { vector: Float32Array; modelId: string; contentHash: string } | null {
    const row = this.db
      .prepare("SELECT vector, model_id, content_hash FROM embeddings WHERE source_id = ? AND table_name = ?")
      .get(sourceId, tableName) as { vector: Buffer; model_id: string; content_hash: string } | undefined;

    if (!row) return null;
    return {
      vector: new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4),
      modelId: row.model_id,
      contentHash: row.content_hash,
    };
  }

  getAllEmbeddings(): Array<{
    sourceId: string;
    tableName: string;
    vector: Float32Array;
    modelId: string;
    contentHash: string;
  }> {
    const rows = this.db
      .prepare("SELECT source_id, table_name, vector, model_id, content_hash FROM embeddings")
      .all() as Array<{
      source_id: string;
      table_name: string;
      vector: Buffer;
      model_id: string;
      content_hash: string;
    }>;

    return rows.map((r) => ({
      sourceId: r.source_id,
      tableName: r.table_name,
      vector: new Float32Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength / 4),
      modelId: r.model_id,
      contentHash: r.content_hash,
    }));
  }

  // ── JOIN Path Methods ──

  saveJoinPath(p: JoinPath): void {
    this.db
      .prepare(
        `INSERT INTO join_paths (path_id, source_id, table_a, table_b, join_type, join_condition, confidence, signal_source, sql_template, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path_id) DO UPDATE SET
           join_type=?, join_condition=?, confidence=?, signal_source=?, sql_template=?, version=?`,
      )
      .run(
        p.pathId, p.sourceId, p.tableA, p.tableB, p.joinType, p.joinCondition,
        p.confidence, p.signalSource, p.sqlTemplate, p.version,
        p.joinType, p.joinCondition, p.confidence, p.signalSource, p.sqlTemplate, p.version,
      );
  }

  getJoinPaths(tableA: string, tableB: string): JoinPath[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM join_paths
         WHERE (table_a = ? AND table_b = ?) OR (table_a = ? AND table_b = ?)`,
      )
      .all(tableA, tableB, tableB, tableA) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      pathId: r.path_id as string,
      sourceId: r.source_id as string,
      tableA: r.table_a as string,
      tableB: r.table_b as string,
      joinType: r.join_type as string,
      joinCondition: r.join_condition as string,
      confidence: r.confidence as number,
      signalSource: r.signal_source as string,
      sqlTemplate: r.sql_template as string,
      version: r.version as number,
    }));
  }

  getAllJoinPaths(): JoinPath[] {
    const rows = this.db.prepare("SELECT * FROM join_paths").all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      pathId: r.path_id as string,
      sourceId: r.source_id as string,
      tableA: r.table_a as string,
      tableB: r.table_b as string,
      joinType: r.join_type as string,
      joinCondition: r.join_condition as string,
      confidence: r.confidence as number,
      signalSource: r.signal_source as string,
      sqlTemplate: r.sql_template as string,
      version: r.version as number,
    }));
  }

  clearJoinPaths(sourceId: string): void {
    this.db.prepare("DELETE FROM join_paths WHERE source_id = ?").run(sourceId);
  }

  // ── Cache Meta Methods ──

  getCacheMeta(datasourceId: string): CacheMeta | null {
    const row = this.db
      .prepare("SELECT * FROM domain_cache_meta WHERE datasource_id = ?")
      .get(datasourceId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return {
      datasourceId: row.datasource_id as string,
      schemaHash: row.schema_hash as string,
      lastComputed: row.last_computed as number,
      dirty: row.dirty as number,
    };
  }

  setCacheMeta(datasourceId: string, schemaHash: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO domain_cache_meta (datasource_id, schema_hash, last_computed, dirty)
         VALUES (?, ?, ?, 0)
         ON CONFLICT(datasource_id) DO UPDATE SET schema_hash=?, last_computed=?, dirty=0`,
      )
      .run(datasourceId, schemaHash, now, schemaHash, now);
  }

  markDirty(datasourceId: string): void {
    this.db
      .prepare(
        `INSERT INTO domain_cache_meta (datasource_id, schema_hash, last_computed, dirty)
         VALUES (?, '', 0, 1)
         ON CONFLICT(datasource_id) DO UPDATE SET dirty=1`,
      )
      .run(datasourceId);
  }

  close(): void {
    this.db.close();
  }
}
