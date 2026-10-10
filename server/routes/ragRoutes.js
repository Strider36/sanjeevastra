const express = require('express');
const router = express.Router();
const { chat, retrieve, answer } = require('../controllers/ragController');
const { protect } = require('../middleware/authMiddleware');
const { createRateLimiter } = require('../middleware/rateLimitMiddleware');

// In-memory rate limiting: 20 requests per minute
const ragLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Too many requests. Please wait a moment before trying again.'
});

// POST /api/rag/chat - Protected healthcare assistant chat endpoint
router.post('/chat', protect, ragLimiter, chat);

// POST /api/rag/retrieve - Protected medical vector retrieval endpoint
router.post('/retrieve', protect, ragLimiter, retrieve);

// POST /api/rag/answer - Protected evidence-grounded RAG answer generation endpoint
router.post('/answer', protect, ragLimiter, answer);

module.exports = router;
