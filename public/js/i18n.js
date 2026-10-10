/* Sanjeev Astra Internationalization (i18n) Engine */

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', native: 'English', flag: '🇬🇧' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', flag: '🇮🇳' },
  { code: 'mr', label: 'Marathi', native: 'मराठी', flag: '🇮🇳' }
];

const DEFAULT_LANG = 'en';
const STORAGE_KEY = 'swasthya_lang';

let currentLanguage = (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function'
  ? localStorage.getItem(STORAGE_KEY)
  : null) || DEFAULT_LANG;
let localeData = {};
let isLoaded = false;
let loadPromise = null;

// Load translations for a specific language
async function fetchLocale(lang) {
  try {
    const res = await fetch(`/locales/${lang}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`[i18n] Could not load /locales/${lang}.json:`, err);
    return null;
  }
}

// Initialize i18n
export async function initI18n() {
  if (isLoaded) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // Load current language and fallback English
    const [currentData, fallbackData] = await Promise.all([
      fetchLocale(currentLanguage),
      currentLanguage !== DEFAULT_LANG ? fetchLocale(DEFAULT_LANG) : Promise.resolve(null)
    ]);

    localeData[currentLanguage] = currentData || {};
    if (fallbackData) {
      localeData[DEFAULT_LANG] = fallbackData;
    }

    isLoaded = true;
    translateDOM();
    updateSelectors();
  })();

  return loadPromise;
}

// Get current active language code
export function getLanguage() {
  return currentLanguage;
}

// Change active language
export async function setLanguage(newLang) {
  if (!SUPPORTED_LANGUAGES.some(l => l.code === newLang)) {
    console.warn(`[i18n] Unsupported language requested: ${newLang}`);
    return;
  }

  currentLanguage = newLang;
  if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
    localStorage.setItem(STORAGE_KEY, newLang);
  }

  if (!localeData[newLang]) {
    const data = await fetchLocale(newLang);
    if (data) localeData[newLang] = data;
  }

  // Update DOM
  translateDOM();
  updateSelectors();

  // Dispatch custom event for dynamic components (charts, modals, SOS UI)
  window.dispatchEvent(new CustomEvent('swasthya:languageChanged', {
    detail: { language: newLang }
  }));
}

// Helper to resolve nested key (e.g. 'sos.requestAmbulance')
function resolveKey(obj, path) {
  if (!obj) return null;
  const parts = path.split('.');
  let curr = obj;
  for (const part of parts) {
    if (curr === undefined || curr === null) return null;
    curr = curr[part];
  }
  return curr;
}

// Translate function t(key, fallback)
export function t(key, fallback = '') {
  // Check active language
  const val = resolveKey(localeData[currentLanguage], key);
  if (typeof val === 'string') return val;

  // Check English fallback
  if (currentLanguage !== DEFAULT_LANG && localeData[DEFAULT_LANG]) {
    const fallbackVal = resolveKey(localeData[DEFAULT_LANG], key);
    if (typeof fallbackVal === 'string') return fallbackVal;
  }

  return fallback || key;
}

// Automatically translate marked elements within given root (or document.body)
export function translateDOM(root = document) {
  // 1. Text content: data-i18n="key"
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translated = t(key);
    if (translated && translated !== key) {
      el.textContent = translated;
    }
  });

  // 2. Placeholders: data-i18n-placeholder="key"
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const translated = t(key);
    if (translated && translated !== key) {
      el.setAttribute('placeholder', translated);
    }
  });

  // 3. Tooltips/Titles: data-i18n-title="key"
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    const translated = t(key);
    if (translated && translated !== key) {
      el.setAttribute('title', translated);
    }
  });

  // 4. Value: data-i18n-val="key"
  root.querySelectorAll('[data-i18n-val]').forEach(el => {
    const key = el.getAttribute('data-i18n-val');
    const translated = t(key);
    if (translated && translated !== key) {
      el.value = translated;
    }
  });
}

// Update all language select elements on the page
function updateSelectors() {
  document.querySelectorAll('.swasthya-lang-select').forEach(select => {
    select.value = currentLanguage;
  });
}

// Render a reusable language dropdown / button selector
export function renderLanguageSelector(targetContainer) {
  if (!targetContainer) return;

  const current = getLanguage();
  targetContainer.innerHTML = `
    <div class="lang-selector-widget" style="display: inline-flex; align-items: center; gap: 6px; background: rgba(var(--primary-rgb), 0.08); padding: 4px 10px; border-radius: var(--radius-full); border: 1px solid var(--border);">
      <span style="font-size: 0.9rem;">🌐</span>
      <select class="swasthya-lang-select" style="background: transparent; border: none; font-size: 0.85rem; font-weight: 600; color: var(--text-primary); cursor: pointer; outline: none; padding: 2px 4px;">
        ${SUPPORTED_LANGUAGES.map(l => `
          <option value="${l.code}" ${l.code === current ? 'selected' : ''} style="color: #0F172A; background: #FFFFFF;">
            ${l.native} (${l.code.toUpperCase()})
          </option>
        `).join('')}
      </select>
    </div>
  `;

  const selectEl = targetContainer.querySelector('.swasthya-lang-select');
  if (selectEl) {
    selectEl.addEventListener('change', (e) => {
      setLanguage(e.target.value);
    });
  }
}

// Auto-run on DOM ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initI18n());
  } else {
    initI18n();
  }
}
