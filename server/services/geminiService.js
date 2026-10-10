const { GoogleGenAI } = require('@google/genai');

let mockGeminiHandler = null;

/**
 * Configure a mock response handler for testing/CI.
 * @param {Function|null} handler
 */
function setMockGemini(handler) {
  mockGeminiHandler = handler;
}

/**
 * Clear any active mock handler.
 */
function clearMockGemini() {
  mockGeminiHandler = null;
}

/**
 * Returns an initialized GoogleGenAI client or throws a 503 configuration error.
 * @param {string} [customApiKey]
 * @returns {GoogleGenAI}
 */
function getGeminiClient(customApiKey) {
  const apiKey = (customApiKey || process.env.GEMINI_API_KEY || '').trim();

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    const error = new Error('GEMINI_API_KEY is missing from .env');
    error.code = 'CONFIG_MISSING';
    error.statusCode = 503;
    error.userMessage = 'Gemini service is not configured on the server. GEMINI_API_KEY is missing in environment variables.';
    throw error;
  }

  return new GoogleGenAI({ apiKey });
}

/**
 * Generates an evidence-grounded answer using Gemini (@google/genai).
 *
 * @param {string} message User question
 * @param {string} [context=""] Retrieved medical evidence passages
 * @returns {Promise<string>} Generated text answer
 */
async function generateAnswer(message, context = '') {
  if (mockGeminiHandler) {
    return await mockGeminiHandler(message, context);
  }

  const ai = getGeminiClient();
  const model = process.env.LLM_MODEL || 'gemini-3.5-flash-lite';

  try {
    const response = await ai.models.generateContent({
      model,
      contents: `
You are Sanjeev Astra, a healthcare information assistant.

Rules:
- Provide general health education, not a diagnosis.
- Do not prescribe medication or recommend individual dosages.
- Use the supplied medical evidence for evidence-based claims.
- Never invent sources or citations.
- If evidence is insufficient, say so clearly.
- For emergencies, advise contacting local emergency services
  or seeking urgent medical care.

Retrieved medical evidence:
${context || 'No verified medical evidence was retrieved.'}

User question:
${message}
`,
    });

    const answer = response.text ? response.text.trim() : '';

    if (!answer) {
      const emptyError = new Error('Gemini returned an empty response.');
      emptyError.statusCode = 502;
      emptyError.userMessage = 'The AI healthcare assistant received an empty response. Please try again.';
      throw emptyError;
    }

    return answer;
  } catch (err) {
    if (err.statusCode && err.userMessage) {
      throw err;
    }

    console.error('[Gemini Service Error]:', err.name || 'Error', err.message || '');

    const handledError = new Error(err.message || 'Gemini provider failure');

    if (err.status === 401 || err.status === 403 || err.message?.includes('API_KEY_INVALID')) {
      handledError.statusCode = 502;
      handledError.userMessage = 'Gemini provider authentication failed. Please verify GEMINI_API_KEY configuration.';
    } else if (err.status === 429 || err.message?.includes('RESOURCE_EXHAUSTED')) {
      handledError.statusCode = 429;
      handledError.userMessage = 'Gemini rate limit exceeded. Please wait a moment and try again.';
    } else {
      handledError.statusCode = 502;
      handledError.userMessage = 'The AI healthcare assistant encountered an error while processing your request with Gemini.';
    }

    throw handledError;
  }
}

module.exports = {
  generateAnswer,
  getGeminiClient,
  setMockGemini,
  clearMockGemini
};
