const assert = require('assert');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const retrievalService = require('../server/services/retrievalService');
const embeddingService = require('../server/services/embeddingService');
const ragRoutes = require('../server/routes/ragRoutes');
const User = require('../server/models/User');

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

async function startTestServer() {
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
  return { status: response.status, headers: response.headers, data };
}

async function main() {
  console.log('\n========================================================');
  console.log('🧪 Sanjeev Astra: Vector Search & Retrieval Test Suite');
  console.log('========================================================\n');

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
    console.log('ℹ️ Note: Running DB-independent checks where applicable.');
  }

  try {
    // ----------------------------------------------------
    // SECTION 1: Query Validation & Filter Allowlist
    // ----------------------------------------------------
    console.log('\n--- Section 1: Query Validation & Filter Allowlist ---');

    await runTest('Rejects non-string queries with 400', () => {
      assert.throws(() => retrievalService.validateQuery(null), /Query must be a string/);
      assert.throws(() => retrievalService.validateQuery(12345), /Query must be a string/);
    });

    await runTest('Rejects empty or too short queries (< 2 chars)', () => {
      assert.throws(() => retrievalService.validateQuery(''), /too short/);
      assert.throws(() => retrievalService.validateQuery(' a '), /too short/);
    });

    await runTest('Rejects queries exceeding maximum length (> 2000 chars)', () => {
      const longQuery = 'A'.repeat(2001);
      assert.throws(() => retrievalService.validateQuery(longQuery), /exceeds maximum length/);
    });

    await runTest('Sanitizes filters against strict allowlist (rejects arbitrary mongo keys)', () => {
      const malicious = {
        topic: 'neurology',
        language: 'EN',
        $where: 'sleep(1000)',
        __proto__: { admin: true }
      };
      const cleaned = retrievalService.sanitizeFilters(malicious);
      assert.strictEqual(cleaned['metadata.topic'], 'neurology');
      assert.strictEqual(cleaned['metadata.language'], 'en');
      assert.strictEqual(cleaned['$where'], undefined);
    });

    // ----------------------------------------------------
    // SECTION 2: Query Embedding & Dimension Matching
    // ----------------------------------------------------
    console.log('\n--- Section 2: Query Embedding & Dimension Matching ---');

    await runTest('Query embedding uses configured model (text-embedding-3-small) and 1536 dims', async () => {
      embeddingService.setMockEmbeddingGenerator(async (texts) => {
        return {
          embeddings: texts.map(() => new Array(1536).fill(0.0123)),
          model: 'text-embedding-3-small',
          dimensions: 1536
        };
      });

      retrievalService.setMockVectorSearch(async ({ queryEmbedding }) => {
        assert.strictEqual(queryEmbedding.length, 1536);
        return [];
      });

      try {
        const res = await retrievalService.retrieveMedicalContext('What causes migraines?');
        assert.strictEqual(res.embeddingModel, 'text-embedding-3-small');
        assert.strictEqual(res.scoreMetric, 'cosine');
      } finally {
        embeddingService.clearMockEmbeddingGenerator();
        retrievalService.clearMockVectorSearch();
      }
    });

    await runTest('Handles embedding generation API failures gracefully', async () => {
      embeddingService.setMockEmbeddingGenerator(async () => {
        const err = new Error('Embedding API unavailable');
        err.statusCode = 502;
        throw err;
      });

      try {
        await retrievalService.retrieveMedicalContext('What causes migraines?');
        assert.fail('Should fail on embedding generation error');
      } catch (err) {
        assert.match(err.message, /Embedding API unavailable/);
      } finally {
        embeddingService.clearMockEmbeddingGenerator();
      }
    });

    // ----------------------------------------------------
    // SECTION 3: Vector Search Logic, Safety & Deduplication
    // ----------------------------------------------------
    console.log('\n--- Section 3: Vector Search Logic, Safety & Deduplication ---');

    const sampleMockChunks = [
      {
        chunkId: 'doc_headache_chunk_0',
        documentId: 'doc_headache',
        text: 'Acute headache evaluation: Differentiating primary headaches from secondary thunderclap red flags.',
        score: 0.89234,
        sectionHeading: 'Clinical Overview',
        metadata: {
          title: 'Acute Headache Triage',
          publisher: 'Ministry of Health',
          topic: 'triage_neurology',
          language: 'en',
          reviewStatus: 'approved'
        }
      },
      // Near-identical overlapping chunk from same document
      {
        chunkId: 'doc_headache_chunk_1',
        documentId: 'doc_headache',
        text: 'Differentiating primary headaches from secondary thunderclap red flags. Immediate 112 emergency routing.',
        score: 0.82110,
        sectionHeading: 'Emergency Red Flags',
        metadata: {
          title: 'Acute Headache Triage',
          publisher: 'Ministry of Health',
          topic: 'triage_neurology',
          language: 'en',
          reviewStatus: 'approved'
        }
      },
      // Duplicate chunkId
      {
        chunkId: 'doc_headache_chunk_0',
        documentId: 'doc_headache',
        text: 'Acute headache evaluation: Differentiating primary headaches from secondary thunderclap red flags.',
        score: 0.75000,
        metadata: { reviewStatus: 'approved' }
      },
      // Unapproved chunk
      {
        chunkId: 'doc_unapproved_chunk_0',
        documentId: 'doc_unapproved',
        text: 'Unapproved experimental treatments.',
        score: 0.95000,
        metadata: {
          reviewStatus: 'pending'
        }
      },
      // Different approved document chunk
      {
        chunkId: 'doc_fever_chunk_0',
        documentId: 'doc_fever',
        text: 'Fever management guidelines: Hydration with ORS and resting.',
        score: 0.74100,
        metadata: {
          title: 'Fever Monitoring Protocol',
          publisher: 'WHO',
          topic: 'infectious_disease',
          language: 'en',
          reviewStatus: 'approved'
        }
      }
    ];

    await runTest('Successful vector search ranks results and excludes unapproved sources', async () => {
      embeddingService.setMockEmbeddingGenerator(async (texts) => ({
        embeddings: texts.map(() => new Array(1536).fill(0.01)),
        model: 'text-embedding-3-small',
        dimensions: 1536
      }));

      retrievalService.setMockVectorSearch(async () => {
        return sampleMockChunks;
      });

      try {
        const res = await retrievalService.retrieveMedicalContext('headache treatment', { topK: 5 });
        assert.strictEqual(res.retrievalStatus, 'results_found');
        assert.ok(res.results.length >= 1);

        // Verify unapproved chunk was excluded
        const hasUnapproved = res.results.some(r => r.chunkId === 'doc_unapproved_chunk_0');
        assert.strictEqual(hasUnapproved, false, 'Unapproved chunks must be excluded');

        // Verify ranked in descending score order
        for (let i = 0; i < res.results.length - 1; i++) {
          assert.ok(res.results[i].score >= res.results[i + 1].score);
        }
      } finally {
        embeddingService.clearMockEmbeddingGenerator();
        retrievalService.clearMockVectorSearch();
      }
    });

    await runTest('Deduplication eliminates identical chunk IDs and suppresses high-overlap sibling chunks', async () => {
      embeddingService.setMockEmbeddingGenerator(async (texts) => ({
        embeddings: texts.map(() => new Array(1536).fill(0.01)),
        model: 'text-embedding-3-small',
        dimensions: 1536
      }));

      retrievalService.setMockVectorSearch(async () => {
        return sampleMockChunks;
      });

      try {
        const res = await retrievalService.retrieveMedicalContext('headache');
        const chunkIds = res.results.map(r => r.chunkId);
        // Ensure doc_headache_chunk_0 appears only once
        const count0 = chunkIds.filter(id => id === 'doc_headache_chunk_0').length;
        assert.strictEqual(count0, 1);

        // Ensure overlapping chunk_1 was suppressed in favor of higher scoring chunk_0
        const hasChunk1 = chunkIds.includes('doc_headache_chunk_1');
        assert.strictEqual(hasChunk1, false, 'Near-identical overlapping sibling chunk should be suppressed');
      } finally {
        embeddingService.clearMockEmbeddingGenerator();
        retrievalService.clearMockVectorSearch();
      }
    });

    await runTest('Returns "no_results" status when no matching passages are found', async () => {
      embeddingService.setMockEmbeddingGenerator(async (texts) => ({
        embeddings: texts.map(() => new Array(1536).fill(0.01)),
        model: 'text-embedding-3-small',
        dimensions: 1536
      }));

      retrievalService.setMockVectorSearch(async () => []);

      try {
        const res = await retrievalService.retrieveMedicalContext('Unmatched rare term');
        assert.strictEqual(res.retrievalStatus, 'no_results');
        assert.strictEqual(res.count, 0);
        assert.deepStrictEqual(res.results, []);
      } finally {
        embeddingService.clearMockEmbeddingGenerator();
        retrievalService.clearMockVectorSearch();
      }
    });

    await runTest('Filters by topic and documentId', async () => {
      embeddingService.setMockEmbeddingGenerator(async (texts) => ({
        embeddings: texts.map(() => new Array(1536).fill(0.01)),
        model: 'text-embedding-3-small',
        dimensions: 1536
      }));

      retrievalService.setMockVectorSearch(async ({ filterConditions }) => {
        assert.strictEqual(filterConditions['metadata.topic'], 'cardiovascular');
        assert.strictEqual(filterConditions.documentId, 'doc_cardio_1');
        return [];
      });

      try {
        await retrievalService.retrieveMedicalContext('blood pressure', {
          topic: 'cardiovascular',
          documentId: 'doc_cardio_1'
        });
      } finally {
        embeddingService.clearMockEmbeddingGenerator();
        retrievalService.clearMockVectorSearch();
      }
    });

    // ----------------------------------------------------
    // SECTION 4: Error Handling & Unsupported Environments
    // ----------------------------------------------------
    console.log('\n--- Section 4: Atlas Vector Search & Error Mapping ---');

    await runTest('Missing Atlas Vector Search aggregation stage reports descriptive 501 error', async () => {
      embeddingService.setMockEmbeddingGenerator(async (texts) => ({
        embeddings: texts.map(() => new Array(1536).fill(0.01)),
        model: 'text-embedding-3-small',
        dimensions: 1536
      }));

      // No mock vector search handler: invokes real KnowledgeChunk.aggregate on local MongoDB
      try {
        await retrievalService.retrieveMedicalContext('Any query');
        assert.fail('Expected exception on local MongoDB lacking $vectorSearch');
      } catch (err) {
        assert.strictEqual(err.statusCode, 501);
        assert.match(err.message, /Atlas Vector Search is not supported on this MongoDB deployment/);
      } finally {
        embeddingService.clearMockEmbeddingGenerator();
      }
    });

    // ----------------------------------------------------
    // SECTION 5: HTTP Endpoint Integration (POST /api/rag/retrieve)
    // ----------------------------------------------------
    console.log('\n--- Section 5: HTTP Endpoint Integration (POST /api/rag/retrieve) ---');

    const { server, port } = await startTestServer();

    try {
      await runTest('Rejects request without Authorization header (401)', async () => {
        const res = await makeRequest(port, '/api/rag/retrieve', {
          method: 'POST',
          body: { message: 'Causes of fever' }
        });

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.data.success, false);
      });

      await runTest('Rejects request with invalid JWT token (401)', async () => {
        const res = await makeRequest(port, '/api/rag/retrieve', {
          method: 'POST',
          headers: { Authorization: 'Bearer invalid_garbage_token' },
          body: { message: 'Causes of fever' }
        });

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.data.success, false);
      });

      if (dbConnected && testUserId) {
        const validToken = jwt.sign({ id: testUserId }, JWT_SECRET, { expiresIn: '1h' });
        const authHeaders = { Authorization: `Bearer ${validToken}` };

        await runTest('Rejects missing message field with 400', async () => {
          const res = await makeRequest(port, '/api/rag/retrieve', {
            method: 'POST',
            headers: authHeaders,
            body: { topK: 5 }
          });

          assert.strictEqual(res.status, 400);
          assert.strictEqual(res.data.success, false);
          assert.match(res.data.error, /"message" is required/);
        });

        await runTest('Rejects empty or too short message with 400', async () => {
          const res = await makeRequest(port, '/api/rag/retrieve', {
            method: 'POST',
            headers: authHeaders,
            body: { message: ' ' }
          });

          assert.strictEqual(res.status, 400);
          assert.strictEqual(res.data.success, false);
          assert.match(res.data.error, /too short/);
        });

        await runTest('Rejects invalid topK values (< 1 or > 20) with 400', async () => {
          const res = await makeRequest(port, '/api/rag/retrieve', {
            method: 'POST',
            headers: authHeaders,
            body: { message: 'What is fever?', topK: 99 }
          });

          assert.strictEqual(res.status, 400);
          assert.strictEqual(res.data.success, false);
          assert.match(res.data.error, /topK must be an integer between 1 and 20/);
        });

        await runTest('End-to-End: Valid authenticated request returns 200 with structured passages', async () => {
          embeddingService.setMockEmbeddingGenerator(async (texts) => ({
            embeddings: texts.map(() => new Array(1536).fill(0.01)),
            model: 'text-embedding-3-small',
            dimensions: 1536
          }));

          retrievalService.setMockVectorSearch(async () => [
            {
              chunkId: 'doc_headache_chunk_0',
              documentId: 'doc_headache',
              text: 'Headache management clinical guideline passage.',
              score: 0.88,
              sectionHeading: 'Overview',
              metadata: {
                title: 'Headache Guide',
                publisher: 'MoH',
                sourceUrl: 'https://example.com/guide',
                topic: 'neurology',
                language: 'en',
                reviewStatus: 'approved'
              }
            }
          ]);

          try {
            const res = await makeRequest(port, '/api/rag/retrieve', {
              method: 'POST',
              headers: authHeaders,
              body: {
                message: 'How to manage tension headaches?',
                topK: 3
              }
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.strictEqual(res.data.retrievalStatus, 'results_found');
            assert.strictEqual(res.data.count, 1);
            assert.strictEqual(res.data.results[0].chunkId, 'doc_headache_chunk_0');
            assert.strictEqual(res.data.results[0].metadata.title, 'Headache Guide');
            assert.strictEqual(res.data.scoreMetric, 'cosine');
          } finally {
            embeddingService.clearMockEmbeddingGenerator();
            retrievalService.clearMockVectorSearch();
          }
        });
      }

    } finally {
      await new Promise(resolve => server.close(resolve));
    }

  } finally {
    if (dbConnected) {
      await mongoose.disconnect();
    }
  }

  // ----------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------
  console.log('\n========================================================');
  console.log(`📊 Vector Retrieval Test Results: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('========================================================\n');

  process.exitCode = failedTests > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exitCode = 1;
});
