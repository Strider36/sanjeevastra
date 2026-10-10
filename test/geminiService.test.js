const assert = require('assert');
const geminiService = require('../server/services/geminiService');
const ragService = require('../server/services/ragService');
const retrievalService = require('../server/services/retrievalService');
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
  console.log('🧪 Sanjeev Astra: Gemini Service & Dual-Provider Tests');
  console.log('========================================================\n');

  // ----------------------------------------------------
  // SECTION 1: Client Configuration & Missing Key Handling
  // ----------------------------------------------------
  console.log('--- Section 1: Gemini Client Configuration ---');

  await runTest('getGeminiClient throws 503 when GEMINI_API_KEY is missing or placeholder', () => {
    const originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      geminiService.getGeminiClient();
      assert.fail('Expected error for missing key');
    } catch (err) {
      assert.strictEqual(err.statusCode, 503);
      assert.strictEqual(err.code, 'CONFIG_MISSING');
      assert.match(err.message, /GEMINI_API_KEY is missing/);
    } finally {
      if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    }
  });

  await runTest('getGeminiClient returns GoogleGenAI instance when key is provided', () => {
    const client = geminiService.getGeminiClient('valid_test_key_123');
    assert.ok(client);
    assert.strictEqual(typeof client.models?.generateContent, 'function');
  });

  // ----------------------------------------------------
  // SECTION 2: Answer Generation & Prompt Structure
  // ----------------------------------------------------
  console.log('\n--- Section 2: Gemini generateAnswer Functionality ---');

  await runTest('generateAnswer sends prompt containing rules, context, and question', async () => {
    let capturedPrompt = '';
    let capturedModel = '';

    geminiService.setMockGemini(async (message, context) => {
      capturedPrompt = `Context: ${context} | Question: ${message}`;
      return 'Acetaminophen (paracetamol) can help reduce fever according to medical guidance [Source 1].';
    });

    try {
      const answer = await geminiService.generateAnswer(
        'How to reduce fever?',
        '[Source 1]: Paracetamol is commonly used for symptomatic relief of mild to moderate fever.'
      );

      assert.match(answer, /Acetaminophen/);
      assert.match(capturedPrompt, /Paracetamol is commonly used/);
      assert.match(capturedPrompt, /How to reduce fever\?/);
    } finally {
      geminiService.clearMockGemini();
    }
  });

  // ----------------------------------------------------
  // SECTION 3: RAG Service Integration with Gemini Provider
  // ----------------------------------------------------
  console.log('\n--- Section 3: RAG Service Integration with Gemini ---');

  await runTest('ragService.generateAnswer routes to Gemini when LLM_PROVIDER=gemini', async () => {
    const prevProvider = process.env.LLM_PROVIDER;
    const prevModel = process.env.LLM_MODEL;
    process.env.LLM_PROVIDER = 'gemini';
    process.env.LLM_MODEL = 'gemini-2.5-flash-lite';

    // Mock vector retrieval
    retrievalService.setMockVectorSearch(async () => [
      {
        chunkId: 'chunk_who_ors_1',
        documentId: 'doc_who_rehydration',
        text: 'Oral Rehydration Salts (ORS) prevent dehydration in acute diarrhea.',
        score: 0.92,
        metadata: {
          title: 'WHO Oral Rehydration Guidelines',
          publisher: 'World Health Organization',
          sourceUrl: 'https://who.int/guidelines/ors',
          reviewStatus: 'approved'
        }
      }
    ]);

    embeddingService.setMockEmbeddingGenerator(async () => ({
      embeddings: [new Array(1536).fill(0.01)],
      model: 'text-embedding-3-small',
      dimensions: 1536
    }));

    geminiService.setMockGemini(async (message, context) => {
      assert.match(context, /Oral Rehydration Salts/);
      assert.match(message, /dehydration/);
      return 'According to [Source 1], ORS is recommended for hydration.';
    });

    try {
      const response = await ragService.generateAnswer({
        message: 'What helps with dehydration in diarrhea?',
        language: 'en'
      });

      assert.strictEqual(response.mode, 'rag');
      assert.strictEqual(response.model, 'gemini-2.5-flash-lite');
      assert.strictEqual(response.sources.length, 1);
      assert.strictEqual(response.sources[0].title, 'WHO Oral Rehydration Guidelines');
      assert.match(response.answer, /According to \[Source 1\]/);
    } finally {
      geminiService.clearMockGemini();
      retrievalService.clearMockVectorSearch();
      embeddingService.clearMockEmbeddingGenerator();
      process.env.LLM_PROVIDER = prevProvider || '';
      process.env.LLM_MODEL = prevModel || '';
    }
  });

  console.log('\n========================================================');
  console.log(`📊 Gemini Service Test Results: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('========================================================\n');

  process.exitCode = failedTests > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exitCode = 1;
});
