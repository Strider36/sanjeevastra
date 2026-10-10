const llmService = require('../services/llmService');
const retrievalService = require('../services/retrievalService');
const ragService = require('../services/ragService');

const MAX_MESSAGE_LENGTH = 2000;

/**
 * @desc    Chat with the AI Healthcare Navigation Assistant (RAG with base LLM fallback)
 * @route   POST /api/rag/chat
 * @access  Private
 */
exports.chat = async (req, res) => {
  try {
    const { message, language } = req.body || {};

    // 1. Validate request body and message type
    if (typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: "message" is required and must be a string.'
      });
    }

    const trimmedMessage = message.trim();

    // 2. Validate non-empty message
    if (trimmedMessage.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message cannot be empty.'
      });
    }

    // 3. Enforce maximum message length
    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `Message exceeds maximum allowed length of ${MAX_MESSAGE_LENGTH} characters.`
      });
    }

    // 4. Sanitize language input
    const normalizedLanguage = typeof language === 'string' && language.trim()
      ? language.trim().toLowerCase().slice(0, 10)
      : 'en';

    // 5. Try RAG generation first; if retrieval/vector search is unavailable, fallback to base LLM
    try {
      const ragResult = await ragService.generateAnswer({
        message: trimmedMessage,
        language: normalizedLanguage
      });

      return res.status(200).json({
        success: true,
        answer: ragResult.answer,
        sources: ragResult.sources || [],
        isEmergency: ragResult.isEmergency || false,
        mode: ragResult.mode || 'rag'
      });
    } catch (ragError) {
      // Fallback to base LLM completion if vector search is not configured
      const fallback = await llmService.generateChatResponse({
        message: trimmedMessage,
        language: normalizedLanguage
      });

      return res.status(200).json({
        success: true,
        answer: fallback.answer,
        sources: fallback.sources || [],
        mode: fallback.mode || 'llm'
      });
    }
  } catch (error) {
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500;

    const userMessage = error.userMessage || error.message || 'An unexpected error occurred while communicating with the assistant.';

    return res.status(statusCode).json({
      success: false,
      error: userMessage
    });
  }
};

/**
 * @desc    Retrieve verified medical knowledge context chunks via vector search
 * @route   POST /api/rag/retrieve
 * @access  Private
 */
exports.retrieve = async (req, res) => {
  try {
    const { message, language, topK, topic, publisher, documentId, minScore } = req.body || {};

    // 1. Validate query message
    if (typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: "message" is required and must be a string.'
      });
    }

    const trimmedMessage = message.trim();
    if (trimmedMessage.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Message is too short. Please provide a descriptive medical question.'
      });
    }

    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `Message exceeds maximum allowed length of ${MAX_MESSAGE_LENGTH} characters.`
      });
    }

    // 2. Validate topK if provided
    let parsedTopK = undefined;
    if (topK !== undefined) {
      const num = Number(topK);
      if (!Number.isInteger(num) || num < 1 || num > 20) {
        return res.status(400).json({
          success: false,
          error: 'topK must be an integer between 1 and 20.'
        });
      }
      parsedTopK = num;
    }

    // 3. Execute vector retrieval service
    const retrievalResult = await retrievalService.retrieveMedicalContext(trimmedMessage, {
      language,
      topK: parsedTopK,
      topic,
      publisher,
      documentId,
      minScore: typeof minScore === 'number' ? minScore : undefined
    });

    return res.status(200).json({
      success: true,
      query: retrievalResult.query,
      results: retrievalResult.results,
      count: retrievalResult.count,
      retrievalStatus: retrievalResult.retrievalStatus,
      scoreMetric: retrievalResult.scoreMetric
    });
  } catch (error) {
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500;

    return res.status(statusCode).json({
      success: false,
      error: error.message || 'An unexpected error occurred while retrieving medical passages.'
    });
  }
};

/**
 * @desc    Generate an evidence-grounded answer with verified citations via RAG
 * @route   POST /api/rag/answer
 * @access  Private
 */
exports.answer = async (req, res) => {
  try {
    const { message, language, topK, topic, publisher, documentId } = req.body || {};

    // 1. Validate query message
    if (typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: "message" is required and must be a string.'
      });
    }

    const trimmedMessage = message.trim();
    if (trimmedMessage.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Message is too short. Please provide a descriptive medical question.'
      });
    }

    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `Message exceeds maximum allowed length of ${MAX_MESSAGE_LENGTH} characters.`
      });
    }

    // 2. Validate topK if provided
    let parsedTopK = undefined;
    if (topK !== undefined) {
      const num = Number(topK);
      if (!Number.isInteger(num) || num < 1 || num > 20) {
        return res.status(400).json({
          success: false,
          error: 'topK must be an integer between 1 and 20.'
        });
      }
      parsedTopK = num;
    }

    // 3. Normalize language
    const normalizedLanguage = typeof language === 'string' && language.trim()
      ? language.trim().toLowerCase().slice(0, 10)
      : 'en';

    // 4. Invoke RAG generation service
    const result = await ragService.generateAnswer({
      message: trimmedMessage,
      language: normalizedLanguage,
      topK: parsedTopK,
      topic,
      publisher,
      documentId
    });

    return res.status(200).json({
      success: true,
      query: result.query,
      answer: result.answer,
      sources: result.sources || [],
      count: result.count || 0,
      retrievalStatus: result.retrievalStatus,
      isEmergency: result.isEmergency || false,
      mode: result.mode || 'rag',
      model: result.model
    });
  } catch (error) {
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500;

    return res.status(statusCode).json({
      success: false,
      error: error.message || 'An unexpected error occurred while generating the grounded answer.'
    });
  }
};
