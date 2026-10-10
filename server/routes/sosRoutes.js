const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const {
  createSos,
  getSosRequests,
  getActiveSos,
  getSosById,
  getPatientSosHistory,
  updateSosStatus,
  cancelSos,
  getNearbyFacilities,
  getAvailableAmbulances,
  assignAmbulance,
  acceptSos,
  declineSos,
  markEnRoute,
  resolveSos,
  escalateSos,
  optInResponder,
  optOutResponder,
  getResponderProfile,
  getNearbyActiveAlerts,
  updateUserLocation
} = require('../controllers/sosController');

// Optional protect middleware for createSos & escalateSos so guest emergency requests are supported
const optionalProtect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'swasthyasetu_super_secret_key_2026_jwt');
      req.user = await User.findById(decoded.id).select('-password');
    } catch (e) {
      // Proceed unauthenticated
    }
  }
  next();
};

// Facilities & Prototype Ambulances (Public discovery)
router.get('/facilities/nearby', getNearbyFacilities);
router.get('/ambulances/available', getAvailableAmbulances);

// Live User Geolocation Sync
router.post('/user-location', protect, updateUserLocation);

// Emergency SOS creation (supports authenticated or guest)
router.post('/', optionalProtect, createSos);

// Responder Opt-In, Opt-Out & Availability Controls
router.post('/responder/opt-in', protect, optInResponder);
router.post('/responder/opt-out', protect, optOutResponder);
router.get('/responder/profile', protect, getResponderProfile);
router.get('/responder/active-alerts', protect, getNearbyActiveAlerts);

// Authenticated SOS management & responder actions
router.get('/', protect, getSosRequests);
router.get('/active', protect, getActiveSos);
router.get('/:id', protect, getSosById);
router.get('/patient/:patientId', protect, getPatientSosHistory);
router.patch('/:id/status', protect, updateSosStatus);
router.post('/:id/cancel', protect, cancelSos);
router.post('/:id/assign-ambulance', protect, assignAmbulance);

// Responder Action Lifecycles (Single Acceptance, Decline, En Route, Resolve, Escalation)
router.post('/:id/accept', protect, acceptSos);
router.post('/:id/decline', protect, declineSos);
router.post('/:id/en-route', protect, markEnRoute);
router.post('/:id/resolve', protect, resolveSos);
router.post('/:id/escalate', optionalProtect, escalateSos);

module.exports = router;
