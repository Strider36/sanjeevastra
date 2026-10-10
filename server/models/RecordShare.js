const mongoose = require('mongoose');

const RecordShareSchema = new mongoose.Schema({
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  doctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  doctorProfile: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DoctorProfile'
  },
  records: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HealthRecord'
    }
  ],
  allRecords: {
    type: Boolean,
    default: false
  },
  permissions: {
    type: [String],
    enum: ['read', 'download'],
    default: ['read']
  },
  status: {
    type: String,
    enum: ['active', 'revoked', 'expired'],
    default: 'active'
  },
  expiresAt: {
    type: Date,
    required: [true, 'Please provide an access expiration date']
  },
  reason: {
    type: String,
    default: ''
  },
  revokedAt: {
    type: Date,
    default: null
  },
  revokedReason: {
    type: String,
    default: ''
  },
  accessHistory: [
    {
      accessedAt: {
        type: Date,
        default: Date.now
      },
      action: {
        type: String,
        enum: ['view', 'download'],
        required: true
      },
      recordId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HealthRecord'
      },
      doctorIp: {
        type: String,
        default: ''
      }
    }
  ]
}, {
  timestamps: true
});

RecordShareSchema.index({ patient: 1, doctor: 1, status: 1 });
RecordShareSchema.index({ doctor: 1, status: 1, expiresAt: 1 });

module.exports = mongoose.model('RecordShare', RecordShareSchema);
