const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: [
      'SHARE_GRANT',
      'SHARE_REVOKE',
      'SHARE_EXPIRE',
      'RECORD_VIEW',
      'RECORD_DOWNLOAD',
      'ACCESS_DENIED',
      'DOCTOR_VERIFIED',
      'DOCTOR_REJECTED',
      'SOS_TRIGGERED',
      'SOS_ACCEPTED',
      'SOS_EN_ROUTE',
      'SOS_RESOLVED',
      'SOS_CANCELLED',
      'RESPONDER_OPT_IN',
      'RESPONDER_OPT_OUT'
    ]
  },
  actor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  actorRole: {
    type: String,
    default: 'patient'
  },
  targetUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  resourceType: {
    type: String,
    default: ''
  },
  resourceId: {
    type: String,
    default: ''
  },
  ipAddress: {
    type: String,
    default: ''
  },
  userAgent: {
    type: String,
    default: ''
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

AuditLogSchema.index({ actor: 1, timestamp: -1 });
AuditLogSchema.index({ targetUser: 1, timestamp: -1 });
AuditLogSchema.index({ resourceType: 1, resourceId: 1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
