/**
 * Business domain clustering engine.
 * Agglomerative hierarchical clustering with average linkage.
 * Automatic k selection via silhouette score.
 */

import crypto from "node:crypto";
import type { CatalogStore } from "../catalog/store.js";
import type { Embedder } from "../semantic/embedder.js";
import type { BusinessDomain } from "../types.js";

/** Tokenize a name by splitting on camelCase, underscores, hyphens, and spaces. */
function tokenize(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase()
    .split("_")
    .filter((t) => t.length > 1);
}

/** Build a TF-IDF feature vector from table name + column names. */
function buildTfIdfVector(
  tokens: string[],
  vocabulary: Map<string, number>,
  idf: Map<string, number>,
): Float32Array {
  const vec = new Float32Array(vocabulary.size);
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  for (const [term, count] of tf) {
    const idx = vocabulary.get(term);
    if (idx !== undefined) {
      vec[idx] = count * (idf.get(term) ?? 0);
    }
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }
  return vec;
}

/** Cosine similarity between two vectors. */
function cosineSim(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Compute pairwise distance matrix: dist[i][j] = 1 - cosine_similarity. */
function computeDistanceMatrix(vectors: Float32Array[]): number[][] {
  const n = vectors.length;
  const dist: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = 1 - cosineSim(vectors[i], vectors[j]);
      dist[i][j] = d;
      dist[j][i] = d;
    }
  }
  return dist;
}

interface ClusterState {
  /** Which cluster each item belongs to (by cluster label). */
  labels: number[];
  /** Number of active clusters. */
  numClusters: number;
}

/**
 * Run agglomerative clustering with average linkage.
 * Returns the full merge history so we can cut at any k.
 */
function agglomerativeClustering(
  dist: number[][],
  n: number,
): { mergeHistory: Array<{ a: number; b: number; distance: number }> } {
  // Each item starts as its own cluster
  const clusterMembers = new Map<number, number[]>();
  for (let i = 0; i < n; i++) clusterMembers.set(i, [i]);

  // Active cluster IDs
  const active = new Set<number>();
  for (let i = 0; i < n; i++) active.add(i);

  // Inter-cluster distance cache (average linkage)
  const interDist = new Map<string, number>();
  const distKey = (a: number, b: number) => `${Math.min(a, b)}|${Math.max(a, b)}`;

  for (const i of active) {
    for (const j of active) {
      if (i < j) interDist.set(distKey(i, j), dist[i][j]);
    }
  }

  const mergeHistory: Array<{ a: number; b: number; distance: number }> = [];
  let nextClusterId = n;

  while (active.size > 1) {
    // Find closest pair
    let minDist = Infinity;
    let bestA = -1;
    let bestB = -1;
    for (const i of active) {
      for (const j of active) {
        if (i >= j) continue;
        const d = interDist.get(distKey(i, j)) ?? Infinity;
        if (d < minDist) {
          minDist = d;
          bestA = i;
          bestB = j;
        }
      }
    }

    if (bestA === -1) break;

    mergeHistory.push({ a: bestA, b: bestB, distance: minDist });

    // Merge bestB into a new cluster
    const newId = nextClusterId++;
    const membersA = clusterMembers.get(bestA)!;
    const membersB = clusterMembers.get(bestB)!;
    const newMembers = [...membersA, ...membersB];
    clusterMembers.set(newId, newMembers);
    clusterMembers.delete(bestA);
    clusterMembers.delete(bestB);
    active.delete(bestA);
    active.delete(bestB);

    // Compute average linkage distance to all remaining clusters
    for (const other of active) {
      const otherMembers = clusterMembers.get(other)!;
      let sumDist = 0;
      for (const mi of newMembers) {
        for (const mj of otherMembers) {
          sumDist += dist[mi][mj];
        }
      }
      const avgDist = sumDist / (newMembers.length * otherMembers.length);
      interDist.set(distKey(newId, other), avgDist);
    }

    active.add(newId);
  }

  return { mergeHistory };
}

/** Cut the dendrogram at k clusters. Returns cluster labels for each item. */
function cutAtK(mergeHistory: Array<{ a: number; b: number }>, n: number, k: number): number[] {
  // Start: each item is its own cluster
  const parent = new Map<number, number>();
  for (let i = 0; i < n; i++) parent.set(i, i);

  // Union-find
  function find(x: number): number {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  }

  // Apply merges until we have k clusters
  let numClusters = n;
  let nextId = n;
  for (const merge of mergeHistory) {
    if (numClusters <= k) break;
    const rootA = find(merge.a);
    const rootB = find(merge.b);
    if (rootA !== rootB) {
      parent.set(rootA, nextId);
      parent.set(rootB, nextId);
      parent.set(nextId, nextId);
      nextId++;
      numClusters--;
    }
  }

  // Assign labels
  const labels = new Array(n);
  const labelMap = new Map<number, number>();
  let labelCounter = 0;
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!labelMap.has(root)) {
      labelMap.set(root, labelCounter++);
    }
    labels[i] = labelMap.get(root)!;
  }
  return labels;
}

/** Compute silhouette score for a given labeling. */
function silhouetteScore(dist: number[][], labels: number[], k: number): number {
  const n = labels.length;
  if (k <= 1 || k >= n) return -1;

  let totalSil = 0;
  for (let i = 0; i < n; i++) {
    const myCluster = labels[i];

    // a(i) = average distance to same-cluster members
    let sumA = 0;
    let countA = 0;
    for (let j = 0; j < n; j++) {
      if (j !== i && labels[j] === myCluster) {
        sumA += dist[i][j];
        countA++;
      }
    }
    const a = countA > 0 ? sumA / countA : 0;

    // b(i) = min average distance to other clusters
    let minB = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === myCluster) continue;
      let sumB = 0;
      let countB = 0;
      for (let j = 0; j < n; j++) {
        if (labels[j] === c) {
          sumB += dist[i][j];
          countB++;
        }
      }
      if (countB > 0) {
        minB = Math.min(minB, sumB / countB);
      }
    }
    if (minB === Infinity) minB = 0;

    const sil = Math.max(a, minB) === 0 ? 0 : (minB - a) / Math.max(a, minB);
    totalSil += sil;
  }
  return totalSil / n;
}

/** Generate domain name from table+column tokens using TF-IDF top-3 words. */
function generateDomainName(
  domainTableIndices: number[],
  allTokenSets: string[][],
  totalDomains: number,
  allDomainTableIndices: number[][],
): string {
  // Collect tokens for this domain
  const domainTokens: string[] = [];
  for (const idx of domainTableIndices) {
    domainTokens.push(...allTokenSets[idx]);
  }

  // TF: count in this domain
  const tf = new Map<string, number>();
  for (const t of domainTokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }

  // IDF: log(totalDomains / domainsContainingTerm)
  const idf = new Map<string, number>();
  for (const term of tf.keys()) {
    let domainsWithTerm = 0;
    for (const indices of allDomainTableIndices) {
      const domainTokenSet = new Set<string>();
      for (const idx of indices) {
        for (const t of allTokenSets[idx]) domainTokenSet.add(t);
      }
      if (domainTokenSet.has(term)) domainsWithTerm++;
    }
    idf.set(term, Math.log((totalDomains + 1) / (domainsWithTerm + 1)));
  }

  // Score = TF * IDF
  const scored = Array.from(tf.entries()).map(([term, count]) => ({
    term,
    score: count * (idf.get(term) ?? 0),
  }));
  scored.sort((a, b) => b.score - a.score);

  const topTerms = scored.slice(0, 3).map((s) => s.term);
  return topTerms.length > 0 ? topTerms.join("_") : "default";
}

/**
 * Discover business domains by clustering tables.
 * Uses embeddings if available, otherwise falls back to TF-IDF on table/column names.
 */
export async function discoverBusinessDomains(
  catalog: CatalogStore,
  embedder?: Embedder | null,
): Promise<BusinessDomain[]> {
  const allTables = catalog.getTables();
  if (allTables.length === 0) return [];

  const n = allTables.length;

  // Collect tokens for each table (for domain naming and TF-IDF fallback)
  const allTokenSets: string[][] = allTables.map((t) => {
    const cols = catalog.getColumns(t.source_id, t.table_name);
    const tokens = [
      ...tokenize(t.table_name),
      ...cols.flatMap((c) => tokenize(c.column_name)),
    ];
    return tokens;
  });

  // Build feature vectors
  let vectors: Float32Array[];

  // Try embeddings first
  let useEmbeddings = false;
  if (embedder && embedder.isReady()) {
    const embVectors: (Float32Array | null)[] = allTables.map((t) => {
      const emb = catalog.getEmbedding(t.source_id, t.table_name);
      return emb ? emb.vector : null;
    });
    if (embVectors.every((v) => v !== null)) {
      vectors = embVectors as Float32Array[];
      useEmbeddings = true;
    }
  }

  if (!useEmbeddings) {
    // Fallback: TF-IDF vectors from table+column names
    const allTokens = new Set<string>();
    for (const ts of allTokenSets) {
      for (const t of ts) allTokens.add(t);
    }
    const vocabulary = new Map<string, number>();
    let idx = 0;
    for (const t of allTokens) vocabulary.set(t, idx++);

    // Compute document frequency
    const df = new Map<string, number>();
    for (const ts of allTokenSets) {
      const unique = new Set(ts);
      for (const t of unique) {
        df.set(t, (df.get(t) ?? 0) + 1);
      }
    }

    // IDF
    const idf = new Map<string, number>();
    for (const [term, count] of df) {
      idf.set(term, Math.log((n + 1) / (count + 1)));
    }

    vectors = allTokenSets.map((ts) => buildTfIdfVector(ts, vocabulary, idf));
  }

  // Single domain fallback for < 5 tables
  if (n < 5) {
    return [makeSingleDomain(allTables, allTokenSets)];
  }

  // Compute distance matrix
  const dist = computeDistanceMatrix(vectors!);

  // Agglomerative clustering
  const { mergeHistory } = agglomerativeClustering(dist, n);

  // Find optimal k via silhouette score
  const maxK = Math.min(Math.floor(n / 2), 20);
  let bestK = 1;
  let bestSil = -1;

  for (let k = 2; k <= maxK; k++) {
    const labels = cutAtK(mergeHistory, n, k);
    const sil = silhouetteScore(dist, labels, k);
    if (sil > bestSil) {
      bestSil = sil;
      bestK = k;
    }
  }

  // If silhouette is too low, fallback to single domain
  if (bestSil < 0.25) {
    return [makeSingleDomain(allTables, allTokenSets)];
  }

  // Cut at best k
  const labels = cutAtK(mergeHistory, n, bestK);

  // Group tables by cluster
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (!clusters.has(labels[i])) clusters.set(labels[i], []);
    clusters.get(labels[i])!.push(i);
  }

  const allDomainTableIndices = Array.from(clusters.values());

  // Build domains
  const domains: BusinessDomain[] = [];
  for (const [_label, indices] of clusters) {
    const tableNames = indices.map((i) => allTables[i].table_name);
    const domainName = generateDomainName(indices, allTokenSets, bestK, allDomainTableIndices);

    // Keywords: top tokens from domain
    const domainTokens: string[] = [];
    for (const i of indices) domainTokens.push(...allTokenSets[i]);
    const freq = new Map<string, number>();
    for (const t of domainTokens) freq.set(t, (freq.get(t) ?? 0) + 1);
    const keywords = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t);

    const domainId = crypto
      .createHash("sha256")
      .update(tableNames.sort().join("|"))
      .digest("hex")
      .slice(0, 16);

    domains.push({
      domainId,
      domainName,
      tableNames,
      keywords,
      createdAt: Date.now(),
      version: 1,
    });
  }

  return domains;
}

/** Create a single "default" domain containing all tables. */
function makeSingleDomain(
  allTables: Array<{ table_name: string; source_id: string }>,
  allTokenSets: string[][],
): BusinessDomain {
  const tableNames = allTables.map((t) => t.table_name);

  // Top keywords across all tables
  const allTokens: string[] = [];
  for (const ts of allTokenSets) allTokens.push(...ts);
  const freq = new Map<string, number>();
  for (const t of allTokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  const keywords = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t);

  const domainId = crypto
    .createHash("sha256")
    .update(tableNames.sort().join("|"))
    .digest("hex")
    .slice(0, 16);

  return {
    domainId,
    domainName: keywords.slice(0, 3).join("_") || "default",
    tableNames,
    keywords,
    createdAt: Date.now(),
    version: 1,
  };
}
