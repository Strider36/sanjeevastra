require('dotenv').config();
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// Import server components
const IdempotencyLog = require('../server/models/IdempotencyLog');
const { checkIdempotency } = require('../server/middleware/idempotencyMiddleware');
const appointmentRoutes = require('../server/routes/appointmentRoutes');
const recordRoutes = require('../server/routes/recordRoutes');
const User = require('../server/models/User');

let passedTests = 0;
let failedTests = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failedTests++;
  }
}

function createIdempotencyTestApp() {
  const app = express();
  app.use(express.json());

  // Mock authenticated user middleware
  app.use((req, res, next) => {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.split(' ')[1];
      try {
        req.user = jwt.verify(token, process.env.JWT_SECRET || 'testsecret123');
      } catch (e) {
        req.user = null;
      }
    }
    next();
  });

  let counter = 0;
  // Route with idempotency check
  app.post('/api/test-mutation', checkIdempotency, (req, res) => {
    counter++;
    res.status(201).json({
      success: true,
      data: { executionCount: counter, body: req.body }
    });
  });

  return { app, getCounter: () => counter };
}

function executeRequest(app, method, url, body, headers = {}) {
  return new Promise((resolve) => {
    const http = require('http');
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const reqHeaders = { ...headers };
      let payload = '';

      if (body) {
        payload = JSON.stringify(body);
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(payload);
      }

      const clientReq = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: url,
          method,
          headers: reqHeaders
        },
        (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            server.close();
            let parsed = null;
            try {
              parsed = JSON.parse(data);
            } catch (e) {
              parsed = data;
            }
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: parsed
            });
          });
        }
      );

      clientReq.on('error', err => {
        server.close();
        resolve({ status: 500, error: err.message });
      });

      if (payload) clientReq.write(payload);
      clientReq.end();
    });
  });
}

async function runOfflineStackTests() {
  console.log('\n======================================================');
  console.log('  Sanjeev Astra — Offline-First & Sync Architecture Test');
  console.log('======================================================\n');

  // Connect to test database if needed
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/swasthyasetu';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
  }

  // Clean test idempotency entries
  await IdempotencyLog.deleteMany({ key: { $regex: /^test-/ } });

  const testUser = {
    _id: new mongoose.Types.ObjectId().toString(),
    email: 'offline.patient@test.com',
    role: 'patient'
  };
  const token = jwt.sign(testUser, process.env.JWT_SECRET || 'testsecret123', { expiresIn: '1h' });

  // ----------------------------------------------------
  // SUITE 1: Service Worker Application Shell Caching
  // ----------------------------------------------------
  console.log('--- Suite 1: Service Worker & App Shell Configuration ---');

  await test('SW file exists and defines versioned cache name', async () => {
    const swPath = path.join(__dirname, '../public/sw.js');
    assert.ok(fs.existsSync(swPath), 'public/sw.js must exist');
    const swContent = fs.readFileSync(swPath, 'utf8');
    assert.ok(swContent.includes('CACHE_NAME'), 'SW must define CACHE_NAME');
    assert.ok(/sanjeev-astra-shell-v\d+/.test(swContent), 'SW cache name must follow versioned convention');
  });

  await test('SW precaches core application pages and static assets', async () => {
    const swContent = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
    const expectedAssets = [
      '/',
      '/index.html',
      '/dashboard.html',
      '/appointments.html',
      '/records.html',
      '/profile.html',
      '/login.html',
      '/offline.html',
      '/css/variables.css',
      '/css/main.css',
      '/css/components.css',
      '/js/api.js',
      '/js/db.js',
      '/js/dexie.mjs',
      '/js/syncEngine.js',
      '/js/networkStatus.js',
      '/manifest.json'
    ];

    for (const asset of expectedAssets) {
      assert.ok(swContent.includes(asset), `SW must precache asset: ${asset}`);
    }
  });

  await test('SW strictly bypasses /api/ requests from Service Worker cache', async () => {
    const swContent = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
    assert.ok(
      swContent.includes("url.pathname.startsWith('/api/')"),
      'SW must check and bypass API endpoints to protect sensitive medical records'
    );
  });

  await test('SW provides /offline.html fallback for navigation requests', async () => {
    const swContent = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
    assert.ok(
      swContent.includes('/offline.html'),
      'SW must route failed navigations to offline fallback page'
    );
  });

  await test('SW activates and purges outdated cache versions safely', async () => {
    const swContent = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
    assert.ok(swContent.includes('caches.keys()'), 'SW must enumerate cache keys on activation');
    assert.ok(swContent.includes('caches.delete'), 'SW must delete obsolete cache buckets');
    assert.ok(swContent.includes('self.clients.claim()'), 'SW must claim clients on activation');
  });

  // ----------------------------------------------------
  // SUITE 2: PWA Web Manifest & Offline Fallback Shell
  // ----------------------------------------------------
  console.log('\n--- Suite 2: PWA Manifest & Offline Fallback Page ---');

  await test('Web manifest contains valid PWA configuration and icons', async () => {
    const manifestPath = path.join(__dirname, '../public/manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifest.name, 'Sanjeev Astra - AI Healthcare Navigation');
    assert.strictEqual(manifest.display, 'standalone');
    assert.ok(manifest.theme_color, 'Manifest must specify a theme_color');
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'Manifest must declare at least 2 icons');

    const icon192 = path.join(__dirname, '../public/icons/icon-192.svg');
    const icon512 = path.join(__dirname, '../public/icons/icon-512.svg');
    assert.ok(fs.existsSync(icon192), 'icon-192.svg must exist');
    assert.ok(fs.existsSync(icon512), 'icon-512.svg must exist');
  });

  await test('Offline fallback page contains emergency hotlines and navigation links', async () => {
    const offlineHtmlPath = path.join(__dirname, '../public/offline.html');
    assert.ok(fs.existsSync(offlineHtmlPath), 'offline.html must exist');
    const offlineContent = fs.readFileSync(offlineHtmlPath, 'utf8');
    assert.ok(offlineContent.includes('tel:112'), 'Offline fallback must provide direct dial to 112');
    assert.ok(offlineContent.includes('tel:108'), 'Offline fallback must provide direct dial to 108');
    assert.ok(offlineContent.includes('/dashboard.html'), 'Offline fallback must provide link to cached dashboard');
    assert.ok(offlineContent.includes('/appointments.html'), 'Offline fallback must provide link to cached appointments');
    assert.ok(offlineContent.includes('/records.html'), 'Offline fallback must provide link to cached records');
    assert.ok(offlineContent.includes("window.addEventListener('online'"), 'Offline page must listen for reconnection');
  });

  // ----------------------------------------------------
  // SUITE 3: Server-Side Idempotency & Deduplication
  // ----------------------------------------------------
  console.log('\n--- Suite 3: Server-Side Idempotency & Mutation Deduplication ---');

  await test('IdempotencyLog model enforces 24h TTL index and compound uniqueness', async () => {
    const indexes = IdempotencyLog.schema.indexes();
    const ttlIndex = indexes.find(idx => idx[0].createdAt === 1 && idx[1] && idx[1].expireAfterSeconds === 86400);
    assert.ok(ttlIndex, 'IdempotencyLog must define 24-hour TTL index (expireAfterSeconds: 86400)');

    const uniqueIndex = indexes.find(idx => idx[0].key === 1 && idx[0].user === 1 && idx[1] && idx[1].unique);
    assert.ok(uniqueIndex, 'IdempotencyLog must define compound unique index { key: 1, user: 1 }');
  });

  await test('First request with idempotency key executes successfully and stores log', async () => {
    const { app, getCounter } = createIdempotencyTestApp();
    const key = `test-key-${Date.now()}`;

    const res = await executeRequest(
      app,
      'POST',
      '/api/test-mutation',
      { doctor: 'Dr. Sharma', notes: 'First submission' },
      {
        Authorization: `Bearer ${token}`,
        'X-Idempotency-Key': key
      }
    );

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.executionCount, 1);
    assert.strictEqual(getCounter(), 1);

    // Verify stored log in MongoDB
    const log = await IdempotencyLog.findOne({ key, user: testUser._id });
    assert.ok(log, 'IdempotencyLog entry must be saved in database');
    assert.strictEqual(log.statusCode, 201);
  });

  await test('Replayed request with identical idempotency key returns cached response without re-executing', async () => {
    const { app, getCounter } = createIdempotencyTestApp();
    const key = `test-replay-${Date.now()}`;

    // Execution 1
    const res1 = await executeRequest(
      app,
      'POST',
      '/api/test-mutation',
      { test: 'data' },
      { Authorization: `Bearer ${token}`, 'X-Idempotency-Key': key }
    );
    assert.strictEqual(res1.status, 201);
    assert.strictEqual(getCounter(), 1);

    // Execution 2 (Replay)
    const res2 = await executeRequest(
      app,
      'POST',
      '/api/test-mutation',
      { test: 'data' },
      { Authorization: `Bearer ${token}`, 'X-Idempotency-Key': key }
    );

    assert.strictEqual(res2.status, 201);
    assert.strictEqual(res2.headers['x-cache'], 'IDEMPOTENT_REPLAY', 'Response header must indicate IDEMPOTENT_REPLAY');
    assert.strictEqual(res2.body.data.executionCount, 1, 'Counter must not increment; body must match cached response');
    assert.strictEqual(getCounter(), 1, 'Controller must not have run a second time');
  });

  await test('Idempotency keys are strictly scoped per authenticated user', async () => {
    const { app, getCounter } = createIdempotencyTestApp();
    const sharedKey = `test-shared-key-${Date.now()}`;

    const otherUser = {
      _id: new mongoose.Types.ObjectId().toString(),
      email: 'other.user@test.com',
      role: 'patient'
    };
    const otherToken = jwt.sign(otherUser, process.env.JWT_SECRET || 'testsecret123', { expiresIn: '1h' });

    // User 1 executes
    await executeRequest(
      app,
      'POST',
      '/api/test-mutation',
      { user: 1 },
      { Authorization: `Bearer ${token}`, 'X-Idempotency-Key': sharedKey }
    );
    assert.strictEqual(getCounter(), 1);

    // User 2 executes with identical key -> must execute separately for User 2
    const resUser2 = await executeRequest(
      app,
      'POST',
      '/api/test-mutation',
      { user: 2 },
      { Authorization: `Bearer ${otherToken}`, 'X-Idempotency-Key': sharedKey }
    );

    assert.strictEqual(resUser2.status, 201);
    assert.strictEqual(getCounter(), 2, 'Different user must execute their own operation despite same key name');
    assert.strictEqual(resUser2.headers['x-cache'], undefined);
  });

  // ----------------------------------------------------
  // SUITE 4: IndexedDB Data Architecture & Dexie Schema
  // ----------------------------------------------------
  console.log('\n--- Suite 4: IndexedDB Client Data Architecture & Security ---');

  await test('db.js defines all required Dexie tables with composite indices', async () => {
    const dbPath = path.join(__dirname, '../public/js/db.js');
    assert.ok(fs.existsSync(dbPath), 'db.js must exist');
    const dbContent = fs.readFileSync(dbPath, 'utf8');

    const requiredStores = [
      'userProfiles',
      'dashboardSummaries',
      'healthRecords',
      'appointments',
      'prescriptions',
      'medicines',
      'chatHistory',
      'drafts',
      'syncQueue',
      'syncMeta'
    ];

    for (const store of requiredStores) {
      assert.ok(dbContent.includes(store), `db.js must define store: ${store}`);
    }

    assert.ok(dbContent.includes('[userId+_id]') || dbContent.includes('[userId+id]'), 'db.js must use compound indexing [userId+_id]');
    assert.ok(dbContent.includes('[userId+date]'), 'db.js must use compound indexing [userId+date]');
    assert.ok(dbContent.includes('[userId+type]'), 'db.js must use compound indexing [userId+type]');
  });

  await test('purgeUserData strictly deletes only the logging out user data from IndexedDB', async () => {
    const dbContent = fs.readFileSync(path.join(__dirname, '../public/js/db.js'), 'utf8');
    assert.ok(dbContent.includes('async purgeUserData(userId)'), 'db.js must implement purgeUserData');
    assert.ok(dbContent.includes("healthRecords.where('userId')"), 'purgeUserData must delete healthRecords for user');
    assert.ok(dbContent.includes("appointments.where('userId')"), 'purgeUserData must delete appointments for user');
    assert.ok(dbContent.includes("chatHistory.where('userId')"), 'purgeUserData must delete chatHistory for user');
    assert.ok(dbContent.includes("drafts.where('userId')"), 'purgeUserData must delete drafts for user');
    assert.ok(dbContent.includes("syncQueue.where('userId')"), 'purgeUserData must delete syncQueue for user');
  });

  await test('Logout function in api.js calls offlineStorage.purgeUserData before clearing session', async () => {
    const apiContent = fs.readFileSync(path.join(__dirname, '../public/js/api.js'), 'utf8');
    assert.ok(apiContent.includes('offlineStorage.purgeUserData(userId)'), 'api.js logout must invoke purgeUserData');
    assert.ok(apiContent.includes("localStorage.removeItem('user')"), 'api.js logout must remove user');
    assert.ok(apiContent.includes('removeToken()'), 'api.js logout must remove auth token');
  });

  // ----------------------------------------------------
  // SUITE 5: Outbox Synchronization Engine Logic
  // ----------------------------------------------------
  console.log('\n--- Suite 5: Outbox Synchronization Engine & Retry Strategy ---');

  await test('syncEngine implements exponential backoff with jitter and max attempt limits', async () => {
    const syncContent = fs.readFileSync(path.join(__dirname, '../public/js/syncEngine.js'), 'utf8');
    assert.ok(syncContent.includes('calculateBackoffDelay(attempt'), 'syncEngine must calculate backoff delay');
    assert.ok(syncContent.includes('Math.min(baseDelay * Math.pow(2, attempt)'), 'syncEngine must use exponential power');
    assert.ok(syncContent.includes('jitter'), 'syncEngine must apply randomized jitter to prevent thundering herd');
    assert.ok(syncContent.includes('maxAttempts'), 'syncEngine must enforce max retry attempts');
  });

  await test('syncEngine categorizes 4xx client errors as non-retryable and 5xx as retryable', async () => {
    const syncContent = fs.readFileSync(path.join(__dirname, '../public/js/syncEngine.js'), 'utf8');
    assert.ok(syncContent.includes('isFatalClientError'), 'syncEngine must identify fatal client errors');
    assert.ok(syncContent.includes('status === 400') || syncContent.includes('status >= 400'), '400 must be treated as fatal');
    assert.ok(syncContent.includes('status === 404') || syncContent.includes('status < 500'), '404 must be treated as fatal');
    assert.ok(syncContent.includes('status === 422') || syncContent.includes('status !== 429'), '422 must be treated as fatal');
  });

  await test('syncEngine coordinates multi-tab execution using web locks and timestamp fallback', async () => {
    const syncContent = fs.readFileSync(path.join(__dirname, '../public/js/syncEngine.js'), 'utf8');
    assert.ok(syncContent.includes("navigator.locks.request('sanjeev_sync_lock'"), 'syncEngine must use Web Locks API');
    assert.ok(syncContent.includes('sync_lock_ts'), 'syncEngine must implement fallback lock timestamp');
  });

  // ----------------------------------------------------
  // SUITE 6: Feature-Specific Offline Safety Verification
  // ----------------------------------------------------
  console.log('\n--- Suite 6: Feature-Specific Safety & Offline Guarantees ---');

  await test('Appointments controller supports offline draft queueing with idempotency keys', async () => {
    const apptContent = fs.readFileSync(path.join(__dirname, '../public/js/appointments.js'), 'utf8');
    assert.ok(apptContent.includes("offlineStorage.saveDraft(userId, 'appointment'"), 'appointments.js must save offline draft');
    assert.ok(apptContent.includes("syncEngine.enqueueOperation("), 'appointments.js must enqueue operation in syncEngine');
    assert.ok(apptContent.includes('idempotencyKey'), 'appointments.js must generate idempotencyKey');
    assert.ok(apptContent.includes('Pending Server Confirmation'), 'appointments.js must label unconfirmed draft clearly');
  });

  await test('Health Records controller prevents offline uploads and sharing grants', async () => {
    const recContent = fs.readFileSync(path.join(__dirname, '../public/js/records.js'), 'utf8');
    assert.ok(recContent.includes('if (!navigator.onLine)'), 'records.js must verify connectivity before upload/share');
    assert.ok(recContent.includes('offlineStorage.getHealthRecords'), 'records.js must fallback to offlineStorage for cached records');
    assert.ok(recContent.includes('Offline Read-Only Health Locker'), 'records.js must inform patient of offline limitations');
  });

  await test('AI Chat prevents fabricated offline responses and preserves drafts in IndexedDB', async () => {
    const chatContent = fs.readFileSync(path.join(__dirname, '../public/js/chat.js'), 'utf8');
    assert.ok(chatContent.includes('if (!navigator.onLine)'), 'chat.js must check connectivity before calling RAG API');
    assert.ok(chatContent.includes("offlineStorage.saveChatMessage(userId"), 'chat.js must store messages in IndexedDB');
    assert.ok(chatContent.includes('Offline Mode Active'), 'chat.js must display transparent offline notice to user');
  });

  await test('ElevenLabs voice engine is disabled while offline to avoid broken cloud audio', async () => {
    const chatContent = fs.readFileSync(path.join(__dirname, '../public/js/chat.js'), 'utf8');
    assert.ok(chatContent.includes('Voice Unavailable Offline'), 'chat.js must block voice recording while offline');
  });

  await test('Emergency SOS displays unmistakable offline warning and never claims server delivery', async () => {
    const sosContent = fs.readFileSync(path.join(__dirname, '../public/js/sos.js'), 'utf8');
    assert.ok(sosContent.includes('DEVICE IS OFFLINE — EMERGENCY NOT DELIVERED TO SERVER'), 'sos.js must show prominent offline warning');
    assert.ok(sosContent.includes('Call 112 (National Emergency)'), 'sos.js must provide direct 112 calling button');
    assert.ok(sosContent.includes('Call 108 (Ambulance Dispatch)'), 'sos.js must provide direct 108 calling button');
    assert.ok(sosContent.includes('LOCAL / PENDING'), 'sos.js must label offline status as LOCAL / PENDING instead of SERVER CONFIRMED');
    assert.ok(sosContent.includes('ageMinutes > 20'), 'sos.js must expire stale emergency alerts (>20 min) instead of dispatching stale ambulances');
  });

  // Clean test logs
  await IdempotencyLog.deleteMany({ key: { $regex: /^test-/ } });
  await mongoose.disconnect();

  console.log('\n======================================================');
  console.log(`  Tests Passed: ${passedTests} | Tests Failed: ${failedTests}`);
  console.log('======================================================\n');

  process.exit(failedTests > 0 ? 1 : 0);
}

runOfflineStackTests().catch(err => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
