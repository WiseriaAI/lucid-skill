/**
 * search_tables tool handler.
 */

import type { CatalogStore } from "../catalog/store.js";
import type { Embedder } from "../semantic/embedder.js";
import { SemanticIndex } from "../semantic/index.js";
import { searchTables, type SearchResult } from "../semantic/search.js";
import { hybridSearch } from "../semantic/hybridSearch.js";
import { readTableSemantic } from "../semantic/layer.js";

/**
 * search_tables — returns matching tables with full semantic info.
 * Uses hybrid search (BM25 + embedding) when embedder is available.
 */
export async function handleSearchTables(
  params: Record<string, unknown>,
  index: SemanticIndex,
  catalog?: CatalogStore,
  embedder?: Embedder | null,
): Promise<string> {
  const query = params.query as string;
  const topK = Number(params.top_k ?? params.topK ?? 5);

  if (!query) {
    throw new Error("query is required");
  }

  let results: SearchResult[];

  if (embedder && catalog) {
    // Hybrid search: BM25 + embedding with RRF fusion
    const hybridResults = await hybridSearch(query, catalog, index, embedder, topK);
    results = hybridResults.map((r) => ({
      sourceId: r.sourceId,
      tableName: r.tableName,
      rank: -r.score, // Negative so higher score = lower (better) rank for display
      semantic: readTableSemantic(r.sourceId, r.tableName),
    }));
  } else {
    // BM25-only fallback
    results = searchTables(index, query, topK);
  }

  if (results.length === 0) {
    return JSON.stringify({
      message: `No tables found matching "${query}". Try different keywords, or check if semantic layer has been initialized (call init_semantic + update_semantic first).`,
      results: [],
    });
  }

  return JSON.stringify(
    {
      message: `Found ${results.length} table(s) matching "${query}"`,
      results: results.map((r) => {
        const relations = r.semantic?.relations?.map((rel) => ({
          targetTable: rel.targetTable,
          joinCondition: rel.joinCondition,
          relationType: rel.relationType,
        }));

        const suggestedJoins = relations?.length
          ? relations.map((rel) => `JOIN ${rel.targetTable} ON ${rel.joinCondition}`)
          : [];

        const suggestedMetricSqls = r.semantic?.metrics?.length
          ? r.semantic.metrics.map((m) => {
              const groupByClause = m.groupBy ? ` GROUP BY ${m.groupBy}` : "";
              const selectCols = m.groupBy ? `${m.groupBy}, ` : "";
              return {
                name: m.name,
                sql: `SELECT ${selectCols}${m.expression} AS ${m.name} FROM ${r.tableName}${groupByClause}`,
              };
            })
          : [];

        return {
          sourceId: r.sourceId,
          tableName: r.tableName,
          relevanceRank: r.rank,
          description: r.semantic?.description,
          businessDomain: r.semantic?.businessDomain,
          tags: r.semantic?.tags,
          columns: r.semantic?.columns?.map((c) => ({
            name: c.name,
            semantic: c.semantic,
            role: c.role,
            unit: c.unit,
          })),
          relations,
          suggestedJoins,
          metrics: r.semantic?.metrics,
          suggestedMetricSqls,
        };
      }),
    },
    null,
    2,
  );
}
