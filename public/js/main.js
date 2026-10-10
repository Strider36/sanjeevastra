/* Sanjeev Astra Shell Layout Controller */
import { isAuthenticated, apiFetch, logout, initTheme } from './api.js';
import { initI18n, t, renderLanguageSelector, translateDOM } from './i18n.js';
import { triggerMedicalSos } from './sos.js';
import './networkStatus.js';

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Session Guard: Check authorization status
  if (!isAuthenticated()) {
    window.location.href = '/login.html';
    return;
  }

  // 2. Initialize i18n & Dark Mode setting
  await initI18n();
  initTheme();

  // 3. Inject Layout Shell Components
  const sidebarContainer = document.getElementById('app-sidebar');
  const navbarContainer = document.getElementById('app-navbar');

  if (sidebarContainer) {
    injectSidebar(sidebarContainer);
  }

  if (navbarContainer) {
    injectNavbar(navbarContainer);
  }

  // 4. Trigger Lucide Icons Rendering
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // 5. Load User Profile Header Information
  loadUserHeader();

  // 6. Register Navigation Interactivity
  registerNavHandlers();

  // 7. Fetch Notifications & Reminders
  loadNotifications();

  // 8. Sync Live Location & Start Real-Time Emergency Alert Polling
  syncLiveUserLocation();
  setInterval(() => {
    loadNotifications(true);
  }, 7000);

  // 8. Listen to language changes to re-render navigation immediately
  window.addEventListener('swasthya:languageChanged', () => {
    if (sidebarContainer) injectSidebar(sidebarContainer);
    if (navbarContainer) injectNavbar(navbarContainer);
    registerNavHandlers();
    translateDOM();
    if (window.lucide) window.lucide.createIcons();
  });
});

// Sidebar Injection Helper
function injectSidebar(container) {
  const activePage = container.getAttribute('data-active') || 'dashboard';

  container.className = 'sidebar';
  container.innerHTML = `
    <div class="sidebar-logo">
      <svg viewBox="0 0 24 24"><path d="M12 2v20M2 12h20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
      <span data-i18n="app.name">Sanjeev Astra</span>
    </div>
    
    <!-- Prominent Medical SOS Button in Sidebar -->
    <div style="padding: 0 16px 14px 16px;">
      <button id="btn-sidebar-sos" class="btn" style="width: 100%; background: linear-gradient(135deg, #EF4444, #B91C1C); color: white; font-weight: 700; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; gap: 8px; padding: 11px; border: none; cursor: pointer; box-shadow: 0 4px 14px rgba(239, 68, 68, 0.4); font-size: 0.95rem; transition: var(--transition);">
        <span style="font-size: 1.15rem;">🚑</span> <span data-i18n="sos.button">${t('sos.button', 'MEDICAL SOS')}</span>
      </button>
    </div>

    <ul class="sidebar-menu">
      <li class="sidebar-item ${activePage === 'dashboard' ? 'active' : ''}"><a href="/dashboard.html"><i data-lucide="layout-dashboard"></i> <span data-i18n="nav.dashboard">${t('nav.dashboard', 'Dashboard')}</span></a></li>
      <li class="sidebar-item ${activePage === 'medicines' ? 'active' : ''}"><a href="/medicines.html"><i data-lucide="pill"></i> <span data-i18n="nav.medications">${t('nav.medications', 'Medications')}</span></a></li>
      <li class="sidebar-item ${activePage === 'scanner' ? 'active' : ''}"><a href="/scanner.html"><i data-lucide="scan-line"></i> <span data-i18n="nav.scanner">${t('nav.scanner', 'OCR Scanner')}</span></a></li>
      <li class="sidebar-item ${activePage === 'prescriptions' ? 'active' : ''}"><a href="/prescriptions.html"><i data-lucide="file-signature"></i> <span data-i18n="nav.prescriptions">${t('nav.prescriptions', 'Prescriptions')}</span></a></li>
      <li class="sidebar-item ${activePage === 'records' ? 'active' : ''}"><a href="/records.html"><i data-lucide="folder-heart"></i> <span data-i18n="nav.records">${t('nav.records', 'Health Records')}</span></a></li>
      <li class="sidebar-item ${activePage === 'appointments' ? 'active' : ''}"><a href="/appointments.html"><i data-lucide="calendar"></i> <span data-i18n="nav.appointments">${t('nav.appointments', 'Appointments')}</span></a></li>
      <li class="sidebar-item ${activePage === 'sos-admin' ? 'active' : ''}"><a href="/sos-admin.html"><i data-lucide="shield-alert"></i> <span data-i18n="nav.adminBoard">${t('nav.adminBoard', 'Dispatch Board')}</span></a></li>
      <li class="sidebar-item ${activePage === 'profile' ? 'active' : ''}"><a href="/profile.html"><i data-lucide="user-cog"></i> <span data-i18n="nav.profile">${t('nav.profile', 'Profile Card')}</span></a></li>
      <li class="sidebar-item ${activePage === 'settings' ? 'active' : ''}"><a href="/settings.html"><i data-lucide="settings"></i> <span data-i18n="nav.settings">${t('nav.settings', 'Settings')}</span></a></li>
      <li class="sidebar-item logout"><a href="#" id="btn-logout"><i data-lucide="log-out"></i> <span data-i18n="nav.logout">${t('nav.logout', 'Logout')}</span></a></li>
    </ul>
  `;
}

// Navbar Injection Helper
function injectNavbar(container) {
  const pageTitle = container.getAttribute('data-title') || 'Dashboard';
  const pageSubtitle = container.getAttribute('data-subtitle') || 'Healthcare Summary';

  container.className = 'navbar';
  container.innerHTML = `
    <div class="nav-left">
      <button class="nav-toggle" id="sidebar-toggle">
        <i data-lucide="menu"></i>
      </button>
      <div>
        <h2 class="page-title">${pageTitle}</h2>
        <p class="page-subtitle" style="margin-top: 0; font-size: 0.8rem;">${pageSubtitle}</p>
      </div>
    </div>
    <div class="nav-right" style="display: flex; align-items: center; gap: 14px;">
      <!-- Language Selector -->
      <div id="navbar-lang-selector"></div>

      <!-- Quick Nav SOS Button -->
      <button id="btn-nav-sos" class="btn" style="background: #EF4444; color: white; font-weight: 700; font-size: 0.85rem; padding: 6px 14px; border-radius: var(--radius-full); display: flex; align-items: center; gap: 6px; border: none; cursor: pointer; box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);">
        <span>🚑</span> <span data-i18n="sos.button">${t('sos.button', 'SOS')}</span>
      </button>

      <div style="position: relative;">
        <button class="btn btn-secondary btn-icon" id="btn-notifications" style="border-radius: var(--radius-full); position: relative; padding: 8px;">
          <i data-lucide="bell"></i>
          <span id="notification-badge" style="display: none; position: absolute; top: 0px; right: 0px; width: 8px; height: 8px; background-color: var(--error); border-radius: 50%;"></span>
        </button>
        
        <div id="notifications-dropdown" style="display: none; position: absolute; top: 46px; right: 0; width: 320px; background-color: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); z-index: 1000; padding: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">
            <span style="font-weight: 600; font-size: 0.9rem;">Alerts & Reminders</span>
            <button id="btn-clear-notifications" style="background: none; border: none; color: var(--primary); font-size: 0.75rem; cursor: pointer; font-weight: 500;">Clear All</button>
          </div>
          <div id="notifications-list" style="max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
            <div style="text-align: center; color: var(--text-secondary); font-size: 0.8rem; padding: 12px;">Checking for alerts...</div>
          </div>
        </div>
      </div>
      
      <div class="nav-profile" onclick="window.location.href='/profile.html'">
        <div class="nav-avatar" id="navbar-avatar">U</div>
        <span class="nav-username" id="navbar-username">User</span>
      </div>
    </div>
  `;

  // Render language selector widget into navbar
  const langContainer = container.querySelector('#navbar-lang-selector');
  if (langContainer) {
    renderLanguageSelector(langContainer);
  }
}

// Bind header data
function loadUserHeader() {
  const cachedUserStr = localStorage.getItem('user');
  if (cachedUserStr) {
    try {
      const user = JSON.parse(cachedUserStr);
      const name = user.name || 'User';
      const initial = name.charAt(0).toUpperCase();

      const avatarEl = document.getElementById('navbar-avatar');
      const usernameEl = document.getElementById('navbar-username');

      if (avatarEl) avatarEl.textContent = initial;
      if (usernameEl) usernameEl.textContent = name.split(' ')[0]; // first name
    } catch (e) {
      console.error('Failed to parse cached user header:', e);
    }
  }
}

// Bind events to injected nodes
function registerNavHandlers() {
  // SOS buttons
  const sidebarSosBtn = document.getElementById('btn-sidebar-sos');
  if (sidebarSosBtn) {
    sidebarSosBtn.addEventListener('click', (e) => {
      e.preventDefault();
      triggerMedicalSos();
    });
  }

  const navSosBtn = document.getElementById('btn-nav-sos');
  if (navSosBtn) {
    navSosBtn.addEventListener('click', (e) => {
      e.preventDefault();
      triggerMedicalSos();
    });
  }

  // Logout button
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  }

  // Sidebar toggle for smaller screens
  const toggleBtn = document.getElementById('sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('open');
    });
    
    // Close sidebar clicking outside
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== toggleBtn) {
        sidebar.classList.remove('open');
      }
    });
  }

  // Notifications drawer dropdown toggle
  const notificationsBtn = document.getElementById('btn-notifications');
  const dropdown = document.getElementById('notifications-dropdown');
  if (notificationsBtn && dropdown) {
    notificationsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = dropdown.style.display === 'block';
      dropdown.style.display = isVisible ? 'none' : 'block';
    });

    document.addEventListener('click', () => {
      dropdown.style.display = 'none';
    });

    dropdown.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  // Notifications clear
  const clearBtn = document.getElementById('btn-clear-notifications');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      const res = await apiFetch('/notifications/read-all', { method: 'PUT' });
      if (res.success) {
        loadNotifications();
      }
    });
  }
}

// Load and render dynamic notifications
// Sync Live Geolocation to Backend for Nearby SOS notifications
function syncLiveUserLocation() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        await apiFetch('/sos/user-location', {
          method: 'POST',
          body: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            locationAddress: 'Live Browser Coordinates'
          }
        });
      } catch (e) {
        // Silent background sync
      }
    },
    (err) => {
      // Permission prompt ignored or denied
    },
    { timeout: 8000, enableHighAccuracy: false }
  );
}

// Track alerts already sounded in current session
const soundedAlertIds = new Set();

// Load and render dynamic notifications with Real-Time Emergency Alerts
export async function loadNotifications(isBackgroundPoll = false) {
  const badge = document.getElementById('notification-badge');
  const list = document.getElementById('notifications-list');

  const response = await apiFetch('/notifications');
  if (response.success) {
    const unread = response.data.filter(n => !n.isRead);
    
    if (unread.length > 0) {
      if (badge) badge.style.display = 'block';
    } else {
      if (badge) badge.style.display = 'none';
    }

    // Check for nearby unread EMERGENCY alerts
    const unreadEmergency = unread.find(n => n.type === 'Emergency');
    if (unreadEmergency) {
      if (!soundedAlertIds.has(unreadEmergency._id)) {
        soundedAlertIds.add(unreadEmergency._id);
        triggerReminderAudio(true);
        showNearbyEmergencyBanner(unreadEmergency);
      }
    }

    if (!list) return;

    if (response.data.length === 0) {
      list.innerHTML = `<div style="text-align: center; color: var(--text-secondary); font-size: 0.8rem; padding: 12px;">No reminders found</div>`;
      return;
    }

    list.innerHTML = response.data
      .map(item => {
        const isEmergency = item.type === 'Emergency';
        const bgStyle = isEmergency
          ? 'background: rgba(239, 68, 68, 0.1); border: 1.5px solid #EF4444;'
          : (item.isRead ? 'background: transparent; border: 1px solid var(--border);' : 'background: rgba(var(--primary-rgb), 0.03); border: 1px solid var(--border);');

        return `
          <div class="notification-item ${isEmergency ? 'notification-emergency' : ''}" style="padding: 10px; border-radius: var(--radius-sm); ${bgStyle} display: flex; flex-direction: column; gap: 4px; font-size: 0.8rem; cursor: pointer; transition: var(--transition);" data-id="${item._id}">
            <div style="font-weight: 700; display: flex; justify-content: space-between; align-items: center; color: ${isEmergency ? '#DC2626' : 'inherit'};">
              <span>${isEmergency ? '🚨 ' : ''}${item.title}</span>
              <span style="font-size: 0.7rem; color: var(--text-secondary); font-weight: normal;">${new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div style="color: ${isEmergency ? 'var(--text-primary)' : 'var(--text-secondary)'}; font-size: 0.8rem; line-height: 1.35;">${item.message}</div>
            ${isEmergency ? `<div style="font-size: 0.75rem; color: #DC2626; font-weight: 600; margin-top: 4px;">⚡ Nearby Community Emergency • Click to view</div>` : ''}
          </div>
        `;
      }).join('');

    // Bind read action triggers on notification click
    list.querySelectorAll('.notification-item').forEach(el => {
      el.addEventListener('click', async () => {
        const id = el.getAttribute('data-id');
        const res = await apiFetch(`/notifications/${id}/read`, { method: 'PUT' });
        if (res.success) {
          loadNotifications();
        }
      });
    });
  } else if (!isBackgroundPoll && list) {
    list.innerHTML = `<div style="text-align: center; color: var(--error); font-size: 0.8rem; padding: 12px;">Failed to load alerts</div>`;
  }
}

// Display prominent top floating Emergency Alert Banner for nearby SOS
function showNearbyEmergencyBanner(alert) {
  const existing = document.getElementById('nearby-emergency-floating-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'nearby-emergency-floating-banner';
  banner.style.position = 'fixed';
  banner.style.top = '16px';
  banner.style.left = '50%';
  banner.style.transform = 'translateX(-50%)';
  banner.style.zIndex = '9999';
  banner.style.maxWidth = '620px';
  banner.style.width = 'calc(100% - 32px)';
  banner.style.background = 'linear-gradient(135deg, #DC2626, #991B1B)';
  banner.style.color = '#FFFFFF';
  banner.style.borderRadius = 'var(--radius-lg, 12px)';
  banner.style.boxShadow = '0 10px 25px -5px rgba(220, 38, 38, 0.5), 0 8px 10px -6px rgba(220, 38, 38, 0.5)';
  banner.style.padding = '16px 20px';
  banner.style.display = 'flex';
  banner.style.flexDirection = 'column';
  banner.style.gap = '10px';
  banner.style.animation = 'pulse 2s infinite ease-in-out';

  banner.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 1.8rem; line-height: 1;">🚨</span>
        <div>
          <div style="font-weight: 800; font-size: 1rem; letter-spacing: -0.01em;">${alert.title || 'COMMUNITY EMERGENCY SOS NEAR YOU'}</div>
          <div style="font-size: 0.85rem; color: rgba(255, 255, 255, 0.95); margin-top: 3px; line-height: 1.35;">${alert.message}</div>
        </div>
      </div>
      <button id="btn-close-emergency-banner" style="background: rgba(255, 255, 255, 0.2); border: none; color: white; width: 28px; height: 28px; border-radius: 50%; font-size: 1.1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">&times;</button>
    </div>
    <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px;">
      <button id="btn-dismiss-emergency" style="background: transparent; border: 1px solid rgba(255, 255, 255, 0.4); color: white; padding: 6px 14px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; font-weight: 500;">Dismiss</button>
      <a href="/sos-admin.html" style="background: white; color: #DC2626; font-weight: 700; padding: 6px 16px; border-radius: 6px; text-decoration: none; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.15);">
        <span>🚑</span> View Live Dispatch Board →
      </a>
    </div>
  `;

  document.body.appendChild(banner);

  const dismiss = async () => {
    banner.remove();
    await apiFetch(`/notifications/${alert._id}/read`, { method: 'PUT' });
    loadNotifications();
  };

  banner.querySelector('#btn-close-emergency-banner')?.addEventListener('click', dismiss);
  banner.querySelector('#btn-dismiss-emergency')?.addEventListener('click', dismiss);
}

// Trigger audible reminder tone dynamically (urgent siren for emergency)
export function triggerReminderAudio(isEmergency = false) {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    if (isEmergency) {
      // Urgent high-pitch double warble for emergency alerts
      const playTone = (freq, start, duration) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, audioContext.currentTime + start);
        gain.gain.setValueAtTime(0.15, audioContext.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + start + duration);
        osc.start(audioContext.currentTime + start);
        osc.stop(audioContext.currentTime + start + duration);
      };
      playTone(950, 0, 0.25);
      playTone(1200, 0.3, 0.25);
      playTone(950, 0.6, 0.25);
      playTone(1200, 0.9, 0.35);
    } else {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.3);
    }
  } catch (err) {
    console.log('AudioContext notification tone note:', err);
  }
}
