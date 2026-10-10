const express = require('express');
const router = express.Router();
const { getAppointments, createAppointment, updateAppointment, deleteAppointment } = require('../controllers/appointmentController');
const { protect } = require('../middleware/authMiddleware');
const { checkIdempotency } = require('../middleware/idempotencyMiddleware');

router.use(protect); // protect all routes
router.use(checkIdempotency); // prevent duplicate booking on offline sync retry

router.route('/')
  .get(getAppointments)
  .post(createAppointment);

router.route('/:id')
  .put(updateAppointment)
  .delete(deleteAppointment);

module.exports = router;
