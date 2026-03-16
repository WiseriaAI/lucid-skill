/**
 * get_join_paths tool handler.
 * Discovers and returns JOIN paths between two tables.
 */

import type { CatalogStore } from "../catalog/store.js";
import type { Embedder } from "../semantic/embedder.js";
import { discoverJoinPaths, computeSchemaHash } from "../discovery/joins.js";

/**
 * Handle get_join_paths request.
 * Checks cache, re-discovers if dirty, returns direct + indirect paths.
 */
export async function handleGetJoinPaths(
  params: Record<string, unknown>,
  catalog: CatalogStore,
  embedder?: Embedder | null,
): Promise<string> {
  const tableA = params.table_a as string;
  const tableB = params.table_b as string;

  if (!tableA || !tableB) {
    throw new Error("Both table_a and table_b are required");
  }

  // Find which source(s) contain these tables
  const allTables = catalog.getTables();
  const sourcesForA = new Set(allTables.filter((t) => t.table_name === tableA).map((t) => t.source_id));
  const sourcesForB = new Set(allTables.filter((t) => t.table_name === tableB).map((t) => t.source_id));

  // Validate both tables exist
  if (sourcesForA.size === 0) {
    throw new Error(`Table "${tableA}" not found in any connected source`);
  }
  if (sourcesForB.size === 0) {
    throw new Error(`Table "${tableB}" not found in any connected source`);
  }

  // Find common sources or all relevant sources
  const relevantSources = new Set<string>();
  for (const s of sourcesForA) {
    if (sourcesForB.has(s)) relevantSources.add(s);
  }
  // If no common source, include all sources (cross-source join)
  if (relevantSources.size === 0) {
    for (const s of sourcesForA) relevantSources.add(s);
    for (const s of sourcesForB) relevantSources.add(s);
  }

  // For each relevant source, check cache and discover if needed
  for (const sourceId of relevantSources) {
    const meta = catalog.getCacheMeta(sourceId);
    const currentHash = computeSchemaHash(catalog, sourceId);

    const needsRefresh = !meta || meta.dirty === 1 || meta.schemaHash !== currentHash;

    if (needsRefresh) {
      // Clear old paths for this source and re-discover
      catalog.clearJoinPaths(sourceId);
      const paths = await discoverJoinPaths(catalog, sourceId, embedder);
      for (const p of paths) {
        catalog.saveJoinPath(p);
      }
      catalog.setCacheMeta(sourceId, currentHash);
    }
  }

  // Fetch paths for the requested table pair
  const paths = catalog.getJoinPaths(tableA, tableB);

  const directPaths = paths.filter((p) => !p.signalSource.startsWith("indirect:"));
  const indirectPaths = paths.filter((p) => p.signalSource.startsWith("indirect:"));

  const hasLowConfidence = paths.some((p) => p.confidence < 0.6);
  const warning = hasLowConfidence ? "low confidence, manual verification recommended" : null;

  return JSON.stringify({
    direct_paths: directPaths.map((p) => ({
      join_sql: p.sqlTemplate,
      confidence: Math.round(p.confidence * 100) / 100,
      signal: p.signalSource,
      join_condition: p.joinCondition,
    })),
    indirect_paths: indirectPaths.map((p) => ({
      via: p.signalSource.replace("indirect:via_", ""),
      join_sql: p.sqlTemplate,
      confidence: Math.round(p.confidence * 100) / 100,
      signal: p.signalSource,
      join_condition: p.joinCondition,
    })),
    warning,
  }, null, 2);
}
