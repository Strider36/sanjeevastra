require('dotenv').config();
const assert = require('assert');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// Load routes
const authRoutes = require('../server/routes/authRoutes');
const recordRoutes = require('../server/routes/recordRoutes');
const doctorRoutes = require('../server/routes/doctorRoutes');
const shareRoutes = require('../server/routes/shareRoutes');
const notificationRoutes = require('../server/routes/notificationRoutes');

// Load models
const User = require('../server/models/User');
const DoctorProfile = require('../server/models/DoctorProfile');
const HealthRecord = require('../server/models/HealthRecord');
const RecordShare = require('../server/models/RecordShare');
const AuditLog = require('../server/models/AuditLog');
const Notification = require('../server/models/Notification');

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
  app.use('/api/auth', authRoutes);
  app.use('/api/records', recordRoutes);
  app.use('/api/doctors', doctorRoutes);
  app.use('/api/shares', shareRoutes);
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

async function runDoctorSharingTests() {
  console.log('\n=== PATIENT-DOCTOR AUTHENTICATION & SECURE SHARING TESTS ===\n');

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/swasthyasetu');
  }

  const app = createTestApp();
  const api = request(app);

  const timestamp = Date.now();
  const patientEmail = `patient_share_${timestamp}@example.com`;
  const doctorEmail = `dr_sharma_${timestamp}@example.com`;
  const doctor2Email = `dr_other_${timestamp}@example.com`;
  const adminEmail = `admin_share_${timestamp}@example.com`;

  let patientToken, doctorToken, doctor2Token, adminToken;
  let patientId, doctorId, doctor2Id, doctorProfileId;
  let testRecord1Id, testRecord2Id, testShareId;

  try {
    // 1. Patient Registration
    await test('Patient registers and receives patient role', async () => {
      const res = await api.post('/api/auth/register', {
        name: 'Rohan Sharma',
        email: patientEmail,
        password: 'Password123!',
        role: 'patient'
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.user.role, 'patient');
      patientToken = res.body.token;
      patientId = res.body.user._id;
    });

    // 2. Doctor Registration (role: doctor, initial pending verification)
    await test('Doctor registers and DoctorProfile is created in pending status', async () => {
      const res = await api.post('/api/auth/register', {
        name: 'Dr. Vikram Joshi',
        email: doctorEmail,
        password: 'Password123!',
        role: 'doctor',
        medicalRegistrationNumber: `MCI-${timestamp}`,
        specialization: 'Cardiology',
        hospitalAffiliation: 'Apollo Trauma Care'
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.user.role, 'doctor');
      doctorToken = res.body.token;
      doctorId = res.body.user._id;

      const profile = await DoctorProfile.findOne({ user: doctorId });
      assert(profile, 'DoctorProfile must be created automatically');
      assert.strictEqual(profile.verificationStatus, 'pending');
      doctorProfileId = profile._id.toString();
    });

    // Register second doctor (for unshared cross-doctor tests)
    await test('Second doctor registers with pending status', async () => {
      const res = await api.post('/api/auth/register', {
        name: 'Dr. Priya Mehta',
        email: doctor2Email,
        password: 'Password123!',
        role: 'doctor',
        medicalRegistrationNumber: `MCI-OTHER-${timestamp}`
      });
      doctor2Token = res.body.token;
      doctor2Id = res.body.user._id;
    });

    // Create an Admin user for verification
    const adminUser = await User.create({
      name: 'System Admin',
      email: adminEmail,
      password: 'AdminPassword123!',
      role: 'admin'
    });
    adminToken = jwt.sign({ id: adminUser._id }, process.env.JWT_SECRET || 'swasthyasetu_super_secret_key_2026_jwt', { expiresIn: '1h' });

    // 3. Create Patient Health Records
    const rec1 = await HealthRecord.create({
      user: patientId,
      name: 'Echocardiogram Report 2026',
      category: 'Medical Report',
      fileUrl: '/uploads/echo-sample.pdf',
      notes: 'Normal ejection fraction 62%'
    });
    testRecord1Id = rec1._id.toString();

    const rec2 = await HealthRecord.create({
      user: patientId,
      name: 'Lipid Profile Blood Analysis',
      category: 'Lab Result',
      fileUrl: '/uploads/lipid-sample.pdf',
      notes: 'Cholesterol within normal range'
    });
    testRecord2Id = rec2._id.toString();

    // 4. Sharing with Unverified Doctor is Strictly Prohibited
    await test('Patient sharing with unverified doctor is rejected with 403', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const res = await api.post('/api/shares', {
        doctorId,
        records: [testRecord1Id],
        expiresAt: futureDate
      }, { Authorization: `Bearer ${patientToken}` });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert(res.body.error.includes('unverified'));
    });

    // 5. Admin Verifies Doctor Credentials
    await test('Admin verifies doctor credentials and action is audit-logged', async () => {
      const res = await api.patch(`/api/doctors/${doctorProfileId}/verify`, {
        status: 'verified'
      }, { Authorization: `Bearer ${adminToken}` });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.verificationStatus, 'verified');

      const audit = await AuditLog.findOne({ action: 'DOCTOR_VERIFIED', resourceId: doctorProfileId });
      assert(audit, 'AuditLog must record DOCTOR_VERIFIED');
    });

    // 6. Patient Grants Read-Only Access to Verified Doctor
    await test('Patient securely grants read-only record access to verified doctor', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const res = await api.post('/api/shares', {
        doctorId,
        records: [testRecord1Id],
        permissions: ['read'],
        expiresAt: futureDate,
        reason: 'Consultation for chest tightness'
      }, { Authorization: `Bearer ${patientToken}` });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, 'active');
      testShareId = res.body.data._id;

      // Verify safe notification payload (no medical secrets leaked)
      const notif = await Notification.findOne({ user: doctorId, type: 'Health' });
      assert(notif, 'Doctor must receive notification');
      assert(!notif.message.includes('chest tightness'), 'Notification must not leak patient notes/diagnosis');
    });

    // 7. Verified Doctor Reads Shared Patient Record
    await test('Authorized doctor successfully views shared record, logged in AuditLog', async () => {
      const res = await api.get(`/api/records/${testRecord1Id}`, { Authorization: `Bearer ${doctorToken}` });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.name, 'Echocardiogram Report 2026');

      const audit = await AuditLog.findOne({ action: 'RECORD_VIEW', actor: doctorId, resourceId: testRecord1Id });
      assert(audit, 'AuditLog must record doctor RECORD_VIEW');

      const share = await RecordShare.findById(testShareId);
      assert(share.accessHistory.length >= 1, 'Share accessHistory must be tracked');
    });

    // 8. IDOR Prevention: Doctor Tries to Access Record NOT Included in Share Grant
    await test('Doctor access to unshared record (testRecord2) is blocked with 403 (IDOR defense)', async () => {
      const res = await api.get(`/api/records/${testRecord2Id}`, { Authorization: `Bearer ${doctorToken}` });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);

      const deniedAudit = await AuditLog.findOne({ action: 'ACCESS_DENIED', actor: doctorId, resourceId: testRecord2Id });
      assert(deniedAudit, 'AuditLog must record ACCESS_DENIED attempt');
    });

    // 9. Cross-Doctor Access Prevention: Doctor 2 (Unshared) Tries to Access Patient Record
    await test('Second unshared doctor cannot access patient record (HTTP 403)', async () => {
      const res = await api.get(`/api/records/${testRecord1Id}`, { Authorization: `Bearer ${doctor2Token}` });
      assert.strictEqual(res.status, 403);
    });

    // 10. Download Permission Enforcement
    await test('Doctor download is denied with 403 when only read-view permission was granted', async () => {
      const res = await api.get(`/api/records/${testRecord1Id}/download`, { Authorization: `Bearer ${doctorToken}` });
      assert.strictEqual(res.status, 403);
      assert(res.body.error.includes('Download permission not granted'));
    });

    // 11. Patient Revokes Sharing Grant
    await test('Patient revokes record sharing access', async () => {
      const res = await api.put(`/api/shares/${testShareId}/revoke`, {
        reason: 'Consultation completed'
      }, { Authorization: `Bearer ${patientToken}` });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'revoked');

      const revokeAudit = await AuditLog.findOne({ action: 'SHARE_REVOKE', resourceId: testShareId });
      assert(revokeAudit, 'AuditLog must record SHARE_REVOKE');
    });

    // 12. Doctor Denied Access Post-Revocation
    await test('Doctor access is blocked with 403 after patient revokes consent', async () => {
      const res = await api.get(`/api/records/${testRecord1Id}`, { Authorization: `Bearer ${doctorToken}` });
      assert.strictEqual(res.status, 403);
    });

    // 13. Expired Share Access Denial
    await test('Doctor access is blocked with 403 when sharing grant has expired', async () => {
      const pastDate = new Date(Date.now() - 60000); // 1 minute in the past
      const expiredShare = await RecordShare.create({
        patient: patientId,
        doctor: doctorId,
        doctorProfile: doctorProfileId,
        records: [testRecord1Id],
        permissions: ['read'],
        status: 'active',
        expiresAt: pastDate
      });

      const res = await api.get(`/api/records/${testRecord1Id}`, { Authorization: `Bearer ${doctorToken}` });
      assert.strictEqual(res.status, 403);
      await expiredShare.deleteOne();
    });

    // 14. Patient Views Record Access Audit Trail
    await test('Patient can query audit logs of who accessed their health records', async () => {
      const res = await api.get('/api/shares/audit', { Authorization: `Bearer ${patientToken}` });
      assert.strictEqual(res.status, 200);
      assert(res.body.count >= 1);
    });

  } finally {
    // Cleanup synthetic test records
    await HealthRecord.deleteMany({ user: patientId });
    await RecordShare.deleteMany({ patient: patientId });
    await AuditLog.deleteMany({ $or: [{ actor: patientId }, { actor: doctorId }, { targetUser: patientId }] });
    await Notification.deleteMany({ user: { $in: [patientId, doctorId, doctor2Id] } });
    await DoctorProfile.deleteMany({ user: { $in: [doctorId, doctor2Id] } });
    await User.deleteMany({ email: { $in: [patientEmail, doctorEmail, doctor2Email, adminEmail] } });
    await mongoose.disconnect();
  }

  console.log(`\nDoctor Sharing Test Results: ${passedTests} passed, ${failedTests} failed\n`);
  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runDoctorSharingTests().catch(err => {
    console.error('Test suite uncaught failure:', err);
    process.exit(1);
  });
}

module.exports = { runDoctorSharingTests };
