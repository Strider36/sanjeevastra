#!/usr/bin/env node
/**
 * ========================================================
 * 🩺 Sanjeev Astra: Optional Live Gemini Smoke Test Script
 * ========================================================
 *
 * NOTE: Running this test makes live network calls to Google Gemini
 * (both LLM text generation and Vector Embeddings) and may consume
 * free-tier quota on your Google AI Studio account.
 *
 * Usage:
 *   node scripts/smokeTestGemini.js
 */

require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const embeddingService = require('../server/services/embeddingService');

async function runLiveSmokeTest() {
  console.log('\n========================================================');
  console.log('📡 Sanjeev Astra: Live Google Gemini API Smoke Test');
  console.log('========================================================\n');

  const rawKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';

  if (!rawKey || rawKey === 'your_gemini_api_key_here') {
    console.log('⚠️  STATUS: BLOCKED / SKIPPED');
    console.log('   Reason: GEMINI_API_KEY is not configured in .env (found placeholder).');
    console.log('   To enable live smoke testing:');
    console.log('   1. Get your API key from https://aistudio.google.com/app/apikey');
    console.log('   2. Set GEMINI_API_KEY=your_key in .env');
    console.log('   3. Rerun: node scripts/smokeTestGemini.js\n');
    return { status: 'SKIPPED', reason: 'Placeholder or missing API key' };
  }

  const model = process.env.LLM_MODEL || 'gemini-3.5-flash-lite';
  const embeddingModel = process.env.EMBEDDING_MODEL || 'gemini-embedding-001';
  const targetDim = process.env.EMBEDDING_DIMENSIONS ? parseInt(process.env.EMBEDDING_DIMENSIONS, 10) : 768;

  console.log(`🔑 API Key Detected : [CONFIGURED - REDACTED (length: ${rawKey.length})]`);
  console.log(`🤖 Target LLM Model : ${model}`);
  console.log(`🧬 Embedding Model  : ${embeddingModel} (${targetDim} dimensions)\n`);

  // --- Step 1: Text Generation Test ---
  console.log('1️⃣ Testing Gemini Text Generation...');
  try {
    const ai = new GoogleGenAI({ apiKey: rawKey });
    const startTime = Date.now();

    const response = await ai.models.generateContent({
      model,
      contents: 'Provide a brief 1-sentence general educational definition of dehydration.'
    });

    const elapsed = Date.now() - startTime;
    const answer = response.text ? response.text.trim() : '';

    if (!answer) {
      throw new Error('Received empty response text from Gemini API.');
    }

    console.log(`   ✅ LLM Call Successful (${elapsed}ms)`);
    console.log(`   📝 Model Output: "${answer}"`);

    // Verify secrets are not echoed back
    if (answer.includes(rawKey)) {
      throw new Error('SECURITY VIOLATION: API key leaked in model response text!');
    }
  } catch (err) {
    console.error('   ❌ LLM Generation Failed:', err.message);
    return { status: 'FAIL', step: 'text-generation', error: err.message };
  }

  // --- Step 2: Embedding Generation Test ---
  console.log('\n2️⃣ Testing Gemini Vector Embeddings...');
  try {
    const startTime = Date.now();
    const embResult = await embeddingService.generateEmbeddings([
      'Clinical triage guideline for acute headache management.'
    ], {
      model: embeddingModel,
      dimensions: targetDim
    });

    const elapsed = Date.now() - startTime;

    if (!embResult?.embeddings || embResult.embeddings.length !== 1) {
      throw new Error('Invalid embedding response: expected 1 vector array.');
    }

    const vector = embResult.embeddings[0];
    embeddingService.validateEmbedding(vector, targetDim);

    console.log(`   ✅ Embedding Generation Successful (${elapsed}ms)`);
    console.log(`   🧬 Dimensions Generated: ${embResult.dimensions} [Model: ${embResult.model}]`);
    console.log(`   📊 Sample values (first 3): [${vector.slice(0, 3).map(v => v.toFixed(6)).join(', ')}...]`);
  } catch (err) {
    console.error('   ❌ Embedding Generation Failed:', err.message);
    return { status: 'FAIL', step: 'embedding-generation', error: err.message };
  }

  console.log('\n🔒 Security Check: PASSED (Zero credentials leaked)');
  console.log('========================================================');
  console.log('🎉 ALL LIVE GEMINI TESTS PASSED SUCCESSFULLY!');
  console.log('========================================================\n');
  return { status: 'PASS', model, embeddingModel, dimensions: targetDim };
}

if (require.main === module) {
  runLiveSmokeTest().then((result) => {
    if (result.status === 'FAIL') process.exit(1);
  });
}

module.exports = { runLiveSmokeTest };
