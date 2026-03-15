# Lucid MCP

AI-native data analysis agent as MCP Server. Connect Excel/CSV/MySQL, understand business semantics, query with natural language.

## Quick Start

```bash
npx lucid-mcp
```

Or configure in Claude Desktop / Cursor:

```jsonc
{
  "mcpServers": {
    "lucid": {
      "command": "npx",
      "args": ["lucid-mcp"]
    }
  }
}
```

## Features

- **Connect** Excel, CSV, and MySQL data sources
- **Schema Discovery** — automatic table/column metadata collection
- **SQL Query** — safe, read-only SQL execution via DuckDB
- **Semantic Layer** — YAML-based business semantics (Sprint 2)
- **Intent Routing** — BM25 full-text search for table discovery (Sprint 2)

## MCP Tools

| Tool | Description |
|------|-------------|
| `connect_source` | Connect a data source (Excel/CSV/MySQL) |
| `list_tables` | List all connected tables |
| `query` | Execute read-only SQL queries |

## Development

```bash
npm install
npm run build
npm run dev    # Run with tsx
npm test       # Run tests
```

## License

MIT
