/* Sanjeev Astra Synchronization Engine - Reliable Offline Outbox Processor */
import { apiFetch, showToast, getToken } from './api.js';
import { offlineStorage, db } from './db.js';

class SynchronizationEngine {
  constructor() {
    this.isSyncing = false;
    this.listeners = new Set();
    this.lockKey = 'swasthya_sync_lock';
    this.syncInterval = null;

    this.init();
  }

  init() {
    if (typeof window === 'undefined') return;

    // Listen to network online event
    window.addEventListener('online', () => {
      console.log('[SyncEngine] Network reconnected - triggering sync queue process');
      this.triggerSync();
    });

    // Listen to Service Worker background sync postMessage
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'BACKGROUND_SYNC_TRIGGER') {
          console.log('[SyncEngine] Service Worker Background Sync event received');
          this.triggerSync();
        }
      });
    }

    // Periodic sweep every 60 seconds if online
    this.syncInterval = setInterval(() => {
      if (navigator.onLine && !this.isSyncing) {
        this.triggerSync({ silent: true });
      }
    }, 60000);
  }

  /**
   * Registers a sync status change listener.
   */
  onStatusChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notifyStatus(status) {
    this.listeners.forEach(fn => {
      try { fn(status); } catch (e) {}
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('swasthya:syncStatus', { detail: status }));
    }
  }

  /**
   * Requests Background Sync from Service Worker if supported.
   */
  async requestBackgroundSync() {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.sync.register('sanjeev-sync-queue');
      } catch (err) {
        // Fallback to online event
      }
    }
  }

  /**
   * Adds an operation to the persistent offline sync queue.
   */
  async enqueueOperation({ userId, endpoint, method = 'POST', payload = {}, idempotencyKey = null }) {
    if (!userId) {
      const storedUser = localStorage.getItem('user');
      const parsed = storedUser ? JSON.parse(storedUser) : null;
      userId = parsed?._id || parsed?.id;
    }

    if (!userId) {
      throw new Error('User authentication is required to queue offline operations.');
    }

    const job = await offlineStorage.enqueueSync({
      userId,
      endpoint,
      method,
      payload,
      idempotencyKey
    });

    await this.requestBackgroundSync();

    const pendingCount = await offlineStorage.getSyncQueueCount(userId);
    this.notifyStatus({
      state: 'pending',
      pendingCount,
      lastSyncTime: await offlineStorage.getSyncMeta('lastSyncTime')
    });

    return job;
  }

  /**
   * Calculates exponential backoff with randomized jitter.
   */
  calculateBackoffDelay(attempt = 0) {
    const baseDelay = 1000;
    const maxDelay = 30000;
    const exp = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    const jitter = Math.random() * 0.3 * exp;
    return Math.floor(exp + jitter);
  }

  /**
   * Distinguishes non-retryable 4xx client errors from retryable 5xx/network errors.
   */
  isFatalClientError(status) {
    return status === 400 || status === 404 || status === 422;
  }

  /**
   * Multi-tab concurrency lock to avoid processing race conditions.
   */
  async acquireLock() {
    if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
      return true; // We use navigator.locks directly in triggerSync
    }
    const now = Date.now();
    const lockVal = localStorage.getItem(this.lockKey) || localStorage.getItem('sync_lock_ts');
    if (lockVal && now - parseInt(lockVal, 10) < 15000) {
      return false; // Another tab holds the lock
    }
    localStorage.setItem(this.lockKey, now.toString());
    localStorage.setItem('sync_lock_ts', now.toString());
    return true;
  }

  releaseLock() {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.lockKey);
      localStorage.removeItem('sync_lock_ts');
    }
  }

  /**
   * Triggers processing of the offline synchronization queue.
   */
  async triggerSync(options = {}) {
    if (this.isSyncing || !navigator.onLine) return;

    const token = getToken();
    if (!token) return;

    let storedUser = null;
    try {
      storedUser = JSON.parse(localStorage.getItem('user') || '{}');
    } catch (e) {}

    const userId = storedUser?._id || storedUser?.id;
    if (!userId) return;

    // Use Web Locks API if supported to coordinate across browser tabs
    if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
      return navigator.locks.request('sanjeev_sync_lock', { ifAvailable: true }, async (lock) => {
        if (!lock) {
          console.log('[SyncEngine] Another tab is actively processing sync queue.');
          return;
        }
        await this.processQueue(userId, options);
      });
    }

    const hasLock = await this.acquireLock();
    if (!hasLock) return;

    try {
      await this.processQueue(userId, options);
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Internal queue processing logic with idempotency and exponential backoff.
   */
  async processQueue(userId, options = {}) {
    this.isSyncing = true;
    const initialCount = await offlineStorage.getSyncQueueCount(userId);

    this.notifyStatus({
      state: 'syncing',
      pendingCount: initialCount,
      lastSyncTime: await offlineStorage.getSyncMeta('lastSyncTime')
    });

    let successCount = 0;
    let failedCount = 0;

    try {
      const jobs = await offlineStorage.getPendingSyncJobs(userId);

      for (const job of jobs) {
        // Enforce max attempts
        if (job.attemptCount >= job.maxAttempts) {
          await offlineStorage.updateSyncJob(job.opId, {
            status: 'failed',
            error: 'Exceeded maximum synchronization retry attempts'
          });
          failedCount++;
          continue;
        }

        try {
          await offlineStorage.updateSyncJob(job.opId, {
            status: 'syncing',
            lastAttemptAt: Date.now()
          });

          // Execute request through apiFetch with Idempotency header
          const headers = {
            'X-Idempotency-Key': job.idempotencyKey,
            'X-Sync-Op-Id': job.opId
          };

          const res = await apiFetch(job.endpoint, {
            method: job.method,
            headers,
            body: job.payload,
            timeout: 25000
          });

          if (res && res.success) {
            // Success: remove from sync queue
            await offlineStorage.removeSyncJob(job.opId);
            successCount++;

            // If an appointment was confirmed, update local appointment record
            if (job.endpoint === '/appointments' && res.data && res.data._id) {
              const localDraftId = job.payload?._localDraftId;
              if (localDraftId) {
                await db.appointments.delete(localDraftId);
              }
              await db.appointments.put({
                _id: res.data._id,
                userId,
                doctorName: res.data.doctorName,
                hospitalName: res.data.hospitalName,
                department: res.data.department,
                date: res.data.date,
                time: res.data.time,
                status: res.data.status,
                reminderMinutes: res.data.reminderMinutes,
                notes: res.data.notes,
                syncStatus: 'synced',
                isOfflineDraft: false,
                cachedAt: Date.now()
              });
            }
          } else {
            const status = res?.status || 0;

            // Handle session expiry
            if (status === 401) {
              console.warn('[SyncEngine] Session expired during sync. Halting queue.');
              await offlineStorage.updateSyncJob(job.opId, {
                status: 'pending',
                error: 'Authentication expired'
              });
              break;
            }

            // Client validation error (4xx) is non-retryable
            if (status >= 400 && status < 500 && status !== 429) {
              await offlineStorage.updateSyncJob(job.opId, {
                status: 'failed',
                error: res?.error || 'Validation error rejected by server'
              });
              failedCount++;
            } else {
              // Retryable 5xx or network drop - apply backoff count
              const newAttempts = (job.attemptCount || 0) + 1;
              await offlineStorage.updateSyncJob(job.opId, {
                status: 'pending',
                attemptCount: newAttempts,
                error: res?.error || 'Server error - queued for retry'
              });
              failedCount++;
            }
          }
        } catch (jobErr) {
          console.error(`[SyncEngine] Error executing job ${job.opId}:`, jobErr);
          const newAttempts = (job.attemptCount || 0) + 1;
          await offlineStorage.updateSyncJob(job.opId, {
            status: 'pending',
            attemptCount: newAttempts,
            error: jobErr.message
          });
          failedCount++;
        }
      }

      const remainingCount = await offlineStorage.getSyncQueueCount(userId);
      const now = Date.now();
      await offlineStorage.setSyncMeta('lastSyncTime', now);

      if (successCount > 0 && !options.silent) {
        showToast('Sync Complete', `Synchronized ${successCount} offline update(s) with server`, 'success');
      }

      this.notifyStatus({
        state: remainingCount > 0 ? (failedCount > 0 ? 'failed' : 'pending') : 'synced',
        pendingCount: remainingCount,
        lastSyncTime: now
      });
    } finally {
      this.isSyncing = false;
    }
  }

  stop() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.releaseLock();
  }
}

export const syncEngine = new SynchronizationEngine();
