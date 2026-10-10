const mongoose = require('mongoose');

const ResponderProfileSchema = new mongoose.Schema({
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
  phone: {
    type: String,
    default: ''
  },
  responderType: {
    type: String,
    enum: ['doctor', 'health_worker', 'first_responder', 'volunteer'],
    default: 'first_responder'
  },
  isAvailable: {
    type: Boolean,
    default: false
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    }
  },
  searchRadiusKm: {
    type: Number,
    default: 10,
    min: 1,
    max: 50
  },
  lastActive: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

ResponderProfileSchema.index({ location: '2dsphere' });
ResponderProfileSchema.index({ isAvailable: 1, responderType: 1 });

module.exports = mongoose.model('ResponderProfile', ResponderProfileSchema);
