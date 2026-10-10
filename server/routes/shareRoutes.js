const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createShare,
  getSentShares,
  getReceivedShares,
  revokeShare,
  getShareAuditLogs
} = require('../controllers/shareController');

router.use(protect);

router.post('/', createShare);
router.get('/sent', getSentShares);
router.get('/received', getReceivedShares);
router.put('/:id/revoke', revokeShare);
router.get('/audit', getShareAuditLogs);

module.exports = router;
