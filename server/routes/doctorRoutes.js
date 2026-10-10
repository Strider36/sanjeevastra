const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getVerifiedDoctors,
  getPendingDoctors,
  verifyDoctor,
  getMyDoctorProfile,
  updateMyDoctorProfile
} = require('../controllers/doctorController');

router.get('/verified', getVerifiedDoctors);
router.get('/pending', protect, getPendingDoctors);
router.patch('/:id/verify', protect, verifyDoctor);
router.get('/profile/me', protect, getMyDoctorProfile);
router.put('/profile/me', protect, updateMyDoctorProfile);

module.exports = router;
