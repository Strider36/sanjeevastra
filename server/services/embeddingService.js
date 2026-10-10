const { GoogleGenAI } = require('@google/genai');

const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';
const DEFAULT_DIMENSIONS = 768;
const DEFAULT_BATCH_SIZE = 20;

const EXPECTED_DIMENSIONS = {
  'gemini-embedding-001': 768,
  'gemini-embedding-2': 3072,
  'text-embedding-004': 768,
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536
};

let mockEmbeddingGenerator = null;
let mockClientOverride = null;

function setMockEmbeddingGenerator(mockFn) {
  mockEmbeddingGenerator = mockFn;
}

function clearMockEmbeddingGenerator() {
  mockEmbeddingGenerator = null;
}

function setMockClient(client) {
  mockClientOverride = client;
}

function clearMockClient() {
  mockClientOverride = null;
}

/**
 * Returns an initialized GoogleGenAI client or throws a 503 configuration error.
 * @param {string} [customApiKey]
 * @returns {GoogleGenAI}
 */
function getClient(customApiKey) {
  if (mockClientOverride) {
    return mockClientOverride;
  }

  const apiKey = (customApiKey || process.env.GEMINI_API_KEY || '').trim();

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    const error = new Error('Embedding generation unavailable: GEMINI_API_KEY is not configured on the server.');
    error.code = 'CONFIG_MISSING';
    error.statusCode = 503;
    error.userMessage = 'Embedding generation is unavailable: GEMINI_API_KEY is missing in environment variables.';
    throw error;
  }

  return new GoogleGenAI({ apiKey });
}

/**
 * Sleeps for the specified number of milliseconds.
 *
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Validates that an embedding is an array of finite floating point numbers.
 *
 * @param {Array<number>} embedding
 * @param {number} [expectedDim]
 */
function validateEmbedding(embedding, expectedDim) {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Invalid embedding: returned embedding is not a non-empty array.');
  }

  if (expectedDim && embedding.length !== expectedDim) {
    throw new Error(`Embedding dimension mismatch: expected ${expectedDim}, got ${embedding.length}.`);
  }

  for (let i = 0; i < embedding.length; i++) {
    const val = embedding[i];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new Error(`Invalid numeric value in embedding at index ${i}: ${val}`);
    }
  }

  return true;
}

/**
 * Generates vector embeddings using Google Gemini (@google/genai).
 *
 * @param {Array<string>} texts Array of string texts to embed
 * @param {Object} [options]
 * @param {string} [options.model] Embedding model name
 * @param {number} [options.dimensions] Target embedding dimensionality
 * @param {number} [options.batchSize] Batch size
 * @param {number} [options.maxRetries=3] Maximum retries per batch
 * @param {number} [options.initialDelayMs=1000] Initial retry delay in ms
 * @param {Object} [options.clientOverride] Optional client override
 * @returns {Promise<{ embeddings: Array<Array<number>>, model: string, dimensions: number }>}
 */
async function generateEmbeddings(texts, options = {}) {
  if (!Array.isArray(texts) || texts.length === 0) {
    const fallbackModel = options.model || process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
    return { embeddings: [], model: fallbackModel, dimensions: 0 };
  }

  if (mockEmbeddingGenerator) {
    return await mockEmbeddingGenerator(texts, options);
  }

  // Validate non-empty text content
  for (let idx = 0; idx < texts.length; idx++) {
    const item = texts[idx];
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`Cannot generate embedding for empty or non-string text at index ${idx}.`);
    }
  }

  const model = options.model || process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  const targetDim = options.dimensions ||
    (process.env.EMBEDDING_DIMENSIONS ? parseInt(process.env.EMBEDDING_DIMENSIONS, 10) : (EXPECTED_DIMENSIONS[model] || DEFAULT_DIMENSIONS));

  const batchSize = options.batchSize ||
    parseInt(process.env.EMBEDDING_BATCH_SIZE || `${DEFAULT_BATCH_SIZE}`, 10);

  const maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : 3;
  const initialDelayMs = options.initialDelayMs || 1000;

  const client = options.clientOverride || getClient();
  const allEmbeddings = new Array(texts.length);

  for (let startIdx = 0; startIdx < texts.length; startIdx += batchSize) {
    const batchTexts = texts.slice(startIdx, startIdx + batchSize);
    let attempt = 0;
    let batchSuccess = false;
    let lastError = null;

    while (attempt <= maxRetries && !batchSuccess) {
      try {
        let response;
        if (client.models?.embedContent) {
          const config = {};
          if (targetDim && (model.startsWith('gemini-') || model.startsWith('text-embedding-004'))) {
            config.outputDimensionality = targetDim;
          }

          response = await client.models.embedContent({
            model,
            contents: batchTexts,
            config: Object.keys(config).length > 0 ? config : undefined
          });
        } else if (client.embeddings?.create) {
          response = await client.embeddings.create({
            model,
            input: batchTexts
          });
        } else {
          throw new Error('Configured client does not support embedContent or embeddings.create');
        }

        if (response?.data) {
          const sorted = [...response.data].sort((a, b) => a.index - b.index);
          for (let i = 0; i < sorted.length; i++) {
            const raw = sorted[i].embedding;
            validateEmbedding(raw, targetDim);
            allEmbeddings[startIdx + i] = raw;
          }
        } else {
          const embList = response?.embeddings || [];
          if (!Array.isArray(embList) || embList.length !== batchTexts.length) {
            throw new Error(`Provider returned incomplete embedding batch: expected ${batchTexts.length}, got ${embList.length}`);
          }
          for (let i = 0; i < embList.length; i++) {
            const rawValues = embList[i]?.values;
            validateEmbedding(rawValues, targetDim);
            allEmbeddings[startIdx + i] = rawValues;
          }
        }

        batchSuccess = true;
      } catch (err) {
        lastError = err;
        attempt++;

        // Upstream rate limit or transient error
        const isRateLimit = err.status === 429 || err.message?.includes('RESOURCE_EXHAUSTED');
        const isTransient = isRateLimit || (err.status && err.status >= 500) || err.code === 'ETIMEDOUT';

        if (isTransient && attempt <= maxRetries) {
          const delayMs = Math.pow(2, attempt - 1) * initialDelayMs;
          await sleep(delayMs);
        } else {
          break;
        }
      }
    }

    if (!batchSuccess) {
      throw new Error(`Embedding generation failed for batch at offset ${startIdx}: ${lastError?.message || 'Unknown provider error'}`);
    }
  }

  const dimensions = allEmbeddings[0] ? allEmbeddings[0].length : (targetDim || 0);

  return {
    embeddings: allEmbeddings,
    model,
    dimensions
  };
}

module.exports = {
  generateEmbeddings,
  validateEmbedding,
  getClient,
  setMockEmbeddingGenerator,
  clearMockEmbeddingGenerator,
  setMockClient,
  clearMockClient,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_DIMENSIONS,
  EXPECTED_DIMENSIONS
};
