const elevenLabsService = require('../services/elevenLabsService');

const ALLOWED_MIME_TYPES = new Set([
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp3',
  'audio/mpeg',
  'audio/ogg',
  'audio/opus',
  'audio/m4a',
  'audio/x-m4a',
  'audio/mp4',
  'audio/aac'
]);

const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
const MIN_AUDIO_SIZE_BYTES = 100; // at least 100 bytes of header/data
const MAX_TEXT_LENGTH = 3000;

/**
 * @desc    Transcribe recorded patient audio using ElevenLabs Speech-to-Text (Scribe)
 * @route   POST /api/voice/transcribe
 * @access  Private (Authenticated)
 */
exports.transcribe = async (req, res) => {
  try {
    const file = req.file;

    // 1. Verify audio file was provided
    if (!file || !file.buffer) {
      return res.status(400).json({
        success: false,
        error: 'No audio recording file was provided. Please record your question and try again.'
      });
    }

    // 2. Validate MIME type
    const mimeBase = (file.mimetype || '').split(';')[0].toLowerCase().trim();
    if (!ALLOWED_MIME_TYPES.has(mimeBase) && !ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase().trim())) {
      return res.status(400).json({
        success: false,
        error: `Unsupported audio format: "${file.mimetype}". Supported formats include webm, wav, mp3, ogg, and m4a.`
      });
    }

    // 3. Validate file size boundaries
    if (file.size < MIN_AUDIO_SIZE_BYTES) {
      return res.status(400).json({
        success: false,
        error: 'Recording is empty or too short. Please speak your question and try again.'
      });
    }

    if (file.size > MAX_AUDIO_SIZE_BYTES) {
      return res.status(400).json({
        success: false,
        error: `Audio recording exceeds maximum allowed size of 25 MB.`
      });
    }

    const language = (req.body?.language || req.query?.language || 'en').toString().trim().toLowerCase();

    // 4. Delegate to ElevenLabs STT service
    const result = await elevenLabsService.transcribeAudio({
      fileBuffer: file.buffer,
      fileName: file.originalname || 'recording.webm',
      mimeType: file.mimetype || 'audio/webm',
      language
    });

    return res.status(200).json({
      success: true,
      text: result.text,
      language: result.language,
      confidence: result.confidence,
      requestId: result.requestId
    });
  } catch (error) {
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500;

    const userMessage = error.userMessage || error.message || 'Speech recognition encountered an unexpected error.';

    return res.status(statusCode).json({
      success: false,
      error: userMessage,
      requestId: error.requestId || null
    });
  }
};

/**
 * @desc    Synthesize assistant medical guidance text into speech audio via ElevenLabs
 * @route   POST /api/voice/synthesize
 * @access  Private (Authenticated)
 */
exports.synthesize = async (req, res) => {
  try {
    const { text, voiceId, language, format } = req.body || {};

    // 1. Validate text presence and type
    if (typeof text !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: "text" is required and must be a string.'
      });
    }

    const trimmedText = text.trim();
    if (trimmedText.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Text to synthesize cannot be empty.'
      });
    }

    if (trimmedText.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `Text exceeds maximum allowed length of ${MAX_TEXT_LENGTH} characters.`
      });
    }

    // 2. Delegate to ElevenLabs TTS service
    const result = await elevenLabsService.synthesizeSpeech({
      text: trimmedText,
      voiceId: typeof voiceId === 'string' ? voiceId.trim() : undefined,
      language: typeof language === 'string' ? language.trim() : undefined
    });

    // 3. Return JSON with base64 if format === 'json', otherwise stream audio/mpeg directly
    if (format === 'json' || req.query.format === 'json' || req.get('Accept') === 'application/json') {
      return res.status(200).json({
        success: true,
        audioBase64: result.audioBuffer.toString('base64'),
        contentType: result.contentType,
        spokenLength: result.spokenLength,
        requestId: result.requestId
      });
    }

    res.set({
      'Content-Type': result.contentType || 'audio/mpeg',
      'Content-Length': result.audioBuffer.length,
      'X-Request-Id': result.requestId,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache'
    });

    return res.status(200).send(result.audioBuffer);
  } catch (error) {
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500;

    const userMessage = error.userMessage || error.message || 'Speech generation encountered an unexpected error.';

    return res.status(statusCode).json({
      success: false,
      error: userMessage,
      requestId: error.requestId || null
    });
  }
};

/**
 * @desc    Get ElevenLabs voice options, default settings, and service status
 * @route   GET /api/voice/config
 * @access  Public / Authenticated
 */
exports.getConfig = (req, res) => {
  const config = elevenLabsService.getVoiceConfig();
  res.status(200).json({
    success: true,
    data: config
  });
};
