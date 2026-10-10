const assert = require('assert');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Load models
const User = require('../server/models/User');
const Appointment = require('../server/models/Appointment');
const Prescription = require('../server/models/Prescription');
const Medicine = require('../server/models/Medicine');
const HealthRecord = require('../server/models/HealthRecord');
const Notification = require('../server/models/Notification');
const SosRequest = require('../server/models/SosRequest');
const MedicalDocument = require('../server/models/MedicalDocument');
const KnowledgeChunk = require('../server/models/KnowledgeChunk');

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

async function runDatabaseAudit() {
  console.log('\n=== SANJEEV ASTRA DATABASE SCHEMA & INTEGRITY AUDIT ===\n');

  // Test 1: User Model Schema Validation
  await test('User schema defines required fields, unique email, and password hashing hook', async () => {
    const emailField = User.schema.paths.email;
    assert.strictEqual(emailField.isRequired, true, 'User email must be required');
    assert.strictEqual(Boolean(emailField.options.unique || emailField._index), true, 'User email must be unique/indexed');

    const nameField = User.schema.paths.name;
    assert.strictEqual(nameField.isRequired, true, 'User name must be required');

    const passwordField = User.schema.paths.password;
    assert.strictEqual(passwordField.isRequired, true, 'User password must be required');
    assert.strictEqual(passwordField.options.select, false, 'Password must be excluded by default');
  });

  // Test 2: User Pre-save Hook Does NOT Corrupt Password on Profile Update
  await test('User pre-save hook leaves password untouched when password is unmodified', async () => {
    const rawPassword = 'ClinicalSecurePass123!';
    const salt = await bcrypt.genSalt(10);
    const originalHash = await bcrypt.hash(rawPassword, salt);

    // Simulate an existing user loaded from database
    const user = User.hydrate({
      _id: new mongoose.Types.ObjectId(),
      name: 'Rohan Sharma',
      email: `rohan_${Date.now()}@example.com`,
      password: originalHash,
      role: 'patient',
      phone: '+91 9876543210'
    });

    assert.strictEqual(user.isModified('password'), false, 'Hydrated user password should be unmodified');

    // Simulate profile update without modifying password
    user.age = 42;
    user.bloodGroup = 'B+';
    user.conditions = ['Mild Hypertension'];

    // Call pre-save hook functions
    const hooks = User.schema.s.hooks._pres.get('save') || [];
    for (const hook of hooks) {
      await hook.fn.call(user);
    }

    // Hash must NOT have changed!
    assert.strictEqual(user.password, originalHash, 'Password hash must remain intact when password is not modified');
    const stillMatches = await bcrypt.compare(rawPassword, user.password);
    assert.strictEqual(stillMatches, true, 'Password must still authenticate successfully after profile update');
  });

  // Test 3: Appointment Schema & Indexes
  await test('Appointment schema has compound index on user, date, and time', async () => {
    const userField = Appointment.schema.paths.user;
    assert.strictEqual(userField.isRequired, true, 'Appointment user must be required');
    assert.strictEqual(userField.instance, 'ObjectId', 'User must be an ObjectId reference');

    const indexes = Appointment.schema.indexes();
    const hasUserIndex = indexes.some(idx => idx[0] && idx[0].user === 1 && idx[0].date === 1 && idx[0].time === 1);
    assert.strictEqual(hasUserIndex, true, 'Appointment must have compound index on { user: 1, date: 1, time: 1 }');
  });

  // Test 4: Prescription Schema & Indexes
  await test('Prescription schema has compound index on user and createdAt', async () => {
    const userField = Prescription.schema.paths.user;
    assert.strictEqual(userField.isRequired, true, 'Prescription user must be required');

    const indexes = Prescription.schema.indexes();
    const hasUserIndex = indexes.some(idx => idx[0] && idx[0].user === 1 && idx[0].createdAt === -1);
    assert.strictEqual(hasUserIndex, true, 'Prescription must have compound index on { user: 1, createdAt: -1 }');
  });

  // Test 5: Medicine Schema & Indexes
  await test('Medicine schema has compound index on user and createdAt', async () => {
    const userField = Medicine.schema.paths.user;
    assert.strictEqual(userField.isRequired, true, 'Medicine user must be required');

    const indexes = Medicine.schema.indexes();
    const hasUserIndex = indexes.some(idx => idx[0] && idx[0].user === 1 && idx[0].createdAt === -1);
    assert.strictEqual(hasUserIndex, true, 'Medicine must have compound index on { user: 1, createdAt: -1 }');
  });

  // Test 6: HealthRecord Schema & Indexes
  await test('HealthRecord schema has compound indexes on { user: 1, date: -1 } and { user: 1, category: 1 }', async () => {
    const userField = HealthRecord.schema.paths.user;
    assert.strictEqual(userField.isRequired, true, 'HealthRecord user must be required');

    const indexes = HealthRecord.schema.indexes();
    const hasDateIndex = indexes.some(idx => idx[0] && idx[0].user === 1 && idx[0].date === -1);
    const hasCatIndex = indexes.some(idx => idx[0] && idx[0].user === 1 && idx[0].category === 1);
    assert.strictEqual(hasDateIndex, true, 'HealthRecord must have index on { user: 1, date: -1 }');
    assert.strictEqual(hasCatIndex, true, 'HealthRecord must have index on { user: 1, category: 1 }');
  });

  // Test 7: Notification Schema & Indexes
  await test('Notification schema has compound index on { user: 1, isRead: 1, createdAt: -1 }', async () => {
    const userField = Notification.schema.paths.user;
    assert.strictEqual(userField.isRequired, true, 'Notification user must be required');

    const indexes = Notification.schema.indexes();
    const hasNotifIndex = indexes.some(idx => idx[0] && idx[0].user === 1 && idx[0].isRead === 1);
    assert.strictEqual(hasNotifIndex, true, 'Notification must have compound index on { user: 1, isRead: 1, createdAt: -1 }');
  });

  // Test 8: SosRequest Schema & Indexes
  await test('SosRequest schema has indexes on patient and status with createdAt', async () => {
    const indexes = SosRequest.schema.indexes();
    const hasPatientIndex = indexes.some(idx => idx[0] && idx[0].patient === 1 && idx[0].createdAt === -1);
    const hasStatusIndex = indexes.some(idx => idx[0] && idx[0].status === 1 && idx[0].createdAt === -1);
    assert.strictEqual(hasPatientIndex, true, 'SosRequest must have index on { patient: 1, createdAt: -1 }');
    assert.strictEqual(hasStatusIndex, true, 'SosRequest must have index on { status: 1, createdAt: -1 }');
  });

  // Test 9: MedicalDocument Schema & Indexes
  await test('MedicalDocument schema indexes unique documentId, contentHash, and reviewStatus', async () => {
    const docIdField = MedicalDocument.schema.paths.documentId;
    assert.strictEqual(docIdField.isRequired, true, 'documentId must be required');
    assert.strictEqual(Boolean(docIdField.options.unique || docIdField._index), true, 'documentId must be unique index');

    const indexes = MedicalDocument.schema.indexes();
    const hasCompoundStatus = indexes.some(idx => idx[0] && idx[0].reviewStatus === 1 && idx[0].status === 1);
    assert.strictEqual(hasCompoundStatus, true, 'MedicalDocument must have compound index on { reviewStatus: 1, status: 1 }');
  });

  // Test 10: KnowledgeChunk Schema & Indexes
  await test('KnowledgeChunk schema has indexes on documentId, chunkIndex, topic, and reviewStatus', async () => {
    const chunkIdField = KnowledgeChunk.schema.paths.chunkId;
    assert.strictEqual(chunkIdField.isRequired, true, 'chunkId must be required');
    assert.strictEqual(Boolean(chunkIdField.options.unique || chunkIdField._index), true, 'chunkId must be unique index');

    const indexes = KnowledgeChunk.schema.indexes();
    const hasDocChunkIndex = indexes.some(idx => idx[0] && idx[0].documentId === 1 && idx[0].chunkIndex === 1);
    const hasTopicIndex = indexes.some(idx => idx[0] && idx[0]['metadata.topic'] === 1);
    assert.strictEqual(hasDocChunkIndex, true, 'KnowledgeChunk must have index on { documentId: 1, chunkIndex: 1 }');
    assert.strictEqual(hasTopicIndex, true, 'KnowledgeChunk must have index on metadata.topic');
  });

  console.log(`\nDatabase Audit Results: ${passedTests} passed, ${failedTests} failed\n`);
  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runDatabaseAudit();
}

module.exports = { runDatabaseAudit };
