const assert = require('assert');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

const ragService = require('../server/services/ragService');
const geminiService = require('../server/services/geminiService');
const retrievalService = require('../server/services/retrievalService');
const embeddingService = require('../server/services/embeddingService');
const ragRoutes = require('../server/routes/ragRoutes');

const JWT_SECRET = process.env.JWT_SECRET || 'swasthyasetu_super_secret_key_2026_jwt';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/rag', ragRoutes);

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

async function makeRequest(port, path, options = {}) {
  const url = `http://127.0.0.1:${port}${path}`;
  const headers = options.headers || {};
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

// Medical passages from knowledge-base manifest
const FEVER_DEFINITION_CHUNK = {
  chunkId: 'doc_who_fever_chunk_0',
  documentId: 'doc_who_fever_management_2026',
  text: 'Fever is defined as core body temperature exceeding 38.0 degrees Celsius (100.4 Fahrenheit).',
  score: 0.94,
  metadata: {
    title: 'Community Health Worker Fever Evaluation and Home Monitoring Protocol',
    publisher: 'World Health Organization (Sample Reference)',
    sourceUrl: 'https://who.int/publications/fever-evaluation-protocol-sample',
    sectionHeading: 'Fever Definition',
    reviewStatus: 'approved'
  }
};

const FEVER_DANGER_SIGNS_CHUNK = {
  chunkId: 'doc_who_fever_chunk_1',
  documentId: 'doc_who_fever_management_2026',
  text: 'Danger signs requiring urgent hospital evaluation include temperature exceeding 40.0 C, petechial purpuric rash, altered mental state, or respiratory distress. Never give aspirin to children due to Reye syndrome.',
  score: 0.88,
  metadata: {
    title: 'Community Health Worker Fever Evaluation and Home Monitoring Protocol',
    publisher: 'World Health Organization (Sample Reference)',
    sourceUrl: 'https://who.int/publications/fever-evaluation-protocol-sample',
    sectionHeading: 'Danger Signs & Red Flags',
    reviewStatus: 'approved'
  }
};

const HEADACHE_SUPPORTIVE_CHUNK = {
  chunkId: 'doc_nhm_headache_chunk_0',
  documentId: 'doc_nhm_headache_triage_2026',
  text: 'Supportive home care for benign tension headaches includes oral fluid rehydration and resting in a quiet, dark environment.',
  score: 0.85,
  metadata: {
    title: 'Clinical Triage and Care Navigation Guidelines for Acute Headaches',
    publisher: 'National Health Mission / Ministry of Health (Sample Reference)',
    sourceUrl: 'https://mohfw.gov.in/guidelines/headache-navigation-sample',
    sectionHeading: 'Supportive Care',
    reviewStatus: 'approved'
  }
};

async function main() {
  console.log('\n========================================================');
  console.log('🧪 Sanjeev Astra: Comprehensive RAG Retrieval Test Suite');
  console.log('========================================================\n');

  const mongoose = require('mongoose');
  const User = require('../server/models/User');

  let dbConnected = false;
  let testUserId = null;
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/swasthyasetu');
    dbConnected = true;
    const existingUser = await User.findOne({});
    if (existingUser) {
      testUserId = existingUser._id.toString();
    }
  } catch (e) {
    console.log('DB connection notice in tests:', e.message);
  }

  const { server, port } = await startServer();
  const testToken = testUserId ? jwt.sign({ id: testUserId }, JWT_SECRET, { expiresIn: '1h' }) : null;
  const authHeaders = testToken ? { Authorization: `Bearer ${testToken}` } : {};

  const prevProvider = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = 'gemini';

  try {
    // -------------------------------------------------------------------------
    // CASE 1: Question directly answered by an ingested document
    // -------------------------------------------------------------------------
    console.log('--- Case 1: Question Directly Answered by Ingested Document ---');

    await runTest('Retrieves exact document chunk and passes context to Gemini', async () => {
      retrievalService.setMockVectorSearch(async () => [FEVER_DEFINITION_CHUNK]);
      embeddingService.setMockEmbeddingGenerator(async () => ({
        embeddings: [new Array(1536).fill(0.01)],
        model: 'text-embedding-3-small',
        dimensions: 1536
      }));

      let capturedContext = '';
      geminiService.setMockGemini(async (msg, ctx) => {
        capturedContext = ctx;
        return 'According to [Source 1], fever is medically defined as a core body temperature exceeding 38.0°C (100.4°F).';
      });

      try {
        const res = await ragService.generateAnswer({
          message: 'What is the medical definition of fever?',
          language: 'en'
        });

        assert.strictEqual(res.retrievalStatus, 'results_found');
        assert.strictEqual(res.sources.length, 1);
        assert.strictEqual(res.sources[0].title, 'Community Health Worker Fever Evaluation and Home Monitoring Protocol');
        assert.strictEqual(res.sources[0].chunkId, 'doc_who_fever_chunk_0');
        assert.match(capturedContext, /38.0 degrees Celsius/);
        assert.match(res.answer, /\[Source 1\]/);
      } finally {
        geminiService.clearMockGemini();
        retrievalService.clearMockVectorSearch();
        embeddingService.clearMockEmbeddingGenerator();
      }
    });

    // -------------------------------------------------------------------------
    // CASE 2: Question requiring retrieval from multiple relevant passages
    // -------------------------------------------------------------------------
    console.log('\n--- Case 2: Multi-Passage Retrieval & Citation Synthesis ---');

    await runTest('Retrieves multiple passages and includes both citations without inventing sources', async () => {
      retrievalService.setMockVectorSearch(async () => [
        FEVER_DEFINITION_CHUNK,
        FEVER_DANGER_SIGNS_CHUNK
      ]);
      embeddingService.setMockEmbeddingGenerator(async () => ({
        embeddings: [new Array(1536).fill(0.01)],
        model: 'text-embedding-3-small',
        dimensions: 1536
      }));

      let capturedPassages = '';
      geminiService.setMockGemini(async (msg, ctx) => {
        capturedPassages = ctx;
        return 'Fever begins above 38.0°C [Source 1]. Warning signs requiring hospital care include temperature exceeding 40.0°C, petechial rash, or respiratory distress [Source 2].';
      });

      try {
        const res = await ragService.generateAnswer({
          message: 'What is fever temperature and what are the severe warning signs?',
          language: 'en'
        });

        assert.strictEqual(res.sources.length, 2);
        assert.strictEqual(res.sources[0].sourceIndex, 1);
        assert.strictEqual(res.sources[1].sourceIndex, 2);
        assert.match(capturedPassages, /\[Source 1\]/);
        assert.match(capturedPassages, /\[Source 2\]/);
        assert.match(res.answer, /\[Source 1\]/);
        assert.match(res.answer, /\[Source 2\]/);
        // Ensure no hallucinated Source 3
        assert.doesNotMatch(res.answer, /\[Source 3\]/);
      } finally {
        geminiService.clearMockGemini();
        retrievalService.clearMockVectorSearch();
        embeddingService.clearMockEmbeddingGenerator();
      }
    });

    // -------------------------------------------------------------------------
    // CASE 3: Question unrelated to indexed medical documents
    // -------------------------------------------------------------------------
    console.log('\n--- Case 3: Question Unrelated to Medical Documents ---');

    await runTest('Unrelated non-medical query yields no results and abstains safely', async () => {
      retrievalService.setMockVectorSearch(async () => []);
      embeddingService.setMockEmbeddingGenerator(async () => ({
        embeddings: [new Array(1536).fill(0.01)],
        model: 'text-embedding-3-small',
        dimensions: 1536
      }));

      try {
        const res = await ragService.generateAnswer({
          message: 'How does an astronomical telescope reflect light from distant galaxies?',
          language: 'en'
        });

        assert.strictEqual(res.retrievalStatus, 'no_results');
        assert.strictEqual(res.sources.length, 0);
        assert.match(res.answer, /verified medical knowledge base does not currently contain guidelines/i);
      } finally {
        retrievalService.clearMockVectorSearch();
        embeddingService.clearMockEmbeddingGenerator();
      }
    });

    // -------------------------------------------------------------------------
    // CASE 4: Question for which no reliable evidence exists (fictional topic)
    // -------------------------------------------------------------------------
    console.log('\n--- Case 4: No Reliable Evidence Exists (Fictional Drug/Treatment) ---');

    await runTest('Fictional drug query abstains rather than inventing evidence or citations', async () => {
      retrievalService.setMockVectorSearch(async () => []);
      embeddingService.setMockEmbeddingGenerator(async () => ({
        embeddings: [new Array(1536).fill(0.01)],
        model: 'text-embedding-3-small',
        dimensions: 1536
      }));

      try {
        const res = await ragService.generateAnswer({
          message: 'What is the dosage of Miraclex-99 for treating common colds?',
          language: 'en'
        });

        assert.strictEqual(res.retrievalStatus, 'no_results');
        assert.strictEqual(res.sources.length, 0);
        // Verified abstention notice
        assert.match(res.answer, /verified medical knowledge base does not currently contain guidelines/i);
        // Ensure no fabricated citations
        assert.doesNotMatch(res.answer, /\[Source/i);
      } finally {
        retrievalService.clearMockVectorSearch();
        embeddingService.clearMockEmbeddingGenerator();
      }
    });

    // -------------------------------------------------------------------------
    // CASE 5: Question containing misspellings or semantic paraphrasing
    // -------------------------------------------------------------------------
    console.log('\n--- Case 5: Misspellings and Paraphrased Query Matching ---');

    await runTest('Semantic query with typos matches relevant concept via vector retrieval', async () => {
      // Simulating semantic embedding match for typos: "fevr body heat and hi temp"
      retrievalService.setMockVectorSearch(async () => [FEVER_DEFINITION_CHUNK]);
      embeddingService.setMockEmbeddingGenerator(async () => ({
        embeddings: [new Array(1536).fill(0.01)],
        model: 'text-embedding-3-small',
        dimensions: 1536
      }));

      geminiService.setMockGemini(async (msg, ctx) => {
        return 'Medical guidelines state that fever is defined as core temperature above 38.0°C [Source 1].';
      });

      try {
        const res = await ragService.generateAnswer({
          message: 'what to do for fevr and hi body tempurature',
          language: 'en'
        });

        assert.strictEqual(res.retrievalStatus, 'results_found');
        assert.strictEqual(res.sources.length, 1);
        assert.strictEqual(res.sources[0].title, 'Community Health Worker Fever Evaluation and Home Monitoring Protocol');
      } finally {
        geminiService.clearMockGemini();
        retrievalService.clearMockVectorSearch();
        embeddingService.clearMockEmbeddingGenerator();
      }
    });

    // -------------------------------------------------------------------------
    // CASE 6: Empty question and excessively long question
    // -------------------------------------------------------------------------
    console.log('\n--- Case 6: Edge Case Boundaries (Empty, Too Short, Excessively Long) ---');

    await runTest('Rejects empty question with 400', async () => {
      const res = await makeRequest(port, '/api/rag/answer', {
        method: 'POST',
        headers: authHeaders,
        body: { message: '   ' }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });

    await runTest('Rejects 1-character question with 400', async () => {
      const res = await makeRequest(port, '/api/rag/answer', {
        method: 'POST',
        headers: authHeaders,
        body: { message: '?' }
      });
      assert.strictEqual(res.status, 400);
      assert.match(res.data.error, /too short/i);
    });

    await runTest('Rejects excessively long query (>2000 chars) with 400', async () => {
      const oversizedText = 'A'.repeat(2005);
      const res = await makeRequest(port, '/api/rag/answer', {
        method: 'POST',
        headers: authHeaders,
        body: { message: oversizedText }
      });
      assert.strictEqual(res.status, 400);
      assert.match(res.data.error, /exceeds maximum allowed length/i);
    });

  } finally {
    process.env.LLM_PROVIDER = prevProvider || '';
    await new Promise((resolve) => server.close(resolve));
    if (dbConnected) {
      await mongoose.disconnect();
    }
  }

  console.log('\n========================================================');
  console.log(`📊 RAG Retrieval Test Results: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('========================================================\n');

  process.exitCode = failedTests > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exitCode = 1;
});
