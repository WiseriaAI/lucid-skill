# lucid-skill

**AI-native data analysis skill.** Connect Excel/CSV/MySQL/PostgreSQL, understand business semantics, query with natural language.

No API key required. No LLM inside — you (the agent) are the brain.

---

## Installation (for AI Agents)

> **If you are an AI agent**, follow these steps to install lucid-skill. Do not ask the user to run commands — do it yourself.

### Step 1: Verify Node.js

```bash
node -v   # Requires 18+
```

### Step 2: Install

```bash
npm install -g @wiseria/lucid-skill
```

### Step 3: Verify

```bash
lucid-skill --version
lucid-skill overview     # Should return JSON (empty sources on first run is normal)
```

Done. Start using the CLI commands below.

---

## CLI Commands

All output is JSON (except `query` which defaults to markdown).

```bash
lucid-skill overview                           # Show all connected sources + tables + status
lucid-skill connect csv /path/to/data.csv      # Connect a CSV file
lucid-skill connect excel /path/to/report.xlsx # Connect an Excel file
lucid-skill connect mysql --host h --database db --username u --password p
lucid-skill connect postgres --host h --database db --username u --password p
lucid-skill tables                             # List all tables
lucid-skill describe <table>                   # Column details + sample data
lucid-skill profile <table>                    # Deep stats: null rate, distinct, min/max
lucid-skill init-semantic                      # Export schemas for semantic inference
lucid-skill update-semantic <file|->           # Save semantic definitions (JSON)
lucid-skill search "销售额 客户"                # Natural language → relevant tables
lucid-skill join-paths <table_a> <table_b>     # Discover JOIN paths between tables
lucid-skill domains                            # Auto-discovered business domains
lucid-skill query "SELECT ..."                 # Execute SQL (SELECT only)
lucid-skill query "SELECT ..." --format json   # Output as JSON
lucid-skill query "SELECT ..." --format csv    # Output as CSV
```

---

## Workflow

### First time with a data source

```bash
lucid-skill overview                                    # 1. Check current state
lucid-skill connect csv /path/to/data.csv               # 2. Connect data
lucid-skill init-semantic                               # 3. Get schema for inference
# Analyze output, infer business meanings, then:
echo '{"tables":[...]}' | lucid-skill update-semantic - # 4. Save semantics
lucid-skill search "用户的问题"                          # 5. Find relevant tables
lucid-skill join-paths orders customers                 # 6. Discover JOINs
lucid-skill query "SELECT ..."                          # 7. Execute and return
```

### Returning (auto-restores previous connections)

```bash
lucid-skill overview                     # See what's already connected
lucid-skill search "用户的问题"           # Find relevant tables
lucid-skill query "SELECT ..."           # Execute
```

---

## Smart Query Pattern

When a user asks a data question:

1. `lucid-skill search "关键词"` — find relevant tables, check `suggestedJoins` and `suggestedMetricSqls`
2. If multi-table: `lucid-skill join-paths table_a table_b` — get correct JOIN SQL
3. Compose SQL from the returned context
4. `lucid-skill query "SELECT ..."` — execute and present results

---

## Supported Data Sources

| Type | Format | Notes |
|------|--------|-------|
| Excel | `.xlsx`, `.xls` | Multiple sheets supported |
| CSV | `.csv` | Auto-detects encoding and delimiter |
| MySQL | MySQL 5.7+ / 8.0+ | Reads foreign keys and column comments |
| PostgreSQL | PostgreSQL 12+ | Reads foreign keys and column comments |

---

## Key Facts

- **Read-only**: Only SELECT allowed. INSERT/UPDATE/DELETE/DROP blocked.
- **Auto-restore**: Previous connections survive restarts. Always check `overview` first.
- **Semantic layer**: YAML files in `~/.lucid-mcp/semantic_store/`, human-readable, Git-friendly.
- **Data directory**: `~/.lucid-mcp/` (override with `LUCID_DATA_DIR` env var).
- **Embedding**: Optional. Set `LUCID_EMBEDDING_ENABLED=true` for better multilingual search (downloads ~460MB model on first use).
- **No credentials stored**: Database passwords are never written to disk.
- **Local only**: All data stays on your machine.

---

## Semantic Update Format

```json
{
  "tables": [{
    "table_name": "orders",
    "description": "订单主表",
    "business_domain": "电商/交易",
    "tags": ["核心表", "财务"],
    "columns": [
      { "name": "amount", "semantic": "订单金额", "role": "measure", "unit": "CNY", "aggregation": "sum" },
      { "name": "created_at", "semantic": "下单时间", "role": "timestamp" }
    ],
    "relations": [
      { "target_table": "customers", "join_condition": "orders.customer_id = customers.id", "relation_type": "many_to_one" }
    ],
    "metrics": [
      { "name": "日GMV", "expression": "SUM(amount)", "group_by": "DATE(created_at)" }
    ]
  }]
}
```

---

## MCP Server Mode

lucid-skill also works as an MCP Server for platforms that support it (Claude Desktop, Cursor, etc.):

```bash
lucid-skill serve    # Start MCP Server (stdio JSON-RPC)
```

See [MCP configuration examples](https://github.com/WiseriaAI/lucid-skill/wiki/MCP-Setup) for platform-specific config.

---

## Development

```bash
git clone https://github.com/WiseriaAI/lucid-skill
cd lucid-skill
npm install
npm run build
npm test       # 27 e2e tests
```

---

## License

MIT
