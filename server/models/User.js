const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a name']
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email'
    ],
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: [true, 'Please add a password'],
    minlength: 6,
    select: false
  },
  role: {
    type: String,
    enum: ['patient', 'doctor', 'health_worker', 'admin'],
    default: 'patient'
  },
  phone: {
    type: String,
    default: ''
  },
  // Profile metrics
  age: {
    type: Number,
    default: null
  },
  gender: {
    type: String,
    default: null
  },
  bloodGroup: {
    type: String,
    default: null
  },
  height: {
    type: Number, // in cm
    default: null
  },
  weight: {
    type: Number, // in kg
    default: null
  },
  conditions: {
    type: [String],
    default: []
  },
  allergies: {
    type: [String],
    default: []
  },
  emergencyContacts: [
    {
      name: { type: String, required: true },
      relationship: { type: String, required: true },
      phone: { type: String, required: true }
    }
  ],
  location: {
    type: {
      type: String,
      enum: ['Point']
    },
    coordinates: [Number]
  },
  locationAddress: {
    type: String,
    default: ''
  },
  lastActiveAt: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

UserSchema.index({ location: '2dsphere' }, { sparse: true });

// Encrypt password using bcrypt
UserSchema.pre('save', async function () {
  if (this.location && (!this.location.coordinates || this.location.coordinates.length < 2)) {
    this.location = undefined;
  }
  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Match user entered password to hashed password in database
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);
