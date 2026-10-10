/* Sanjeev Astra AI Health Assistant Chatbot Drawer (Evidence-Grounded RAG + ElevenLabs Voice) */

import { apiFetch, isAuthenticated, showToast, getUser } from './api.js';
import { getLanguage } from './i18n.js';
import { triggerMedicalSos } from './sos.js';
import { ElevenVoiceClient } from './elevenVoice.js';
import { offlineStorage } from './db.js';

let isSubmitting = false;
let voiceClient = null;

/**
 * Format seconds into M:SS display.
 */
function formatAudioTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Updates the live voice status banner across the chat drawer.
 */
function updateVoiceStatusUI({ state, durationSeconds, error }) {
  const statusPill = document.getElementById('voice-status-pill');
  const statusHint = document.getElementById('voice-status-hint');
  const micBtn = document.getElementById('btn-chat-voice');
  const recTimer = document.getElementById('voice-recording-timer');

  if (!statusPill) return;

  // Reset classes
  statusPill.className = 'voice-status-pill';

  if (state === 'listening') {
    statusPill.classList.add('voice-status-listening');
    statusPill.textContent = 'Listening';
    if (statusHint) statusHint.textContent = `Recording speech... (${durationSeconds || 0}s)`;
    if (micBtn) micBtn.classList.add('recording');
    if (recTimer) recTimer.textContent = formatAudioTime(durationSeconds || 0);
  } else if (state === 'transcribing') {
    statusPill.classList.add('voice-status-transcribing');
    statusPill.textContent = 'Transcribing';
    if (statusHint) statusHint.textContent = 'ElevenLabs Speech AI is recognizing your words...';
    if (micBtn) micBtn.classList.remove('recording');
  } else if (state === 'thinking') {
    statusPill.classList.add('voice-status-thinking');
    statusPill.textContent = 'Thinking';
    if (statusHint) statusHint.textContent = 'Retrieving evidence & generating medical answer...';
    if (micBtn) micBtn.classList.remove('recording');
  } else if (state === 'speaking') {
    statusPill.classList.add('voice-status-speaking');
    statusPill.textContent = 'Speaking';
    if (statusHint) statusHint.textContent = 'Assistant is speaking via ElevenLabs TTS...';
    if (micBtn) micBtn.classList.remove('recording');
  } else if (state === 'error') {
    statusPill.classList.add('voice-status-error');
    statusPill.textContent = 'Error';
    if (statusHint) statusHint.textContent = error || 'Voice communication error occurred';
    if (micBtn) micBtn.classList.remove('recording');
  } else {
    statusPill.classList.add('voice-status-ready');
    statusPill.textContent = 'Ready';
    if (statusHint) statusHint.textContent = 'Speak or type your question';
    if (micBtn) micBtn.classList.remove('recording');
  }
}

/**
 * Initializes chatbot drawer events, ElevenLabs voice engine, and submission bindings.
 */
export function initChatbot() {
  if (typeof document === 'undefined') return;

  const chatFab = document.getElementById('btn-chat-fab');
  const chatDrawer = document.getElementById('chat-drawer');
  const closeChat = document.getElementById('btn-close-chat');
  const chatInput = document.getElementById('chat-input');
  const sendChatBtn = document.getElementById('btn-send-chat');
  const voiceChatBtn = document.getElementById('btn-chat-voice');

  // Voice Settings & Panel Elements
  const voiceSettingsBtn = document.getElementById('btn-voice-settings');
  const voiceSettingsPanel = document.getElementById('voice-settings-panel');
  const closeVoiceSettingsBtn = document.getElementById('btn-close-voice-settings');
  const voiceSelect = document.getElementById('voice-select');
  const voiceLangSelect = document.getElementById('voice-lang-select');
  const voiceAutoplayToggle = document.getElementById('voice-autoplay-toggle');

  // Live Recording Elements
  const recordingBar = document.getElementById('voice-recording-bar');
  const stopRecordingBtn = document.getElementById('btn-stop-recording');
  const cancelRecordingBtn = document.getElementById('btn-cancel-recording');

  // Transcript Preview Elements
  const transcriptCard = document.getElementById('voice-transcript-card');
  const transcriptInput = document.getElementById('voice-transcript-input');
  const confirmVoiceSubmitBtn = document.getElementById('btn-confirm-voice-submit');
  const retryRecordingBtn = document.getElementById('btn-retry-recording');
  const discardTranscriptBtn = document.getElementById('btn-discard-transcript');

  if (!chatFab || !chatDrawer) return;

  // Toggle drawer open and load cached conversation history
  let historyLoaded = false;
  const loadCachedHistory = async () => {
    if (historyLoaded) return;
    historyLoaded = true;
    try {
      const user = getUser();
      const userId = user?._id || user?.id;
      if (userId) {
        const history = await offlineStorage.getChatHistory(userId);
        const container = document.getElementById('chat-messages');
        if (container && history && history.length > 0) {
          const banner = document.createElement('div');
          banner.style.textAlign = 'center';
          banner.style.fontSize = '0.72rem';
          banner.style.color = 'var(--text-secondary)';
          banner.style.margin = '10px 0';
          banner.textContent = '─── Previously Saved Chat History ───';
          container.appendChild(banner);

          history.forEach(item => {
            if (item.role === 'user') {
              appendUserMessage(item.text);
            } else {
              appendAIMessage({
                answer: item.text,
                sources: item.sources || [],
                mode: 'CACHED'
              });
            }
          });
        }
      }
    } catch (e) {
      console.warn('Could not load cached chat history:', e);
    }
  };

  chatFab.addEventListener('click', () => {
    chatDrawer.style.right = '0px';
    if (chatInput) chatInput.focus();
    loadCachedHistory();
  });

  // Close drawer
  const closeDrawer = () => {
    chatDrawer.style.right = '-420px';
    if (voiceClient && voiceClient.isRecording) {
      voiceClient.cancelRecording();
      if (recordingBar) recordingBar.style.display = 'none';
    }
    if (voiceClient && voiceClient.isPlaying) {
      voiceClient.stopPlayback();
    }
  };

  if (closeChat) closeChat.addEventListener('click', closeDrawer);

  // Initialize ElevenVoiceClient
  voiceClient = new ElevenVoiceClient({
    onStatusChange: updateVoiceStatusUI
  });

  voiceClient.init().then(cfg => {
    if (cfg && cfg.availableVoices && voiceSelect) {
      voiceSelect.innerHTML = cfg.availableVoices.map(v => 
        `<option value="${v.id}" ${v.id === voiceClient.preferences.voiceId ? 'selected' : ''}>${v.name} (${v.description})</option>`
      ).join('');
    }
  }).catch(() => {});

  // Setup Voice Preferences UI Sync
  const prefs = voiceClient.getPreferences();
  if (voiceAutoplayToggle) {
    voiceAutoplayToggle.checked = prefs.autoplay;
    voiceAutoplayToggle.addEventListener('change', (e) => {
      voiceClient.setPreferences({ autoplay: e.target.checked });
      showToast('Preference Saved', e.target.checked ? 'Voice answers will autoplay' : 'Voice autoplay disabled', 'info');
    });
  }

  if (voiceSelect) {
    voiceSelect.value = prefs.voiceId;
    voiceSelect.addEventListener('change', (e) => {
      voiceClient.setPreferences({ voiceId: e.target.value });
      showToast('Voice Updated', `Assistant voice changed`, 'info');
    });
  }

  if (voiceLangSelect) {
    voiceLangSelect.value = prefs.language;
    voiceLangSelect.addEventListener('change', (e) => {
      voiceClient.setPreferences({ language: e.target.value });
    });
  }

  // Toggle Voice Settings Panel
  if (voiceSettingsBtn && voiceSettingsPanel) {
    voiceSettingsBtn.addEventListener('click', () => {
      const isVisible = voiceSettingsPanel.style.display === 'block';
      voiceSettingsPanel.style.display = isVisible ? 'none' : 'block';
    });
  }
  if (closeVoiceSettingsBtn && voiceSettingsPanel) {
    closeVoiceSettingsBtn.addEventListener('click', () => {
      voiceSettingsPanel.style.display = 'none';
    });
  }

  // ----------------------------------------------------
  // ElevenLabs Microphone Recording Workflow
  // ----------------------------------------------------
  const startRecordingFlow = async () => {
    if (isSubmitting) return;

    if (!navigator.onLine) {
      showToast('Voice Unavailable Offline', 'ElevenLabs speech AI and cloud synthesis require an active internet connection.', 'warning');
      updateVoiceStatusUI({ state: 'error', error: 'Voice unavailable while offline' });
      return;
    }

    if (!isAuthenticated()) {
      showToast('Authentication Required', 'Please log in to use voice consultation', 'warning');
      return;
    }

    try {
      if (transcriptCard) transcriptCard.style.display = 'none';
      if (recordingBar) recordingBar.style.display = 'flex';
      await voiceClient.startRecording();
    } catch (err) {
      if (recordingBar) recordingBar.style.display = 'none';
      showToast('Microphone Notice', err.message || 'Microphone access denied or unsupported.', 'warning');
    }
  };

  const stopAndTranscribeFlow = async () => {
    if (!voiceClient.isRecording) return;

    if (recordingBar) recordingBar.style.display = 'none';

    try {
      const { blob } = await voiceClient.stopRecording();
      const lang = voiceClient.preferences.language || 'en';
      const result = await voiceClient.transcribeAudio(blob, lang);

      if (result && result.text) {
        // Show transcript confirmation card with editing support
        if (transcriptCard && transcriptInput) {
          transcriptInput.value = result.text;
          transcriptCard.style.display = 'block';
          transcriptInput.focus();
        } else {
          // Fallback directly to send
          handleSendMessageWithText(result.text, { isVoiceInput: true });
        }
      } else {
        showToast('Transcription Empty', 'No speech was recognized. Please speak clearly and try again.', 'info');
      }
    } catch (err) {
      showToast('Transcription Failed', err.message || 'Speech recognition failed. Please try typed chat.', 'error');
    }
  };

  const cancelRecordingFlow = () => {
    if (voiceClient.isRecording) {
      voiceClient.cancelRecording();
    }
    if (recordingBar) recordingBar.style.display = 'none';
    showToast('Cancelled', 'Recording discarded', 'info');
  };

  // Wire up mic and recording buttons
  if (voiceChatBtn) {
    voiceChatBtn.addEventListener('click', () => {
      if (voiceClient.isRecording) {
        stopAndTranscribeFlow();
      } else {
        startRecordingFlow();
      }
    });
  }

  if (stopRecordingBtn) stopRecordingBtn.addEventListener('click', stopAndTranscribeFlow);
  if (cancelRecordingBtn) cancelRecordingBtn.addEventListener('click', cancelRecordingFlow);

  // Transcript confirmation card buttons
  if (confirmVoiceSubmitBtn) {
    confirmVoiceSubmitBtn.addEventListener('click', () => {
      const confirmedText = transcriptInput?.value?.trim();
      if (transcriptCard) transcriptCard.style.display = 'none';
      if (confirmedText) {
        handleSendMessageWithText(confirmedText, { isVoiceInput: true });
      }
    });
  }

  if (retryRecordingBtn) {
    retryRecordingBtn.addEventListener('click', () => {
      if (transcriptCard) transcriptCard.style.display = 'none';
      startRecordingFlow();
    });
  }

  if (discardTranscriptBtn) {
    discardTranscriptBtn.addEventListener('click', () => {
      if (transcriptCard) transcriptCard.style.display = 'none';
    });
  }

  // ----------------------------------------------------
  // Send Message Logic (Typed or Voice Transcript)
  // ----------------------------------------------------
  const handleSendMessageWithText = async (textToSend, { isVoiceInput = false } = {}) => {
    if (isSubmitting) return;

    const text = (textToSend || '').trim();
    if (!text) return;

    if (text.length < 2) {
      showToast('Question Too Short', 'Please enter a more descriptive health question (at least 2 characters).', 'warning');
      return;
    }

    if (!isAuthenticated()) {
      appendAIMessage({
        isError: true,
        errorTitle: 'Authentication Required',
        errorMessage: 'Please log in to your Sanjeev Astra account to consult the medical knowledge assistant.'
      });
      showToast('Login Required', 'Please log in to use the AI assistant', 'warning');
      return;
    }

    // Lock submission state
    isSubmitting = true;
    updateVoiceStatusUI({ state: 'thinking' });

    if (chatInput) {
      chatInput.value = '';
      chatInput.disabled = true;
    }
    if (sendChatBtn) {
      sendChatBtn.disabled = true;
      sendChatBtn.style.opacity = '0.5';
    }
    if (voiceChatBtn) {
      voiceChatBtn.disabled = true;
      voiceChatBtn.style.opacity = '0.5';
    }

    appendUserMessage(text);

    if (!navigator.onLine) {
      const user = getUser();
      const userId = user?._id || user?.id;
      if (userId) {
        offlineStorage.saveChatMessage(userId, {
          role: 'user',
          text,
          status: 'draft',
          createdAt: new Date().toISOString()
        }).catch(() => {});
      }
      appendAIMessage({
        isError: false,
        answer: '⚠️ **Offline Mode Active**: Sanjeev Astra AI clinical guidance and Gemini RAG search require an active internet connection to access medical databases.\n\nYour message has been saved as an offline draft. When connectivity is restored, you can resend your question for live medical verification.'
      });
      isSubmitting = false;
      updateVoiceStatusUI({ state: 'ready' });
      if (chatInput) {
        chatInput.disabled = false;
        chatInput.focus();
      }
      if (sendChatBtn) {
        sendChatBtn.disabled = false;
        sendChatBtn.style.opacity = '1';
      }
      if (voiceChatBtn) {
        voiceChatBtn.disabled = false;
        voiceChatBtn.style.opacity = '1';
      }
      return;
    }

    showTypingIndicator();

    try {
      const language = voiceClient.preferences.language || (typeof getLanguage === 'function' ? getLanguage() : 'en');

      // Call working RAG answer endpoint
      const response = await apiFetch('/rag/answer', {
        method: 'POST',
        body: {
          message: text,
          language,
          topK: 3
        },
        timeout: 35000
      });

      removeTypingIndicator();

      if (response && response.success && response.answer) {
        const user = getUser();
        const userId = user?._id || user?.id;
        if (userId) {
          offlineStorage.saveChatMessage(userId, {
            role: 'user',
            text,
            createdAt: new Date().toISOString()
          }).catch(() => {});
          offlineStorage.saveChatMessage(userId, {
            role: 'model',
            text: response.answer,
            sources: response.sources || [],
            createdAt: new Date().toISOString()
          }).catch(() => {});
        }

        appendAIMessage({
          answer: response.answer,
          sources: response.sources || [],
          retrievalStatus: response.retrievalStatus,
          isEmergency: Boolean(response.isEmergency),
          mode: response.mode,
          isVoiceResponse: isVoiceInput
        });
      } else {
        const errorDetails = formatErrorFeedback(response);
        appendAIMessage({
          isError: true,
          errorTitle: errorDetails.title,
          errorMessage: errorDetails.message
        });
      }
    } catch (err) {
      removeTypingIndicator();
      console.error('Chat error:', err);
      appendAIMessage({
        isError: true,
        errorTitle: 'Connection Error',
        errorMessage: 'Unable to reach the healthcare navigation server. Please check your network connection and try again.'
      });
    } finally {
      isSubmitting = false;
      updateVoiceStatusUI({ state: 'ready' });

      if (chatInput) {
        chatInput.disabled = false;
        chatInput.focus();
      }
      if (sendChatBtn) {
        sendChatBtn.disabled = false;
        sendChatBtn.style.opacity = '1';
      }
      if (voiceChatBtn) {
        voiceChatBtn.disabled = false;
        voiceChatBtn.style.opacity = '1';
      }
    }
  };

  // Bind Typed Input
  const handleTypedSendMessage = () => {
    const rawText = chatInput ? chatInput.value : '';
    handleSendMessageWithText(rawText);
  };

  if (sendChatBtn) sendChatBtn.addEventListener('click', handleTypedSendMessage);
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleTypedSendMessage();
      }
    });
  }

  // Refresh Lucide icons if available
  if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
    try {
      window.lucide.createIcons();
    } catch (e) {
      // Ignore
    }
  }
}

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChatbot);
  } else {
    initChatbot();
  }
}

/**
 * Maps API error responses / statuses into user-friendly clinical guidance notices.
 */
export function formatErrorFeedback(response) {
  const status = response?.status;

  if (status === 401) {
    return {
      title: 'Session Expired',
      message: 'Your session has expired. Please log in again to continue consulting the assistant.'
    };
  }

  if (status === 429) {
    return {
      title: 'Request Limit Reached',
      message: 'You have submitted multiple questions recently. Please wait a moment before sending another message.'
    };
  }

  if (status === 504 || response?.isTimeout) {
    return {
      title: 'Request Timeout',
      message: 'The assistant took too long to formulate a response. Please try rephrasing with a more concise question.'
    };
  }

  if (status === 502 || status === 503) {
    return {
      title: 'Service Temporarily Unavailable',
      message: 'The clinical knowledge retrieval service is currently unavailable. For medical emergencies or urgent concerns, please consult a healthcare facility immediately.'
    };
  }

  return {
    title: 'Assistant Guidance Notice',
    message: response?.error || 'Unable to process your medical navigation query. Please try again or rephrase your symptoms.'
  };
}

/**
 * Appends a patient message bubble to the chat messages container.
 */
export function appendUserMessage(text) {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('chat-messages');
  if (!container) return;

  const msg = document.createElement('div');
  msg.className = 'chat-message-user';
  msg.style.alignSelf = 'flex-end';
  msg.style.maxWidth = '85%';
  msg.style.backgroundColor = 'var(--primary)';
  msg.style.color = '#FFFFFF';
  msg.style.padding = '12px 16px';
  msg.style.borderRadius = 'var(--radius-md) 0 var(--radius-md) var(--radius-md)';
  msg.style.fontSize = '0.85rem';
  msg.style.lineHeight = '1.5';
  msg.style.wordBreak = 'break-word';
  msg.textContent = text;

  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
  return msg;
}

/**
 * Appends an assistant response bubble with markdown parsing, sources,
 * emergency escalation banners, and ElevenLabs voice playback bar.
 */
export function appendAIMessage({
  answer = '',
  sources = [],
  retrievalStatus = 'results_found',
  isEmergency = false,
  isError = false,
  errorTitle = 'Guidance Notice',
  errorMessage = '',
  isVoiceResponse = false
} = {}) {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('chat-messages');
  if (!container) return;

  const msg = document.createElement('div');
  msg.className = 'chat-bubble ai-bubble';
  msg.style.alignSelf = 'flex-start';
  msg.style.maxWidth = '85%';
  msg.style.backgroundColor = 'var(--surface)';
  msg.style.color = 'var(--text-primary)';
  msg.style.border = '1px solid var(--border)';

  if (isError) {
    msg.style.backgroundColor = '#FEF2F2';
    msg.style.borderColor = '#FCA5A5';
    msg.style.color = '#991B1B';
  }
  msg.style.padding = '14px 16px';
  msg.style.borderRadius = '0 var(--radius-md) var(--radius-md) var(--radius-md)';
  msg.style.fontSize = '0.85rem';
  msg.style.lineHeight = '1.5';

  // 1. Error Message Rendering
  if (isError) {
    const errorHead = document.createElement('div');
    errorHead.style.fontWeight = '700';
    errorHead.style.marginBottom = '4px';
    errorHead.style.display = 'flex';
    errorHead.style.alignItems = 'center';
    errorHead.style.gap = '6px';

    const icon = document.createElement('span');
    icon.textContent = '⚠️';
    const titleText = document.createElement('span');
    titleText.textContent = errorTitle;
    errorHead.appendChild(icon);
    errorHead.appendChild(titleText);
    msg.appendChild(errorHead);

    const errorBody = document.createElement('div');
    errorBody.textContent = errorMessage;
    msg.appendChild(errorBody);

    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
    return msg;
  }

  // 2. Emergency Notice & Escalation Banner
  if (isEmergency) {
    const emergBanner = document.createElement('div');
    emergBanner.className = 'chat-emergency-banner';
    emergBanner.style.padding = '10px 12px';
    emergBanner.style.marginBottom = '12px';
    emergBanner.style.borderRadius = 'var(--radius-sm)';
    emergBanner.style.backgroundColor = '#FEF2F2';
    emergBanner.style.border = '1px solid #FCA5A5';
    emergBanner.style.color = '#991B1B';

    const emergHead = document.createElement('div');
    emergHead.style.fontWeight = '700';
    emergHead.style.fontSize = '0.82rem';
    emergHead.style.display = 'flex';
    emergHead.style.alignItems = 'center';
    emergHead.style.gap = '6px';
    emergHead.style.marginBottom = '4px';

    const icon = document.createElement('span');
    icon.textContent = '🚨';
    const title = document.createElement('span');
    title.textContent = 'POTENTIAL MEDICAL EMERGENCY';
    emergHead.appendChild(icon);
    emergHead.appendChild(title);
    emergBanner.appendChild(emergHead);

    const emergDesc = document.createElement('div');
    emergDesc.style.fontSize = '0.78rem';
    emergDesc.style.lineHeight = '1.4';
    emergDesc.textContent = 'Reported symptoms may indicate an emergency. Do not delay: dial 112 / 108 or activate Medical SOS immediately.';
    emergBanner.appendChild(emergDesc);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    actions.style.marginTop = '8px';

    const dialLink = document.createElement('a');
    dialLink.href = 'tel:108';
    dialLink.className = 'btn btn-danger btn-sm';
    dialLink.style.padding = '4px 10px';
    dialLink.style.fontSize = '0.75rem';
    dialLink.style.textDecoration = 'none';
    dialLink.textContent = '📞 Dial 108';
    actions.appendChild(dialLink);

    const sosBtn = document.createElement('button');
    sosBtn.type = 'button';
    sosBtn.className = 'btn btn-secondary btn-sm';
    sosBtn.style.padding = '4px 10px';
    sosBtn.style.fontSize = '0.75rem';
    sosBtn.textContent = '🚑 Medical SOS';
    sosBtn.addEventListener('click', () => {
      try {
        triggerMedicalSos();
      } catch (e) {
        console.warn('Could not trigger SOS:', e);
      }
    });
    actions.appendChild(sosBtn);

    emergBanner.appendChild(actions);
    msg.appendChild(emergBanner);
  }

  // 3. Render Markdown Answer
  const answerBody = document.createElement('div');
  answerBody.className = 'chat-answer-body';
  renderSafeMarkdownToDOM(answer, answerBody);
  msg.appendChild(answerBody);

  // 4. Missing Evidence Notice
  if (retrievalStatus === 'no_results') {
    const noResultsNote = document.createElement('div');
    noResultsNote.className = 'chat-no-results-note';
    noResultsNote.style.marginTop = '10px';
    noResultsNote.style.padding = '8px 12px';
    noResultsNote.style.backgroundColor = 'rgba(245, 158, 11, 0.08)';
    noResultsNote.style.border = '1px solid rgba(245, 158, 11, 0.2)';
    noResultsNote.style.borderRadius = 'var(--radius-sm)';
    noResultsNote.style.fontSize = '0.72rem';
    noResultsNote.style.color = '#B45309';
    noResultsNote.textContent = 'ℹ️ Note: This response is based on general educational healthcare navigation because no directly matching guidelines were found in the approved medical knowledge base.';
    msg.appendChild(noResultsNote);
  }

  // 5. Render Verified Sources Citations
  if (Array.isArray(sources) && sources.length > 0) {
    const sourcesBox = document.createElement('div');
    sourcesBox.className = 'chat-sources-box';
    sourcesBox.style.marginTop = '12px';
    sourcesBox.style.paddingTop = '10px';
    sourcesBox.style.borderTop = '1px dashed var(--border)';
    sourcesBox.style.fontSize = '0.74rem';
    sourcesBox.style.color = 'var(--text-secondary)';

    const heading = document.createElement('div');
    heading.style.fontWeight = '700';
    heading.style.marginBottom = '6px';
    heading.style.color = 'var(--text-primary)';
    heading.textContent = '📚 Verified Medical Sources:';
    sourcesBox.appendChild(heading);

    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '6px';

    sources.forEach((src) => {
      const item = document.createElement('div');
      item.style.lineHeight = '1.4';

      const prefix = document.createElement('span');
      prefix.textContent = `• [Source ${src.sourceIndex || '1'}]: `;
      prefix.style.fontWeight = '600';
      item.appendChild(prefix);

      const isHttpUrl = src.sourceUrl && /^https?:\/\//i.test(src.sourceUrl.trim());
      if (isHttpUrl) {
        const link = document.createElement('a');
        link.href = src.sourceUrl.trim();
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = src.title || 'Clinical Guideline';
        link.style.color = 'var(--primary)';
        link.style.textDecoration = 'underline';
        link.style.fontWeight = '600';
        item.appendChild(link);
      } else {
        const titleSpan = document.createElement('span');
        titleSpan.textContent = src.title || 'Clinical Guideline';
        titleSpan.style.fontWeight = '600';
        item.appendChild(titleSpan);
      }

      const details = [];
      if (src.publisher) details.push(src.publisher);
      if (src.sectionHeading) details.push(`Section: ${src.sectionHeading}`);
      if (src.publicationDate) details.push(`Published: ${src.publicationDate}`);

      if (details.length > 0) {
        const meta = document.createElement('span');
        meta.style.color = 'var(--text-secondary)';
        meta.style.fontSize = '0.7rem';
        meta.textContent = ` (${details.join(' • ')})`;
        item.appendChild(meta);
      }

      list.appendChild(item);
    });

    sourcesBox.appendChild(list);
    msg.appendChild(sourcesBox);
  }

  // ----------------------------------------------------
  // 6. Voice Output Audio Player Bar (ElevenLabs + Browser Fallback)
  // ----------------------------------------------------
  if (!isError && answer && answer.trim().length > 0) {
    const playerBar = document.createElement('div');
    playerBar.className = 'voice-player-bar';

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'btn btn-secondary btn-sm';
    playBtn.style.padding = '4px 10px';
    playBtn.style.fontSize = '0.75rem';
    playBtn.style.borderRadius = 'var(--radius-sm)';
    playBtn.innerHTML = '<span>▶</span> <span>Listen</span>';

    const statusSpan = document.createElement('span');
    statusSpan.style.color = 'var(--text-secondary)';
    statusSpan.style.fontSize = '0.72rem';
    statusSpan.textContent = 'Voice Ready';

    const waveAnim = document.createElement('span');
    waveAnim.style.display = 'none';
    waveAnim.innerHTML = '<span class="audio-wave-bar"></span><span class="audio-wave-bar"></span><span class="audio-wave-bar"></span>';

    playerBar.appendChild(playBtn);
    playerBar.appendChild(waveAnim);
    playerBar.appendChild(statusSpan);
    msg.appendChild(playerBar);

    let playbackCtrl = null;
    let activeSpeechMode = 'elevenlabs';

    const startPlayback = async () => {
      if (!voiceClient) return;

      try {
        playBtn.disabled = true;
        playBtn.innerHTML = '<span>⏳</span> <span>Speaking...</span>';
        statusSpan.textContent = 'Preparing speech...';

        playbackCtrl = await voiceClient.speak(answer, {
          onMode: (mode) => {
            activeSpeechMode = mode;
          },
          onStart: () => {
            msg.classList.add('speaking-active-bubble');
            waveAnim.style.display = 'inline-flex';
            playBtn.disabled = false;
            playBtn.innerHTML = '<span>⏸</span> <span>Pause</span>';
            statusSpan.textContent = activeSpeechMode === 'elevenlabs'
              ? 'Speaking (ElevenLabs)'
              : 'Speaking (Browser Voice)';
          },
          onPause: () => {
            waveAnim.style.display = 'none';
            playBtn.innerHTML = '<span>▶</span> <span>Resume</span>';
            statusSpan.textContent = 'Paused';
          },
          onResume: () => {
            waveAnim.style.display = 'inline-flex';
            playBtn.innerHTML = '<span>⏸</span> <span>Pause</span>';
            statusSpan.textContent = activeSpeechMode === 'elevenlabs'
              ? 'Speaking (ElevenLabs)'
              : 'Speaking (Browser Voice)';
          },
          onProgress: (prog) => {
            const cur = formatAudioTime(prog.currentTime);
            const tot = formatAudioTime(prog.duration);
            statusSpan.textContent = `${cur} / ${tot}`;
          },
          onEnd: () => {
            msg.classList.remove('speaking-active-bubble');
            waveAnim.style.display = 'none';
            playBtn.disabled = false;
            playBtn.innerHTML = '<span>🔄</span> <span>Replay</span>';
            statusSpan.textContent = 'Completed';
            playbackCtrl = null;
          },
          onError: () => {
            msg.classList.remove('speaking-active-bubble');
            waveAnim.style.display = 'none';
            playBtn.disabled = false;
            playBtn.innerHTML = '<span>▶</span> <span>Listen</span>';
            statusSpan.textContent = 'Playback ended';
            playbackCtrl = null;
          }
        });
      } catch (err) {
        msg.classList.remove('speaking-active-bubble');
        playBtn.disabled = false;
        playBtn.innerHTML = '<span>▶</span> <span>Listen</span>';
        statusSpan.textContent = 'Speech unavailable';
        playbackCtrl = null;
      }
    };

    playBtn.addEventListener('click', () => {
      if (!playbackCtrl) {
        startPlayback();
      } else if (voiceClient.isPlaying) {
        playbackCtrl.pause();
      } else {
        playbackCtrl.resume();
      }
    });

    // Auto-play speech if user enabled autoplay preference OR if question was asked via voice
    const shouldAutoplay = Boolean(
      (voiceClient && voiceClient.getPreferences().autoplay) || isVoiceResponse
    );

    if (shouldAutoplay) {
      setTimeout(() => {
        startPlayback();
      }, 350);
    }
  }

  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
  return msg;
}

/**
 * Safely parses raw markdown into DOM elements without innerHTML.
 */
export function renderSafeMarkdownToDOM(rawText, container) {
  if (!rawText || typeof rawText !== 'string' || !container) return;

  const lines = rawText.split('\n');

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      const spacer = document.createElement('div');
      spacer.style.height = '6px';
      container.appendChild(spacer);
      return;
    }

    const isBullet = /^[-*•]\s+/.test(trimmed);

    if (isBullet) {
      const bulletContent = trimmed.replace(/^[-*•]\s+/, '');
      const itemDiv = document.createElement('div');
      itemDiv.style.display = 'flex';
      itemDiv.style.alignItems = 'flex-start';
      itemDiv.style.gap = '6px';
      itemDiv.style.marginBottom = '4px';

      const bulletDot = document.createElement('span');
      bulletDot.textContent = '•';
      bulletDot.style.color = 'var(--primary)';
      bulletDot.style.fontWeight = '700';
      bulletDot.style.flexShrink = '0';
      itemDiv.appendChild(bulletDot);

      const contentSpan = document.createElement('span');
      appendSafeInlineTokens(bulletContent, contentSpan);
      itemDiv.appendChild(contentSpan);

      container.appendChild(itemDiv);
    } else {
      const lineDiv = document.createElement('div');
      lineDiv.style.marginBottom = '6px';
      appendSafeInlineTokens(trimmed, lineDiv);
      container.appendChild(lineDiv);
    }
  });
}

/**
 * Tokenizes text inline into bold, italic, citation badge pills, and text nodes.
 */
export function appendSafeInlineTokens(text, container) {
  if (!text || !container) return;

  const tokenRegex = /(\*\*.*?\*\*|\*[^*]+?\*|\[Source\s*\d+\])/g;
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
    }

    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = token.slice(2, -2);
      container.appendChild(strong);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      const em = document.createElement('em');
      em.textContent = token.slice(1, -1);
      container.appendChild(em);
    } else if (/^\[Source\s*\d+\]$/i.test(token)) {
      const pill = document.createElement('span');
      pill.className = 'chat-citation-pill';
      pill.textContent = token;
      pill.style.fontSize = '0.72rem';
      pill.style.padding = '1px 5px';
      pill.style.borderRadius = '4px';
      pill.style.backgroundColor = 'rgba(13, 148, 136, 0.12)';
      pill.style.color = 'var(--primary, #0D9488)';
      pill.style.fontWeight = '600';
      pill.style.marginLeft = '2px';
      pill.style.marginRight = '2px';
      container.appendChild(pill);
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.substring(lastIndex)));
  }
}

/**
 * Displays an animated typing/loading indicator in chat messages.
 */
export function showTypingIndicator() {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('chat-messages');
  if (!container) return;

  if (document.getElementById('chat-typing-indicator')) return;

  const indicator = document.createElement('div');
  indicator.id = 'chat-typing-indicator';
  indicator.className = 'skeleton';
  indicator.style.alignSelf = 'flex-start';
  indicator.style.maxWidth = '75%';
  indicator.style.padding = '10px 14px';
  indicator.style.borderRadius = '0 var(--radius-md) var(--radius-md) var(--radius-md)';
  indicator.style.fontSize = '0.8rem';
  indicator.style.color = 'var(--text-secondary)';
  indicator.style.display = 'flex';
  indicator.style.alignItems = 'center';
  indicator.style.gap = '8px';

  const dot = document.createElement('span');
  dot.textContent = '●';
  dot.style.color = 'var(--primary)';
  dot.style.animation = 'pulse 1.2s infinite';
  indicator.appendChild(dot);

  const textNode = document.createElement('span');
  textNode.textContent = 'Sanjeev Astra is analyzing medical guidelines...';
  indicator.appendChild(textNode);

  container.appendChild(indicator);
  container.scrollTop = container.scrollHeight;
  return indicator;
}

/**
 * Removes typing/loading indicator from chat messages.
 */
export function removeTypingIndicator() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('chat-typing-indicator');
  if (el) el.remove();
}
