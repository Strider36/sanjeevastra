const mongoose = require('mongoose');

const PrescriptionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  doctorName: {
    type: String,
    default: 'Unknown Doctor'
  },
  hospitalName: {
    type: String,
    default: ''
  },
  date: {
    type: Date,
    default: Date.now
  },
  medicines: [
    {
      name: { type: String, required: true },
      dosage: { type: String, default: '' },
      frequency: { type: String, default: 'Daily' },
      duration: { type: String, default: '' }
    }
  ],
  fileUrl: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  },
  rawOcrText: {
    type: String,
    default: ''
  },
  healthRecord: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HealthRecord',
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

PrescriptionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Prescription', PrescriptionSchema);
