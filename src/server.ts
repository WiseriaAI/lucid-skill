import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CatalogStore } from "./catalog/store.js";
import { QueryEngine } from "./query/engine.js";
import { handleConnectSource, handleListTables } from "./tools/connect.js";
import { handleQuery } from "./tools/query.js";
import { getConfig } from "./config.js";

/**
 * Create and configure the Lucid MCP Server.
 */
export function createServer(): McpServer {
  const config = getConfig();
  const catalog = new CatalogStore();
  const engine = new QueryEngine();

  const server = new McpServer({
    name: config.server.name,
    version: config.server.version,
  });

  // ── Tool: connect_source ──
  server.tool(
    "connect_source",
    "Connect a data source (Excel, CSV, or MySQL). Automatically collects schema and basic profiling.",
    {
      type: z.enum(["excel", "csv", "mysql"]).describe("Data source type"),
      path: z.string().optional().describe("File path for Excel/CSV sources"),
      sheets: z
        .array(z.string())
        .optional()
        .describe("Sheet names to load (Excel only, default: all)"),
      host: z.string().optional().describe("MySQL host"),
      port: z.number().optional().describe("MySQL port (default: 3306)"),
      database: z.string().optional().describe("MySQL database name"),
      username: z.string().optional().describe("MySQL username"),
      password: z.string().optional().describe("MySQL password"),
    },
    async (params) => {
      try {
        const result = await handleConnectSource(params, catalog);
        const tableNames = result.tables.map((t) => t.name);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  sourceId: result.sourceId,
                  message: `Connected successfully. Found ${result.tables.length} table(s): ${tableNames.join(", ")}`,
                  tables: result.tables.map((t) => ({
                    name: t.name,
                    rowCount: t.rowCount,
                    columnCount: t.columns.length,
                    columns: t.columns.map((c) => ({
                      name: c.name,
                      dtype: c.dtype,
                      comment: c.comment,
                    })),
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error connecting source: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── Tool: list_tables ──
  server.tool(
    "list_tables",
    "List all connected data tables with metadata.",
    {
      sourceId: z.string().optional().describe("Filter by source ID"),
    },
    async (params) => {
      try {
        const tables = await handleListTables(params, catalog);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(tables, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing tables: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── Tool: query ──
  server.tool(
    "query",
    "Execute a read-only SQL query (SELECT only). Returns results in the specified format.",
    {
      sql: z.string().describe("SQL SELECT statement to execute"),
      maxRows: z
        .number()
        .optional()
        .default(100)
        .describe("Maximum rows to return (default: 100)"),
      format: z
        .enum(["json", "markdown", "csv"])
        .optional()
        .default("markdown")
        .describe("Output format (default: markdown)"),
    },
    async (params) => {
      try {
        const result = await handleQuery(params, engine);
        return {
          content: [
            {
              type: "text" as const,
              text: result,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error executing query: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}
