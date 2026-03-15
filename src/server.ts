import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CatalogStore } from "./catalog/store.js";
import { QueryEngine } from "./query/engine.js";
import { handleConnectSource, handleListTables } from "./tools/connect.js";
import { handleQuery } from "./tools/query.js";
import { handleDescribeTable } from "./tools/describe.js";
import { handleProfileData } from "./tools/profile.js";
import { getConfig } from "./config.js";

/**
 * Create and configure the Lucid MCP Server.
 * Sprint 1: connect_source, list_tables, describe_table, profile_data, query
 * Sprint 2: init_semantic, update_semantic, search_tables
 */
export function createServer(): McpServer {
  const config = getConfig();
  const catalog = new CatalogStore();
  const engine = new QueryEngine();

  const server = new McpServer({
    name: config.server.name,
    version: config.server.version,
  });

  // ── Tool: connect_source ──────────────────────────────────────────────────
  server.tool(
    "connect_source",
    "Connect a data source (Excel, CSV, or MySQL). Automatically collects schema and basic profiling.",
    {
      type: z.enum(["excel", "csv", "mysql"]).describe("Data source type"),
      path: z.string().optional().describe("File path for Excel/CSV sources"),
      sheets: z.array(z.string()).optional().describe("Sheet names to load (Excel only, default: all)"),
      host: z.string().optional().describe("MySQL host"),
      port: z.number().optional().describe("MySQL port (default: 3306)"),
      database: z.string().optional().describe("MySQL database name"),
      username: z.string().optional().describe("MySQL username"),
      password: z.string().optional().describe("MySQL password"),
    },
    async (params) => {
      try {
        const result = await handleConnectSource(params, catalog, engine);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              sourceId: result.sourceId,
              message: `Connected successfully. Found ${result.tables.length} table(s): ${result.tables.map((t) => t.name).join(", ")}`,
              tables: result.tables.map((t) => ({
                name: t.name,
                rowCount: t.rowCount,
                columnCount: t.columns.length,
                columns: t.columns.map((c) => ({ name: c.name, dtype: c.dtype, comment: c.comment })),
              })),
            }, (_key, val) => typeof val === "bigint" ? String(val) : val, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error connecting source: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  // ── Tool: list_tables ─────────────────────────────────────────────────────
  server.tool(
    "list_tables",
    "List all connected data tables with metadata (row count, column count, semantic status).",
    {
      source_id: z.string().optional().describe("Filter by source ID"),
    },
    async (params) => {
      try {
        const tables = await handleListTables({ sourceId: params.source_id }, catalog);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(tables, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing tables: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  // ── Tool: describe_table ──────────────────────────────────────────────────
  server.tool(
    "describe_table",
    "View the detailed structure, column types, and business semantics of a specific table. Optionally includes sample data.",
    {
      table_name: z.string().describe("Name of the table to describe"),
      source_id: z.string().optional().describe("Source ID (optional, auto-detected if omitted)"),
      include_sample: z.boolean().optional().default(true).describe("Include sample rows (default: true)"),
      sample_rows: z.number().optional().default(5).describe("Number of sample rows (default: 5)"),
    },
    async (params) => {
      try {
        const result = await handleDescribeTable(params, catalog, engine);
        return {
          content: [{ type: "text" as const, text: result }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error describing table: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  // ── Tool: query ───────────────────────────────────────────────────────────
  server.tool(
    "query",
    "Execute a read-only SQL query (SELECT only). Returns results in JSON, markdown, or CSV format.",
    {
      sql: z.string().describe("SQL SELECT statement to execute"),
      max_rows: z.number().optional().default(100).describe("Maximum rows to return (default: 100)"),
      format: z.enum(["json", "markdown", "csv"]).optional().default("markdown").describe("Output format (default: markdown)"),
    },
    async (params) => {
      try {
        const result = await handleQuery({ sql: params.sql, maxRows: params.max_rows, format: params.format }, engine);
        return {
          content: [{ type: "text" as const, text: result }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error executing query: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  // ── Tool: profile_data ────────────────────────────────────────────────────
  server.tool(
    "profile_data",
    "Run a deep data profile on a table using DuckDB SUMMARIZE. Returns stats: null rate, distinct count, min/max/avg, quartiles.",
    {
      table_name: z.string().describe("Name of the table to profile"),
      source_id: z.string().optional().describe("Source ID (optional, auto-detected if omitted)"),
      columns: z.array(z.string()).optional().describe("Specific columns to profile (optional, default: all)"),
    },
    async (params) => {
      try {
        const result = await handleProfileData(params, catalog, engine);
        return {
          content: [{ type: "text" as const, text: result }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error profiling data: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  // ── Sprint 2 Tools (stubs — registered so clients can discover them) ──────
  server.tool(
    "init_semantic",
    "[Sprint 2] Return all connected table schemas, sample data, and profiling summaries for the host Agent to infer business semantics. After inference, call update_semantic to save results.",
    {
      source_id: z.string().optional().describe("Filter by source ID (optional)"),
      sample_rows: z.number().optional().default(5).describe("Sample rows per table (default: 5)"),
    },
    async (_params) => {
      return {
        content: [{ type: "text" as const, text: "init_semantic is available in Sprint 2. Currently use describe_table for individual table schema." }],
      };
    },
  );

  server.tool(
    "update_semantic",
    "[Sprint 2] Write or update business semantic definitions for tables. Automatically updates the search index after writing.",
    {
      tables: z.array(z.object({
        table_name: z.string(),
        description: z.string().optional(),
        business_domain: z.string().optional(),
        tags: z.array(z.string()).optional(),
        columns: z.array(z.object({
          name: z.string(),
          semantic: z.string().optional(),
          role: z.string().optional(),
          unit: z.string().optional(),
          aggregation: z.string().optional(),
          confirmed: z.boolean().optional(),
        })).optional(),
      })).describe("Array of table semantic definitions to write"),
    },
    async (_params) => {
      return {
        content: [{ type: "text" as const, text: "update_semantic is available in Sprint 2." }],
      };
    },
  );

  server.tool(
    "search_tables",
    "[Sprint 2] Search the semantic layer using natural language to find relevant tables and fields. Returns full semantic info including JOIN relations and metrics.",
    {
      query: z.string().describe("Natural language keywords or question"),
      top_k: z.number().optional().default(5).describe("Top K most relevant tables to return (default: 5)"),
    },
    async (_params) => {
      return {
        content: [{ type: "text" as const, text: "search_tables is available in Sprint 2. Currently use list_tables + describe_table to explore the schema." }],
      };
    },
  );

  return server;
}
