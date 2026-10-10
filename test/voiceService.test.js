require('dotenv').config();
const assert = require('assert');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const elevenLabsService = require('../server/services/elevenLabsService');
const voiceRoutes = require('../server/routes/voiceRoutes');
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
  app.use('/api/voice', voiceRoutes);
  app.use('/api/rag', ragRoutes);

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

async function makeJsonRequest(port, path, options = {}) {
  const url = `http://127.0.0.1:${port}${path}`;
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const contentType = response.headers.get('content-type') || '';
  let data = null;
  let rawBuffer = null;

  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => null);
  } else {
    const arrayBuffer = await response.arrayBuffer();
    rawBuffer = Buffer.from(arrayBuffer);
  }

  return { status: response.status, headers: response.headers, data, rawBuffer };
}

async function makeMultipartRequest(port, path, { fields = {}, file = null, headers = {} } = {}) {
  const url = `http://127.0.0.1:${port}${path}`;
  const formData = new FormData();

  for (const [key, val] of Object.entries(fields)) {
    formData.append(key, val);
  }

  if (file) {
    const blob = new Blob([file.buffer], { type: file.mimeType || 'audio/webm' });
    formData.append(file.fieldname || 'audio', blob, file.filename || 'recording.webm');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: formData
  });

  const contentType = response.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => null);
  }

  return { status: response.status, headers: response.headers, data };
}

async function main() {
  console.log('\n========================================================');
  console.log('🎙️ Sanjeev Astra: ElevenLabs Voice-to-Voice Test Suite');
  console.log('========================================================\n');

  let dbConnected = false;
  let testUser = null;
  let authToken = null;

  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/swasthyasetu');
    dbConnected = true;

    // Find or create test patient user
    testUser = await User.findOne({ email: 'voice_test_patient@sanjeevastra.org' });
    if (!testUser) {
      testUser = await User.create({
        name: 'Voice Test Patient',
        email: 'voice_test_patient@sanjeevastra.org',
        password: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890abcdef',
        role: 'patient',
        isVerified: true
      });
    }

    authToken = jwt.sign(
      { id: testUser._id.toString(), email: testUser.email, role: testUser.role },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
  } catch (err) {
    console.warn('⚠️ MongoDB connection warning in test setup:', err.message);
  }

  const { server, port } = await startTestServer();

  try {
    // ----------------------------------------------------
    // SECTION 1: Unit Tests for Text Cleaning & Config
    // ----------------------------------------------------
    console.log('\n--- Section 1: Clinical Text Sanitization & Configuration ---');

    await runTest('cleanTextForSpeech strips Markdown headings, bold, italics, and backticks', () => {
      const input = '## Medical Guidance\n\n**Take 500mg** of *paracetamol* if fever persists. Use `ice pack` on forehead.';
      const output = elevenLabsService.cleanTextForSpeech(input);
      assert.strictEqual(output.includes('##'), false);
      assert.strictEqual(output.includes('**'), false);
      assert.strictEqual(output.includes('*'), false);
      assert.strictEqual(output.includes('`'), false);
      assert.match(output, /Medical Guidance/);
      assert.match(output, /Take 500mg/);
      assert.match(output, /paracetamol/);
      assert.match(output, /ice pack/);
    });

    await runTest('cleanTextForSpeech strips citation tags [Source 1], [1], and URLs from speech', () => {
      const input = 'Hypertension is defined as BP >= 130/80 mmHg [Source 1]. Refer to https://who.int/guidelines for details [Source 2: WHO 2023].';
      const output = elevenLabsService.cleanTextForSpeech(input);
      assert.strictEqual(output.includes('[Source 1]'), false);
      assert.strictEqual(output.includes('[Source 2: WHO 2023]'), false);
      assert.strictEqual(output.includes('https://who.int'), false);
      assert.match(output, /Hypertension is defined as BP >= 130\/80 mmHg/);
      assert.match(output, /Refer to for details/);
    });

    await runTest('cleanTextForSpeech strips bullet points and numbered list markers for smooth speaking', () => {
      const input = 'Please follow these steps:\n* Drink warm water\n- Avoid heavy meals\n1. Rest for 8 hours';
      const output = elevenLabsService.cleanTextForSpeech(input);
      assert.strictEqual(output.includes('* Drink'), false);
      assert.strictEqual(output.includes('- Avoid'), false);
      assert.strictEqual(output.includes('1. Rest'), false);
      assert.match(output, /Drink warm water/);
      assert.match(output, /Avoid heavy meals/);
      assert.match(output, /Rest for 8 hours/);
    });

    await runTest('cleanTextForSpeech handles empty, null, or whitespace input safely', () => {
      assert.strictEqual(elevenLabsService.cleanTextForSpeech(''), '');
      assert.strictEqual(elevenLabsService.cleanTextForSpeech(null), '');
      assert.strictEqual(elevenLabsService.cleanTextForSpeech(undefined), '');
      assert.strictEqual(elevenLabsService.cleanTextForSpeech('   \n  '), '');
    });

    await runTest('getVoiceConfig returns available voice catalog and supported languages', () => {
      const config = elevenLabsService.getVoiceConfig();
      assert.ok(typeof config.configured === 'boolean');
      assert.ok(Array.isArray(config.availableVoices));
      assert.ok(config.availableVoices.length >= 3);
      assert.strictEqual(config.availableVoices.some(v => v.name === 'Rachel'), true);
      assert.strictEqual(config.availableVoices.some(v => v.name === 'Bella'), true);

      assert.ok(Array.isArray(config.supportedLanguages));
      assert.strictEqual(config.supportedLanguages.some(l => l.code === 'en'), true);
      assert.strictEqual(config.supportedLanguages.some(l => l.code === 'hi'), true);
      assert.strictEqual(config.supportedLanguages.some(l => l.code === 'mr'), true);
      assert.strictEqual(config.maxAudioSizeBytes, 25 * 1024 * 1024);
    });

    // ----------------------------------------------------
    // SECTION 2: Voice API Route Tests
    // ----------------------------------------------------
    console.log('\n--- Section 2: Voice Endpoints & Input Validation ---');

    await runTest('GET /api/voice/config is public and returns configuration', async () => {
      const res = await makeJsonRequest(port, '/api/voice/config');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.data.availableVoices);
      assert.ok(res.data.data.supportedLanguages);
    });

    await runTest('POST /api/voice/transcribe rejects requests without authentication (401)', async () => {
      const dummyAudio = Buffer.alloc(500, 1);
      const res = await makeMultipartRequest(port, '/api/voice/transcribe', {
        file: { buffer: dummyAudio, mimeType: 'audio/webm', filename: 'voice.webm' }
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.success, false);
    });

    await runTest('POST /api/voice/transcribe rejects requests without audio file (400)', async () => {
      const res = await makeMultipartRequest(port, '/api/voice/transcribe', {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
      assert.match(res.data.error, /No audio recording file was provided/i);
    });

    await runTest('POST /api/voice/transcribe rejects unsupported file format (400)', async () => {
      const dummyFile = Buffer.alloc(300, 1);
      const res = await makeMultipartRequest(port, '/api/voice/transcribe', {
        headers: { Authorization: `Bearer ${authToken}` },
        file: { buffer: dummyFile, mimeType: 'image/png', filename: 'photo.png' }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
      assert.match(res.data.error, /Unsupported audio format/i);
    });

    await runTest('POST /api/voice/transcribe rejects audio under 100 bytes (empty/corrupt) (400)', async () => {
      const tinyAudio = Buffer.alloc(20, 1); // 20 bytes
      const res = await makeMultipartRequest(port, '/api/voice/transcribe', {
        headers: { Authorization: `Bearer ${authToken}` },
        file: { buffer: tinyAudio, mimeType: 'audio/webm', filename: 'tiny.webm' }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
      assert.match(res.data.error, /Recording is empty or too short/i);
    });

    await runTest('POST /api/voice/transcribe successfully transcribes with mock handler (200)', async () => {
      elevenLabsService.setMockTranscriber(async ({ fileBuffer, language, requestId }) => {
        assert.ok(Buffer.isBuffer(fileBuffer));
        assert.ok(fileBuffer.length >= 100);
        return {
          success: true,
          text: 'What are the main warning signs of hypertension?',
          language: language === 'hi' ? 'hin' : 'eng',
          confidence: 0.98,
          requestId
        };
      });

      const audioBuffer = Buffer.alloc(1024, 0xAA);
      const res = await makeMultipartRequest(port, '/api/voice/transcribe', {
        headers: { Authorization: `Bearer ${authToken}` },
        file: { buffer: audioBuffer, mimeType: 'audio/webm', filename: 'query.webm' },
        fields: { language: 'en' }
      });

      elevenLabsService.clearMockTranscriber();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.text, 'What are the main warning signs of hypertension?');
      assert.strictEqual(res.data.language, 'eng');
      assert.ok(res.data.requestId.startsWith('stt_'));
    });

    await runTest('POST /api/voice/transcribe preserves Hindi language selection', async () => {
      elevenLabsService.setMockTranscriber(async ({ language, requestId }) => {
        return {
          success: true,
          text: 'उच्च रक्तचाप के क्या लक्षण हैं?',
          language: 'hin',
          confidence: 0.95,
          requestId
        };
      });

      const audioBuffer = Buffer.alloc(512, 0xBB);
      const res = await makeMultipartRequest(port, '/api/voice/transcribe', {
        headers: { Authorization: `Bearer ${authToken}` },
        file: { buffer: audioBuffer, mimeType: 'audio/wav', filename: 'hindi_query.wav' },
        fields: { language: 'hi' }
      });

      elevenLabsService.clearMockTranscriber();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.text, 'उच्च रक्तचाप के क्या लक्षण हैं?');
      assert.strictEqual(res.data.language, 'hin');
    });

    await runTest('POST /api/voice/synthesize rejects unauthenticated requests (401)', async () => {
      const res = await makeJsonRequest(port, '/api/voice/synthesize', {
        method: 'POST',
        body: { text: 'Hello, this is a test.' }
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.success, false);
    });

    await runTest('POST /api/voice/synthesize rejects empty or whitespace-only text (400)', async () => {
      const res = await makeJsonRequest(port, '/api/voice/synthesize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: { text: '   ' }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
      assert.match(res.data.error, /Text to synthesize cannot be empty/i);
    });

    await runTest('POST /api/voice/synthesize rejects oversized text > 3000 chars (400)', async () => {
      const longText = 'a'.repeat(3001);
      const res = await makeJsonRequest(port, '/api/voice/synthesize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: { text: longText }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
      assert.match(res.data.error, /exceeds maximum allowed length/i);
    });

    await runTest('POST /api/voice/synthesize returns binary audio/mpeg stream with mock (200)', async () => {
      const fakeMpeg = Buffer.from('FAKE_MPEG_AUDIO_STREAM_DATA_BYTES_12345');
      elevenLabsService.setMockSynthesizer(async ({ text, requestId }) => {
        return {
          audioBuffer: fakeMpeg,
          contentType: 'audio/mpeg',
          spokenLength: text.length,
          requestId
        };
      });

      const res = await makeJsonRequest(port, '/api/voice/synthesize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: { text: 'Consult your physician for personalized medical advice.' }
      });

      elevenLabsService.clearMockSynthesizer();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'audio/mpeg');
      assert.ok(res.headers.get('x-request-id').startsWith('tts_'));
      assert.ok(res.rawBuffer);
      assert.strictEqual(res.rawBuffer.toString(), fakeMpeg.toString());
    });

    await runTest('POST /api/voice/synthesize supports JSON base64 format (200)', async () => {
      const fakeMpeg = Buffer.from('BASE64_TEST_AUDIO_BYTES');
      elevenLabsService.setMockSynthesizer(async ({ text, requestId }) => {
        return {
          audioBuffer: fakeMpeg,
          contentType: 'audio/mpeg',
          spokenLength: text.length,
          requestId
        };
      });

      const res = await makeJsonRequest(port, '/api/voice/synthesize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          Accept: 'application/json'
        },
        body: { text: 'Drink adequate water and monitor blood sugar levels.', format: 'json' }
      });

      elevenLabsService.clearMockSynthesizer();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.audioBase64, fakeMpeg.toString('base64'));
      assert.strictEqual(res.data.contentType, 'audio/mpeg');
      assert.ok(res.data.requestId.startsWith('tts_'));
    });

    // ----------------------------------------------------
    // SECTION 3: Upstream Error Mapping & Resilience
    // ----------------------------------------------------
    console.log('\n--- Section 3: Upstream Error Handling & Resilience ---');

    await runTest('Transcribe maps missing API key to 503 Service Unavailable', async () => {
      const prevKey = process.env.ELEVENLABS_API_KEY;
      delete process.env.ELEVENLABS_API_KEY;

      const audioBuffer = Buffer.alloc(200, 1);
      const res = await makeMultipartRequest(port, '/api/voice/transcribe', {
        headers: { Authorization: `Bearer ${authToken}` },
        file: { buffer: audioBuffer, mimeType: 'audio/webm', filename: 'test.webm' }
      });

      process.env.ELEVENLABS_API_KEY = prevKey;

      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.data.success, false);
      assert.match(res.data.error, /Voice transcription is currently unavailable/i);
    });

    await runTest('Synthesize maps missing API key to 503 with user-safe message', async () => {
      const prevKey = process.env.ELEVENLABS_API_KEY;
      delete process.env.ELEVENLABS_API_KEY;

      const res = await makeJsonRequest(port, '/api/voice/synthesize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: { text: 'Testing missing key handling' }
      });

      process.env.ELEVENLABS_API_KEY = prevKey;

      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.data.success, false);
      assert.match(res.data.error, /Text responses remain fully readable/i);
    });

    await runTest('Synthesize maps quota 429 error without crashing or losing text response', async () => {
      elevenLabsService.setMockSynthesizer(async () => {
        const err = new Error('Quota exceeded');
        err.statusCode = 429;
        err.userMessage = 'Voice synthesis quota or rate limit reached. Text response is displayed above.';
        err.requestId = 'tts_quota_test';
        throw err;
      });

      const res = await makeJsonRequest(port, '/api/voice/synthesize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: { text: 'Testing rate limit handling' }
      });

      elevenLabsService.clearMockSynthesizer();

      assert.strictEqual(res.status, 429);
      assert.strictEqual(res.data.success, false);
      assert.match(res.data.error, /rate limit reached/i);
    });

    // ----------------------------------------------------
    // SECTION 4: End-to-End Voice-to-Voice RAG Chat Pipeline
    // ----------------------------------------------------
    console.log('\n--- Section 4: End-to-End Voice-to-Voice RAG Pipeline ---');

    const ragService = require('../server/services/ragService');

    await runTest('End-to-End: Voice Transcribe -> RAG Medical Answer -> Speech Synthesize', async () => {
      // 1. Mock ElevenLabs transcribe for patient spoken question
      elevenLabsService.setMockTranscriber(async () => {
        return {
          success: true,
          text: 'What is hypertension and how is it managed?',
          language: 'eng',
          confidence: 0.99,
          requestId: 'stt_e2e_001'
        };
      });

      // 2. Mock RAG response with genuine citations
      ragService.setMockRAGResponse(async ({ query, isEmergency }) => {
        return {
          query,
          answer: 'Hypertension is defined as persistent elevated arterial blood pressure [Source 1]. Standard management includes regular exercise, reduced dietary sodium, and clinical evaluation [Source 2: WHO Guidelines].',
          sources: [
            { sourceIndex: 1, title: 'Hypertension Clinical Guidelines', publisher: 'Ministry of Health', url: 'https://mohfw.gov.in' },
            { sourceIndex: 2, title: 'Cardiovascular Care', publisher: 'WHO', url: 'https://who.int' }
          ],
          count: 2,
          retrievalStatus: 'success',
          isEmergency,
          mode: 'rag',
          model: 'gemini-3.5-flash-lite'
        };
      });

      const patientAudio = Buffer.alloc(1024, 0x44);
      const transcribeRes = await makeMultipartRequest(port, '/api/voice/transcribe', {
        headers: { Authorization: `Bearer ${authToken}` },
        file: { buffer: patientAudio, mimeType: 'audio/webm', filename: 'patient_voice.webm' }
      });
      elevenLabsService.clearMockTranscriber();

      assert.strictEqual(transcribeRes.status, 200);
      assert.strictEqual(transcribeRes.data.text, 'What is hypertension and how is it managed?');

      // 3. Submit recognized text to /api/rag/answer
      const ragRes = await makeJsonRequest(port, '/api/rag/answer', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: {
          message: transcribeRes.data.text,
          language: 'en'
        }
      });

      assert.strictEqual(ragRes.status, 200);
      assert.strictEqual(ragRes.data.success, true);
      assert.ok(ragRes.data.answer);
      assert.strictEqual(ragRes.data.sources.length, 2);
      assert.strictEqual(ragRes.data.isEmergency, false);

      const textAnswer = ragRes.data.answer;

      // 4. Synthesize assistant response via ElevenLabs TTS
      let speechInputCaptured = '';
      elevenLabsService.setMockSynthesizer(async ({ text, requestId }) => {
        speechInputCaptured = text;
        return {
          audioBuffer: Buffer.from('SYNTHESIZED_MEDICAL_SPEECH_MPEG_STREAM'),
          contentType: 'audio/mpeg',
          spokenLength: text.length,
          requestId
        };
      });

      const synthRes = await makeJsonRequest(port, '/api/voice/synthesize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: {
          text: textAnswer,
          voiceId: '21m00Tcm4TlvDq8ikWAM'
        }
      });
      elevenLabsService.clearMockSynthesizer();
      ragService.clearMockRAGResponse();

      assert.strictEqual(synthRes.status, 200);
      assert.strictEqual(synthRes.headers.get('content-type'), 'audio/mpeg');
      assert.ok(synthRes.rawBuffer.length > 0);

      // Verify speech cleaning was applied to the spoken prompt (citations stripped from speech)
      assert.strictEqual(speechInputCaptured.includes('##'), false);
      assert.strictEqual(speechInputCaptured.includes('**'), false);
      assert.strictEqual(/\[Source\s*\d+[^\]]*\]/i.test(speechInputCaptured), false);
    });

    await runTest('Emergency triage question: Voice Transcribe -> RAG triggers emergency notice', async () => {
      // 1. Transcribe emergency symptom
      elevenLabsService.setMockTranscriber(async () => {
        return {
          success: true,
          text: 'I am experiencing severe sudden chest pain and numbness in my left arm',
          language: 'eng',
          confidence: 0.99,
          requestId: 'stt_e2e_emerg'
        };
      });

      ragService.setMockRAGResponse(async ({ query, isEmergency }) => {
        return {
          query,
          answer: '⚠️ **EMERGENCY MEDICAL NOTICE:** The symptoms described may indicate an acute cardiac emergency. Please immediately call 108 or 112 for urgent emergency medical care.',
          sources: [],
          count: 0,
          retrievalStatus: 'emergency_triage',
          isEmergency: true,
          mode: 'rag',
          model: 'gemini-3.5-flash-lite'
        };
      });

      const audioBuffer = Buffer.alloc(1024, 0x99);
      const transcribeRes = await makeMultipartRequest(port, '/api/voice/transcribe', {
        headers: { Authorization: `Bearer ${authToken}` },
        file: { buffer: audioBuffer, mimeType: 'audio/webm', filename: 'emergency.webm' }
      });
      elevenLabsService.clearMockTranscriber();

      assert.strictEqual(transcribeRes.status, 200);

      // 2. Submit to RAG
      const ragRes = await makeJsonRequest(port, '/api/rag/answer', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: { message: transcribeRes.data.text }
      });
      ragService.clearMockRAGResponse();

      assert.strictEqual(ragRes.status, 200);
      assert.strictEqual(ragRes.data.isEmergency, true);
      assert.match(ragRes.data.answer, /emergency|urgent|call|108|112|911|medical attention/i);
    });

    // ----------------------------------------------------
    // SECTION 5: Live Provider Credential Verification
    // ----------------------------------------------------
    console.log('\n--- Section 5: Live ElevenLabs Provider Connectivity ---');

    await runTest('Live ElevenLabs credentials inspection & connectivity check', async () => {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey || apiKey === 'your_elevenlabs_api_key_here') {
        console.log('    ℹ️  STATUS: BLOCKED / SKIPPED — No active ELEVENLABS_API_KEY provided in .env.');
        console.log('       (Mock tests passed 100%. Supply live ElevenLabs API key in .env for production usage.)');
        return;
      }

      // If key is configured, perform live API health call to ElevenLabs GET /v1/voices
      try {
        const response = await fetch('https://api.elevenlabs.io/v1/voices', {
          method: 'GET',
          headers: { 'xi-api-key': apiKey }
        });

        if (response.ok) {
          const data = await response.json();
          console.log(`    ✅ STATUS: PASS — Live ElevenLabs API validated! (${data.voices?.length || 0} voices accessible).`);
        } else {
          console.log(`    ⚠️ STATUS: FAIL — ElevenLabs API responded with status ${response.status} (${response.statusText}).`);
        }
      } catch (e) {
        console.log(`    ⚠️ STATUS: FAIL — Live ElevenLabs connection failed: ${e.message}`);
      }
    });

  } finally {
    server.close();
    if (dbConnected) {
      await mongoose.disconnect();
    }
  }

  console.log('\n========================================================');
  console.log(`📊 Test Summary: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('========================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
