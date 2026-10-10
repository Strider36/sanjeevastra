const OpenAI = require('openai');
const geminiService = require('./geminiService');

const SYSTEM_PROMPT_TEMPLATE = `You are the Sanjeev Astra Healthcare Navigation Assistant, an AI designed to provide general healthcare navigation and educational health information.

CRITICAL SAFETY AND OPERATIONAL GUIDELINES:
1. Identity: You are an AI informational assistant, NOT a medical doctor. Always maintain this distinction clearly.
2. Educational Only: Provide general educational information and care-navigation guidance only. Never offer a definitive clinical diagnosis.
3. No Prescriptions or Invented Dosages: Never prescribe medications or suggest specific drug dosages. You may discuss standard informational concepts (such as drug classes, standard OTC indications, or general precautions), but always advise the patient to follow their prescribing doctor's or pharmacist's specific instructions.
4. Professional Evaluation: Always encourage consulting a licensed healthcare professional, general physician, or local Primary Health Centre (PHC) for personal medical evaluations and treatment plans.
5. Emergency Protocol: If the user describes emergency symptoms (such as severe chest pain, sudden numbness or weakness, difficulty breathing, heavy bleeding, loss of consciousness, poisoning, or severe head trauma), urgently and clearly instruct them to seek immediate emergency medical care (such as calling national emergency services 112 / ambulance 108 in India, or going to the nearest emergency department).
6. Honesty and Uncertainty: Acknowledge uncertainty when information is insufficient. Never fabricate medical facts, scientific data, or citations.
7. Retrieval Status: Document retrieval (RAG) is currently not active in this system. Do NOT claim or imply that you have retrieved or searched personal medical records, hospital databases, or private health documents.
8. Language Support: Respond in the requested user language: {LANGUAGE}. If the user asks in Hindi or Marathi, provide the response in that language (using Devanagari script for Hindi and Marathi). Keep language empathetic, clear, and accessible.`;

const LANGUAGE_MAP = {
  en: 'English',
  hi: 'Hindi (हिन्दी)',
  mr: 'Marathi (मराठी)'
};

let mockResponseHandler = null;

function setMockResponse(handler) {
  mockResponseHandler = handler;
}

function clearMockResponse() {
  mockResponseHandler = null;
}

/**
 * Returns an initialized OpenAI client or throws a configuration error.
 */
function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : '';

  if (!apiKey) {
    const error = new Error('LLM service is not configured. OPENAI_API_KEY is missing on the server.');
    error.code = 'CONFIG_MISSING';
    error.statusCode = 503;
    error.userMessage = 'LLM service is not configured on the server. OPENAI_API_KEY is missing in environment variables.';
    throw error;
  }

  const clientConfig = { apiKey };

  if (process.env.OPENAI_BASE_URL && process.env.OPENAI_BASE_URL.trim()) {
    clientConfig.baseURL = process.env.OPENAI_BASE_URL.trim();
  }

  return new OpenAI(clientConfig);
}

/**
 * Generate a chat completion using the configured LLM.
 *
 * @param {Object} params
 * @param {string} params.message User message
 * @param {string} [params.language='en'] Requested language code ('en', 'hi', 'mr')
 * @param {Object} [params.clientOverride] Optional client for testing/mocking
 * @returns {Promise<{ answer: string, sources: Array, mode: string, model: string }>}
 */
async function generateChatResponse({ message, language = 'en', clientOverride = null }) {
  if (mockResponseHandler) {
    return await mockResponseHandler({ message, language, clientOverride });
  }

  const isGemini = !clientOverride && (
    (process.env.LLM_PROVIDER && process.env.LLM_PROVIDER.toLowerCase() === 'gemini') ||
    (!process.env.OPENAI_API_KEY && Boolean(process.env.GEMINI_API_KEY))
  );

  if (isGemini) {
    const answer = await geminiService.generateAnswer(message, '');
    return {
      answer,
      sources: [],
      mode: 'llm',
      model: process.env.LLM_MODEL || 'gemini-3.5-flash-lite'
    };
  }

  const client = clientOverride || getOpenAIClient();
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';

  const langKey = (language || 'en').toLowerCase();
  const targetLanguage = LANGUAGE_MAP[langKey] || langKey || 'English';

  const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace('{LANGUAGE}', targetLanguage);

  try {
    const completion = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        temperature: 0.3,
        max_tokens: 1000
      },
      {
        timeout: 30000 // 30-second timeout guard
      }
    );

    const answer = completion.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      const emptyError = new Error('LLM returned an empty response.');
      emptyError.statusCode = 502;
      emptyError.userMessage = 'The AI healthcare assistant received an empty response. Please try again.';
      throw emptyError;
    }

    return {
      answer,
      sources: [],
      mode: 'llm',
      model
    };
  } catch (err) {
    // Already formatted custom errors
    if (err.statusCode && err.userMessage) {
      throw err;
    }

    console.error('[LLM Service Error]:', err.name || 'Error', err.code || '', err.status || '');

    const handledError = new Error(err.message || 'LLM provider failure');

    // OpenAI SDK Error mapping
    if (err.status === 401 || err.name === 'AuthenticationError') {
      handledError.statusCode = 502;
      handledError.userMessage = 'LLM provider authentication failed. Please verify API key configuration.';
    } else if (err.status === 429 || err.name === 'RateLimitError') {
      handledError.statusCode = 429;
      handledError.userMessage = 'LLM provider rate limit exceeded. Please wait a moment and try again.';
    } else if (err.name === 'APIConnectionTimeoutError' || err.code === 'ETIMEDOUT') {
      handledError.statusCode = 504;
      handledError.userMessage = 'The request to the LLM service timed out. Please try again.';
    } else if (err.name === 'APIConnectionError') {
      handledError.statusCode = 502;
      handledError.userMessage = 'Unable to reach the LLM provider. Please check network connectivity.';
    } else if (err.status && err.status >= 500) {
      handledError.statusCode = 502;
      handledError.userMessage = 'Upstream LLM provider is currently experiencing issues. Please try again later.';
    } else {
      handledError.statusCode = 502;
      handledError.userMessage = 'The AI healthcare assistant encountered an error while processing your request.';
    }

    throw handledError;
  }
}

module.exports = {
  generateChatResponse,
  getOpenAIClient,
  SYSTEM_PROMPT_TEMPLATE,
  LANGUAGE_MAP,
  setMockResponse,
  clearMockResponse
};
