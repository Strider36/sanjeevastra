const assert = require('assert');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

// Services & Controllers under test
const llmService = require('../server/services/llmService');
const { createRateLimiter } = require('../server/middleware/rateLimitMiddleware');
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

  // Mount ragRoutes at /api/rag
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
  console.log('🧪 Sanjeev Astra: LLM Backend Connection Test Suite');
  console.log('========================================================\n');

  // Connect to DB if available
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

  // ----------------------------------------------------
  // SECTION 1: Healthcare Safety & Prompt Instructions
  // ----------------------------------------------------
  console.log('\n--- Section 1: Healthcare System Instructions & Guidelines ---');

  await runTest('System prompt explicitly states assistant identity and NOT a doctor', () => {
    assert.match(llmService.SYSTEM_PROMPT_TEMPLATE, /informational assistant, NOT a medical doctor/i);
  });

  await runTest('System prompt explicitly prohibits prescribing medicines or dosages', () => {
    assert.match(llmService.SYSTEM_PROMPT_TEMPLATE, /Never prescribe medications/i);
    assert.match(llmService.SYSTEM_PROMPT_TEMPLATE, /No Prescriptions or Invented Dosages/i);
  });

  await runTest('System prompt includes emergency symptoms & emergency care routing (112 / 108)', () => {
    assert.match(llmService.SYSTEM_PROMPT_TEMPLATE, /emergency symptoms/i);
    assert.match(llmService.SYSTEM_PROMPT_TEMPLATE, /112/);
    assert.match(llmService.SYSTEM_PROMPT_TEMPLATE, /108/);
  });

  await runTest('System prompt clarifies document retrieval (RAG) is not active in this milestone', () => {
    assert.match(llmService.SYSTEM_PROMPT_TEMPLATE, /Document retrieval \(RAG\) is currently not active/i);
  });

  await runTest('System prompt supports multilingual guidance (Hindi & Marathi Devanagari)', () => {
    assert.match(llmService.SYSTEM_PROMPT_TEMPLATE, /Hindi or Marathi/i);
    assert.match(llmService.SYSTEM_PROMPT_TEMPLATE, /Devanagari script/i);
  });

  // ----------------------------------------------------
  // SECTION 2: LLM Service Unit Verification (Mocked Provider)
  // ----------------------------------------------------
  console.log('\n--- Section 2: LLM Service Unit Verification (Mocked Provider) ---');

  await runTest('Missing OPENAI_API_KEY throws a 503 configuration error without leaking secrets', async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      await llmService.generateChatResponse({ message: 'What is paracetamol?' });
      assert.fail('Should have thrown an error');
    } catch (err) {
      assert.strictEqual(err.statusCode, 503);
      assert.strictEqual(err.code, 'CONFIG_MISSING');
      assert.match(err.userMessage, /OPENAI_API_KEY is missing/);
    } finally {
      if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    }
  });

  await runTest('Mocked LLM provider generates valid response with expected structure', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async (payload) => {
            assert.strictEqual(payload.messages.length, 2);
            assert.strictEqual(payload.messages[0].role, 'system');
            assert.strictEqual(payload.messages[1].role, 'user');
            assert.strictEqual(payload.messages[1].content, 'What are causes of headaches?');

            return {
              choices: [
                {
                  message: {
                    content: 'Headaches can be caused by dehydration, stress, tension, or lack of sleep.'
                  }
                }
              ]
            };
          }
        }
      }
    };

    const res = await llmService.generateChatResponse({
      message: 'What are causes of headaches?',
      language: 'en',
      clientOverride: mockClient
    });

    assert.strictEqual(res.mode, 'llm');
    assert.deepStrictEqual(res.sources, []);
    assert.match(res.answer, /Headaches can be caused by dehydration/);
  });

  await runTest('Upstream 401 provider error maps to 502 with safe user message', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () => {
            const err = new Error('Incorrect API key provided: sk-secret-123456');
            err.status = 401;
            err.name = 'AuthenticationError';
            throw err;
          }
        }
      }
    };

    try {
      await llmService.generateChatResponse({
        message: 'Hello',
        clientOverride: mockClient
      });
      assert.fail('Expected exception');
    } catch (err) {
      assert.strictEqual(err.statusCode, 502);
      assert.match(err.userMessage, /authentication failed/i);
      assert.doesNotMatch(err.userMessage, /sk-secret/i);
    }
  });

  await runTest('Upstream 429 provider rate limit error maps to 429 with safe user message', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () => {
            const err = new Error('Rate limit reached for requests');
            err.status = 429;
            err.name = 'RateLimitError';
            throw err;
          }
        }
      }
    };

    try {
      await llmService.generateChatResponse({
        message: 'Hello',
        clientOverride: mockClient
      });
      assert.fail('Expected exception');
    } catch (err) {
      assert.strictEqual(err.statusCode, 429);
      assert.match(err.userMessage, /rate limit exceeded/i);
    }
  });

  await runTest('Upstream timeout maps to 504 with safe user message', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () => {
            const err = new Error('Connection timeout');
            err.name = 'APIConnectionTimeoutError';
            err.code = 'ETIMEDOUT';
            throw err;
          }
        }
      }
    };

    try {
      await llmService.generateChatResponse({
        message: 'Hello',
        clientOverride: mockClient
      });
      assert.fail('Expected exception');
    } catch (err) {
      assert.strictEqual(err.statusCode, 504);
      assert.match(err.userMessage, /timed out/i);
    }
  });

  // ----------------------------------------------------
  // SECTION 3: Rate Limiter Middleware Unit Tests
  // ----------------------------------------------------
  console.log('\n--- Section 3: Rate Limiter Middleware ---');

  await runTest('Rate limiter enforces max requests within window', async () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 2, message: 'Too many requests' });
    const req = { ip: '127.0.0.1' };
    const createRes = () => {
      const res = {
        statusCode: 200,
        headers: {},
        setHeader: (k, v) => { res.headers[k] = v; },
        status: (code) => { res.statusCode = code; return res; },
        json: (payload) => { res.body = payload; return res; }
      };
      return res;
    };

    let nextCalled = 0;
    const next = () => { nextCalled++; };

    // Request 1: allowed
    limiter(req, createRes(), next);
    assert.strictEqual(nextCalled, 1);

    // Request 2: allowed
    limiter(req, createRes(), next);
    assert.strictEqual(nextCalled, 2);

    // Request 3: blocked with 429
    const blockedRes = createRes();
    limiter(req, blockedRes, next);
    assert.strictEqual(nextCalled, 2);
    assert.strictEqual(blockedRes.statusCode, 429);
    assert.strictEqual(blockedRes.body.success, false);
    assert.match(blockedRes.body.error, /Too many requests/);
  });

  // ----------------------------------------------------
  // SECTION 4: HTTP Endpoint Integration Tests (POST /api/rag/chat)
  // ----------------------------------------------------
  console.log('\n--- Section 4: HTTP Endpoint Integration (/api/rag/chat) ---');

  const { server, port } = await startTestServer();

  try {
    await runTest('Rejects request without Authorization header (401)', async () => {
      const res = await makeRequest(port, '/api/rag/chat', {
        method: 'POST',
        body: { message: 'What is ibuprofen?' }
      });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.success, false);
      assert.match(res.data.error, /Not authorized, no token provided/);
    });

    await runTest('Rejects request with invalid JWT token (401)', async () => {
      const res = await makeRequest(port, '/api/rag/chat', {
        method: 'POST',
        headers: { Authorization: 'Bearer invalid_garbage_token' },
        body: { message: 'What is ibuprofen?' }
      });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.success, false);
      assert.match(res.data.error, /token verification failed/);
    });

    if (dbConnected && testUserId) {
      const validToken = jwt.sign({ id: testUserId }, JWT_SECRET, { expiresIn: '1h' });
      const authHeaders = { Authorization: `Bearer ${validToken}` };

      await runTest('Rejects missing message field with 400', async () => {
        const res = await makeRequest(port, '/api/rag/chat', {
          method: 'POST',
          headers: authHeaders,
          body: { language: 'en' }
        });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.data.success, false);
        assert.match(res.data.error, /"message" is required and must be a string/);
      });

      await runTest('Rejects empty message string with 400', async () => {
        const res = await makeRequest(port, '/api/rag/chat', {
          method: 'POST',
          headers: authHeaders,
          body: { message: '' }
        });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.data.success, false);
        assert.match(res.data.error, /Message cannot be empty/);
      });

      await runTest('Rejects whitespace-only message with 400', async () => {
        const res = await makeRequest(port, '/api/rag/chat', {
          method: 'POST',
          headers: authHeaders,
          body: { message: '     \n  \t  ' }
        });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.data.success, false);
        assert.match(res.data.error, /Message cannot be empty/);
      });

      await runTest('Rejects message exceeding maximum allowed length (>2000 chars) with 400', async () => {
        const longMessage = 'A'.repeat(2001);
        const res = await makeRequest(port, '/api/rag/chat', {
          method: 'POST',
          headers: authHeaders,
          body: { message: longMessage }
        });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.data.success, false);
        assert.match(res.data.error, /Message exceeds maximum allowed length/);
      });

      await runTest('When OPENAI_API_KEY is unset, returns 503 server configuration error', async () => {
        const savedKey = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;

        try {
          const res = await makeRequest(port, '/api/rag/chat', {
            method: 'POST',
            headers: authHeaders,
            body: { message: 'How to manage fever at home?' }
          });

          assert.strictEqual(res.status, 503);
          assert.strictEqual(res.data.success, false);
          assert.match(res.data.error, /OPENAI_API_KEY is missing/);
        } finally {
          if (savedKey) process.env.OPENAI_API_KEY = savedKey;
        }
      });

      await runTest('End-to-End: Valid authenticated request returns 200 with answer, sources, and mode', async () => {
        llmService.setMockResponse(async ({ message, language }) => {
          return {
            answer: `Educational guidance regarding: ${message}. Please consult a physician.`,
            sources: [],
            mode: 'llm',
            model: 'gpt-4o-mini'
          };
        });

        try {
          const res = await makeRequest(port, '/api/rag/chat', {
            method: 'POST',
            headers: authHeaders,
            body: {
              message: 'What are common causes of a headache?',
              language: 'en'
            }
          });

          assert.strictEqual(res.status, 200);
          assert.strictEqual(res.data.success, true);
          assert.strictEqual(res.data.mode, 'llm');
          assert.deepStrictEqual(res.data.sources, []);
          assert.match(res.data.answer, /Educational guidance regarding/);
        } finally {
          llmService.clearMockResponse();
        }
      });

      await runTest('End-to-End: Supports regional language input (Hindi & Marathi)', async () => {
        let receivedLang = null;
        llmService.setMockResponse(async ({ message, language }) => {
          receivedLang = language;
          return {
            answer: 'डोकेदुखीची सामान्य कारणे म्हणजे तणाव किंवा पाण्याची कमतरता.',
            sources: [],
            mode: 'llm',
            model: 'gpt-4o-mini'
          };
        });

        try {
          const res = await makeRequest(port, '/api/rag/chat', {
            method: 'POST',
            headers: authHeaders,
            body: {
              message: 'डोकेदुखी का होते?',
              language: 'mr'
            }
          });

          assert.strictEqual(res.status, 200);
          assert.strictEqual(receivedLang, 'mr');
          assert.strictEqual(res.data.success, true);
          assert.match(res.data.answer, /डोकेदुखी/);
        } finally {
          llmService.clearMockResponse();
        }
      });

    } else {
      console.log('  ⚠️ Skipping user-authenticated integration steps: requires live MongoDB user.');
    }

  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  // ----------------------------------------------------
  // SECTION 5: Real LLM API Connectivity Check
  // ----------------------------------------------------
  console.log('\n--- Section 5: Real LLM API Connectivity Check ---');
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) {
    console.log('🔑 OPENAI_API_KEY detected in environment. Initiating live API test...');
    await runTest('Live OpenAI API completion call succeeds', async () => {
      const res = await llmService.generateChatResponse({
        message: 'Say hello in 5 words or less.',
        language: 'en'
      });
      assert.strictEqual(res.success !== false, true);
      assert.ok(res.answer.length > 0);
      assert.strictEqual(res.mode, 'llm');
      console.log(`     Live LLM Response: "${res.answer}"`);
    });
  } else {
    console.log('ℹ️ [Real API Connectivity]: SKIPPED - No OPENAI_API_KEY configured in environment.');
    console.log('   All automated unit, integration, validation, rate limiting, and mock tests executed.');
    console.log('   To test real connectivity, add your key to .env: OPENAI_API_KEY=sk-...');
  }

  // ----------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------
  console.log('\n========================================================');
  console.log(`📊 Test Results: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('========================================================\n');

  if (dbConnected) {
    await mongoose.disconnect();
  }

  process.exitCode = failedTests > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exitCode = 1;
});
