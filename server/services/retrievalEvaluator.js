/**
 * ========================================================
 * 🩺 Sanjeev Astra: Retrieval Quality Evaluator
 * ========================================================
 *
 * Computes IR metrics for vector retrieval against gold-standard labels:
 * - Recall@K (K=1, 3, 5)
 * - Precision@K (K=1, 3, 5)
 * - Mean Reciprocal Rank (MRR)
 * - Normalized Discounted Cumulative Gain (nDCG@K)
 * - Retrieval Latency (Mean, Median, P95, Min, Max)
 * - Empty-result & unapproved source handling
 */

/**
 * Computes Recall at rank K.
 *
 * @param {Array<string>} retrievedIds
 * @param {Array<string>} relevantIds
 * @param {number} k
 * @returns {number}
 */
function computeRecallAtK(retrievedIds, relevantIds, k) {
  if (!Array.isArray(relevantIds) || relevantIds.length === 0) {
    return retrievedIds.length === 0 ? 1.0 : 1.0;
  }
  const topK = retrievedIds.slice(0, k);
  const relevantSet = new Set(relevantIds);
  let hits = 0;
  for (const id of topK) {
    if (relevantSet.has(id)) {
      hits++;
    }
  }
  return hits / relevantIds.length;
}

/**
 * Computes Precision at rank K.
 *
 * @param {Array<string>} retrievedIds
 * @param {Array<string>} relevantIds
 * @param {number} k
 * @returns {number}
 */
function computePrecisionAtK(retrievedIds, relevantIds, k) {
  if (k <= 0) return 0.0;
  if (!Array.isArray(relevantIds) || relevantIds.length === 0) {
    return retrievedIds.length === 0 ? 1.0 : 0.0;
  }
  const topK = retrievedIds.slice(0, k);
  const relevantSet = new Set(relevantIds);
  let hits = 0;
  for (const id of topK) {
    if (relevantSet.has(id)) {
      hits++;
    }
  }
  return hits / Math.min(k, Math.max(1, topK.length));
}

/**
 * Computes Reciprocal Rank (RR).
 *
 * @param {Array<string>} retrievedIds
 * @param {Array<string>} relevantIds
 * @returns {number}
 */
function computeReciprocalRank(retrievedIds, relevantIds) {
  if (!Array.isArray(relevantIds) || relevantIds.length === 0) {
    return retrievedIds.length === 0 ? 1.0 : 1.0;
  }
  const relevantSet = new Set(relevantIds);
  for (let i = 0; i < retrievedIds.length; i++) {
    if (relevantSet.has(retrievedIds[i])) {
      return 1.0 / (i + 1);
    }
  }
  return 0.0;
}

/**
 * Computes DCG at rank K.
 *
 * @param {Array<string>} retrievedIds
 * @param {Object} gradedRelevance Map of docId -> grade (e.g. 2, 1, 0)
 * @param {number} k
 * @returns {number}
 */
function computeDCG(retrievedIds, gradedRelevance = {}, k = 5) {
  const topK = retrievedIds.slice(0, k);
  let dcg = 0.0;
  for (let i = 0; i < topK.length; i++) {
    const id = topK[i];
    const rel = gradedRelevance[id] || 0;
    const numerator = Math.pow(2, rel) - 1;
    const denominator = Math.log2(i + 2); // i=0 -> log2(2) = 1
    dcg += numerator / denominator;
  }
  return dcg;
}

/**
 * Computes nDCG at rank K.
 *
 * @param {Array<string>} retrievedIds
 * @param {Object} gradedRelevance
 * @param {number} k
 * @returns {number}
 */
function computeNDCGAtK(retrievedIds, gradedRelevance = {}, k = 5) {
  const idealGrades = Object.values(gradedRelevance)
    .filter(g => g > 0)
    .sort((a, b) => b - a)
    .slice(0, k);

  if (idealGrades.length === 0) {
    return retrievedIds.length === 0 ? 1.0 : 1.0;
  }

  let idcg = 0.0;
  for (let i = 0; i < idealGrades.length; i++) {
    const rel = idealGrades[i];
    const numerator = Math.pow(2, rel) - 1;
    const denominator = Math.log2(i + 2);
    idcg += numerator / denominator;
  }

  if (idcg === 0.0) return 1.0;

  const dcg = computeDCG(retrievedIds, gradedRelevance, k);
  return Math.min(1.0, dcg / idcg);
}

/**
 * Calculates percentile from an array of numbers.
 *
 * @param {Array<number>} arr
 * @param {number} p (0 to 100)
 * @returns {number}
 */
function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Evaluates a single retrieval result against its gold evaluation case.
 *
 * @param {Object} testCase
 * @param {Object} retrievalOutput
 * @param {number} latencyMs
 * @returns {Object}
 */
function evaluateSingleRetrieval(testCase, retrievalOutput, latencyMs = 0) {
  const results = retrievalOutput.results || [];
  const retrievedDocIds = results.map(r => r.documentId);
  const retrievedChunkIds = results.map(r => r.chunkId);
  const expectedDocIds = testCase.expectedRelevantDocuments || [];
  const gradedRelevance = testCase.gradedRelevance || {};

  const recall1 = computeRecallAtK(retrievedDocIds, expectedDocIds, 1);
  const recall3 = computeRecallAtK(retrievedDocIds, expectedDocIds, 3);
  const recall5 = computeRecallAtK(retrievedDocIds, expectedDocIds, 5);

  const precision1 = computePrecisionAtK(retrievedDocIds, expectedDocIds, 1);
  const precision3 = computePrecisionAtK(retrievedDocIds, expectedDocIds, 3);
  const precision5 = computePrecisionAtK(retrievedDocIds, expectedDocIds, 5);

  const mrr = computeReciprocalRank(retrievedDocIds, expectedDocIds);
  const ndcg3 = computeNDCGAtK(retrievedDocIds, gradedRelevance, 3);
  const ndcg5 = computeNDCGAtK(retrievedDocIds, gradedRelevance, 5);

  const isExpectEmpty = expectedDocIds.length === 0;
  const isActualEmpty = results.length === 0;
  const emptyHandlingCorrect = isExpectEmpty ? isActualEmpty : !isActualEmpty;

  // Check that no unapproved chunks were returned
  const hasUnapprovedChunks = results.some(r => r.metadata?.reviewStatus !== 'approved');

  return {
    caseId: testCase.id,
    category: testCase.category,
    query: testCase.query,
    retrievedCount: results.length,
    retrievedDocIds,
    retrievedChunkIds,
    expectedDocIds,
    latencyMs,
    metrics: {
      recallAt1: parseFloat(recall1.toFixed(4)),
      recallAt3: parseFloat(recall3.toFixed(4)),
      recallAt5: parseFloat(recall5.toFixed(4)),
      precisionAt1: parseFloat(precision1.toFixed(4)),
      precisionAt3: parseFloat(precision3.toFixed(4)),
      precisionAt5: parseFloat(precision5.toFixed(4)),
      mrr: parseFloat(mrr.toFixed(4)),
      ndcgAt3: parseFloat(ndcg3.toFixed(4)),
      ndcgAt5: parseFloat(ndcg5.toFixed(4))
    },
    emptyHandlingCorrect,
    hasUnapprovedChunks,
    passed: (expectedDocIds.length === 0 ? isActualEmpty : recall3 > 0) && !hasUnapprovedChunks
  };
}

/**
 * Aggregates retrieval evaluations into overall and per-category reports.
 *
 * @param {Array<Object>} evaluations
 * @returns {Object}
 */
function aggregateRetrievalMetrics(evaluations) {
  const n = evaluations.length;
  if (n === 0) {
    return { overall: {}, categories: {}, latencies: {} };
  }

  const latencies = evaluations.map(e => e.latencyMs);
  const avg = (arr) => arr.reduce((sum, v) => sum + v, 0) / arr.length;

  const overall = {
    totalQueries: n,
    meanRecallAt1: parseFloat(avg(evaluations.map(e => e.metrics.recallAt1)).toFixed(4)),
    meanRecallAt3: parseFloat(avg(evaluations.map(e => e.metrics.recallAt3)).toFixed(4)),
    meanRecallAt5: parseFloat(avg(evaluations.map(e => e.metrics.recallAt5)).toFixed(4)),
    meanPrecisionAt1: parseFloat(avg(evaluations.map(e => e.metrics.precisionAt1)).toFixed(4)),
    meanPrecisionAt3: parseFloat(avg(evaluations.map(e => e.metrics.precisionAt3)).toFixed(4)),
    meanPrecisionAt5: parseFloat(avg(evaluations.map(e => e.metrics.precisionAt5)).toFixed(4)),
    meanMRR: parseFloat(avg(evaluations.map(e => e.metrics.mrr)).toFixed(4)),
    meanNDCGAt3: parseFloat(avg(evaluations.map(e => e.metrics.ndcgAt3)).toFixed(4)),
    meanNDCGAt5: parseFloat(avg(evaluations.map(e => e.metrics.ndcgAt5)).toFixed(4)),
    emptyHandlingAccuracy: parseFloat((evaluations.filter(e => e.emptyHandlingCorrect).length / n).toFixed(4)),
    unapprovedChunksSuppression: parseFloat((evaluations.filter(e => !e.hasUnapprovedChunks).length / n).toFixed(4))
  };

  const latencyStats = {
    minMs: Math.min(...latencies),
    maxMs: Math.max(...latencies),
    meanMs: parseFloat(avg(latencies).toFixed(2)),
    medianMs: parseFloat(percentile(latencies, 50).toFixed(2)),
    p95Ms: parseFloat(percentile(latencies, 95).toFixed(2))
  };

  // Group by category
  const categories = {};
  const catGroups = new Map();
  for (const ev of evaluations) {
    if (!catGroups.has(ev.category)) {
      catGroups.set(ev.category, []);
    }
    catGroups.get(ev.category).push(ev);
  }

  for (const [cat, items] of catGroups.entries()) {
    categories[cat] = {
      count: items.length,
      meanRecallAt3: parseFloat(avg(items.map(e => e.metrics.recallAt3)).toFixed(4)),
      meanPrecisionAt3: parseFloat(avg(items.map(e => e.metrics.precisionAt3)).toFixed(4)),
      meanMRR: parseFloat(avg(items.map(e => e.metrics.mrr)).toFixed(4)),
      meanNDCGAt3: parseFloat(avg(items.map(e => e.metrics.ndcgAt3)).toFixed(4)),
      passed: items.filter(e => e.passed).length,
      passRate: parseFloat((items.filter(e => e.passed).length / items.length).toFixed(4))
    };
  }

  return {
    overall,
    latencyStats,
    categories,
    evaluations
  };
}

module.exports = {
  computeRecallAtK,
  computePrecisionAtK,
  computeReciprocalRank,
  computeDCG,
  computeNDCGAtK,
  percentile,
  evaluateSingleRetrieval,
  aggregateRetrievalMetrics
};
