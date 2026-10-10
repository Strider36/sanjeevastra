const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Helper to generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'swasthyasetu_super_secret_key_2026_jwt', {
    expiresIn: '30d'
  });
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Please provide all fields' });
    }

    // Check if user exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false, error: 'User already exists' });
    }

    // Create user (password is hashed in pre-save middleware)
    const allowedRoles = ['patient', 'doctor', 'health_worker'];
    const assignedRole = allowedRoles.includes(req.body.role) ? req.body.role : 'patient';
    const user = await User.create({
      name,
      email,
      password,
      role: assignedRole,
      phone: req.body.phone || ''
    });

    if (assignedRole === 'doctor') {
      const DoctorProfile = require('../models/DoctorProfile');
      await DoctorProfile.create({
        user: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        medicalRegistrationNumber: req.body.medicalRegistrationNumber || `DOC-${Date.now()}`,
        specialization: req.body.specialization || 'General Medicine',
        hospitalAffiliation: req.body.hospitalAffiliation || 'Affiliated Clinic / Hospital',
        qualifications: req.body.qualifications || ['MBBS'],
        verificationStatus: 'pending'
      });
    }

    if (user) {
      res.status(201).json({
        success: true,
        token: generateToken(user._id),
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role || 'patient',
          phone: user.phone || ''
        }
      });
    } else {
      res.status(400).json({ success: false, error: 'Invalid user data' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Authenticate user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Please provide email and password' });
    }

    // Check for user (need to select password explicitly because select: false is set)
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    res.status(200).json({
      success: true,
      token: generateToken(user._id),
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role || 'patient',
        phone: user.phone || ''
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    const fieldsToUpdate = {
      name: req.body.name,
      age: req.body.age,
      gender: req.body.gender,
      bloodGroup: req.body.bloodGroup,
      height: req.body.height,
      weight: req.body.weight,
      conditions: req.body.conditions,
      allergies: req.body.allergies,
      emergencyContacts: req.body.emergencyContacts
    };

    // Filter out undefined fields
    Object.keys(fieldsToUpdate).forEach(
      (key) => fieldsToUpdate[key] === undefined && delete fieldsToUpdate[key]
    );

    const user = await User.findByIdAndUpdate(req.user.id, fieldsToUpdate, {
      new: true,
      runValidators: true
    });

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
