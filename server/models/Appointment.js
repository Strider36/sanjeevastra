const mongoose = require('mongoose');

const AppointmentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  doctorName: {
    type: String,
    required: [true, 'Please add a doctor name']
  },
  hospitalName: {
    type: String,
    required: [true, 'Please add a hospital name']
  },
  department: {
    type: String,
    default: 'General'
  },
  date: {
    type: String, // format YYYY-MM-DD
    required: [true, 'Please add a date']
  },
  time: {
    type: String, // format HH:MM
    required: [true, 'Please add a time']
  },
  notes: {
    type: String,
    default: ''
  },
  reminderMinutes: {
    type: Number,
    default: 60 // reminder minutes before appointment
  },
  status: {
    type: String,
    enum: ['Scheduled', 'Completed', 'Cancelled'],
    default: 'Scheduled'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

AppointmentSchema.index({ user: 1, date: 1, time: 1 });

module.exports = mongoose.model('Appointment', AppointmentSchema);
