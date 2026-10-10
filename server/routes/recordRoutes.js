const express = require('express');
const router = express.Router();
const {
  getRecords,
  getRecordById,
  downloadRecord,
  createRecord,
  deleteRecord
} = require('../controllers/recordController');
const { protect } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');
const { checkIdempotency } = require('../middleware/idempotencyMiddleware');

router.use(protect); // protect all routes
router.use(checkIdempotency); // prevent duplicate record creation on offline sync retry

router.route('/')
  .get(getRecords)
  .post(upload.single('file'), createRecord);

router.route('/:id')
  .get(getRecordById)
  .delete(deleteRecord);

router.route('/:id/download')
  .get(downloadRecord);

module.exports = router;
