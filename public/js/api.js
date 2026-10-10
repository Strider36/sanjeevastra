/* Sanjeev Astra API Service Wrapper */

const API_BASE = '/api';

export const apiFetch = async (endpoint, options = {}) => {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  
  // Prepare headers
  options.headers = options.headers || {};
  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }

  // If body is an object and not FormData, stringify it
  if (options.body && !(options.body instanceof FormData) && typeof options.body === 'object') {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  // Attach timeout signal using AbortController if supported
  const timeoutMs = options.timeout || 35000;
  let timeoutId = null;
  if (!options.signal && typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    options.signal = controller.signal;
    timeoutId = setTimeout(() => {
      try {
        controller.abort();
      } catch (e) {
        // Ignore already completed controller
      }
    }, timeoutMs);
  }

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    if (timeoutId) clearTimeout(timeoutId);
    
    // Check if token expired or invalid
    if (response.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/register')) {
      logout();
      if (typeof window !== 'undefined' && window.location) {
        window.location.href = '/login.html';
      }
      return { success: false, error: 'Session expired. Please log in again.', status: 401 };
    }

    const data = await response.json();
    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'Something went wrong',
        status: response.status,
        data
      };
    }

    return data;
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    console.error(`Fetch error at ${endpoint}:`, error);
    const isTimeout = error.name === 'AbortError' || (typeof error.message === 'string' && error.message.toLowerCase().includes('timeout'));
    return {
      success: false,
      error: isTimeout ? 'Request timed out. Please try again.' : 'Network connection failure',
      status: isTimeout ? 504 : 0,
      isTimeout
    };
  }
};

export const getToken = () => (typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null);
export const setToken = (token) => (typeof localStorage !== 'undefined' ? localStorage.setItem('token', token) : null);
export const removeToken = () => (typeof localStorage !== 'undefined' ? localStorage.removeItem('token') : null);
export const isAuthenticated = () => !!getToken();
export const getUser = () => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('user') : null;
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};

export const logout = async () => {
  try {
    const storedUser = typeof localStorage !== 'undefined' ? localStorage.getItem('user') : null;
    const user = storedUser ? JSON.parse(storedUser) : null;
    const userId = user?._id || user?.id;
    if (userId) {
      const { offlineStorage } = await import('./db.js');
      await offlineStorage.purgeUserData(userId);
    }
  } catch (e) {
    console.warn('[Logout] Cleanup note:', e);
  }

  removeToken();
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('user');
  }
  if (typeof window !== 'undefined' && window.location) {
    window.location.href = '/';
  }
};

// Central Toast Manager
export const showToast = (title, message, type = 'success') => {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = '🔔';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';
  if (type === 'warning') icon = '⚠️';

  toast.innerHTML = `
    <span style="font-size: 1.25rem;">${icon}</span>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;

  container.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);

  // Auto-remove
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
};

// Global Initialization UI Hooks
export const initTheme = () => {
  const savedTheme = localStorage.getItem('theme') || 'light';
  if (savedTheme === 'dark') {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }
};

// Validate profile field requirements
export const formatBloodGroup = (bg) => {
  const validGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  return validGroups.includes(bg?.toUpperCase()) ? bg.toUpperCase() : null;
};

// Trigger browser reminders dynamically
export function triggerReminderAudio() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // A5 note
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.3); // play for 300ms
  } catch (err) {
    console.log('AudioContext not allowed or not supported yet:', err);
  }
}

