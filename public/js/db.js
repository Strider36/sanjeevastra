/* Sanjeev Astra IndexedDB Offline Data Service (Dexie.js) */
import Dexie from './dexie.mjs';

export class SanjeevDatabase extends Dexie {
  constructor() {
    super('SanjeevAstraDB');

    // Schema Version 1
    this.version(1).stores({
      userProfiles: 'userId, email, role, cachedAt',
      dashboardSummaries: 'userId, cachedAt',
      healthRecords: '_id, userId, [userId+_id], category, date, syncStatus, cachedAt',
      appointments: '_id, userId, [userId+_id], date, [userId+date], status, syncStatus, isOfflineDraft, cachedAt',
      prescriptions: '_id, userId, [userId+_id], date, syncStatus, cachedAt',
      medicines: '_id, userId, [userId+_id], name, cachedAt',
      chatHistory: 'id, userId, [userId+id], timestamp, isOfflineQueued',
      drafts: 'draftId, userId, [userId+type], type, updatedAt',
      syncQueue: 'opId, userId, [userId+status], endpoint, status, createdAt',
      syncMeta: 'key, updatedAt'
    });
  }
}

export const db = new SanjeevDatabase();

/**
 * Offline Data Storage Service Helper Methods
 */
export const offlineStorage = {
  // ----------------------------------------------------
  // User Profile & Dashboard Cache
  // ----------------------------------------------------
  async saveUserProfile(user) {
    if (!user || !user._id) return null;
    const record = {
      userId: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      cachedAt: Date.now()
    };
    await db.userProfiles.put(record);
    return record;
  },

  async getUserProfile(userId) {
    if (!userId) return null;
    return await db.userProfiles.get(userId.toString());
  },

  async saveDashboardSummary(userId, summary) {
    if (!userId) return null;
    const record = {
      userId: userId.toString(),
      medicinesCount: summary.medicinesCount || 0,
      appointmentsCount: summary.appointmentsCount || 0,
      compliancePercent: summary.compliancePercent || 0,
      cachedAt: Date.now()
    };
    await db.dashboardSummaries.put(record);
    return record;
  },

  async getDashboardSummary(userId) {
    if (!userId) return null;
    return await db.dashboardSummaries.get(userId.toString());
  },

  // ----------------------------------------------------
  // Appointments Cache & Offline Drafts
  // ----------------------------------------------------
  async cacheAppointments(userId, appointments = []) {
    if (!userId || !Array.isArray(appointments)) return [];
    const uid = userId.toString();
    const records = appointments.map(appt => ({
      _id: appt._id ? appt._id.toString() : `local_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      userId: uid,
      doctorName: appt.doctorName || 'Doctor',
      hospitalName: appt.hospitalName || 'Clinic',
      department: appt.department || 'General Medicine',
      date: appt.date,
      time: appt.time,
      status: appt.status || 'Scheduled',
      reminderMinutes: appt.reminderMinutes || 60,
      notes: appt.notes || '',
      syncStatus: appt.syncStatus || 'synced',
      isOfflineDraft: Boolean(appt.isOfflineDraft),
      cachedAt: Date.now()
    }));

    await db.transaction('rw', db.appointments, async () => {
      // Clear non-draft appointments for this user to avoid stale deletes
      await db.appointments.where('userId').equals(uid).and(a => !a.isOfflineDraft).delete();
      await db.appointments.bulkPut(records);
    });

    return records;
  },

  async saveAppointments(userId, appointments = []) {
    return this.cacheAppointments(userId, appointments);
  },

  async getAppointments(userId) {
    if (!userId) return [];
    return await db.appointments.where('userId').equals(userId.toString()).toArray();
  },

  async saveAppointmentDraft(userId, draft) {
    if (!userId || !draft) return null;
    const draftId = draft._id || `draft_appt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const record = {
      _id: draftId,
      userId: userId.toString(),
      doctorName: draft.doctorName,
      hospitalName: draft.hospitalName,
      department: draft.department || 'General Medicine',
      date: draft.date,
      time: draft.time,
      status: 'Pending Sync',
      reminderMinutes: draft.reminderMinutes || 60,
      notes: draft.notes || '',
      syncStatus: 'pending',
      isOfflineDraft: true,
      cachedAt: Date.now()
    };
    await db.appointments.put(record);
    return record;
  },

  async removeAppointment(apptId) {
    if (!apptId) return;
    await db.appointments.delete(apptId.toString());
  },

  // ----------------------------------------------------
  // Health Records Cache
  // ----------------------------------------------------
  async cacheHealthRecords(userId, records = []) {
    if (!userId || !Array.isArray(records)) return [];
    const uid = userId.toString();
    const formatted = records.map(rec => ({
      _id: rec._id ? rec._id.toString() : `local_rec_${Date.now()}`,
      userId: uid,
      name: rec.name || 'Medical Document',
      category: rec.category || 'General',
      date: rec.date,
      doctor: rec.doctor || '',
      notes: rec.notes || '',
      fileUrl: rec.fileUrl || '',
      fileType: rec.fileType || '',
      fileSize: rec.fileSize || 0,
      syncStatus: 'synced',
      isOfflineCached: true,
      cachedAt: Date.now()
    }));

    await db.transaction('rw', db.healthRecords, async () => {
      await db.healthRecords.where('userId').equals(uid).delete();
      await db.healthRecords.bulkPut(formatted);
    });

    return formatted;
  },

  async saveHealthRecords(userId, records = []) {
    return this.cacheHealthRecords(userId, records);
  },

  async getHealthRecords(userId) {
    if (!userId) return [];
    return await db.healthRecords.where('userId').equals(userId.toString()).toArray();
  },

  // ----------------------------------------------------
  // Prescriptions & Medicines Cache
  // ----------------------------------------------------
  async cacheMedicines(userId, medicines = []) {
    if (!userId || !Array.isArray(medicines)) return [];
    const uid = userId.toString();
    const formatted = medicines.map(m => ({
      _id: m._id ? m._id.toString() : `med_${Date.now()}`,
      userId: uid,
      name: m.name,
      dosage: m.dosage,
      instructions: m.instructions || '',
      startDate: m.startDate,
      endDate: m.endDate,
      timings: m.timings || [],
      history: m.history || [],
      cachedAt: Date.now()
    }));

    await db.transaction('rw', db.medicines, async () => {
      await db.medicines.where('userId').equals(uid).delete();
      await db.medicines.bulkPut(formatted);
    });
    return formatted;
  },

  async getMedicines(userId) {
    if (!userId) return [];
    return await db.medicines.where('userId').equals(userId.toString()).toArray();
  },

  // ----------------------------------------------------
  // Chat History & Offline Question Drafts
  // ----------------------------------------------------
  async saveChatMessage(userId, msg) {
    if (!userId || !msg) return null;
    const record = {
      id: msg.id || `chat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      userId: userId.toString(),
      role: msg.role || 'user',
      message: msg.message || '',
      answer: msg.answer || '',
      sources: msg.sources || [],
      timestamp: msg.timestamp || Date.now(),
      isOfflineQueued: Boolean(msg.isOfflineQueued)
    };
    await db.chatHistory.put(record);
    return record;
  },

  async getChatHistory(userId, limit = 50) {
    if (!userId) return [];
    return await db.chatHistory
      .where('userId')
      .equals(userId.toString())
      .reverse()
      .sortBy('timestamp');
  },

  // ----------------------------------------------------
  // Synchronization Queue (Persistent Outbox)
  // ----------------------------------------------------
  async enqueueSync({ userId, endpoint, method, payload, idempotencyKey }) {
    if (!userId || !endpoint) throw new Error('userId and endpoint are required for sync queue.');
    const opId = `op_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const idempKey = idempotencyKey || `idemp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const job = {
      opId,
      userId: userId.toString(),
      endpoint,
      method: (method || 'POST').toUpperCase(),
      payload: payload || {},
      idempotencyKey: idempKey,
      attemptCount: 0,
      maxAttempts: 5,
      lastAttemptAt: null,
      status: 'pending', // 'pending' | 'syncing' | 'failed'
      error: null,
      createdAt: Date.now()
    };

    await db.syncQueue.put(job);
    return job;
  },

  async getPendingSyncJobs(userId) {
    if (!userId) return [];
    return await db.syncQueue
      .where('userId')
      .equals(userId.toString())
      .and(j => j.status === 'pending' || j.status === 'syncing')
      .sortBy('createdAt');
  },

  async updateSyncJob(opId, updates = {}) {
    if (!opId) return;
    await db.syncQueue.update(opId, updates);
  },

  async removeSyncJob(opId) {
    if (!opId) return;
    await db.syncQueue.delete(opId);
  },

  async getSyncQueueCount(userId) {
    if (!userId) return 0;
    return await db.syncQueue
      .where('userId')
      .equals(userId.toString())
      .and(j => j.status === 'pending' || j.status === 'failed')
      .count();
  },

  // ----------------------------------------------------
  // Sync Metadata & Timestamps
  // ----------------------------------------------------
  async setSyncMeta(key, value) {
    await db.syncMeta.put({ key, value, updatedAt: Date.now() });
  },

  async getSyncMeta(key) {
    const item = await db.syncMeta.get(key);
    return item ? item.value : null;
  },

  // ----------------------------------------------------
  // Security & Logout Cleanup: Purge Protected User Data
  // ----------------------------------------------------
  async purgeUserData(userId) {
    if (!userId) return;
    const uid = userId.toString();

    await db.transaction('rw', [
      db.userProfiles,
      db.dashboardSummaries,
      db.healthRecords,
      db.appointments,
      db.prescriptions,
      db.medicines,
      db.chatHistory,
      db.drafts,
      db.syncQueue
    ], async () => {
      await db.userProfiles.where('userId').equals(uid).delete();
      await db.dashboardSummaries.where('userId').equals(uid).delete();
      await db.healthRecords.where('userId').equals(uid).delete();
      await db.appointments.where('userId').equals(uid).delete();
      await db.prescriptions.where('userId').equals(uid).delete();
      await db.medicines.where('userId').equals(uid).delete();
      await db.chatHistory.where('userId').equals(uid).delete();
      await db.drafts.where('userId').equals(uid).delete();
      await db.syncQueue.where('userId').equals(uid).delete();
    });

    console.log(`[IndexedDB] Securely purged offline data for user: ${uid}`);
  }
};
