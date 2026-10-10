const mongoose = require('mongoose');
const embeddingService = require('./embeddingService');
const KnowledgeChunk = require('../models/KnowledgeChunk');

const DEFAULT_TOP_K = 5;
const DEFAULT_CANDIDATES = 100;
const DEFAULT_VECTOR_INDEX = 'medical_chunks_vector_index';
const MAX_QUERY_LENGTH = 2000;

let mockVectorSearchHandler = null;

function setMockVectorSearch(handler) {
  mockVectorSearchHandler = handler;
}

function clearMockVectorSearch() {
  mockVectorSearchHandler = null;
}

function computeCosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || !Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Validates the user's query string.
 *
 * @param {string} query
 * @returns {string} Cleaned query string
 */
function validateQuery(query) {
  if (typeof query !== 'string') {
    const err = new Error('Query must be a string.');
    err.statusCode = 400;
    throw err;
  }

  const trimmed = query.trim();
  if (trimmed.length < 2) {
    const err = new Error('Query is too short. Please provide a descriptive medical question.');
    err.statusCode = 400;
    throw err;
  }

  if (trimmed.length > MAX_QUERY_LENGTH) {
    const err = new Error(`Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters.`);
    err.statusCode = 400;
    throw err;
  }

  return trimmed;
}

/**
 * Validates and sanitizes optional metadata filters against an allowlist.
 *
 * @param {Object} rawFilters
 * @returns {Object} Cleaned filter dictionary
 */
function sanitizeFilters(rawFilters = {}) {
  const allowed = {};

  if (!rawFilters || typeof rawFilters !== 'object') {
    return allowed;
  }

  // Allowed fields: topic, language, publisher, documentId
  if (typeof rawFilters.topic === 'string' && rawFilters.topic.trim()) {
    allowed['metadata.topic'] = rawFilters.topic.trim();
  }

  if (typeof rawFilters.language === 'string' && rawFilters.language.trim()) {
    allowed['metadata.language'] = rawFilters.language.trim().toLowerCase();
  }

  if (typeof rawFilters.publisher === 'string' && rawFilters.publisher.trim()) {
    allowed['metadata.publisher'] = rawFilters.publisher.trim();
  }

  if (typeof rawFilters.documentId === 'string' && rawFilters.documentId.trim()) {
    allowed.documentId = rawFilters.documentId.trim();
  }

  return allowed;
}

/**
 * Computes Jaccard character-ngram similarity to detect overlapping passages from the same document.
 *
 * @param {string} strA
 * @param {string} strB
 * @returns {number} Similarity ratio between 0.0 and 1.0
 */
function computePassageOverlap(strA, strB) {
  if (!strA || !strB) return 0;
  if (strA === strB) return 1.0;

  // Substring containment check
  if (strA.includes(strB) || strB.includes(strA)) {
    const minLen = Math.min(strA.length, strB.length);
    const maxLen = Math.max(strA.length, strB.length);
    return minLen / maxLen;
  }

  // Word set overlap
  const wordsA = new Set(strA.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(strB.toLowerCase().split(/\s+/).filter(w => w.length > 3));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

/**
 * Deduplicates retrieved chunks by eliminating duplicate chunk IDs and suppressing
 * near-identical overlapping chunks from the same document.
 *
 * @param {Array<Object>} candidates
 * @param {number} topK
 * @returns {Array<Object>} Deduplicated, ranked results
 */
function deduplicateResults(candidates, topK) {
  const seenChunkIds = new Set();
  const selected = [];

  for (const candidate of candidates) {
    if (!candidate || !candidate.chunkId) continue;

    // Strict chunk ID deduplication
    if (seenChunkIds.has(candidate.chunkId)) {
      continue;
    }

    // Check for high overlap with already selected chunks from the SAME document
    let hasHighOverlap = false;
    for (const prior of selected) {
      if (prior.documentId === candidate.documentId) {
        const overlap = computePassageOverlap(prior.text, candidate.text);
        if (overlap > 0.5) {
          hasHighOverlap = true;
          break;
        }
      }
    }

    if (!hasHighOverlap) {
      seenChunkIds.add(candidate.chunkId);
      selected.push(candidate);
    }

    if (selected.length >= topK) {
      break;
    }
  }

  return selected;
}

/**
 * Executes vector search against the stored medical knowledge base.
 *
 * @param {string} question User question / symptom query
 * @param {Object} [options]
 * @param {number} [options.topK=5] Final number of results to return
 * @param {number} [options.numCandidates=100] Number of candidates to evaluate in vector search
 * @param {string} [options.topic] Optional topic filter
 * @param {string} [options.language] Optional language filter
 * @param {string} [options.publisher] Optional publisher filter
 * @param {string} [options.documentId] Optional documentId filter
 * @param {number} [options.minScore] Optional minimum similarity score threshold
 * @param {string} [options.vectorIndexName] MongoDB Atlas vector index name
 * @returns {Promise<Object>} Formatted retrieval result
 */
async function retrieveMedicalContext(question, options = {}) {
  const query = validateQuery(question);

  const topK = Math.min(20, Math.max(1, parseInt(options.topK || process.env.MEDICAL_RETRIEVAL_TOP_K || `${DEFAULT_TOP_K}`, 10)));
  const numCandidates = Math.max(topK * 2, parseInt(options.numCandidates || process.env.MEDICAL_RETRIEVAL_CANDIDATES || `${DEFAULT_CANDIDATES}`, 10));
  const vectorIndexName = options.vectorIndexName || process.env.MEDICAL_VECTOR_INDEX_NAME || DEFAULT_VECTOR_INDEX;
  const minScore = typeof options.minScore === 'number'
    ? options.minScore
    : (process.env.MEDICAL_RETRIEVAL_MIN_SCORE ? parseFloat(process.env.MEDICAL_RETRIEVAL_MIN_SCORE) : null);

  // 1. Generate query embedding using the configured model
  const embeddingResult = await embeddingService.generateEmbeddings([query]);
  const queryEmbedding = embeddingResult.embeddings[0];

  if (!queryEmbedding || !Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
    const err = new Error('Failed to generate query vector embedding.');
    err.statusCode = 502;
    throw err;
  }

  embeddingService.validateEmbedding(queryEmbedding, embeddingResult.dimensions || 768);

  // 2. Build metadata filter allowlist
  // CRITICAL MEDICAL SAFETY: strictly enforce reviewStatus === 'approved'
  const filterConditions = {
    'metadata.reviewStatus': 'approved',
    ...sanitizeFilters(options)
  };

  // 3. Execute Vector Search (Mock or MongoDB Atlas Vector Search)
  let rawCandidates = [];

  if (mockVectorSearchHandler) {
    rawCandidates = await mockVectorSearchHandler({
      query,
      queryEmbedding,
      filterConditions,
      numCandidates,
      topK,
      vectorIndexName
    });
  } else {
    // Atlas Vector Search aggregation pipeline
    // Build Atlas filter stage
    const atlasFilter = {
      'metadata.reviewStatus': { $eq: 'approved' }
    };

    if (filterConditions['metadata.topic']) {
      atlasFilter['metadata.topic'] = { $eq: filterConditions['metadata.topic'] };
    }
    if (filterConditions['metadata.language']) {
      atlasFilter['metadata.language'] = { $eq: filterConditions['metadata.language'] };
    }
    if (filterConditions['metadata.publisher']) {
      atlasFilter['metadata.publisher'] = { $eq: filterConditions['metadata.publisher'] };
    }
    if (filterConditions.documentId) {
      atlasFilter.documentId = { $eq: filterConditions.documentId };
    }

    const pipeline = [
      {
        $vectorSearch: {
          index: vectorIndexName,
          path: process.env.MEDICAL_VECTOR_FIELD || 'embedding',
          queryVector: queryEmbedding,
          numCandidates,
          limit: Math.max(numCandidates, topK * 4),
          filter: atlasFilter
        }
      },
      {
        $project: {
          chunkId: 1,
          documentId: 1,
          text: 1,
          sectionHeading: 1,
          estimatedTokens: 1,
          metadata: 1,
          score: { $meta: 'vectorSearchScore' }
        }
      }
    ];

    try {
      rawCandidates = await KnowledgeChunk.aggregate(pipeline);
    } catch (dbErr) {
      // Graceful error mapping for local vs Atlas environments
      const isMissingAtlasStage = dbErr.message.includes('$vectorSearch') ||
        dbErr.message.includes('Arguments must be aggregate pipeline operators') ||
        dbErr.code === 40324;

      const isIndexMissing = dbErr.message.includes('index') && dbErr.message.includes('not found');

      if (isMissingAtlasStage) {
        if (!options.allowLocalFallback && process.env.ENABLE_LOCAL_VECTOR_FALLBACK !== 'true') {
          const error = new Error(
            'Atlas Vector Search is not supported on this MongoDB deployment. ' +
            'A MongoDB Atlas cluster with an active Search Index is required.'
          );
          error.code = 'ATLAS_VECTOR_SEARCH_UNSUPPORTED';
          error.statusCode = 501;
          throw error;
        }

        // Fallback: Compute in-memory cosine similarity over approved knowledge chunks
        const filter = {
          'metadata.reviewStatus': 'approved',
          embedding: { $exists: true, $ne: [] }
        };
        if (filterConditions['metadata.topic']) {
          filter['metadata.topic'] = filterConditions['metadata.topic'];
        }
        if (filterConditions['metadata.language']) {
          filter['metadata.language'] = filterConditions['metadata.language'];
        }
        if (filterConditions['metadata.publisher']) {
          filter['metadata.publisher'] = filterConditions['metadata.publisher'];
        }
        if (filterConditions.documentId) {
          filter.documentId = filterConditions.documentId;
        }

        const storedChunks = await KnowledgeChunk.find(filter).lean();
        rawCandidates = storedChunks.map(chunk => ({
          chunkId: chunk.chunkId,
          documentId: chunk.documentId,
          text: chunk.text,
          sectionHeading: chunk.sectionHeading,
          estimatedTokens: chunk.estimatedTokens,
          metadata: chunk.metadata,
          score: computeCosineSimilarity(queryEmbedding, chunk.embedding)
        })).sort((a, b) => b.score - a.score).slice(0, Math.max(numCandidates, topK * 4));
      } else if (isIndexMissing) {
        const error = new Error(
          `Vector search index '${vectorIndexName}' was not found on the collection. ` +
          `Please configure the Atlas Search index.`
        );
        error.code = 'VECTOR_INDEX_MISSING';
        error.statusCode = 503;
        throw error;
      } else {
        throw dbErr;
      }
    }
  }

  // 4. Quality filtering, score normalization & deduplication
  const validCandidates = (rawCandidates || [])
    .filter(c => {
      // Enforce approved reviewStatus
      const reviewStatus = c.metadata?.reviewStatus || 'pending';
      if (reviewStatus !== 'approved') return false;

      // Apply score threshold if configured
      if (minScore !== null && typeof c.score === 'number' && c.score < minScore) {
        return false;
      }

      return true;
    })
    .map(c => ({
      chunkId: c.chunkId,
      documentId: c.documentId,
      text: c.text,
      score: typeof c.score === 'number' ? parseFloat(c.score.toFixed(4)) : 1.0,
      metadata: {
        title: c.metadata?.title || 'Unknown Title',
        publisher: c.metadata?.publisher || 'Unknown',
        sourceUrl: c.metadata?.sourceUrl || null,
        language: c.metadata?.language || 'en',
        topic: c.metadata?.topic || 'general_medicine',
        sectionHeading: c.sectionHeading || c.metadata?.sectionHeading || null,
        publicationDate: c.metadata?.publicationDate || null,
        reviewStatus: c.metadata?.reviewStatus || 'approved'
      }
    }));

  // 5. Rank and deduplicate
  // Sort descending by similarity score
  validCandidates.sort((a, b) => b.score - a.score);

  const deduplicated = deduplicateResults(validCandidates, topK);

  const retrievalStatus = deduplicated.length > 0 ? 'results_found' : 'no_results';

  return {
    query,
    results: deduplicated,
    count: deduplicated.length,
    retrievalStatus,
    embeddingModel: embeddingResult.model,
    scoreMetric: 'cosine'
  };
}

module.exports = {
  retrieveMedicalContext,
  validateQuery,
  sanitizeFilters,
  computePassageOverlap,
  deduplicateResults,
  setMockVectorSearch,
  clearMockVectorSearch,
  DEFAULT_TOP_K,
  DEFAULT_CANDIDATES,
  DEFAULT_VECTOR_INDEX
};
