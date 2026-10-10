const mongoose = require('mongoose');

const idempotencyLogSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    trim: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  endpoint: {
    type: String,
    required: true
  },
  method: {
    type: String,
    required: true
  },
  statusCode: {
    type: Number,
    required: true
  },
  responseBody: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 86400 // TTL 24 hours (auto-expire idempotency records)
  }
});

// Compound unique index on key + user ensures operations are unique per authenticated patient
idempotencyLogSchema.index({ key: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('IdempotencyLog', idempotencyLogSchema);
