const crypto = require('crypto');

// Default ElevenLabs voice IDs (Pre-made voices known for high quality)
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel (Calm, Healthcare friendly)
const DEFAULT_TTS_MODEL = process.env.ELEVENLABS_TTS_MODEL || 'eleven_multilingual_v2';
const DEFAULT_STT_MODEL = process.env.ELEVENLABS_STT_MODEL || 'scribe_v1';

// Supported voices catalog for frontend selection
const AVAILABLE_VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', description: 'Calm & Professional (Recommended for Clinical Guidance)', gender: 'female' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', description: 'Warm & Empathetic', gender: 'female' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', description: 'Clear & Confident', gender: 'female' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', description: 'Friendly & Reassuring', gender: 'male' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', description: 'Deep & Grounded', gender: 'male' }
];

// ISO language map for ElevenLabs Scribe
const STT_LANG_MAP = {
  en: 'eng',
  hi: 'hin',
  mr: 'mar'
};

// Test mock hooks
let mockTranscriber = null;
let mockSynthesizer = null;

/**
 * Sets a mock transcriber handler for automated testing.
 * @param {Function} handler
 */
function setMockTranscriber(handler) {
  mockTranscriber = handler;
}

/**
 * Clears the mock transcriber handler.
 */
function clearMockTranscriber() {
  mockTranscriber = null;
}

/**
 * Sets a mock synthesizer handler for automated testing.
 * @param {Function} handler
 */
function setMockSynthesizer(handler) {
  mockSynthesizer = handler;
}

/**
 * Clears the mock synthesizer handler.
 */
function clearMockSynthesizer() {
  mockSynthesizer = null;
}

/**
 * Strips raw markdown syntax, citation indices, URLs, and formatting markers
 * so that ElevenLabs speaks clean, calm, natural clinical prose.
 *
 * @param {string} text
 * @returns {string} Clean spoken text
 */
function cleanTextForSpeech(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    // Remove Markdown headings (e.g. ## Heading)
    .replace(/^#{1,6}\s+/gm, '')
    // Remove Markdown bold/italics (e.g. **bold**, *italic*, __bold__, _italic_)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove Markdown links: [anchor](url) -> anchor
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove raw source citation markers like [Source 1], [Source 2: ...], [1], [2]
    .replace(/\[(?:Source[^\]]*|[\d,\s]+)\](?::[^\n]*)?/gi, '')
    // Remove bullet points and numbered list markers
    .replace(/^[\s*•-]+\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    // Remove backtick code spans
    .replace(/`([^`]+)`/g, '$1')
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove URLs
    .replace(/https?:\/\/\S+/gi, '')
    // Collapse excessive whitespace and line breaks
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Transcribes audio via ElevenLabs Speech-to-Text API (Scribe).
 *
 * @param {Object} params
 * @param {Buffer} params.fileBuffer - Raw audio buffer
 * @param {string} params.fileName - Original file name (e.g. 'recording.webm')
 * @param {string} params.mimeType - MIME type (e.g. 'audio/webm')
 * @param {string} [params.language] - Optional ISO language code ('en', 'hi', 'mr')
 * @returns {Promise<Object>} { text, language, requestId }
 */
async function transcribeAudio({ fileBuffer, fileName, mimeType, language }) {
  const requestId = `stt_${crypto.randomBytes(6).toString('hex')}`;

  // Execute mock if active
  if (mockTranscriber) {
    return await mockTranscriber({ fileBuffer, fileName, mimeType, language, requestId });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || apiKey === 'your_elevenlabs_api_key_here') {
    const error = new Error('ElevenLabs Speech-to-Text is not configured. Missing ELEVENLABS_API_KEY.');
    error.statusCode = 503;
    error.userMessage = 'Voice transcription is currently unavailable. Please type your message or check server configuration.';
    error.requestId = requestId;
    throw error;
  }

  if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    const error = new Error('Audio file buffer is empty or missing.');
    error.statusCode = 400;
    error.userMessage = 'No valid audio data was received for transcription.';
    error.requestId = requestId;
    throw error;
  }

  // Construct standard FormData using native Node 18+ Blob & FormData
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: mimeType || 'audio/webm' });
  formData.append('file', blob, fileName || 'recording.webm');
  formData.append('model_id', DEFAULT_STT_MODEL);

  const mappedLang = language && STT_LANG_MAP[language.toLowerCase()];
  if (mappedLang) {
    formData.append('language_code', mappedLang);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey
      },
      body: formData,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorBody = {};
      try {
        errorBody = await response.json();
      } catch (e) {
        // ignore json parse error
      }

      const status = response.status;
      const upstreamMsg = errorBody.detail?.message || errorBody.message || response.statusText;

      const error = new Error(`ElevenLabs STT error (${status}): ${upstreamMsg}`);
      error.requestId = requestId;

      if (status === 401) {
        error.statusCode = 502;
        error.userMessage = 'Voice service authentication failed. Please check backend API credentials.';
      } else if (status === 429) {
        error.statusCode = 429;
        error.userMessage = 'Voice transcription quota or rate limit exceeded. Please try again shortly or use typed chat.';
      } else {
        error.statusCode = status >= 500 ? 502 : status;
        error.userMessage = 'Failed to transcribe speech audio. Please try speaking again or use typed chat.';
      }
      throw error;
    }

    const data = await response.json();
    return {
      success: true,
      text: (data.text || '').trim(),
      language: data.language_code || language || 'eng',
      confidence: data.language_probability || null,
      requestId
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Voice transcription request timed out after 30 seconds.');
      timeoutErr.statusCode = 504;
      timeoutErr.userMessage = 'Speech recognition took too long. Please try a shorter phrase.';
      timeoutErr.requestId = requestId;
      throw timeoutErr;
    }
    throw err;
  }
}

/**
 * Synthesizes text into high-quality speech audio via ElevenLabs Text-to-Speech API.
 *
 * @param {Object} params
 * @param {string} params.text - Assistant text response to speak
 * @param {string} [params.voiceId] - Target voice ID
 * @param {string} [params.language] - Target language ('en', 'hi', etc.)
 * @returns {Promise<Object>} { audioBuffer, contentType, requestId }
 */
async function synthesizeSpeech({ text, voiceId, language }) {
  const requestId = `tts_${crypto.randomBytes(6).toString('hex')}`;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    const error = new Error('Speech synthesis requires non-empty text.');
    error.statusCode = 400;
    error.userMessage = 'No text provided for speech synthesis.';
    error.requestId = requestId;
    throw error;
  }

  const cleanText = cleanTextForSpeech(text);
  if (cleanText.length === 0) {
    const error = new Error('Text contains no pronounceable content after cleaning.');
    error.statusCode = 400;
    error.userMessage = 'Message contains no pronounceable text.';
    error.requestId = requestId;
    throw error;
  }

  // Execute mock if active
  if (mockSynthesizer) {
    return await mockSynthesizer({ text: cleanText, voiceId, language, requestId });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || apiKey === 'your_elevenlabs_api_key_here') {
    const error = new Error('ElevenLabs Text-to-Speech is not configured. Missing ELEVENLABS_API_KEY.');
    error.statusCode = 503;
    error.userMessage = 'Voice audio generation is currently unavailable. Text responses remain fully readable.';
    error.requestId = requestId;
    throw error;
  }

  const targetVoiceId = voiceId || DEFAULT_VOICE_ID;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(targetVoiceId)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35000); // 35s timeout

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: DEFAULT_TTS_MODEL,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorBody = {};
      try {
        errorBody = await response.json();
      } catch (e) {
        // ignore
      }

      const status = response.status;
      const upstreamMsg = errorBody.detail?.message || errorBody.message || response.statusText;

      const error = new Error(`ElevenLabs TTS error (${status}): ${upstreamMsg}`);
      error.requestId = requestId;

      if (status === 401) {
        error.statusCode = 502;
        error.userMessage = 'Voice service authentication failed. Please check backend API credentials.';
      } else if (status === 429) {
        error.statusCode = 429;
        error.userMessage = 'Voice synthesis quota or rate limit reached. Text response is displayed above.';
      } else {
        error.statusCode = status >= 500 ? 502 : status;
        error.userMessage = 'Unable to generate audio voiceover. Text response is displayed above.';
      }
      throw error;
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    return {
      audioBuffer,
      contentType: 'audio/mpeg',
      spokenLength: cleanText.length,
      requestId
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Voice synthesis request timed out after 35 seconds.');
      timeoutErr.statusCode = 504;
      timeoutErr.userMessage = 'Speech generation took too long. Text response is displayed above.';
      timeoutErr.requestId = requestId;
      throw timeoutErr;
    }
    throw err;
  }
}

/**
 * Returns public voice settings & configuration metadata for the frontend.
 */
function getVoiceConfig() {
  const isConfigured = Boolean(
    process.env.ELEVENLABS_API_KEY &&
    process.env.ELEVENLABS_API_KEY !== 'your_elevenlabs_api_key_here'
  );

  return {
    configured: isConfigured,
    defaultVoiceId: DEFAULT_VOICE_ID,
    ttsModel: DEFAULT_TTS_MODEL,
    sttModel: DEFAULT_STT_MODEL,
    availableVoices: AVAILABLE_VOICES,
    supportedLanguages: [
      { code: 'en', name: 'English (Indian / International)', elevenCode: 'eng' },
      { code: 'hi', name: 'Hindi (हिंदी)', elevenCode: 'hin' },
      { code: 'mr', name: 'Marathi (मराठी)', elevenCode: 'mar' }
    ],
    maxAudioSizeBytes: 25 * 1024 * 1024, // 25 MB
    notice: 'Voice processing powered by ElevenLabs Speech AI. Clinical guidance verified by Gemini & Medical Evidence Library.'
  };
}

module.exports = {
  transcribeAudio,
  synthesizeSpeech,
  cleanTextForSpeech,
  getVoiceConfig,
  setMockTranscriber,
  clearMockTranscriber,
  setMockSynthesizer,
  clearMockSynthesizer,
  AVAILABLE_VOICES,
  DEFAULT_VOICE_ID
};
