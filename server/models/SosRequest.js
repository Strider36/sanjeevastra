const mongoose = require('mongoose');

const SosRequestSchema = new mongoose.Schema({
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  patientName: {
    type: String,
    default: 'Anonymous Patient'
  },
  patientPhone: {
    type: String,
    default: ''
  },
  latitude: {
    type: Number,
    default: null
  },
  longitude: {
    type: Number,
    default: null
  },
  locationAddress: {
    type: String,
    default: 'Location detected via GPS coordinates'
  },
  emergencyType: {
    type: String,
    enum: ['Ambulance', 'NearestHospital', 'MedicalHelp', 'EmergencyContact'],
    default: 'Ambulance'
  },
  description: {
    type: String,
    default: ''
  },
  destinationFacility: {
    id: { type: String, default: '' },
    name: { type: String, default: '' },
    type: { type: String, default: '' },
    address: { type: String, default: '' },
    distanceKm: { type: Number, default: 0 },
    phone: { type: String, default: '' }
  },
  ambulance: {
    id: { type: String, default: '' },
    vehicleNumber: { type: String, default: '' },
    driverName: { type: String, default: '' },
    phone: { type: String, default: '' },
    etaMinutes: { type: Number, default: 0 },
    currentLat: { type: Number, default: null },
    currentLng: { type: Number, default: null }
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [73.8567, 18.5204]
    }
  },
  assignedResponder: {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, default: '' },
    phone: { type: String, default: '' },
    responderType: { type: String, default: '' },
    etaMinutes: { type: Number, default: 0 },
    acceptedAt: { type: Date, default: null }
  },
  declinedResponders: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  ],
  status: {
    type: String,
    enum: ['REQUESTED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'RESOLVED', 'CANCELLED', 'COMPLETED', 'ESCALATED'],
    default: 'REQUESTED'
  },
  escalatedAt: {
    type: Date,
    default: null
  },
  resolvedAt: {
    type: Date,
    default: null
  },
  resolutionNote: {
    type: String,
    default: ''
  },
  isOfflineQueued: {
    type: Boolean,
    default: false
  },
  timeline: [
    {
      status: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
      note: { type: String, default: '' }
    }
  ]
}, {
  timestamps: true
});

SosRequestSchema.index({ patient: 1, createdAt: -1 });
SosRequestSchema.index({ status: 1, createdAt: -1 });
SosRequestSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('SosRequest', SosRequestSchema);
