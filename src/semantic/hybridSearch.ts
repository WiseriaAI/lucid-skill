/**
 * Hybrid search: BM25/LIKE full scan + Embedding full scan → RRF fusion.
 */

import type { CatalogStore } from "../catalog/store.js";
import type { SemanticIndex } from "./index.js";
import { Embedder } from "./embedder.js";

/** In-memory embedding cache: key = "sourceId::tableName" */
const embeddingCache = new Map<string, Float32Array>();

function cacheKey(sourceId: string, tableName: string): string {
  return `${sourceId}::${tableName}`;
}

/** Load all embeddings from catalog into memory cache. */
export function loadEmbeddingCache(catalog: CatalogStore): void {
  const all = catalog.getAllEmbeddings();
  for (const e of all) {
    embeddingCache.set(cacheKey(e.sourceId, e.tableName), e.vector);
  }
}

/** Update a single entry in the cache. */
export function updateCacheEntry(sourceId: string, tableName: string, vector: Float32Array): void {
  embeddingCache.set(cacheKey(sourceId, tableName), vector);
}

export interface HybridSearchResult {
  sourceId: string;
  tableName: string;
  score: number;
}

/**
 * Dual-path parallel search + RRF fusion.
 *
 * 1. BM25/LIKE full scan (unlimited results)
 * 2. If embedder ready: embed query → cosine similarity against all cached vectors
 * 3. RRF merge (k=60): score(d) = Σ 1/(k + rank_i(d))
 * 4. Return top-K by RRF score descending
 */
export async function hybridSearch(
  query: string,
  catalog: CatalogStore,
  semanticIndex: SemanticIndex,
  embedder: Embedder,
  topK: number,
): Promise<HybridSearchResult[]> {
  const RRF_K = 60;

  // Path 1: BM25/LIKE — get all results (use a large topK)
  const bm25Results = semanticIndex.search(query, 10000);

  // Path 2: Embedding (if ready)
  let vectorResults: Array<{ sourceId: string; tableName: string; similarity: number }> = [];

  if (embedder.isReady()) {
    try {
      const queryVec = await embedder.embed(query);

      // Ensure cache is populated
      if (embeddingCache.size === 0) {
        loadEmbeddingCache(catalog);
      }

      // Compute cosine similarity for all cached embeddings
      const scored: Array<{ sourceId: string; tableName: string; similarity: number }> = [];
      for (const [key, vec] of embeddingCache) {
        const [sourceId, tableName] = key.split("::");
        const sim = Embedder.cosineSimilarity(queryVec, vec);
        scored.push({ sourceId, tableName, similarity: sim });
      }

      // Sort by similarity descending
      scored.sort((a, b) => b.similarity - a.similarity);
      vectorResults = scored;
    } catch {
      // Embedding failed — proceed with BM25 only
    }
  }

  // RRF fusion
  const rrfScores = new Map<string, { sourceId: string; tableName: string; score: number }>();

  // BM25 rankings (already sorted by rank, lower rank = better)
  for (let i = 0; i < bm25Results.length; i++) {
    const r = bm25Results[i];
    const key = cacheKey(r.sourceId, r.tableName);
    const existing = rrfScores.get(key);
    const contribution = 1 / (RRF_K + i + 1);
    if (existing) {
      existing.score += contribution;
    } else {
      rrfScores.set(key, { sourceId: r.sourceId, tableName: r.tableName, score: contribution });
    }
  }

  // Vector rankings (already sorted by similarity descending)
  for (let i = 0; i < vectorResults.length; i++) {
    const r = vectorResults[i];
    const key = cacheKey(r.sourceId, r.tableName);
    const existing = rrfScores.get(key);
    const contribution = 1 / (RRF_K + i + 1);
    if (existing) {
      existing.score += contribution;
    } else {
      rrfScores.set(key, { sourceId: r.sourceId, tableName: r.tableName, score: contribution });
    }
  }

  // Sort by RRF score descending, return top-K
  return Array.from(rrfScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
