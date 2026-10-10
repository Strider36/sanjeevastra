/* Sanjeev Astra ElevenLabs Voice Client & Audio Controller (with Browser Speech Fallback) */
import { apiFetch, showToast, getToken } from './api.js';

export class ElevenVoiceClient {
  constructor(options = {}) {
    this.onStatusChange = options.onStatusChange || (() => {});
    this.mediaRecorder = null;
    this.audioStream = null;
    this.audioChunks = [];
    this.recordingStartTime = null;
    this.timerInterval = null;
    this.currentAudio = null;
    this.currentObjectUrl = null;
    this.currentUtterance = null;
    this.speechRecognizer = null;
    this.browserTranscript = '';
    this.isRecording = false;
    this.isPlaying = false;
    this.config = null;
    this.activeSpeechMode = 'elevenlabs'; // 'elevenlabs' or 'browser'

    // Load persisted preferences: default autoplay to true for immediate speech turnaround
    const storedAutoplay = typeof localStorage !== 'undefined' ? localStorage.getItem('swasthya_voice_autoplay') : null;
    const initialAutoplay = storedAutoplay !== null ? storedAutoplay === 'true' : true;

    this.preferences = {
      autoplay: initialAutoplay,
      voiceId: (typeof localStorage !== 'undefined' && localStorage.getItem('swasthya_voice_id')) || '21m00Tcm4TlvDq8ikWAM',
      language: (typeof localStorage !== 'undefined' && localStorage.getItem('swasthya_voice_lang')) || 'en'
    };
  }

  /**
   * Initializes voice service by loading voice configuration from backend.
   */
  async init() {
    try {
      const res = await apiFetch('/voice/config');
      if (res && res.success && res.data) {
        this.config = res.data;
      }
    } catch (e) {
      console.warn('Could not fetch voice configuration:', e);
    }
    return this.config;
  }

  /**
   * Updates and persists user voice preferences.
   */
  setPreferences(updates = {}) {
    if (typeof updates.autoplay === 'boolean') {
      this.preferences.autoplay = updates.autoplay;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('swasthya_voice_autoplay', updates.autoplay ? 'true' : 'false');
      }
    }
    if (updates.voiceId) {
      this.preferences.voiceId = updates.voiceId;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('swasthya_voice_id', updates.voiceId);
      }
    }
    if (updates.language) {
      this.preferences.language = updates.language;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('swasthya_voice_lang', updates.language);
      }
    }
  }

  getPreferences() {
    return { ...this.preferences };
  }

  /**
   * Strips Markdown headings, asterisks, bullet points, source citations [Source 1],
   * HTML tags, and URLs so speech engines pronounce clean clinical prose.
   */
  cleanTextForSpeech(text) {
    if (!text || typeof text !== 'string') return '';

    return text
      // Remove Markdown headings
      .replace(/^#{1,6}\s+/gm, '')
      // Remove Markdown bold/italics
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
   * Starts recording audio from browser microphone using MediaRecorder.
   * Also listens with browser SpeechRecognition in parallel as an instant fallback.
   */
  async startRecording() {
    if (this.isRecording) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microphone access is not supported in this browser.');
    }

    try {
      this.onStatusChange({ state: 'listening', durationSeconds: 0 });
      this.browserTranscript = '';

      // Initialize browser SpeechRecognition in parallel if available
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRec) {
        try {
          this.speechRecognizer = new SpeechRec();
          this.speechRecognizer.continuous = true;
          this.speechRecognizer.interimResults = true;
          const lang = this.preferences.language || 'en';
          this.speechRecognizer.lang = lang === 'hi' ? 'hi-IN' : (lang === 'mr' ? 'mr-IN' : 'en-US');

          this.speechRecognizer.onresult = (event) => {
            let combined = '';
            for (let i = 0; i < event.results.length; i++) {
              combined += event.results[i][0].transcript + ' ';
            }
            this.browserTranscript = combined.trim();
          };

          this.speechRecognizer.onerror = (e) => {
            console.warn('Browser SpeechRecognition note:', e?.error);
          };

          this.speechRecognizer.start();
        } catch (e) {
          console.warn('SpeechRecognition initialization note:', e);
          this.speechRecognizer = null;
        }
      }

      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 44100,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      // Select best supported MIME type
      let mimeType = 'audio/webm';
      const candidateTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/ogg'
      ];

      for (const type of candidateTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }

      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(this.audioStream, { mimeType });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.recordingStartTime = Date.now();
      this.isRecording = true;

      // Start duration tracking interval
      this.timerInterval = setInterval(() => {
        if (this.recordingStartTime) {
          const seconds = Math.floor((Date.now() - this.recordingStartTime) / 1000);
          this.onStatusChange({ state: 'listening', durationSeconds: seconds });

          // Auto-stop at 60 seconds to protect usage
          if (seconds >= 60) {
            this.stopRecording();
          }
        }
      }, 500);

      this.mediaRecorder.start(250);
    } catch (err) {
      this.cleanupMediaStream();
      this.isRecording = false;
      this.onStatusChange({ state: 'error', error: err.message });
      throw err;
    }
  }

  /**
   * Stops recording and returns the recorded Audio Blob.
   */
  async stopRecording() {
    if (!this.isRecording || !this.mediaRecorder) {
      return null;
    }

    if (this.speechRecognizer) {
      try {
        this.speechRecognizer.stop();
      } catch (e) {}
    }

    return new Promise((resolve, reject) => {
      this.mediaRecorder.onstop = () => {
        const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        const durationSeconds = this.recordingStartTime
          ? Math.floor((Date.now() - this.recordingStartTime) / 1000)
          : 0;

        this.cleanupMediaStream();
        this.isRecording = false;
        this.onStatusChange({ state: 'ready' });

        resolve({
          blob: audioBlob,
          mimeType,
          durationSeconds
        });
      };

      this.mediaRecorder.onerror = (e) => {
        this.cleanupMediaStream();
        this.isRecording = false;
        this.onStatusChange({ state: 'error', error: 'Recording failure' });
        reject(e);
      };

      try {
        this.mediaRecorder.stop();
      } catch (err) {
        this.cleanupMediaStream();
        this.isRecording = false;
        reject(err);
      }
    });
  }

  /**
   * Discards the active recording and resets state.
   */
  cancelRecording() {
    if (this.speechRecognizer) {
      try {
        this.speechRecognizer.stop();
      } catch (e) {}
      this.speechRecognizer = null;
    }
    this.browserTranscript = '';

    if (this.mediaRecorder && this.isRecording) {
      try {
        this.mediaRecorder.stop();
      } catch (e) {}
    }
    this.cleanupMediaStream();
    this.isRecording = false;
    this.audioChunks = [];
    this.onStatusChange({ state: 'ready' });
  }

  /**
   * Releases hardware microphone tracks immediately.
   */
  cleanupMediaStream() {
    if (this.audioStream) {
      try {
        this.audioStream.getTracks().forEach(track => {
          if (track && typeof track.stop === 'function') {
            track.stop();
          }
        });
      } catch (e) {
        console.warn('Error stopping audio tracks:', e);
      }
      this.audioStream = null;
    }
    this.mediaRecorder = null;
    clearInterval(this.timerInterval);
  }

  /**
   * Transcribes recorded Audio Blob via protected ElevenLabs STT backend endpoint.
   * Falls back to browser SpeechRecognition if ElevenLabs is unconfigured or fails.
   */
  async transcribeAudio(blob, language) {
    if (!blob || blob.size === 0) {
      throw new Error('Recorded audio file is empty.');
    }

    this.onStatusChange({ state: 'transcribing' });

    const formData = new FormData();
    const extension = blob.type.includes('mp4') ? 'mp4' : (blob.type.includes('ogg') ? 'ogg' : 'webm');
    formData.append('audio', blob, `patient_speech.${extension}`);

    const targetLang = language || this.preferences.language || 'en';
    formData.append('language', targetLang);

    const token = getToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000);

    try {
      const response = await fetch('/api/voice/transcribe', {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const data = await response.json();

      if (!response.ok || !data.success) {
        // Fallback to browser SpeechRecognition transcript if available
        if (this.browserTranscript && this.browserTranscript.trim().length > 0) {
          this.onStatusChange({ state: 'ready' });
          return {
            text: this.browserTranscript.trim(),
            language: targetLang,
            confidence: 0.9,
            mode: 'browser',
            requestId: 'browser_stt'
          };
        }

        const error = new Error(data.error || 'Failed to transcribe audio.');
        error.status = response.status;
        error.data = data;
        this.onStatusChange({ state: 'error', error: error.message });
        throw error;
      }

      this.onStatusChange({ state: 'ready' });
      return {
        text: data.text,
        language: data.language,
        confidence: data.confidence,
        mode: 'elevenlabs',
        requestId: data.requestId
      };
    } catch (err) {
      clearTimeout(timeoutId);
      // Fallback to browser SpeechRecognition transcript on error/offline
      if (this.browserTranscript && this.browserTranscript.trim().length > 0) {
        this.onStatusChange({ state: 'ready' });
        return {
          text: this.browserTranscript.trim(),
          language: targetLang,
          confidence: 0.9,
          mode: 'browser',
          requestId: 'browser_stt'
        };
      }
      this.onStatusChange({ state: 'error', error: err.message });
      throw err;
    }
  }

  /**
   * Synthesizes text to speech audio via ElevenLabs TTS backend endpoint.
   */
  async synthesizeText(text, options = {}) {
    if (!text || !text.trim()) {
      throw new Error('No text provided for speech synthesis.');
    }

    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const voiceId = options.voiceId || this.preferences.voiceId;
    const language = options.language || this.preferences.language;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000);

    try {
      const response = await fetch('/api/voice/synthesize', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          text,
          voiceId,
          language
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errJson = null;
        try {
          errJson = await response.json();
        } catch (e) {}
        const error = new Error(errJson?.error || `Synthesis failed with status ${response.status}`);
        error.status = response.status;
        throw error;
      }

      const audioBlob = await response.blob();
      return audioBlob;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  /**
   * Unified speech method: Tries ElevenLabs TTS first; if unconfigured or offline,
   * falls back immediately to Browser Web Speech Synthesis (window.speechSynthesis).
   *
   * @param {string} text - Raw assistant response text
   * @param {Object} callbacks - { onStart, onPause, onResume, onProgress, onEnd, onError, onMode }
   * @param {Object} [options] - { voiceId, language }
   * @returns {Promise<Object>} Playback controller { pause, resume, stop, replay }
   */
  async speak(text, callbacks = {}, options = {}) {
    this.stopPlayback();

    const cleanText = this.cleanTextForSpeech(text);
    if (!cleanText || cleanText.trim().length === 0) {
      throw new Error('No speakable text found in response.');
    }

    this.onStatusChange({ state: 'thinking' });

    // Step 1: Attempt ElevenLabs TTS via backend
    let elevenBlob = null;
    try {
      elevenBlob = await this.synthesizeText(cleanText, options);
    } catch (err) {
      console.warn('ElevenLabs TTS unavailable, activating Browser Speech Synthesis fallback:', err.message);
    }

    // Step 2: If ElevenLabs audio was returned, play it via Audio element
    if (elevenBlob && elevenBlob.size > 0) {
      this.activeSpeechMode = 'elevenlabs';
      if (callbacks.onMode) callbacks.onMode('elevenlabs');
      return this.playAudio(elevenBlob, callbacks);
    }

    // Step 3: Fallback to Browser Speech Synthesis (Web Speech API)
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.activeSpeechMode = 'browser';
      if (callbacks.onMode) callbacks.onMode('browser');
      return this.playBrowserSpeech(cleanText, callbacks, options);
    }

    throw new Error('Speech synthesis is not supported on this browser and ElevenLabs is unconfigured.');
  }

  /**
   * Plays speech audio via HTML5 Audio element with lifecycle callbacks.
   */
  playAudio(audioSource, callbacks = {}) {
    this.stopPlayback();

    let url = '';
    if (typeof audioSource === 'string') {
      url = audioSource;
    } else if (audioSource instanceof Blob) {
      this.currentObjectUrl = URL.createObjectURL(audioSource);
      url = this.currentObjectUrl;
    } else {
      throw new Error('Invalid audio source for playback.');
    }

    const audio = new Audio(url);
    this.currentAudio = audio;
    this.isPlaying = true;

    this.onStatusChange({ state: 'speaking' });
    if (callbacks.onStart) callbacks.onStart();

    audio.addEventListener('timeupdate', () => {
      if (callbacks.onProgress && audio.duration) {
        callbacks.onProgress({
          currentTime: audio.currentTime,
          duration: audio.duration,
          percent: (audio.currentTime / audio.duration) * 100
        });
      }
    });

    audio.addEventListener('ended', () => {
      this.isPlaying = false;
      this.onStatusChange({ state: 'ready' });
      if (callbacks.onEnd) callbacks.onEnd();
      this.cleanupPlayback();
    });

    audio.addEventListener('error', (e) => {
      this.isPlaying = false;
      this.onStatusChange({ state: 'error', error: 'Audio playback failed' });
      if (callbacks.onError) callbacks.onError(e);
      this.cleanupPlayback();
    });

    audio.play().catch(err => {
      console.warn('Audio auto-play prevented by browser policy:', err);
      this.isPlaying = false;
      this.onStatusChange({ state: 'ready' });
      if (callbacks.onError) callbacks.onError(err);
    });

    return {
      pause: () => {
        if (this.currentAudio && !this.currentAudio.paused) {
          this.currentAudio.pause();
          this.isPlaying = false;
          if (callbacks.onPause) callbacks.onPause();
        }
      },
      resume: () => {
        if (this.currentAudio && this.currentAudio.paused) {
          this.currentAudio.play();
          this.isPlaying = true;
          this.onStatusChange({ state: 'speaking' });
          if (callbacks.onResume) callbacks.onResume();
        }
      },
      stop: () => {
        this.stopPlayback();
        if (callbacks.onEnd) callbacks.onEnd();
      },
      replay: () => {
        if (this.currentAudio) {
          this.currentAudio.currentTime = 0;
          this.currentAudio.play();
          this.isPlaying = true;
          this.onStatusChange({ state: 'speaking' });
          if (callbacks.onStart) callbacks.onStart();
        }
      }
    };
  }

  /**
   * Plays speech using the browser's built-in Web Speech API (window.speechSynthesis).
   */
  playBrowserSpeech(text, callbacks = {}, options = {}) {
    this.stopPlayback();

    const synth = window.speechSynthesis;
    synth.cancel(); // Cancel any existing speech

    const utterance = new SpeechSynthesisUtterance(text);

    // Language configuration
    const lang = options.language || this.preferences.language || 'en';
    const langPrefix = lang === 'hi' ? 'hi' : (lang === 'mr' ? 'mr' : 'en');

    const voices = synth.getVoices ? synth.getVoices() : [];
    const matchedVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(langPrefix)) ||
                         voices.find(v => v.lang && v.lang.toLowerCase().startsWith('en'));

    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }
    utterance.lang = lang === 'hi' ? 'hi-IN' : (lang === 'mr' ? 'mr-IN' : 'en-US');
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    this.currentUtterance = utterance;
    this.isPlaying = true;
    this.onStatusChange({ state: 'speaking' });

    if (callbacks.onStart) callbacks.onStart();

    // Chrome workaround for long utterances: resume periodically if paused
    const resumeTimer = setInterval(() => {
      if (synth.speaking && !synth.paused) {
        synth.pause();
        synth.resume();
      } else {
        clearInterval(resumeTimer);
      }
    }, 10000);

    utterance.onend = () => {
      clearInterval(resumeTimer);
      this.isPlaying = false;
      this.currentUtterance = null;
      this.onStatusChange({ state: 'ready' });
      if (callbacks.onEnd) callbacks.onEnd();
    };

    utterance.onerror = (e) => {
      clearInterval(resumeTimer);
      this.isPlaying = false;
      this.currentUtterance = null;
      this.onStatusChange({ state: 'ready' });
      if (callbacks.onError) callbacks.onError(e);
    };

    synth.speak(utterance);

    return {
      pause: () => {
        if (synth.speaking && !synth.paused) {
          synth.pause();
          this.isPlaying = false;
          if (callbacks.onPause) callbacks.onPause();
        }
      },
      resume: () => {
        if (synth.paused) {
          synth.resume();
          this.isPlaying = true;
          this.onStatusChange({ state: 'speaking' });
          if (callbacks.onResume) callbacks.onResume();
        }
      },
      stop: () => {
        clearInterval(resumeTimer);
        synth.cancel();
        this.isPlaying = false;
        this.currentUtterance = null;
        this.onStatusChange({ state: 'ready' });
        if (callbacks.onEnd) callbacks.onEnd();
      },
      replay: () => {
        clearInterval(resumeTimer);
        synth.cancel();
        this.playBrowserSpeech(text, callbacks, options);
      }
    };
  }

  /**
   * Immediately stops any currently playing audio and revokes memory URLs.
   */
  stopPlayback() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }
    this.currentUtterance = null;

    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch (e) {}
      this.currentAudio = null;
    }
    this.cleanupPlayback();
    this.isPlaying = false;
    this.onStatusChange({ state: 'ready' });
  }

  cleanupPlayback() {
    if (this.currentObjectUrl) {
      try {
        URL.revokeObjectURL(this.currentObjectUrl);
      } catch (e) {}
      this.currentObjectUrl = null;
    }
  }
}
