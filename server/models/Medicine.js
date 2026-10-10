const mongoose = require('mongoose');

const MedicineSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: [true, 'Please add a medicine name']
  },
  dosage: {
    type: String,
    required: [true, 'Please add a dosage details (e.g., 500mg, 1 tablet)']
  },
  frequency: {
    type: String,
    required: [true, 'Please specify frequency (e.g., Daily, Twice a day, As needed)']
  },
  timings: {
    type: [String],
    default: ['Morning'] // e.g. ['Morning', 'Afternoon', 'Evening', 'Night']
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date,
    default: null
  },
  reminderTime: {
    type: String,
    default: '08:00' // e.g., '08:00'
  },
  instructions: {
    type: String,
    default: '' // e.g., 'Take after food'
  },
  history: [
    {
      date: {
        type: String, // format YYYY-MM-DD
        required: true
      },
      timeSlot: {
        type: String, // Morning, Afternoon, etc.
        required: true
      },
      status: {
        type: String,
        enum: ['Taken', 'Missed', 'Pending'],
        default: 'Pending'
      },
      takenAt: {
        type: Date
      }
    }
  ],
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

MedicineSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Medicine', MedicineSchema);
