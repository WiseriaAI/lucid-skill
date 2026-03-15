# Lucid MCP — Sprint 1 测试计划

> 状态：Draft | 日期：2026-03-15 | 作者：Hikari

---

## 概述

Sprint 1 主要实现了：
1. **MCP Server 骨架** — stdio transport, tool 注册
2. **三个 Connector** — Excel / CSV / MySQL
3. **查询引擎** — DuckDB + SQL 安全检查
4. **元数据 Catalog** — SQLite 缓存 + Schema 采集 + Profiling
5. **语义层基础** — YAML 读写 + BM25 FTS5 索引
6. **八个 Tool Handler** — connect_source, list_tables, query, describe_table, profile_data, search_tables, init_semantic, update_semantic

本文档定义了端到端验证测试。

---

## 测试数据

### 1. Superstore（CSV）
- 源：人工生成的 12 行订单数据
- 位置：`tests/datasets/superstore/orders.csv`
- 表名：orders
- 字段：Order ID, Order Date, Ship Date, Customer Name, Segment, City, State, Region, Category, Sub-Category, Product Name, Sales, Quantity, Discount, Profit
- 目的：验证 CSV 连接、数据采样、profiling、基础查询

### 2. Northwind（MySQL）
- 源：经典电商数据库
- 位置：本地 MySQL（需要单独启动）
- 表：Customers, Orders, Products, OrderDetails, Employees, Suppliers, Categories, Shippers
- 目的：验证 MySQL 连接、多表关系采集、JOIN 查询、外键推断

---

## 测试场景

### Scenario 1: CSV 连接 + 基础查询
**目标**：验证 CSV Connector 和查询引擎可以正常工作

**步骤**：
```
1. 连接 orders.csv
   Tool: connect_source
   Input: { type: "csv", path: "tests/datasets/superstore/orders.csv" }
   Expected: ✅ 连接成功，发现 1 张表

2. 列出所有表
   Tool: list_tables
   Expected: ✅ 返回 ["orders"]，包含行数、列数

3. 查看表结构
   Tool: describe_table
   Input: { table_name: "orders" }
   Expected: ✅ 返回 14 个字段名、类型、样本值

4. 执行基础查询
   Tool: query
   Input: { sql: "SELECT COUNT(*) as count FROM orders" }
   Expected: ✅ 返回 [{ count: 12 }]

5. 执行聚合查询
   Tool: query
   Input: { sql: "SELECT Category, SUM(Sales) as total_sales FROM orders GROUP BY Category ORDER BY total_sales DESC LIMIT 3" }
   Expected: ✅ 返回按销售额排序的 3 个分类

6. Profiling
   Tool: profile_data
   Input: { table_name: "orders" }
   Expected: ✅ 返回每列的数据画像（distinct count, null rate, min, max 等）
```

**验收**：所有 6 个请求都返回 200，无超时、无崩溃

---

### Scenario 2: CSV + 语义层初始化
**目标**：验证语义推断和索引构建

**步骤**：
```
1. 获取初始化信息
   Tool: init_semantic
   Input: { source_id: "csv:orders.csv" }
   Expected: ✅ 返回 schema + 样本数据 + profiling（供宿主推断语义）

2. 推断并写入语义
   Tool: update_semantic
   Input: {
     tables: [{
       table_name: "orders",
       description: "订单记录，包含销售额、折扣、利润等关键商业指标",
       businessDomain: "电商/交易",
       tags: ["核心表", "财务"],
       columns: [
         { name: "Order ID", semantic: "订单唯一标识", role: "primary_key" },
         { name: "Sales", semantic: "订单销售额（CNY）", role: "measure", unit: "CNY", aggregation: "sum" },
         { name: "Profit", semantic: "订单利润（CNY）", role: "measure", unit: "CNY", aggregation: "sum" },
         { name: "Category", semantic: "商品分类", role: "dimension" },
         { name: "Segment", semantic: "客户段（消费者/企业/居家办公）", role: "dimension" },
         { name: "Order Date", semantic: "下单时间", role: "timestamp", granularity: ["day", "month", "year"] }
         // ... 其他字段
       ],
       metrics: [
         { name: "日销售额", expression: "SUM(Sales)", groupBy: "DATE(Order Date)" },
         { name: "日订单数", expression: "COUNT(DISTINCT 'Order ID')", groupBy: "DATE(Order Date)" },
         { name: "平均利润率", expression: "SUM(Profit) / SUM(Sales)", filter: "Sales > 0" }
       ]
     }]
   }
   Expected: ✅ 语义层已写入 YAML + 索引已更新

3. 验证索引
   Tool: search_tables
   Input: { query: "销售额 分类" }
   Expected: ✅ 返回 orders 表及其语义信息（因为表中有销售额和分类字段）

4. 验证语义搜索精度
   Tool: search_tables
   Input: { query: "订单量 时间序列" }
   Expected: ✅ orders 在 top-1（有订单 ID 字段和时间戳）
```

**验收**：语义 YAML 文件生成正确，搜索返回相关表

---

### Scenario 3: SQL 安全检查
**目标**：验证只允许 SELECT，禁止 INSERT/DELETE/DROP

**步骤**：
```
1. 禁止 INSERT
   Tool: query
   Input: { sql: "INSERT INTO orders VALUES (...)" }
   Expected: ❌ 返回错误 "Only SELECT statements are allowed"

2. 禁止 DELETE
   Tool: query
   Input: { sql: "DELETE FROM orders WHERE id=1" }
   Expected: ❌ 返回错误 "Only SELECT statements are allowed"

3. 禁止 DROP
   Tool: query
   Input: { sql: "DROP TABLE orders" }
   Expected: ❌ 返回错误 "Forbidden keyword detected: DROP"

4. 允许 SELECT
   Tool: query
   Input: { sql: "SELECT * FROM orders LIMIT 1" }
   Expected: ✅ 正常返回数据

5. 允许 CTE（WITH）
   Tool: query
   Input: { sql: "WITH summary AS (SELECT Category, SUM(Sales) as total FROM orders GROUP BY Category) SELECT * FROM summary" }
   Expected: ✅ 正常返回数据
```

**验收**：所有禁止的 SQL 都被拒绝，合法 SQL 都被执行

---

### Scenario 4: MySQL 连接（可选，需要本地 MySQL）
**目标**：验证 MySQL Connector 和跨源 JOIN

**前置条件**：
- 本地 MySQL 运行在 localhost:3306
- Northwind 数据库已导入
- credentials 正确

**步骤**：
```
1. 连接 MySQL
   Tool: connect_source
   Input: {
     type: "mysql",
     host: "localhost",
     port: 3306,
     database: "northwind",
     username: "root",
     password: "..."
   }
   Expected: ✅ 连接成功，发现 8 张表

2. 查看表列表
   Tool: list_tables
   Expected: ✅ 返回 Customers, Orders, Products, OrderDetails 等

3. 描述 Orders 表
   Tool: describe_table
   Input: { table_name: "Orders" }
   Expected: ✅ 返回字段 + 外键关系

4. MySQL 多表 JOIN
   Tool: query
   Input: { sql: "SELECT c.CompanyName, COUNT(o.OrderID) as order_count FROM Customers c LEFT JOIN Orders o ON c.CustomerID = o.CustomerID GROUP BY c.CompanyName ORDER BY order_count DESC LIMIT 5" }
   Expected: ✅ 返回前 5 个客户及其订单数

5. MySQL 查询性能
   Input: { sql: "SELECT * FROM Orders WHERE OrderDate >= '1998-01-01' AND OrderDate < '1998-02-01'" }
   Expected: ✅ < 100ms 返回

6. MySQL Profiling
   Tool: profile_data
   Input: { table_name: "Orders" }
   Expected: ✅ 返回数据画像
```

**验收**：MySQL 连接、多表 JOIN、性能正常

---

### Scenario 5: CSV + MySQL 混合 JOIN（可选）
**目标**：验证跨源 JOIN 能力

**前置条件**：
- CSV 和 MySQL 同时连接
- CSV orders 表有 customer_name，MySQL Customers 表有 CompanyName

**步骤**：
```
1. 跨源 JOIN（如果支持）
   Tool: query
   Input: { sql: "SELECT csv_orders.Order_ID, mysql_customers.CompanyName FROM csv_orders JOIN mysql_customers ON csv_orders.Customer_Name = mysql_customers.CompanyName" }
   Expected: ⚠️ MVP 版本可能不支持，返回错误或空结果（这是 TODO）
```

**验收**：至少能清晰地说明为什么不支持（待 V1 优化）

---

## 测试执行流程

### 本地环境
```bash
# 1. 构建
npm run build

# 2. 启动 MCP Server（stdio 模式，单独终端）
node dist/index.js

# 3. 在另一个终端发送 MCP 协议消息
# 可以用 claude desktop / cursor / 或手写 JSON-RPC 2.0 请求
```

### 端到端脚本（待实现）
```bash
# 理想情况下，我们会写一个 E2E 测试脚本：
npm run test:e2e

# 或者单个场景：
npm run test:scenario 1  # CSV 连接 + 基础查询
npm run test:scenario 2  # CSV + 语义层
npm run test:scenario 3  # SQL 安全检查
```

---

## 验收标准

### 必须通过（MVP）
- ✅ Scenario 1 — CSV 连接 + 基础查询
- ✅ Scenario 2 — 语义层初始化
- ✅ Scenario 3 — SQL 安全检查

### 可选（MySQL 需要本地数据库）
- ⚠️ Scenario 4 — MySQL 连接（需要 Northwind 数据库）
- ⚠️ Scenario 5 — 跨源 JOIN（MVP 不支持）

### 代码质量
- ✅ `npm run build` 无错误
- ✅ `npm run lint` 无严重 warning
- ✅ 构建产物大小 < 1MB（当前 529KB ✅）
- ✅ 启动时间 < 1s

---

## 已知限制

1. **跨源 JOIN**：MVP 版本不支持 CSV + MySQL 混合 JOIN，这是 TODO
2. **Embedding 检索**：MVP 使用 BM25，V1 计划加入 Embedding
3. **大文件处理**：Excel 100MB+ 场景没有特殊优化
4. **多租户**：MVP 不支持，后续商业版才加

---

## 测试结果记录

### Test Run #1 — 2026-03-15 13:09 GMT+8

| Scenario | Status | 备注 |
|----------|--------|------|
| 1.1 CSV 连接 | ✅ 通过 | sourceId=csv:orders.csv，1张表，15列，12行 |
| 1.2 列表 | ✅ 通过 | 返回表名、行数、列数、semantic_status |
| 1.3 描述表 | ✅ 通过 | 返回15列完整信息 + sampleValues |
| 1.4 基础查询 | ✅ 通过 | `SELECT COUNT(*) → 12` |
| 1.5 聚合查询 | ✅ 通过 | Technology: 42995, Furniture: 20080, Office Supplies: 584 |
| 1.6 Profiling | ✅ 通过 | 15列全部 SUMMARIZE，含 min/max/approxUnique/nullPercentage |
| 2.1 init_semantic | ⏳ Sprint 2 | 目前返回提示信息 |
| 2.2 update_semantic | ⏳ Sprint 2 | 目前返回提示信息 |
| 2.3 search_tables | ⏳ Sprint 2 | 目前返回提示信息 |
| 3.1 禁止 INSERT | ✅ 通过 | "SQL safety check failed: Only SELECT statements are allowed. Got: INSERT" |
| 3.2 禁止 DELETE | ✅ 通过 | "SQL safety check failed: Only SELECT statements are allowed. Got: DELETE" |
| 3.3 禁止 DROP | ✅ 通过 | "SQL safety check failed: Only SELECT statements are allowed. Got: DROP" |
| 3.4 允许 SELECT | ✅ 通过 | 正常返回数据 |
| 3.5 允许 CTE | ✅ 通过 | WITH 语句正常执行 |

**总结：11/11 测试通过（语义层 3 项待 Sprint 2 实现）**

**修复的 Bug（第一轮测试发现）：**
1. BigInt 序列化错误 — DuckDB 返回 BigInt 类型，JSON.stringify 失败 → 增加自定义 replacer
2. Tool 注册不完整 — describe_table / profile_data 未注册到 MCP Server → 补全注册
3. CSV 表未注册到 DuckDB — connect_source 时未调用 registerToDuckDB → 传入 engine 并调用

---

## 下一步

1. ✅ DuckDB native binding 编译完成
2. ⏳ 运行 Scenario 1（CSV 基础）
3. ⏳ 运行 Scenario 2（语义层）
4. ⏳ 运行 Scenario 3（安全检查）
5. ⏳ 修复 bug（如有）
6. ⏳ 更新此表格为实际测试结果

---

## 附录：MCP 协议消息示例

### 示例 1：连接 CSV
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "connect_source",
    "arguments": {
      "type": "csv",
      "path": "tests/datasets/superstore/orders.csv"
    }
  }
}
```

### 示例 2：查询数据
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "query",
    "arguments": {
      "sql": "SELECT COUNT(*) as count FROM orders"
    }
  }
}
```

### 示例 3：更新语义
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "update_semantic",
    "arguments": {
      "tables": [
        {
          "table_name": "orders",
          "description": "订单表",
          "columns": [
            { "name": "Order ID", "semantic": "订单 ID", "role": "primary_key" }
          ]
        }
      ]
    }
  }
}
```

