/* Sanjeev Astra Network Status & Offline-Aware UI Indicator */
import { syncEngine } from './syncEngine.js';
import { offlineStorage } from './db.js';

class NetworkStatusManager {
  constructor() {
    this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.syncState = 'synced'; // 'synced' | 'syncing' | 'pending' | 'failed'
    this.pendingCount = 0;
    this.lastSyncTime = null;
    this.probeInterval = null;

    this.init();
  }

  async init() {
    if (typeof window === 'undefined') return;

    // Register Service Worker
    this.registerServiceWorker();

    // Ensure indicator container exists in DOM
    this.mountIndicatorDOM();

    // Load initial metadata from IndexedDB
    try {
      this.lastSyncTime = await offlineStorage.getSyncMeta('lastSyncTime');
      const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
      const userId = storedUser?._id || storedUser?.id;
      if (userId) {
        this.pendingCount = await offlineStorage.getSyncQueueCount(userId);
      }
    } catch (e) {}

    // Listen to sync engine events
    syncEngine.onStatusChange((status) => {
      if (status.state) this.syncState = status.state;
      if (status.pendingCount !== undefined) this.pendingCount = status.pendingCount;
      if (status.lastSyncTime) this.lastSyncTime = status.lastSyncTime;
      this.render();
    });

    // Listen to browser network events
    window.addEventListener('online', () => {
      this.probeConnection(true);
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.render();
    });

    // Periodic connectivity probe
    this.probeInterval = setInterval(() => {
      this.probeConnection(false);
    }, 30000);

    // Initial probe
    this.probeConnection(false);
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then((reg) => {
            console.log('[PWA] Service Worker registered successfully with scope:', reg.scope);
          })
          .catch((err) => {
            console.warn('[PWA] Service Worker registration note:', err.message);
          });
      });
    }
  }

  /**
   * Probes backend health endpoint to confirm genuine connectivity,
   * avoiding false positives from captive portals or local virtual adapters.
   */
  async probeConnection(isReconnect = false) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const prevOnline = this.isOnline;
      this.isOnline = res.ok;

      if (!prevOnline && this.isOnline && isReconnect) {
        syncEngine.triggerSync();
      }
    } catch (err) {
      this.isOnline = false;
    }
    this.render();
  }

  mountIndicatorDOM() {
    if (document.getElementById('network-sync-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'network-sync-banner';
    banner.className = 'network-sync-banner';
    banner.style.cssText = `
      position: sticky;
      top: 0;
      z-index: 1200;
      width: 100%;
      padding: 6px 16px;
      font-size: 0.78rem;
      font-weight: 500;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: all 0.25s ease;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    `;

    // Insert at top of body
    document.body.insertBefore(banner, document.body.firstChild);
    this.render();
  }

  render() {
    const banner = document.getElementById('network-sync-banner');
    if (!banner) return;

    const formattedTime = this.lastSyncTime
      ? new Date(this.lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : null;

    if (!this.isOnline) {
      banner.style.display = 'flex';
      banner.style.backgroundColor = '#FEF2F2';
      banner.style.borderBottom = '1px solid #FCA5A5';
      banner.style.color = '#991B1B';

      banner.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #EF4444;"></span>
          <strong>Offline Mode</strong>
          <span style="opacity: 0.85;">— Using local medical cache. Sensitive actions queued until reconnected.</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          ${this.pendingCount > 0 ? `<span class="badge badge-warning" style="font-size: 0.7rem;">${this.pendingCount} pending</span>` : ''}
          <a href="/offline.html" style="color: #DC2626; text-decoration: underline; font-weight: 600;">Offline Guide</a>
          <button id="btn-banner-retry" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 0.72rem;">Check Connection</button>
        </div>
      `;

      banner.querySelector('#btn-banner-retry')?.addEventListener('click', () => {
        this.probeConnection(true);
      });
      return;
    }

    // Online States
    if (this.syncState === 'syncing') {
      banner.style.display = 'flex';
      banner.style.backgroundColor = '#EFF6FF';
      banner.style.borderBottom = '1px solid #BFDBFE';
      banner.style.color = '#1E40AF';

      banner.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #3B82F6; animation: pulse 1s infinite;"></span>
          <strong>Synchronizing Offline Updates...</strong>
          <span style="opacity: 0.85;">Uploading queued records to server</span>
        </div>
        <div>
          <span class="badge badge-info" style="font-size: 0.7rem;">${this.pendingCount} remaining</span>
        </div>
      `;
      return;
    }

    if (this.pendingCount > 0 || this.syncState === 'failed') {
      banner.style.display = 'flex';
      banner.style.backgroundColor = '#FFFBEB';
      banner.style.borderBottom = '1px solid #FDE68A';
      banner.style.color = '#92400E';

      banner.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #F59E0B;"></span>
          <strong>Pending Offline Changes</strong>
          <span style="opacity: 0.85;">(${this.pendingCount} mutation(s) stored locally)</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          ${formattedTime ? `<span style="font-size: 0.7rem; opacity: 0.8;">Synced ${formattedTime}</span>` : ''}
          <button id="btn-banner-sync-now" class="btn btn-primary btn-sm" style="padding: 2px 10px; font-size: 0.72rem;">🔄 Sync Now</button>
        </div>
      `;

      banner.querySelector('#btn-banner-sync-now')?.addEventListener('click', () => {
        syncEngine.triggerSync();
      });
      return;
    }

    // Fully Online and Synced
    banner.style.display = 'none'; // Keep clean during normal online synced browsing
  }
}

export const networkStatus = new NetworkStatusManager();
