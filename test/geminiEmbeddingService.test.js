const assert = require('assert');
const embeddingService = require('../server/services/embeddingService');

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

async function main() {
  console.log('\n========================================================');
  console.log('🧪 Sanjeev Astra: Gemini Embedding Service Test Suite');
  console.log('========================================================\n');

  // ----------------------------------------------------
  // SECTION 1: Missing API Key Configuration
  // ----------------------------------------------------
  console.log('--- Section 1: API Key & Configuration Validation ---');

  await runTest('getClient throws 503 when GEMINI_API_KEY is missing or placeholder', () => {
    const originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      embeddingService.getClient();
      assert.fail('Should have thrown missing key error');
    } catch (err) {
      assert.strictEqual(err.statusCode, 503);
      assert.strictEqual(err.code, 'CONFIG_MISSING');
      assert.match(err.message, /GEMINI_API_KEY is not configured/);
    } finally {
      if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    }
  });

  await runTest('getClient returns GoogleGenAI instance when key is provided', () => {
    const client = embeddingService.getClient('test_gemini_key_123');
    assert.ok(client);
    assert.strictEqual(typeof client.models?.embedContent, 'function');
  });

  // ----------------------------------------------------
  // SECTION 2: Empty & Invalid Input Handling
  // ----------------------------------------------------
  console.log('\n--- Section 2: Input Validation & Boundary Checks ---');

  await runTest('Empty texts array returns empty embeddings with dimensions 0 without calling API', async () => {
    const res = await embeddingService.generateEmbeddings([]);
    assert.strictEqual(res.embeddings.length, 0);
    assert.strictEqual(res.dimensions, 0);
    assert.strictEqual(res.model, 'gemini-embedding-001');
  });

  await runTest('Rejects empty or whitespace-only string in batch with error', async () => {
    try {
      await embeddingService.generateEmbeddings(['Valid text', '   ']);
      assert.fail('Should have rejected whitespace-only string');
    } catch (err) {
      assert.match(err.message, /Cannot generate embedding for empty or non-string text/i);
    }
  });

  // ----------------------------------------------------
  // SECTION 3: Mocked Successful Embedding Generation
  // ----------------------------------------------------
  console.log('\n--- Section 3: Mocked Provider Embeddings Generation ---');

  await runTest('Mocked Gemini client generates single-text embedding of requested dimension', async () => {
    const mockClient = {
      models: {
        embedContent: async ({ model, contents, config }) => {
          assert.strictEqual(model, 'gemini-embedding-001');
          assert.strictEqual(config?.outputDimensionality, 768);
          assert.strictEqual(contents.length, 1);
          return {
            embeddings: [
              { values: new Array(768).fill(0.015) }
            ]
          };
        }
      }
    };

    embeddingService.setMockClient(mockClient);

    try {
      const res = await embeddingService.generateEmbeddings(['Clinical protocol for acute fever.'], {
        dimensions: 768
      });

      assert.strictEqual(res.embeddings.length, 1);
      assert.strictEqual(res.dimensions, 768);
      assert.strictEqual(res.embeddings[0].length, 768);
      assert.strictEqual(res.model, 'gemini-embedding-001');
    } finally {
      embeddingService.clearMockClient();
    }
  });

  await runTest('Mocked Gemini client processes multi-item batch accurately', async () => {
    const texts = [
      'Document chunk 1: Hypertension care',
      'Document chunk 2: Oral rehydration salts',
      'Document chunk 3: Emergency triage protocol'
    ];

    const mockClient = {
      models: {
        embedContent: async ({ contents }) => {
          return {
            embeddings: contents.map(() => ({ values: new Array(768).fill(0.05) }))
          };
        }
      }
    };

    embeddingService.setMockClient(mockClient);

    try {
      const res = await embeddingService.generateEmbeddings(texts, {
        batchSize: 2, // Forces multiple batches
        dimensions: 768
      });

      assert.strictEqual(res.embeddings.length, 3);
      assert.strictEqual(res.dimensions, 768);
      for (const emb of res.embeddings) {
        assert.strictEqual(emb.length, 768);
      }
    } finally {
      embeddingService.clearMockClient();
    }
  });

  // ----------------------------------------------------
  // SECTION 4: Provider Failures & Retry Behavior
  // ----------------------------------------------------
  console.log('\n--- Section 4: Provider Failure & Error Handling ---');

  await runTest('Incomplete batch returned by provider throws an explicit error', async () => {
    const mockClient = {
      models: {
        embedContent: async () => {
          // Returning 1 embedding for a 2-item batch
          return {
            embeddings: [{ values: new Array(768).fill(0.01) }]
          };
        }
      }
    };

    embeddingService.setMockClient(mockClient);

    try {
      await embeddingService.generateEmbeddings(['Text 1', 'Text 2'], { dimensions: 768, maxRetries: 0 });
      assert.fail('Should have caught incomplete batch');
    } catch (err) {
      assert.match(err.message, /incomplete embedding batch/i);
    } finally {
      embeddingService.clearMockClient();
    }
  });

  await runTest('Invalid vector numbers (NaN or non-finite) fail validation', () => {
    const invalidVector = [0.1, NaN, 0.3];
    assert.throws(() => {
      embeddingService.validateEmbedding(invalidVector);
    }, /Invalid numeric value/);
  });

  await runTest('Dimension mismatch fails validation', () => {
    const vector = new Array(768).fill(0.1);
    assert.throws(() => {
      embeddingService.validateEmbedding(vector, 1536);
    }, /Embedding dimension mismatch/);
  });

  await runTest('Provider rate limit triggers retries with exponential backoff', async () => {
    let callCount = 0;
    const mockClient = {
      models: {
        embedContent: async () => {
          callCount++;
          if (callCount < 2) {
            const err = new Error('Resource exhausted: quota exceeded');
            err.status = 429;
            throw err;
          }
          return {
            embeddings: [{ values: new Array(768).fill(0.01) }]
          };
        }
      }
    };

    embeddingService.setMockClient(mockClient);

    try {
      const res = await embeddingService.generateEmbeddings(['Testing retry backoff'], {
        dimensions: 768,
        maxRetries: 2,
        initialDelayMs: 10
      });

      assert.strictEqual(callCount, 2);
      assert.strictEqual(res.embeddings.length, 1);
      assert.strictEqual(res.dimensions, 768);
    } finally {
      embeddingService.clearMockClient();
    }
  });

  // ----------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------
  console.log('\n========================================================');
  console.log(`📊 Gemini Embedding Tests: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('========================================================\n');

  process.exitCode = failedTests > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exitCode = 1;
});
