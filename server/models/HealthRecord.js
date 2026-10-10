const mongoose = require('mongoose');

const HealthRecordSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: [true, 'Please add a record name']
  },
  category: {
    type: String,
    enum: ['Prescription', 'Medical Report', 'Lab Result', 'Bill', 'Insurance', 'Other'],
    default: 'Other'
  },
  date: {
    type: Date,
    default: Date.now
  },
  fileUrl: {
    type: String,
    required: [true, 'Please add a file URL']
  },
  notes: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

HealthRecordSchema.index({ user: 1, date: -1 });
HealthRecordSchema.index({ user: 1, category: 1 });

module.exports = mongoose.model('HealthRecord', HealthRecordSchema);
