const express = require('express');
const router = express.Router();
const multer = require('multer');
const { transcribe, synthesize, getConfig } = require('../controllers/voiceController');
const { protect } = require('../middleware/authMiddleware');
const { createRateLimiter } = require('../middleware/rateLimitMiddleware');

// In-memory Multer storage (audio kept in memory buffer, never persisted to disk without consent)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024 // 25 MB max
  }
});

// Voice rate limiter: 30 requests per minute to prevent quota exhaustion
const voiceLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many voice requests. Please wait a moment before trying again.'
});

// GET /api/voice/config - Public configuration of voices and service status
router.get('/config', getConfig);

// POST /api/voice/transcribe - Protected audio transcription using ElevenLabs STT
router.post('/transcribe', protect, voiceLimiter, upload.single('audio'), transcribe);

// POST /api/voice/synthesize - Protected text-to-speech synthesis using ElevenLabs TTS
router.post('/synthesize', protect, voiceLimiter, synthesize);

module.exports = router;
