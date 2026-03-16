# lucid-mcp

**AI-native data analysis agent as an MCP Server.**

Connect your Excel files, CSVs, MySQL, and PostgreSQL databases. Understand business semantics. Query with natural language.

```jsonc
// Claude Desktop / Cursor config
{
  "mcpServers": {
    "lucid": {
      "command": "npx",
      "args": ["@wiseria/lucid-mcp"]
    }
  }
}
```

No API key required. No LLM inside the server. Just plug in and ask questions.

---

## What it does

Lucid MCP gives your AI assistant (Claude, Cursor, etc.) structured access to your business data:

| Tool | What it does |
|------|-------------|
| `connect_source` | Connect Excel / CSV / MySQL / PostgreSQL. Auto-collects schema + profiling. |
| `get_overview` | Get an overview of all connected sources, tables, semantic status. Always call first. |
| `list_tables` | List all connected tables with row counts and semantic status. |
| `describe_table` | View column types, sample data, and business semantics. |
| `profile_data` | Deep stats: null rate, distinct count, min/max, quartiles. |
| `init_semantic` | Export schema + samples for LLM to infer business meaning. |
| `update_semantic` | Save semantic definitions (YAML) + update search index. |
| `search_tables` | Natural language search → relevant tables + JOIN hints + metrics. |
| `get_join_paths` | Discover JOIN paths between two tables (FK + column name + embedding signals, direct + indirect). |
| `get_business_domains` | Auto-discovered business domains via hierarchical clustering. |
| `query` | Execute read-only SQL (SELECT only). Returns markdown/JSON/CSV. |

---

## How it works

```
You: "上个月哪个客户下单金额最多？"

Claude:
  1. search_tables("上月 销售 客户")
     → orders 表 (有 Sales 字段、Customer Name、Order Date)

  2. 生成 SQL:
     SELECT "Customer Name", SUM("Sales") as total
     FROM orders
     WHERE "Order Date" >= '2024-02-01'
       AND "Order Date" < '2024-03-01'
     GROUP BY "Customer Name"
     ORDER BY total DESC
     LIMIT 10

  3. query(sql) → 返回结果表格
  4. 解读结果给你
```

**Design principle: Server has no LLM.** All semantic inference and SQL generation is done by the host agent. The server handles deterministic operations only — connecting, cataloging, indexing, querying.

---

## Supported Platforms

| Platform | Status | Config |
|----------|--------|--------|
| Claude Desktop | ✅ Verified | See below |
| Cursor | ✅ Native MCP support | Same config format |
| OpenClaw | ✅ Native MCP support | Same config format |
| Windsurf | ✅ Native MCP support | Same config format |
| Continue.dev | ✅ Native MCP support | Same config format |

---

## Quick Start

### Prerequisites

- **Node.js 18+** (recommended 20+) — check with `node -v`
- **npm** (comes with Node.js)

### Installation

**Option 1: Zero-install (recommended)** — no global install needed, always runs the latest version:

```bash
npx @wiseria/lucid-mcp
```

Just use `npx @wiseria/lucid-mcp` in your MCP config (see below).

**Option 2: Global install** — faster startup, no download on each launch:

```bash
npm install -g @wiseria/lucid-mcp
```

Then use `lucid-mcp` as the command in your MCP config.

**Option 3: Local install** — pin to a specific version in a project:

```bash
npm install @wiseria/lucid-mcp
```

Use the full path `./node_modules/.bin/lucid-mcp` in your MCP config.

### 1. Configure your platform

Choose your platform and add the config:

<details>
<summary><strong>Claude Desktop</strong></summary>

Config file location:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "lucid": {
      "command": "npx",
      "args": ["@wiseria/lucid-mcp"]
    }
  }
}
```
</details>

<details>
<summary><strong>Cursor</strong></summary>

Config file location:
- **Project-level**: `.cursor/mcp.json` (in your project root)
- **Global**: `~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "lucid": {
      "command": "npx",
      "args": ["@wiseria/lucid-mcp"]
    }
  }
}
```
</details>

<details>
<summary><strong>OpenClaw</strong></summary>

Config file: `~/.openclaw/openclaw.json`

```json
{
  "mcpServers": {
    "lucid": {
      "command": "npx",
      "args": ["@wiseria/lucid-mcp"]
    }
  }
}
```
</details>

<details>
<summary><strong>Windsurf</strong></summary>

Config file: `~/.windsurf/mcp.json`

```json
{
  "mcpServers": {
    "lucid": {
      "command": "npx",
      "args": ["@wiseria/lucid-mcp"]
    }
  }
}
```
</details>

<details>
<summary><strong>Continue.dev</strong></summary>

Config file: `~/.continue/config.json`, add under `experimental.modelContextProtocolServers`:

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "npx",
          "args": ["@wiseria/lucid-mcp"]
        }
      }
    ]
  }
}
```
</details>

Restart the host application after editing config.

### Verify Installation

```bash
npx @wiseria/lucid-mcp --version
```

Or launch the server and connect a CSV to verify everything works:

> "Connect my CSV file at /path/to/data.csv"

### Data Directory

Lucid MCP stores data in `~/.lucid-mcp/`:

| Path | Purpose |
|------|---------|
| `lucid-catalog.db` | SQLite metadata catalog (schema, profiling, search index) |
| `semantic_store/` | Semantic YAML definitions (human-readable, Git-friendly) |
| `models/` | Downloaded embedding model (only if embedding enabled) |

Customize the data directory via the `LUCID_DATA_DIR` environment variable.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LUCID_DATA_DIR` | `~/.lucid-mcp` | Data directory for catalog, semantic store, models |
| `LUCID_EMBEDDING_ENABLED` | `false` | Enable embedding hybrid search (downloads ~460MB model on first run) |

### 2. Connect a data source

Ask Claude:

> "Connect my Excel file at /Users/me/sales.xlsx"

Claude will call `connect_source` and report back the tables it found.

### 3. Initialize semantics (optional but recommended)

Ask Claude:

> "Initialize the semantic layer for my data"

Claude will call `init_semantic` to get the schema, infer business meanings for each table and column, then call `update_semantic` to save them. After this, natural language search works much better.

### 4. Start asking questions

> "Which product category had the highest profit margin last quarter?"
> "Show me the top 10 customers by revenue"
> "What's the average order value by region?"

---

## Supported Data Sources

| Type | Format | Notes |
|------|--------|-------|
| Excel | `.xlsx`, `.xls` | Multiple sheets supported |
| CSV | `.csv` | Auto-detects encoding and delimiter |
| MySQL | MySQL 5.7+ / 8.0+ | Reads foreign keys and column comments |
| PostgreSQL | PostgreSQL 12+ | Reads foreign keys and column comments via `pg_description` |

---

## Semantic Layer

Lucid stores business semantics as YAML files in `./semantic_store/`. These are:

- **Human-readable** — edit them directly if needed
- **Git-friendly** — commit and version your semantic definitions
- **LLM-agnostic** — switching from Claude to GPT doesn't lose your semantic layer

Example:
```yaml
source: "csv:orders.csv"
table: orders
description: "订单记录，包含销售额、折扣、利润等关键商业指标"
businessDomain: "电商/交易"
tags: ["核心表", "财务", "订单"]

columns:
  - name: Sales
    semantic: "订单销售额"
    role: measure
    unit: CNY
    aggregation: sum

  - name: Order Date
    semantic: "下单时间"
    role: timestamp
    granularity: [day, month, year]

metrics:
  - name: "总销售额"
    expression: "SUM(Sales)"
```

---

## Configuration

Optional config file `lucid.config.yaml` in your working directory:

```yaml
query:
  maxRows: 1000        # Max rows per query (default: 1000)
  timeoutSeconds: 30   # Query timeout (default: 30)

semantic:
  storePath: ./semantic_store   # Where to save YAML files

catalog:
  dbPath: ./lucid-catalog.db   # SQLite metadata cache
```

---

## JOIN Path Discovery

`get_join_paths` automatically discovers how two tables can be joined — using foreign keys, matching column names, and embedding similarity. It finds both direct joins and indirect paths via one intermediate table, ranked by confidence.

## Business Domain Discovery

`get_business_domains` uses hierarchical clustering on table semantics and column overlap to group your tables into business domains (e.g., "Sales", "Inventory", "HR"). This gives the AI a high-level map of your data landscape before diving into specific queries.

---

## Embedding Hybrid Search (Optional)

Enable embedding-based hybrid search for better multilingual and semantic matching. When enabled, `search_tables` uses both BM25 keyword search and vector similarity, fused with Reciprocal Rank Fusion (RRF).

**How to enable:**

```bash
# Via environment variable
LUCID_EMBEDDING_ENABLED=true npx @wiseria/lucid-mcp
```

Or in Claude Desktop config:
```json
{
  "mcpServers": {
    "lucid": {
      "command": "npx",
      "args": ["@wiseria/lucid-mcp"],
      "env": {
        "LUCID_EMBEDDING_ENABLED": "true"
      }
    }
  }
}
```

**Notes:**
- First launch downloads ~460MB multilingual model (`paraphrase-multilingual-MiniLM-L12-v2`) to `~/.lucid-mcp/models/`
- Model loading is async — search works immediately via BM25, embedding kicks in once ready
- Default: **disabled** — no impact on startup time or disk usage when off

---

## Security

- **Read-only**: Only `SELECT` statements are allowed. `INSERT`, `UPDATE`, `DELETE`, `DROP`, and all DDL are blocked.
- **No credentials stored**: Database passwords are never written to disk.
- **Local only**: All data stays on your machine. Nothing is sent to external services.

---

## Development

```bash
git clone https://github.com/wiseriai/lucid-mcp
cd lucid-mcp
npm install
npm run build
npm run dev    # Run with tsx (no build step)
npm test       # Run e2e tests
```

---

## Roadmap

- [x] Sprint 1: Excel / CSV / MySQL connectors, DuckDB query engine, SQL safety
- [x] Sprint 2: Semantic layer (YAML), BM25 search index, natural language routing
- [x] Sprint 3: Query routing (MySQL direct), npm publish
- [x] V1: Embedding-based hybrid search (BM25 + vector)
- [x] V2: JOIN path discovery, business domain clustering, get_overview
- [ ] V2: Parquet / large file support
- [ ] Commercial: Multi-tenancy, authentication, hosted version

---

## License

MIT
