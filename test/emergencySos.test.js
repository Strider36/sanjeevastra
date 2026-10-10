require('dotenv').config();
const assert = require('assert');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// Load routes & models
const sosRoutes = require('../server/routes/sosRoutes');
const notificationRoutes = require('../server/routes/notificationRoutes');
const User = require('../server/models/User');
const SosRequest = require('../server/models/SosRequest');
const ResponderProfile = require('../server/models/ResponderProfile');
const Notification = require('../server/models/Notification');
const AuditLog = require('../server/models/AuditLog');

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

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sos', sosRoutes);
  app.use('/api/notifications', notificationRoutes);
  return app;
}

function request(app) {
  return {
    async get(path, headers = {}) { return executeRequest(app, 'GET', path, null, headers); },
    async post(path, body = {}, headers = {}) { return executeRequest(app, 'POST', path, body, headers); },
    async put(path, body = {}, headers = {}) { return executeRequest(app, 'PUT', path, body, headers); },
    async patch(path, body = {}, headers = {}) { return executeRequest(app, 'PATCH', path, body, headers); },
    async delete(path, headers = {}) { return executeRequest(app, 'DELETE', path, null, headers); }
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

      if (payload) clientReq.write(payload);
      clientReq.end();
    });
  });
}

async function runEmergencySosTests() {
  console.log('\n=== NEARBY EMERGENCY SOS & GEOSPATIAL RESPONDER TESTS ===\n');

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/swasthyasetu');
  }

  const app = createTestApp();
  const api = request(app);

  const timestamp = Date.now();
  const patientEmail = `sos_patient_${timestamp}@example.com`;
  const responder1Email = `responder_near_${timestamp}@example.com`;
  const responder2Email = `responder_far_${timestamp}@example.com`;
  const responder3Email = `responder_compete_${timestamp}@example.com`;

  let patientUser, responder1User, responder2User, responder3User;
  let patientToken, responder1Token, responder2Token, responder3Token;
  let testSosId = null;

  try {
    // 1. Create Test Users
    patientUser = await User.create({
      name: 'Anjali Deshmukh',
      email: patientEmail,
      password: 'Password123!',
      role: 'patient',
      phone: '+91 98220 12345'
    });
    patientToken = jwt.sign({ id: patientUser._id }, process.env.JWT_SECRET || 'swasthyasetu_super_secret_key_2026_jwt');

    // Nearby responder (~2 km away from Pune Station: 18.5204, 73.8567)
    responder1User = await User.create({
      name: 'Dr. Sameer Kulkarni (Responder)',
      email: responder1Email,
      password: 'Password123!',
      role: 'doctor',
      phone: '+91 98220 54321'
    });
    responder1Token = jwt.sign({ id: responder1User._id }, process.env.JWT_SECRET || 'swasthyasetu_super_secret_key_2026_jwt');

    // Competing nearby responder
    responder3User = await User.create({
      name: 'Nurse Rekha (Health Worker)',
      email: responder3Email,
      password: 'Password123!',
      role: 'health_worker',
      phone: '+91 98220 99887'
    });
    responder3Token = jwt.sign({ id: responder3User._id }, process.env.JWT_SECRET || 'swasthyasetu_super_secret_key_2026_jwt');

    // Distant responder (~80 km away in Mumbai: 18.9220, 72.8347)
    responder2User = await User.create({
      name: 'Volunteer Mumbai',
      email: responder2Email,
      password: 'Password123!',
      role: 'patient',
      phone: '+91 98220 11111'
    });
    responder2Token = jwt.sign({ id: responder2User._id }, process.env.JWT_SECRET || 'swasthyasetu_super_secret_key_2026_jwt');

    // 2. Coordinate Validation
    await test('POST /api/sos rejects invalid latitude (>90) with 400', async () => {
      const res = await api.post('/api/sos', {
        latitude: 145.2,
        longitude: 73.85
      }, { Authorization: `Bearer ${patientToken}` });
      assert.strictEqual(res.status, 400);
      assert(res.body.error.includes('latitude'));
    });

    await test('POST /api/sos rejects invalid longitude (>180) with 400', async () => {
      const res = await api.post('/api/sos', {
        latitude: 18.52,
        longitude: -200
      }, { Authorization: `Bearer ${patientToken}` });
      assert.strictEqual(res.status, 400);
      assert(res.body.error.includes('longitude'));
    });

    // 3. Responder Opt-in & Availability Management
    await test('Responder 1 explicitly opts in with nearby coordinates', async () => {
      const res = await api.post('/api/sos/responder/opt-in', {
        latitude: 18.5300,
        longitude: 73.8500,
        searchRadiusKm: 15,
        responderType: 'doctor'
      }, { Authorization: `Bearer ${responder1Token}` });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.isAvailable, true);
      assert.strictEqual(res.body.data.location.type, 'Point');
    });

    await test('Competing Responder 3 explicitly opts in with nearby coordinates', async () => {
      const res = await api.post('/api/sos/responder/opt-in', {
        latitude: 18.5250,
        longitude: 73.8600,
        searchRadiusKm: 10,
        responderType: 'health_worker'
      }, { Authorization: `Bearer ${responder3Token}` });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.isAvailable, true);
    });

    await test('Distant Responder 2 opts in in Mumbai (>70 km away)', async () => {
      const res = await api.post('/api/sos/responder/opt-in', {
        latitude: 18.9220,
        longitude: 72.8347,
        searchRadiusKm: 10
      }, { Authorization: `Bearer ${responder2Token}` });

      assert.strictEqual(res.status, 200);
    });

    // 4. Trigger SOS & Geospatial Discovery
    await test('Triggering SOS discovers nearby responders and excludes distant responders', async () => {
      const res = await api.post('/api/sos', {
        latitude: 18.5204,
        longitude: 73.8567,
        locationAddress: 'Pune Railway Station, Platform 1',
        emergencyType: 'Ambulance',
        radiusKm: 15
      }, { Authorization: `Bearer ${patientToken}` });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.status, 'REQUESTED');
      assert.strictEqual(res.body.data.location.type, 'Point');
      testSosId = res.body.data._id;

      // Check nearby responders were notified
      const notif1 = await Notification.findOne({ user: responder1User._id, type: 'Emergency' });
      assert(notif1, 'Nearby Responder 1 must receive emergency notification');

      const notif3 = await Notification.findOne({ user: responder3User._id, type: 'Emergency' });
      assert(notif3, 'Nearby Responder 3 must receive emergency notification');

      // Check distant responder was NOT notified
      const notifFar = await Notification.findOne({ user: responder2User._id, type: 'Emergency' });
      assert.strictEqual(notifFar, null, 'Distant responder (>15 km) must not receive notification');

      // Check requester did NOT receive responder alert for own SOS
      const notifSelf = await Notification.findOne({ user: patientUser._id, type: 'Emergency' });
      assert.strictEqual(notifSelf, null, 'Requester must not receive responder alert for own emergency');
    });

    // 5. Duplicate Alert Prevention
    await test('Duplicate SOS creation within 5 minutes returns existing active alert', async () => {
      const res = await api.post('/api/sos', {
        latitude: 18.5204,
        longitude: 73.8567,
        locationAddress: 'Pune Railway Station'
      }, { Authorization: `Bearer ${patientToken}` });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.isDuplicate, true);
      assert.strictEqual(res.body.data._id.toString(), testSosId.toString());
    });

    // 6. Atomic Single-Responder Acceptance (Prevents Conflicting Acceptances)
    await test('First responder accepts SOS atomically (status -> ACCEPTED)', async () => {
      const res = await api.post(`/api/sos/${testSosId}/accept`, {
        etaMinutes: 4,
        note: 'Carrying first-aid and AED kit'
      }, { Authorization: `Bearer ${responder1Token}` });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'ACCEPTED');
      assert.strictEqual(res.body.data.assignedResponder.name, 'Dr. Sameer Kulkarni (Responder)');

      // Requester must receive notification that responder is coming
      const patientNotif = await Notification.findOne({ user: patientUser._id, type: 'Emergency' });
      assert(patientNotif, 'Patient must be notified of responder acceptance');
      assert(patientNotif.message.includes('Dr. Sameer Kulkarni'));
    });

    await test('Simultaneous second responder acceptance is rejected with HTTP 409 Conflict', async () => {
      const res = await api.post(`/api/sos/${testSosId}/accept`, {
        etaMinutes: 6
      }, { Authorization: `Bearer ${responder3Token}` });

      assert.strictEqual(res.status, 409, 'Second acceptance must conflict and be rejected');
      assert.strictEqual(res.body.success, false);
      assert(res.body.error.toLowerCase().includes('accepted'));
    });

    // 7. Responder Marks En Route
    await test('Assigned responder marks en route', async () => {
      const res = await api.post(`/api/sos/${testSosId}/en-route`, {
        etaMinutes: 2
      }, { Authorization: `Bearer ${responder1Token}` });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'EN_ROUTE');
    });

    // 8. Responder Marks Resolved
    await test('Assigned responder marks emergency alert as resolved', async () => {
      const res = await api.post(`/api/sos/${testSosId}/resolve`, {
        resolutionNote: 'Patient stabilized and accompanied to District Hospital'
      }, { Authorization: `Bearer ${responder1Token}` });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'RESOLVED');
      assert(res.body.data.resolvedAt);
    });

    // 9. Escalation Policy Test (Unaccepted Alert Escalation)
    await test('Unaccepted alert escalates with official 112 / 108 emergency protocol', async () => {
      // Create a fresh unaccepted alert
      const alert = await SosRequest.create({
        patient: patientUser._id,
        patientName: 'Anjali Deshmukh',
        latitude: 18.5204,
        longitude: 73.8567,
        emergencyType: 'NearestHospital',
        status: 'REQUESTED'
      });

      const res = await api.post(`/api/sos/${alert._id}/escalate`, {});
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'ESCALATED');
      assert.strictEqual(res.body.emergencyContacts.nationalEmergency, '112');
      assert.strictEqual(res.body.emergencyContacts.ambulance, '108');

      await alert.deleteOne();
    });

    // 10. Responder Opt-Out (Offline)
    await test('Responder opts out and goes offline', async () => {
      const res = await api.post('/api/sos/responder/opt-out', {}, { Authorization: `Bearer ${responder1Token}` });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.isAvailable, false);
    });

    // 11. User Live Geolocation Update & Real-Life Nearby Facilities Discovery
    await test('POST /api/sos/user-location updates user coordinates in database', async () => {
      const res = await api.post('/api/sos/user-location', {
        latitude: 18.5280,
        longitude: 73.8580,
        locationAddress: 'Deccan Gymkhana, Pune'
      }, { Authorization: `Bearer ${responder1Token}` });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.location.type, 'Point');
      assert.strictEqual(res.body.data.location.coordinates[0], 73.8580);
      assert.strictEqual(res.body.data.location.coordinates[1], 18.5280);
    });

    await test('GET /api/sos/facilities/nearby returns real-life local facilities for custom coordinates', async () => {
      // Coordinates in Delhi (Connaught Place: 28.6315, 77.2167)
      const res = await api.get('/api/sos/facilities/nearby?lat=28.6315&lng=77.2167');
      assert.strictEqual(res.status, 200);
      assert(res.body.data.length >= 3);
      // Ensure the facilities are realistically nearby (< 6 km) rather than 1,200 km away in Pune
      assert(res.body.data[0].distanceKm < 6.0, `Nearest facility must be <6 km, was ${res.body.data[0].distanceKm}`);
      assert(res.body.data[0].phone.includes('108') || res.body.data[0].phone.includes('112'));
    });

    await test('Nearby regular user of program receives notification when SOS is triggered', async () => {
      // Create a regular user located ~1.5 km away from patient
      const regularUserEmail = `nearby_regular_${Date.now()}@example.com`;
      const regularUser = await User.create({
        name: 'Priya Neighbor',
        email: regularUserEmail,
        password: 'Password123!',
        role: 'patient',
        phone: '+91 98220 77777',
        location: {
          type: 'Point',
          coordinates: [73.8650, 18.5250] // ~1.5 km from Pune Station
        }
      });
      const regularToken = jwt.sign({ id: regularUser._id }, process.env.JWT_SECRET || 'swasthyasetu_super_secret_key_2026_jwt');

      // Trigger a fresh SOS from patient
      // First resolve or clear previous so duplicate prevention doesn't trigger
      await SosRequest.deleteMany({ patient: patientUser._id });

      const sosRes = await api.post('/api/sos', {
        latitude: 18.5204,
        longitude: 73.8567,
        locationAddress: 'Pune Railway Station Central',
        emergencyType: 'MedicalHelp',
        radiusKm: 15
      }, { Authorization: `Bearer ${patientToken}` });

      assert.strictEqual(sosRes.status, 201);
      assert(sosRes.body.meta.notifiedUsersCount >= 1, 'At least 1 nearby program user must be notified');

      // Check regular nearby user received the Emergency notification
      const userNotif = await Notification.findOne({ user: regularUser._id, type: 'Emergency' });
      assert(userNotif, 'Nearby program user must receive emergency notification');
      assert(userNotif.title.includes('EMERGENCY'));
      assert(userNotif.message.includes('Anjali Deshmukh'));

      // Cleanup regular user
      await Notification.deleteMany({ user: regularUser._id });
      await User.findByIdAndDelete(regularUser._id);
    });

  } finally {
    // Cleanup synthetic test records
    await SosRequest.deleteMany({ patient: patientUser?._id });
    if (testSosId) await SosRequest.findByIdAndDelete(testSosId);
    await ResponderProfile.deleteMany({ user: { $in: [responder1User?._id, responder2User?._id, responder3User?._id] } });
    await Notification.deleteMany({ user: { $in: [patientUser?._id, responder1User?._id, responder2User?._id, responder3User?._id] } });
    await AuditLog.deleteMany({ actor: { $in: [patientUser?._id, responder1User?._id, responder3User?._id] } });
    await User.deleteMany({ email: { $in: [patientEmail, responder1Email, responder2Email, responder3Email] } });
    await mongoose.disconnect();
  }

  console.log(`\nEmergency SOS Test Results: ${passedTests} passed, ${failedTests} failed\n`);
  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runEmergencySosTests().catch(err => {
    console.error('Test suite uncaught failure:', err);
    process.exit(1);
  });
}

module.exports = { runEmergencySosTests };
