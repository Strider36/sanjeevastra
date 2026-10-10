const mongoose = require('mongoose');

const DoctorProfileSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    default: ''
  },
  medicalRegistrationNumber: {
    type: String,
    required: [true, 'Please provide official medical registration / license number'],
    unique: true,
    trim: true
  },
  specialization: {
    type: String,
    required: [true, 'Please specify medical specialization'],
    trim: true
  },
  hospitalAffiliation: {
    type: String,
    required: [true, 'Please specify hospital or clinic affiliation'],
    trim: true
  },
  qualifications: {
    type: [String],
    default: ['MBBS']
  },
  experienceYears: {
    type: Number,
    default: 0
  },
  bio: {
    type: String,
    default: ''
  },
  verificationStatus: {
    type: String,
    enum: ['pending', 'verified', 'rejected'],
    default: 'pending'
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  verifiedAt: {
    type: Date,
    default: null
  },
  rejectionReason: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

DoctorProfileSchema.index({ verificationStatus: 1, specialization: 1 });

module.exports = mongoose.model('DoctorProfile', DoctorProfileSchema);
