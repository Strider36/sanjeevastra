require('dotenv').config();
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// Load routes & controllers
const authRoutes = require('../server/routes/authRoutes');
const doctorRoutes = require('../server/routes/doctorRoutes');
const shareRoutes = require('../server/routes/shareRoutes');
const notificationRoutes = require('../server/routes/notificationRoutes');
const recordRoutes = require('../server/routes/recordRoutes');

// Load models
const User = require('../server/models/User');
const DoctorProfile = require('../server/models/DoctorProfile');
const HealthRecord = require('../server/models/HealthRecord');
const RecordShare = require('../server/models/RecordShare');
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
  app.use('/api/doctors', doctorRoutes);
  app.use('/api/shares', shareRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/records', recordRoutes);
  return app;
}

function request(app) {
  return {
    async get(url, headers = {}) { return executeReq(app, 'GET', url, null, headers); },
    async post(url, body = {}, headers = {}) { return executeReq(app, 'POST', url, body, headers); },
    async put(url, body = {}, headers = {}) { return executeReq(app, 'PUT', url, body, headers); },
    async patch(url, body = {}, headers = {}) { return executeReq(app, 'PATCH', url, body, headers); }
  };
}

function executeReq(app, method, url, body, headers = {}) {
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

async function runDoctorPortalUITests() {
  console.log('\n======================================================');
  console.log('  Sanjeev Astra — Doctor / Authority Portal UI Tests  ');
  console.log('======================================================\n');

  // Connect to DB
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/swasthyasetu';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
  }

  const app = createTestApp();
  const api = request(app);

  // ----------------------------------------------------
  // SECTION 1: Static HTML & CSS Assets Audit
  // ----------------------------------------------------
  console.log('--- Section 1: Doctor Portal UI Files & Structure ---');

  await test('doctor-login.html exists with minimal structure and teal accent stylesheet', async () => {
    const filePath = path.join(__dirname, '../public/doctor-login.html');
    assert.ok(fs.existsSync(filePath), 'doctor-login.html must exist');
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check required fields
    assert.ok(content.includes('id="doctor-email"'), 'Must have email input');
    assert.ok(content.includes('id="doctor-password"'), 'Must have password input');
    assert.ok(content.includes('id="doctor-login-btn"'), 'Must have Login button');
    assert.ok(content.includes('id="doctor-forgot-password"'), 'Must have Forgot Password link');
    assert.ok(content.includes('/css/doctor.css'), 'Must link to clean doctor stylesheet');
    assert.ok(content.includes('/doctor-register.html'), 'Must link to separate doctor registration');
  });

  await test('doctor-register.html exists with separate workflow and verification notice', async () => {
    const filePath = path.join(__dirname, '../public/doctor-register.html');
    assert.ok(fs.existsSync(filePath), 'doctor-register.html must exist');
    const content = fs.readFileSync(filePath, 'utf8');

    assert.ok(content.includes('id="reg-license"'), 'Must require medical registration / NMC ID');
    assert.ok(content.includes('id="reg-specialization"'), 'Must require specialization');
    assert.ok(content.includes('id="reg-hospital"'), 'Must require hospital affiliation');
    assert.ok(content.includes('Verification Notice'), 'Must clearly explain admin verification requirement');
  });

  await test('doctor-dashboard.html contains Shared Records, Notifications, and Profile panes', async () => {
    const filePath = path.join(__dirname, '../public/doctor-dashboard.html');
    assert.ok(fs.existsSync(filePath), 'doctor-dashboard.html must exist');
    const content = fs.readFileSync(filePath, 'utf8');

    assert.ok(content.includes('id="pane-records"'), 'Must contain Shared Records section');
    assert.ok(content.includes('id="pane-notifications"'), 'Must contain Notifications section');
    assert.ok(content.includes('id="pane-profile"'), 'Must contain Profile section');
    assert.ok(content.includes('Consent-Governed Access'), 'Must enforce consent-governed records disclaimer');
  });

  await test('doctor.css provides clean styling with white background and subtle teal palette', async () => {
    const cssPath = path.join(__dirname, '../public/css/doctor.css');
    assert.ok(fs.existsSync(cssPath), 'doctor.css must exist');
    const css = fs.readFileSync(cssPath, 'utf8');

    assert.ok(css.includes('--doc-bg: #ffffff'), 'Must specify clean white background');
    assert.ok(css.includes('--doc-teal: #0d9488'), 'Must define subtle teal accent');
    assert.ok(css.includes('--doc-teal-light: #f0fdfa'), 'Must define subtle teal light background');
  });

  // ----------------------------------------------------
  // SECTION 2: Doctor Registration & Verification Flow
  // ----------------------------------------------------
  console.log('\n--- Section 2: Doctor Registration & Admin Verification Flow ---');

  const stamp = Date.now();
  const testDoctorEmail = `portal.doc.${stamp}@test.com`;
  const testPatientEmail = `portal.patient.${stamp}@test.com`;
  const testAdminEmail = `portal.admin.${stamp}@test.com`;

  let doctorUser = null;
  let doctorToken = null;
  let doctorProfile = null;
  let patientUser = null;
  let patientToken = null;
  let adminUser = null;
  let adminToken = null;

  await test('Doctor registers with credentials and receives pending status', async () => {
    const res = await api.post('/api/auth/register', {
      name: 'Dr. Portal Clinician',
      email: testDoctorEmail,
      password: 'password123',
      role: 'doctor',
      phone: '+919876543210',
      medicalRegistrationNumber: `NMC-${stamp}`,
      specialization: 'Cardiology',
      hospitalAffiliation: 'Central Medical Institute'
    });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.token, 'Must return JWT token');
    assert.strictEqual(res.body.user.role, 'doctor');

    doctorUser = res.body.user;
    doctorToken = res.body.token;

    doctorProfile = await DoctorProfile.findOne({ user: doctorUser._id });
    assert.ok(doctorProfile, 'DoctorProfile record must be created');
    assert.strictEqual(doctorProfile.verificationStatus, 'pending', 'Must start as pending');
  });

  await test('Unverified doctor cannot access shared patient records (HTTP 403)', async () => {
    const res = await api.get('/api/shares/received', {
      Authorization: `Bearer ${doctorToken}`
    });

    assert.strictEqual(res.status, 403);
    assert.ok(res.body.error.includes('credentials have not been verified'), 'Must block access with clear security notice');
  });

  await test('Admin account verifies doctor credentials', async () => {
    // Create admin user
    const resAdmin = await api.post('/api/auth/register', {
      name: 'System Hospital Admin',
      email: testAdminEmail,
      password: 'adminpassword123',
      role: 'patient' // create first then elevate in DB to prevent self-elevation
    });
    await User.findByIdAndUpdate(resAdmin.body.user._id, { role: 'admin' });
    adminUser = await User.findById(resAdmin.body.user._id);
    adminToken = jwt.sign({ id: adminUser._id }, process.env.JWT_SECRET || 'swasthyasetu_super_secret_key_2026_jwt');

    // Admin verifies doctor
    const verifyRes = await api.patch(`/api/doctors/${doctorProfile._id}/verify`, {
      status: 'verified'
    }, {
      Authorization: `Bearer ${adminToken}`
    });

    assert.strictEqual(verifyRes.status, 200);
    assert.strictEqual(verifyRes.body.data.verificationStatus, 'verified');

    // Refresh profile state
    doctorProfile = await DoctorProfile.findById(doctorProfile._id);
    assert.strictEqual(doctorProfile.verificationStatus, 'verified');
  });

  // ----------------------------------------------------
  // SECTION 3: Consent-Based Shared Records Access
  // ----------------------------------------------------
  console.log('\n--- Section 3: Patient Consent & Shared Records Access ---');

  let testRecord = null;
  let testShareId = null;

  await test('Patient creates a health record and grants consent to verified doctor', async () => {
    // Register patient
    const pRes = await api.post('/api/auth/register', {
      name: 'Ramesh Patel',
      email: testPatientEmail,
      password: 'patientpass123',
      role: 'patient'
    });
    patientUser = pRes.body.user;
    patientToken = pRes.body.token;

    // Create record
    testRecord = await HealthRecord.create({
      user: patientUser._id,
      name: 'ECG Cardiac Panel',
      category: 'Lab Result',
      date: new Date(),
      fileUrl: '/uploads/records/sample-ecg.pdf',
      notes: 'Normal sinus rhythm, heart rate 72 bpm.'
    });

    // Grant consent to verified doctor
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    const shareRes = await api.post('/api/shares', {
      doctorId: doctorUser._id,
      records: [testRecord._id],
      permissions: ['read'],
      expiresAt: expiresAt.toISOString(),
      reason: 'Cardiological consultation'
    }, {
      Authorization: `Bearer ${patientToken}`
    });

    assert.strictEqual(shareRes.status, 201);
    assert.ok(shareRes.body.data._id);
    testShareId = shareRes.body.data._id;
  });

  await test('Verified doctor successfully retrieves records under active consent', async () => {
    const res = await api.get('/api/shares/received', {
      Authorization: `Bearer ${doctorToken}`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.count, 1);
    assert.strictEqual(res.body.data[0].patient.name, 'Ramesh Patel');
    assert.strictEqual(res.body.data[0].records[0].name, 'ECG Cardiac Panel');
  });

  await test('Patient revokes consent and doctor immediately loses record access', async () => {
    // Patient revokes
    const revokeRes = await api.put(`/api/shares/${testShareId}/revoke`, {
      reason: 'Consultation concluded'
    }, {
      Authorization: `Bearer ${patientToken}`
    });
    assert.strictEqual(revokeRes.status, 200);

    // Doctor checks received shares again
    const docRes = await api.get('/api/shares/received', {
      Authorization: `Bearer ${doctorToken}`
    });
    assert.strictEqual(docRes.status, 200);
    assert.strictEqual(docRes.body.count, 0, 'Revoked share must no longer appear in doctor portal');
  });

  // ----------------------------------------------------
  // SECTION 4: Doctor Notifications & Profile Endpoints
  // ----------------------------------------------------
  console.log('\n--- Section 4: Doctor Notifications & Profile Functionality ---');

  await test('Doctor receives notification for verification and revocation', async () => {
    const notifRes = await api.get('/api/notifications', {
      Authorization: `Bearer ${doctorToken}`
    });

    assert.strictEqual(notifRes.status, 200);
    assert.ok(Array.isArray(notifRes.body.data));
    assert.ok(notifRes.body.data.length >= 1, 'Doctor must have received system notifications');

    // Mark all read
    const readAllRes = await api.put('/api/notifications/read-all', {}, {
      Authorization: `Bearer ${doctorToken}`
    });
    assert.strictEqual(readAllRes.status, 200);
  });

  await test('Doctor views and updates clinical profile', async () => {
    // View profile
    const getProfileRes = await api.get('/api/doctors/profile/me', {
      Authorization: `Bearer ${doctorToken}`
    });
    assert.strictEqual(getProfileRes.status, 200);
    assert.strictEqual(getProfileRes.body.data.specialization, 'Cardiology');

    // Update profile bio & qualifications
    const updateRes = await api.put('/api/doctors/profile/me', {
      specialization: 'Interventional Cardiology',
      hospitalAffiliation: 'National Heart Center',
      qualifications: ['MBBS', 'MD', 'DM (Cardiology)'],
      experienceYears: 12,
      bio: 'Senior consultant specializing in preventive cardiology.'
    }, {
      Authorization: `Bearer ${doctorToken}`
    });

    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.body.data.specialization, 'Interventional Cardiology');
    assert.strictEqual(updateRes.body.data.experienceYears, 12);
  });

  // Cleanup test entities
  await User.deleteMany({ email: { $in: [testDoctorEmail, testPatientEmail, testAdminEmail] } });
  await DoctorProfile.deleteMany({ user: { $in: [doctorUser?._id] } });
  await HealthRecord.deleteMany({ user: { $in: [patientUser?._id] } });
  await RecordShare.deleteMany({ patient: { $in: [patientUser?._id] } });
  await Notification.deleteMany({ user: { $in: [doctorUser?._id] } });

  console.log('\n======================================================');
  console.log(`  Doctor Portal Tests Passed: ${passedTests} | Failed: ${failedTests}`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runDoctorPortalUITests().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error('Fatal error running doctor portal tests:', err);
    process.exit(1);
  });
}

module.exports = { runDoctorPortalUITests };
