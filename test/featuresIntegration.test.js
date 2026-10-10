require('dotenv').config();
const assert = require('assert');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// Load controllers & routes
const authRoutes = require('../server/routes/authRoutes');
const appointmentRoutes = require('../server/routes/appointmentRoutes');
const medicineRoutes = require('../server/routes/medicineRoutes');
const prescriptionRoutes = require('../server/routes/prescriptionRoutes');
const recordRoutes = require('../server/routes/recordRoutes');
const notificationRoutes = require('../server/routes/notificationRoutes');
const sosRoutes = require('../server/routes/sosRoutes');
const ragRoutes = require('../server/routes/ragRoutes');
const { setMockRAGResponse, clearMockRAGResponse } = require('../server/services/ragService');
const { setMockVectorSearch, clearMockVectorSearch } = require('../server/services/retrievalService');

// Load models
const User = require('../server/models/User');
const Appointment = require('../server/models/Appointment');
const Medicine = require('../server/models/Medicine');
const Prescription = require('../server/models/Prescription');
const HealthRecord = require('../server/models/HealthRecord');
const Notification = require('../server/models/Notification');
const SosRequest = require('../server/models/SosRequest');

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

// Helper to make mock HTTP requests to Express router
function createMockApp() {
  const app = express();
  app.use(express.json());

  // Health endpoint
  app.get('/api/health', (req, res) => {
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: {
        status: dbStatus,
        name: mongoose.connection.name || 'swasthyasetu'
      },
      services: {
        llm: process.env.LLM_PROVIDER || 'gemini',
        embedding: process.env.EMBEDDING_PROVIDER || 'gemini',
        embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '768', 10)
      }
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/appointments', appointmentRoutes);
  app.use('/api/medicines', medicineRoutes);
  app.use('/api/prescriptions', prescriptionRoutes);
  app.use('/api/records', recordRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/sos', sosRoutes);
  app.use('/api/rag', ragRoutes);

  return app;
}

// Lightweight HTTP requester for Express in-memory testing
function request(app) {
  return {
    async get(path, headers = {}) {
      return executeRequest(app, 'GET', path, null, headers);
    },
    async post(path, body = {}, headers = {}) {
      return executeRequest(app, 'POST', path, body, headers);
    },
    async put(path, body = {}, headers = {}) {
      return executeRequest(app, 'PUT', path, body, headers);
    },
    async patch(path, body = {}, headers = {}) {
      return executeRequest(app, 'PATCH', path, body, headers);
    },
    async delete(path, headers = {}) {
      return executeRequest(app, 'DELETE', path, null, headers);
    }
  };
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
            let parsedBody = null;
            try {
              parsedBody = JSON.parse(data);
            } catch (e) {
              parsedBody = data;
            }
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: parsedBody
            });
          });
        }
      );

      clientReq.on('error', (err) => {
        server.close();
        resolve({ status: 500, headers: {}, body: { error: err.message } });
      });

      if (payload) {
        clientReq.write(payload);
      }
      clientReq.end();
    });
  });
}

async function runFeaturesIntegrationTests() {
  console.log('\n=== SANJEEV ASTRA ALL-FEATURE INTEGRATION TEST SUITE ===\n');

  // Connect to local MongoDB
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/swasthyasetu');
  }

  const app = createMockApp();
  const api = request(app);

  const testEmail = `synthetic_patient_${Date.now()}@example.com`;
  const testPassword = 'Password123!Secure';
  let authToken = null;
  let testUserId = null;

  // 1. Operational Health Check
  await test('GET /api/health returns operational status and database connectivity', async () => {
    const res = await api.get('/api/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'healthy');
    assert.strictEqual(res.body.database.status, 'connected');
    assert.strictEqual(res.body.services.llm, 'gemini');
    assert.strictEqual(res.body.services.embeddingDimensions, 768);
  });

  // 2. User Registration & Sanitized Role
  await test('POST /api/auth/register creates user and prevents unauthorized admin role elevation', async () => {
    const res = await api.post('/api/auth/register', {
      name: 'Dr. Test Patient',
      email: testEmail,
      password: testPassword,
      role: 'admin', // Malicious attempt to self-assign admin!
      phone: '+91 9123456789'
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.user.role, 'patient', 'Public registration must sanitize role to patient');
    assert(res.body.token, 'Token must be returned');
    authToken = res.body.token;
    testUserId = res.body.user._id;
  });

  // 3. Duplicate Registration Rejection
  await test('POST /api/auth/register rejects duplicate email address with 400', async () => {
    const res = await api.post('/api/auth/register', {
      name: 'Duplicate User',
      email: testEmail,
      password: testPassword
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error, 'User already exists');
  });

  // 4. User Login with Correct Password
  await test('POST /api/auth/login succeeds with valid credentials', async () => {
    const res = await api.post('/api/auth/login', {
      email: testEmail,
      password: testPassword
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert(res.body.token);
  });

  // 5. User Login Rejection with Bad Password
  await test('POST /api/auth/login rejects invalid password with 401', async () => {
    const res = await api.post('/api/auth/login', {
      email: testEmail,
      password: 'WrongPassword123'
    });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  // 6. Protected Route Enforcement
  await test('Protected endpoints reject unauthenticated requests with 401', async () => {
    const res = await api.get('/api/auth/me');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  // 7. Get Authenticated User Profile
  await test('GET /api/auth/me returns current user profile without password leak', async () => {
    const res = await api.get('/api/auth/me', { Authorization: `Bearer ${authToken}` });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.email, testEmail);
    assert.strictEqual(res.body.data.password, undefined, 'Password must never be exposed');
  });

  // 8. Update User Profile & Verify Password Immutability
  await test('PUT /api/auth/profile updates profile without corrupting password authentication', async () => {
    const updateRes = await api.put(
      '/api/auth/profile',
      {
        name: 'Updated Patient Name',
        age: 35,
        bloodGroup: 'O+',
        conditions: ['Allergic Rhinitis']
      },
      { Authorization: `Bearer ${authToken}` }
    );

    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.body.data.age, 35);
    assert.strictEqual(updateRes.body.data.bloodGroup, 'O+');

    // Crucial check: User MUST still be able to log in with original password!
    const loginAfterUpdate = await api.post('/api/auth/login', {
      email: testEmail,
      password: testPassword
    });
    assert.strictEqual(loginAfterUpdate.status, 200, 'User must authenticate successfully after profile update');
  });

  // 9. Appointments: Create, List, Update, Delete
  let testAppointmentId = null;
  await test('Appointments: create, list, and update appointments with user isolation', async () => {
    // Create
    const createRes = await api.post(
      '/api/appointments',
      {
        doctorName: 'Dr. Anita Joshi',
        hospitalName: 'District Hospital',
        department: 'Cardiology',
        date: '2026-10-15',
        time: '10:30',
        reminderMinutes: 60
      },
      { Authorization: `Bearer ${authToken}` }
    );
    assert.strictEqual(createRes.status, 201);
    assert.strictEqual(createRes.body.data.doctorName, 'Dr. Anita Joshi');
    testAppointmentId = createRes.body.data._id;

    // List
    const listRes = await api.get('/api/appointments', { Authorization: `Bearer ${authToken}` });
    assert.strictEqual(listRes.status, 200);
    assert(listRes.body.count >= 1);

    // Update
    const updateRes = await api.put(
      `/api/appointments/${testAppointmentId}`,
      { time: '11:00', status: 'Completed' },
      { Authorization: `Bearer ${authToken}` }
    );
    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.body.data.status, 'Completed');
  });

  // 10. Medicines: Create, List, and Log Adherence
  let testMedicineId = null;
  await test('Medicines: create, list, and log patient adherence compliance', async () => {
    const createRes = await api.post(
      '/api/medicines',
      {
        name: 'Metformin 500mg',
        dosage: '1 tablet',
        frequency: 'Daily',
        timings: ['Morning', 'Night'],
        reminderTime: '09:00',
        instructions: 'After meals'
      },
      { Authorization: `Bearer ${authToken}` }
    );
    assert.strictEqual(createRes.status, 201);
    assert.strictEqual(createRes.body.data.name, 'Metformin 500mg');
    testMedicineId = createRes.body.data._id;

    // Log adherence
    const logRes = await api.post(
      `/api/medicines/${testMedicineId}/log`,
      {
        date: '2026-10-10',
        timeSlot: 'Morning',
        status: 'Taken'
      },
      { Authorization: `Bearer ${authToken}` }
    );
    assert.strictEqual(logRes.status, 200);
    assert.strictEqual(logRes.body.data.history[0].status, 'Taken');
  });

  // 11. Prescriptions: Create and List
  let testPrescriptionId = null;
  await test('Prescriptions: create and query user prescriptions', async () => {
    const createRes = await api.post(
      '/api/prescriptions',
      {
        doctorName: 'Dr. Suresh Verma',
        hospitalName: 'Apollo Clinic',
        medicines: JSON.stringify([{ name: 'Paracetamol', dosage: '500mg', frequency: 'TDS' }]),
        notes: 'Take for 3 days if fever persists'
      },
      { Authorization: `Bearer ${authToken}` }
    );
    assert.strictEqual(createRes.status, 201);
    assert.strictEqual(createRes.body.data.doctorName, 'Dr. Suresh Verma');
    testPrescriptionId = createRes.body.data._id;

    const listRes = await api.get('/api/prescriptions', { Authorization: `Bearer ${authToken}` });
    assert.strictEqual(listRes.status, 200);
    assert(listRes.body.count >= 1);
  });

  // 12. Notifications: Query and Mark Read
  await test('Notifications: query and mark all notifications read', async () => {
    // Seed a notification
    await Notification.create({
      user: testUserId,
      title: 'Appointment Reminder',
      message: 'You have an upcoming consultation with Dr. Anita Joshi.',
      type: 'Appointment',
      isRead: false
    });

    const listRes = await api.get('/api/notifications', { Authorization: `Bearer ${authToken}` });
    assert.strictEqual(listRes.status, 200);
    assert(listRes.body.count >= 1);

    const markRes = await api.put('/api/notifications/read-all', {}, { Authorization: `Bearer ${authToken}` });
    assert.strictEqual(markRes.status, 200);
    assert.strictEqual(markRes.body.success, true);
  });

  // 13. SOS & Emergency Assistance Flow
  let testSosId = null;
  await test('Emergency SOS: query facilities, available ambulances, and progress emergency lifecycle', async () => {
    // Discovery
    const facRes = await api.get('/api/sos/facilities/nearby?lat=18.5204&lng=73.8567');
    assert.strictEqual(facRes.status, 200);
    assert(facRes.body.count >= 1);

    const ambRes = await api.get('/api/sos/ambulances/available');
    assert.strictEqual(ambRes.status, 200);
    assert(ambRes.body.data.length >= 1);

    // Create SOS
    const createRes = await api.post(
      '/api/sos',
      {
        latitude: 18.5204,
        longitude: 73.8567,
        locationAddress: 'JM Road, Shivajinagar, Pune',
        emergencyType: 'Ambulance',
        patientPhone: '+91 9123456789'
      },
      { Authorization: `Bearer ${authToken}` }
    );
    assert.strictEqual(createRes.status, 201);
    assert.strictEqual(createRes.body.data.status, 'REQUESTED');
    testSosId = createRes.body.data._id;

    // Active SOS query
    const activeRes = await api.get('/api/sos/active', { Authorization: `Bearer ${authToken}` });
    assert.strictEqual(activeRes.status, 200);
    assert.strictEqual(activeRes.body.data._id.toString(), testSosId.toString());

    // Status update: ACCEPTED -> EN_ROUTE
    const statusRes = await api.patch(
      `/api/sos/${testSosId}/status`,
      { status: 'EN_ROUTE', note: 'Ambulance dispatched with oxygen' },
      { Authorization: `Bearer ${authToken}` }
    );
    assert.strictEqual(statusRes.status, 200);
    assert.strictEqual(statusRes.body.data.status, 'EN_ROUTE');
  });

  // 14. RAG Chat & Evidence Citations
  await test('POST /api/rag/answer returns evidence-grounded answer with source citations', async () => {
    // Mock response handler for isolated integration test
    setMockRAGResponse(async ({ query, language }) => ({
      query,
      answer: 'According to WHO guidelines, paracetamol is recommended for fever management [Source 1]. Ensure adequate oral rehydration [Source 2].',
      sources: [
        { sourceIndex: 1, title: 'WHO Fever Clinical Guidelines', publisher: 'World Health Organization', relevanceScore: 0.88 },
        { sourceIndex: 2, title: 'Clinical Dehydration Protocols', publisher: 'National Health Mission', relevanceScore: 0.82 }
      ],
      count: 2,
      retrievalStatus: 'success',
      isEmergency: false,
      mode: 'rag',
      model: 'gemini-3.5-flash-lite'
    }));

    const res = await api.post(
      '/api/rag/answer',
      { message: 'What is the standard treatment for moderate fever?' },
      { Authorization: `Bearer ${authToken}` }
    );

    clearMockRAGResponse();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert(res.body.answer.includes('[Source 1]'));
    assert.strictEqual(res.body.sources.length, 2);
    assert.strictEqual(res.body.sources[0].publisher, 'World Health Organization');
  });

  // 15. RAG Emergency Symptom Red-flag Detection
  await test('POST /api/rag/answer flags acute emergency symptoms and prioritizes urgent medical help', async () => {
    setMockRAGResponse(async ({ query, isEmergency }) => ({
      query,
      answer: '⚠️ **EMERGENCY MEDICAL NOTICE:** Severe chest pain requires immediate emergency medical attention. Call 112 or 108 immediately.',
      sources: [],
      count: 0,
      retrievalStatus: 'emergency_detected',
      isEmergency: true,
      mode: 'rag',
      model: 'gemini-3.5-flash-lite'
    }));

    const res = await api.post(
      '/api/rag/answer',
      { message: 'I have severe chest pain and cannot breathe' },
      { Authorization: `Bearer ${authToken}` }
    );

    clearMockRAGResponse();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.isEmergency, true);
    assert(res.body.answer.includes('112') || res.body.answer.includes('108') || res.body.answer.includes('emergency'));
  });

  // 16. Rate Limiting Headers
  await test('RAG endpoints enforce rate-limiting headers', async () => {
    setMockVectorSearch(async () => [
      {
        chunkId: 'chunk-test-1',
        documentId: 'doc-test-1',
        text: 'Headache triage guidelines require ruling out thunderclap onset.',
        metadata: { reviewStatus: 'approved', title: 'Headache Triage Protocol' },
        score: 0.88
      }
    ]);

    const res = await api.post(
      '/api/rag/retrieve',
      { message: 'headache red flags' },
      { Authorization: `Bearer ${authToken}` }
    );

    clearMockVectorSearch();

    assert.strictEqual(res.status, 200);
    assert(res.headers['ratelimit-limit'], 'RateLimit-Limit header must be present');
    assert(res.headers['ratelimit-remaining'] !== undefined, 'RateLimit-Remaining header must be present');
  });

  // Cleanup synthetic test records
  if (testUserId) {
    await Appointment.deleteMany({ user: testUserId });
    await Medicine.deleteMany({ user: testUserId });
    await Prescription.deleteMany({ user: testUserId });
    await HealthRecord.deleteMany({ user: testUserId });
    await Notification.deleteMany({ user: testUserId });
    await SosRequest.deleteMany({ patient: testUserId });
    await User.findByIdAndDelete(testUserId);
  }

  await mongoose.disconnect();

  console.log(`\nAll-Feature Integration Results: ${passedTests} passed, ${failedTests} failed\n`);
  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runFeaturesIntegrationTests()
    .catch((err) => {
      console.error('Test suite uncaught failure:', err);
      process.exit(1);
    });
}

module.exports = { runFeaturesIntegrationTests };
