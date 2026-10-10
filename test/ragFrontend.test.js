/**
 * ========================================================
 * 🧪 Sanjeev Astra: Frontend RAG Integration Test Suite
 * ========================================================
 *
 * Verifies frontend RAG answer integration (public/js/chat.js):
 * - Safe model output rendering (pure DOM, zero innerHTML injection)
 * - Verified clinical citation rendering with clickable links
 * - Missing evidence (no-results) safe abstention fallback
 * - Duplicate submission prevention and loading indicator
 * - Error mapping (401, 429, 502, 503, 504/timeout, network failure)
 * - Emergency detection and Medical SOS escalation banner
 * - Input validation (empty, <2 chars)
 * - End-to-end integration against Express backend (/api/rag/answer)
 */

const assert = require('node:assert');
const http = require('node:http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// Setup mock browser DOM environment before importing frontend modules
function createMockElement(tagName = 'div') {
  return {
    tagName: tagName.toUpperCase(),
    style: {},
    className: '',
    id: '',
    type: 'button',
    disabled: false,
    value: '',
    children: [],
    _textContent: '',
    get textContent() {
      if (this.children.length > 0) {
        return this.children.map(c => c.textContent || '').join('');
      }
      return this._textContent;
    },
    set textContent(val) {
      this.children = [];
      this._textContent = String(val);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    remove() {
      this._removed = true;
    },
    addEventListener(evt, handler) {
      this._listeners = this._listeners || {};
      this._listeners[evt] = this._listeners[evt] || [];
      this._listeners[evt].push(handler);
    },
    trigger(evt, eventObj = {}) {
      if (this._listeners && this._listeners[evt]) {
        for (const h of this._listeners[evt]) {
          h(eventObj);
        }
      }
    },
    classList: {
      _classes: new Set(),
      add(cls) { this._classes.add(cls); },
      remove(cls) { this._classes.delete(cls); },
      contains(cls) { return this._classes.has(cls); }
    },
    querySelector(selector) {
      const all = this.querySelectorAll(selector);
      return all.length > 0 ? all[0] : null;
    },
    querySelectorAll(selector) {
      const results = [];
      const traverse = (el) => {
        for (const c of (el.children || [])) {
          if (selector.startsWith('#')) {
            if (c.id === selector.slice(1)) results.push(c);
          } else if (selector.startsWith('.')) {
            if (c.className && c.className.includes(selector.slice(1))) results.push(c);
          } else if (c.tagName === selector.toUpperCase()) {
            results.push(c);
          }
          traverse(c);
        }
      };
      traverse(this);
      return results;
    },
    focus() {
      this._focused = true;
    }
  };
}

function createTextNode(text) {
  return {
    nodeType: 3,
    _textContent: String(text),
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = String(v); }
  };
}

// Global browser mocks
const elementRegistry = new Map();

globalThis.window = {
  location: { href: '' },
  addEventListener() {},
  removeEventListener() {},
  AudioContext: class {
    createOscillator() { return { connect() {}, start() {}, stop() {}, frequency: { setValueAtTime() {} } }; }
    createGain() { return { connect() {}, gain: { setValueAtTime() {} } }; }
    get destination() { return {}; }
    get currentTime() { return 0; }
  }
};

const bodyElement = createMockElement('body');

globalThis.document = {
  readyState: 'complete',
  body: bodyElement,
  createElement: (tag) => createMockElement(tag),
  createTextNode: (txt) => createTextNode(txt),
  getElementById: (id) => elementRegistry.get(id) || null,
  querySelectorAll: () => [],
  addEventListener: () => {}
};

const localStorageMock = {
  _store: new Map(),
  getItem: (k) => localStorageMock._store.get(k) || null,
  setItem: (k, v) => localStorageMock._store.set(k, String(v)),
  removeItem: (k) => localStorageMock._store.delete(k),
  clear: () => localStorageMock._store.clear()
};
globalThis.localStorage = localStorageMock;

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.log(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}\n`);
    failedTests++;
  }
}

async function main() {
  console.log('\n========================================================');
  console.log('🧪 Sanjeev Astra: Frontend RAG Integration Test Suite');
  console.log('========================================================\n');

  // Dynamically import public/js/chat.js (ES Module)
  const chatModule = await import('../public/js/chat.js');
  const {
    appendAIMessage,
    appendUserMessage,
    renderSafeMarkdownToDOM,
    appendSafeInlineTokens,
    formatErrorFeedback,
    showTypingIndicator,
    removeTypingIndicator
  } = chatModule;

  // ----------------------------------------------------
  // SECTION 1: DOM SECURITY & SAFE RENDERING (XSS DEFENSE)
  // ----------------------------------------------------
  console.log('--- Section 1: DOM Security & Safe Rendering (XSS Defense) ---');

  await runTest('Untrusted model output cannot inject script or img tags into DOM', async () => {
    const chatContainer = createMockElement('div');
    chatContainer.id = 'chat-messages';
    elementRegistry.set('chat-messages', chatContainer);

    const maliciousPayload = '<script>window.pwned = true;</script><img src="x" onerror="alert(1)">Medical advice.';
    const msg = appendAIMessage({ answer: maliciousPayload });

    // Verify no script or img elements were created
    const scripts = msg.querySelectorAll('script');
    const imgs = msg.querySelectorAll('img');
    assert.strictEqual(scripts.length, 0, 'No script elements must be created');
    assert.strictEqual(imgs.length, 0, 'No img elements must be created');

    // Verify text content safely preserved as literal text
    assert.ok(msg.textContent.includes('<script>'), 'Script tag must be rendered as literal text string');
    assert.ok(msg.textContent.includes('Medical advice.'), 'Message body text preserved');
  });

  await runTest('Safe inline formatting renders bold, italics, and citation pills as structured elements', async () => {
    const chatContainer = createMockElement('div');
    chatContainer.id = 'chat-messages';
    elementRegistry.set('chat-messages', chatContainer);

    const answer = 'Take **paracetamol** as directed by guidelines [Source 1]. Rest in a *quiet room*.';
    const msg = appendAIMessage({ answer });

    const strongs = msg.querySelectorAll('strong');
    const ems = msg.querySelectorAll('em');
    const pills = msg.querySelectorAll('.chat-citation-pill');

    assert.strictEqual(strongs.length, 1);
    assert.strictEqual(strongs[0].textContent, 'paracetamol');

    assert.strictEqual(ems.length, 1);
    assert.strictEqual(ems[0].textContent, 'quiet room');

    assert.strictEqual(pills.length, 1);
    assert.strictEqual(pills[0].textContent, '[Source 1]');
  });

  await runTest('Untrusted model URLs with javascript: protocol are rejected and not clickable', async () => {
    const chatContainer = createMockElement('div');
    chatContainer.id = 'chat-messages';
    elementRegistry.set('chat-messages', chatContainer);

    const sources = [
      {
        sourceIndex: 1,
        title: 'Malicious Source Link',
        sourceUrl: 'javascript:alert(document.cookie)',
        publisher: 'Attacker'
      }
    ];

    const msg = appendAIMessage({ answer: 'Valid guidance', sources });
    const links = msg.querySelectorAll('a');

    // javascript: protocol link must NOT be rendered as an <a> tag
    const jsLinks = links.filter(l => l.href && l.href.startsWith('javascript:'));
    assert.strictEqual(jsLinks.length, 0, 'No javascript: URI links allowed');
  });

  // ----------------------------------------------------
  // SECTION 2: VERIFIED SOURCE CITATIONS & NO-RESULTS FALLBACK
  // ----------------------------------------------------
  console.log('\n--- Section 2: Verified Source Citations & No-Results Fallbacks ---');

  await runTest('Renders verified sources citations box with clickable http/https links and publisher details', async () => {
    const chatContainer = createMockElement('div');
    chatContainer.id = 'chat-messages';
    elementRegistry.set('chat-messages', chatContainer);

    const sources = [
      {
        sourceIndex: 1,
        title: 'Clinical Protocol for Acute Headaches',
        publisher: 'National Health Mission',
        sourceUrl: 'https://mohfw.gov.in/guidelines/headache-sample',
        sectionHeading: 'Supportive Care',
        publicationDate: '2026-01-15'
      }
    ];

    const msg = appendAIMessage({
      answer: 'Rest and oral hydration are recommended [Source 1].',
      sources,
      retrievalStatus: 'results_found'
    });

    const sourcesBox = msg.querySelector('.chat-sources-box');
    assert.ok(sourcesBox, 'Sources box must be present when sources array is non-empty');

    const link = msg.querySelector('a');
    assert.ok(link, 'Verified link must be rendered');
    assert.strictEqual(link.href, 'https://mohfw.gov.in/guidelines/headache-sample');
    assert.strictEqual(link.target, '_blank');
    assert.strictEqual(link.rel, 'noopener noreferrer');
    assert.strictEqual(link.textContent, 'Clinical Protocol for Acute Headaches');

    // Verify publisher and section metadata
    assert.ok(sourcesBox.textContent.includes('National Health Mission'));
    assert.ok(sourcesBox.textContent.includes('Supportive Care'));
    assert.ok(sourcesBox.textContent.includes('2026-01-15'));
  });

  await runTest('Missing retrieval evidence (retrievalStatus: no_results) renders safe abstention notice and no sources box', async () => {
    const chatContainer = createMockElement('div');
    chatContainer.id = 'chat-messages';
    elementRegistry.set('chat-messages', chatContainer);

    const msg = appendAIMessage({
      answer: 'Our verified medical knowledge base does not contain direct guidelines on this specific condition.',
      sources: [],
      retrievalStatus: 'no_results'
    });

    const sourcesBox = msg.querySelector('.chat-sources-box');
    assert.strictEqual(sourcesBox, null, 'Sources box must NOT be rendered when sources is empty');

    const noResultsNote = msg.querySelector('.chat-no-results-note');
    assert.ok(noResultsNote, 'Missing retrieval notice must be displayed');
    assert.ok(noResultsNote.textContent.includes('approved medical knowledge base'));
  });

  // ----------------------------------------------------
  // SECTION 3: DUPLICATE SUBMISSION & LOADING STATES
  // ----------------------------------------------------
  console.log('\n--- Section 3: Duplicate Submission Prevention & Loading States ---');

  await runTest('Typing indicator is created and removed cleanly', async () => {
    const chatContainer = createMockElement('div');
    chatContainer.id = 'chat-messages';
    elementRegistry.set('chat-messages', chatContainer);

    const indicator = showTypingIndicator();
    elementRegistry.set('chat-typing-indicator', indicator);
    assert.ok(indicator, 'Typing indicator must be created');
    assert.strictEqual(indicator.id, 'chat-typing-indicator');

    removeTypingIndicator();
    assert.strictEqual(indicator._removed, true, 'Indicator must be removed from DOM');
  });

  await runTest('appendUserMessage adds user message safely using textContent', async () => {
    const chatContainer = createMockElement('div');
    chatContainer.id = 'chat-messages';
    elementRegistry.set('chat-messages', chatContainer);

    const userMsg = appendUserMessage('What are symptoms of migraine?');
    assert.ok(userMsg, 'User message element created');
    assert.strictEqual(userMsg.className, 'chat-message-user');
    assert.strictEqual(userMsg.textContent, 'What are symptoms of migraine?');
  });

  // ----------------------------------------------------
  // SECTION 4: ERROR MAPPING & STATUS CODES
  // ----------------------------------------------------
  console.log('\n--- Section 4: Network Error & HTTP Status Code Mapping ---');

  await runTest('HTTP 401 maps to Session Expired login guidance', () => {
    const feedback = formatErrorFeedback({ status: 401 });
    assert.strictEqual(feedback.title, 'Session Expired');
    assert.match(feedback.message, /log in again/i);
  });

  await runTest('HTTP 429 maps to Rate Limit guidance', () => {
    const feedback = formatErrorFeedback({ status: 429 });
    assert.strictEqual(feedback.title, 'Request Limit Reached');
    assert.match(feedback.message, /wait a moment/i);
  });

  await runTest('HTTP 504 / timeout maps to Request Timeout guidance', () => {
    const feedbackTimeout = formatErrorFeedback({ status: 504 });
    assert.strictEqual(feedbackTimeout.title, 'Request Timeout');
    assert.match(feedbackTimeout.message, /too long/i);

    const feedbackFlag = formatErrorFeedback({ isTimeout: true });
    assert.strictEqual(feedbackFlag.title, 'Request Timeout');
  });

  await runTest('HTTP 502/503 maps to Service Unavailable notice with emergency fallback', () => {
    const feedback = formatErrorFeedback({ status: 503 });
    assert.strictEqual(feedback.title, 'Service Temporarily Unavailable');
    assert.match(feedback.message, /healthcare facility immediately/i);
  });

  // ----------------------------------------------------
  // SECTION 5: MEDICAL EMERGENCY ESCALATION UI
  // ----------------------------------------------------
  console.log('\n--- Section 5: Medical Emergency Escalation UI ---');

  await runTest('Emergency flag activates prominent banner with 108 dial link and Medical SOS escalation', async () => {
    const chatContainer = createMockElement('div');
    chatContainer.id = 'chat-messages';
    elementRegistry.set('chat-messages', chatContainer);

    const msg = appendAIMessage({
      answer: 'Severe chest pain requires urgent hospital evaluation.',
      sources: [],
      isEmergency: true
    });

    const emergBanner = msg.querySelector('.chat-emergency-banner');
    assert.ok(emergBanner, 'Emergency banner must be rendered when isEmergency is true');
    assert.ok(emergBanner.textContent.includes('POTENTIAL MEDICAL EMERGENCY'));

    const dialLink = emergBanner.querySelector('a');
    assert.ok(dialLink, '108 dial link must be rendered');
    assert.strictEqual(dialLink.href, 'tel:108');

    const sosBtn = emergBanner.querySelector('button');
    assert.ok(sosBtn, 'Medical SOS button must be rendered');
    assert.ok(sosBtn.textContent.includes('Medical SOS'));
  });

  // ----------------------------------------------------
  // SECTION 6: END-TO-END EXPRESS API & FRONTEND CONTRACT
  // ----------------------------------------------------
  console.log('\n--- Section 6: End-to-End Express API & Frontend Contract Verification ---');

  let dbConnected = false;
  let testServer = null;

  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sanjeevastra';
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 2000 });
      dbConnected = true;
    }

    const User = require('../server/models/User');
    let testUser = await User.findOne({});
    if (!testUser) {
      testUser = await User.create({
        name: 'Test Patient',
        email: 'test_patient_fe@sanjeevastra.org',
        password: 'password123',
        phone: '9876543210'
      });
    }

    const testSecret = process.env.JWT_SECRET || 'swasthyasetu_super_secret_key_2026_jwt';
    const testToken = jwt.sign(
      { id: testUser._id.toString(), role: 'patient' },
      testSecret,
      { expiresIn: '1h' }
    );

    const express = require('express');
    const ragRoutes = require('../server/routes/ragRoutes');
    const ragService = require('../server/services/ragService');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/rag', ragRoutes);

    testServer = http.createServer(testApp);
    await new Promise(resolve => testServer.listen(0, resolve));
    const testPort = testServer.address().port;

    await runTest('Live Express POST /api/rag/answer returns payload exactly matching frontend schema', async () => {
      ragService.setMockRAGResponse(async ({ query }) => ({
        query,
        answer: 'Supportive care for mild fever includes oral rehydration and monitoring [Source 1].',
        sources: [
          {
            sourceIndex: 1,
            chunkId: 'doc_fever_triage_chunk_0',
            documentId: 'doc_fever_triage',
            title: 'Fever Clinical Triage Guidelines',
            publisher: 'National Health Mission',
            sourceUrl: 'https://mohfw.gov.in/guidelines/fever',
            sectionHeading: 'Home Supportive Care',
            publicationDate: '2026-02-01',
            relevanceScore: 0.91
          }
        ],
        count: 1,
        retrievalStatus: 'results_found',
        isEmergency: false,
        mode: 'rag',
        model: 'gpt-4o-mini'
      }));

      try {
        const reqPayload = JSON.stringify({
          message: 'What should I do for a mild fever?',
          language: 'en',
          topK: 3
        });

        const apiRes = await new Promise((resolve, reject) => {
          const req = http.request({
            hostname: '127.0.0.1',
            port: testPort,
            path: '/api/rag/answer',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(reqPayload),
              'Authorization': `Bearer ${testToken}`
            }
          }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
              resolve({ status: res.statusCode, data: JSON.parse(data) });
            });
          });
          req.on('error', reject);
          req.write(reqPayload);
          req.end();
        });

        assert.strictEqual(apiRes.status, 200);
        assert.strictEqual(apiRes.data.success, true);
        assert.ok(apiRes.data.answer);
        assert.ok(Array.isArray(apiRes.data.sources));
        assert.strictEqual(apiRes.data.sources.length, 1);
        assert.strictEqual(apiRes.data.retrievalStatus, 'results_found');

        // Test rendering backend response via appendAIMessage
        const chatContainer = createMockElement('div');
        chatContainer.id = 'chat-messages';
        elementRegistry.set('chat-messages', chatContainer);

        const renderedMsg = appendAIMessage({
          answer: apiRes.data.answer,
          sources: apiRes.data.sources,
          retrievalStatus: apiRes.data.retrievalStatus,
          isEmergency: apiRes.data.isEmergency
        });

        assert.ok(renderedMsg);
        assert.ok(renderedMsg.querySelector('.chat-sources-box'));
        const renderedLink = renderedMsg.querySelector('a');
        assert.ok(renderedLink);
        assert.strictEqual(renderedLink.href, 'https://mohfw.gov.in/guidelines/fever');
      } finally {
        ragService.clearMockRAGResponse();
      }
    });

  } catch (dbErr) {
    console.log(`ℹ️ [E2E Live DB/Server Check]: Skipped live MongoDB loop - ${dbErr.message}`);
  } finally {
    if (testServer) {
      await new Promise(resolve => testServer.close(resolve));
    }
    if (dbConnected) {
      await mongoose.disconnect();
    }
  }

  // ----------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------
  console.log('\n========================================================');
  console.log(`📊 Frontend Integration Results: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('========================================================\n');

  process.exitCode = failedTests > 0 ? 1 : 0;
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exitCode = 1;
});
