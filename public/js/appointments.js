/* Sanjeev Astra Appointments Controller */
import { apiFetch, showToast, getUser } from './api.js';
import { offlineStorage } from './db.js';
import { syncEngine } from './syncEngine.js';

let userAppointments = [];

document.addEventListener('DOMContentLoaded', () => {
  loadAppointments();

  // Listen for sync completion to refresh list
  window.addEventListener('sanjeev:sync-complete', () => {
    loadAppointments();
  });

  const addBtn = document.getElementById('btn-open-appt-modal');
  const modal = document.getElementById('appt-modal');
  const closeBtn = document.getElementById('appt-modal-close');
  const cancelBtn = document.getElementById('appt-modal-cancel');
  const form = document.getElementById('appt-form');

  // Set default date to tomorrow
  const dateInput = document.getElementById('appt-date');
  if (dateInput) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    dateInput.value = tomorrow.toISOString().split('T')[0];
  }

  const openModal = (mode = 'add', appt = null) => {
    if (!modal) return;

    form.reset();
    document.getElementById('appt-id').value = '';
    
    if (dateInput) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      dateInput.value = tomorrow.toISOString().split('T')[0];
    }

    if (mode === 'edit' && appt) {
      document.getElementById('appt-modal-title').textContent = 'Edit Consultation Info';
      document.getElementById('btn-appt-submit').textContent = 'Save Changes';
      document.getElementById('appt-id').value = appt._id;
      document.getElementById('appt-doctor').value = appt.doctorName;
      document.getElementById('appt-hospital').value = appt.hospitalName;
      document.getElementById('appt-dept').value = appt.department || 'General Medicine';
      document.getElementById('appt-date').value = appt.date;
      document.getElementById('appt-time').value = appt.time;
      document.getElementById('appt-reminder').value = appt.reminderMinutes || 60;
      document.getElementById('appt-status').value = appt.status || 'Scheduled';
      document.getElementById('appt-notes').value = appt.notes || '';
    } else {
      document.getElementById('appt-modal-title').textContent = 'Book Consultation';
      document.getElementById('btn-appt-submit').textContent = 'Schedule Appointment';
    }

    modal.classList.add('open');
  };

  const closeModal = () => {
    if (modal) modal.classList.remove('open');
  };

  if (addBtn) addBtn.addEventListener('click', () => openModal('add'));
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  // Form submit handler
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const id = document.getElementById('appt-id').value;
      const doctorName = document.getElementById('appt-doctor').value.trim();
      const hospitalName = document.getElementById('appt-hospital').value.trim();
      const department = document.getElementById('appt-dept').value;
      const date = document.getElementById('appt-date').value;
      const time = document.getElementById('appt-time').value;
      const reminderMinutes = parseInt(document.getElementById('appt-reminder').value);
      const status = document.getElementById('appt-status').value;
      const notes = document.getElementById('appt-notes').value.trim();

      const payload = {
        doctorName,
        hospitalName,
        department,
        date,
        time,
        reminderMinutes,
        status,
        notes
      };

      const user = getUser();
      const userId = user?._id || user?.id || 'anonymous';
      const isOffline = !navigator.onLine;

      if (isOffline && !id) {
        // Handle offline creation
        const idempotencyKey = `appt_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await offlineStorage.saveDraft(userId, 'appointment', {
          ...payload,
          idempotencyKey
        });
        await syncEngine.enqueueOperation({
          endpoint: '/appointments',
          method: 'POST',
          payload,
          idempotencyKey,
          description: `Consultation with Dr. ${doctorName}`
        });

        showToast('Saved Locally', 'Appointment saved as offline draft and queued for synchronization.', 'info');
        closeModal();
        loadAppointments();
        return;
      }

      let result;
      if (id) {
        result = await apiFetch(`/appointments/${id}`, {
          method: 'PUT',
          body: payload
        });
      } else {
        const idempotencyKey = `appt_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        result = await apiFetch('/appointments', {
          method: 'POST',
          headers: { 'X-Idempotency-Key': idempotencyKey },
          body: payload
        });
      }

      if (result.success) {
        showToast('Success', id ? 'Appointment updated' : 'Appointment scheduled successfully', 'success');
        closeModal();
        loadAppointments();
      } else if (result.status === 0 || !navigator.onLine) {
        // Network failed during send
        const idempotencyKey = `appt_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await offlineStorage.saveDraft(userId, 'appointment', {
          ...payload,
          idempotencyKey
        });
        await syncEngine.enqueueOperation({
          endpoint: '/appointments',
          method: 'POST',
          payload,
          idempotencyKey,
          description: `Consultation with Dr. ${doctorName}`
        });
        showToast('Saved Offline', 'Server unreachable. Queued in outbox for automatic sync.', 'warning');
        closeModal();
        loadAppointments();
      } else {
        showToast('Operation Failed', result.error, 'error');
      }
    });
  }

  // Bind global actions
  window.editAppt = (id) => {
    const appt = userAppointments.find(a => (a._id === id || a.id === id));
    if (appt) openModal('edit', appt);
  };

  window.deleteAppt = async (id) => {
    if (confirm('Are you sure you want to cancel and delete this appointment schedule?')) {
      if (typeof id === 'string' && id.startsWith('draft_')) {
        const user = getUser();
        const userId = user?._id || user?.id;
        const draftId = id.replace('draft_', '');
        await offlineStorage.deleteDraft(draftId);
        showToast('Removed', 'Offline draft removed', 'info');
        loadAppointments();
        return;
      }

      const res = await apiFetch(`/appointments/${id}`, { method: 'DELETE' });
      if (res.success) {
        showToast('Deleted', 'Appointment removed', 'success');
        loadAppointments();
      } else {
        showToast('Failed', res.error, 'error');
      }
    }
  };
});

// Fetch appointments from API with IndexedDB fallback and draft integration
async function loadAppointments() {
  const container = document.getElementById('appointments-container');
  if (!container) return;

  const user = getUser();
  const userId = user?._id || user?.id;
  let isOfflineData = false;

  try {
    const result = await apiFetch('/appointments');
    if (result && result.success) {
      userAppointments = result.data || [];
      if (userId) {
        await offlineStorage.saveAppointments(userId, userAppointments);
      }
    } else {
      // Offline fallback to IndexedDB
      isOfflineData = true;
      if (userId) {
        userAppointments = await offlineStorage.getAppointments(userId);
      } else {
        userAppointments = [];
      }
    }

    // Load any pending offline drafts
    let drafts = [];
    if (userId) {
      const rawDrafts = await offlineStorage.getDrafts(userId, 'appointment');
      drafts = rawDrafts.map(d => ({
        ...d.payload,
        _id: `draft_${d.id}`,
        id: `draft_${d.id}`,
        _isDraft: true,
        status: 'Pending Server Confirmation'
      }));
    }

    const allDisplayAppointments = [...drafts, ...userAppointments];

  if (allDisplayAppointments.length === 0) {
    container.innerHTML = `
      ${isOfflineData ? '<div class="alert-banner warning" style="margin-bottom: 16px; padding: 10px 16px; border-radius: var(--radius-md); background: rgba(245, 158, 11, 0.1); border: 1px solid #F59E0B; font-size: 0.85rem; color: #B45309;">⚠️ Working offline. No cached consultations found on this device.</div>' : ''}
      <div class="empty-state">
        <div class="empty-icon"><i data-lucide="calendar" style="width: 48px; height: 48px;"></i></div>
        <div class="empty-title">No appointments scheduled</div>
        <div class="empty-subtitle">Get started by booking your first doctor consultation.</div>
        <button class="btn btn-primary" onclick="document.getElementById('btn-open-appt-modal').click()"><i data-lucide="plus"></i> Book Consultation</button>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  const offlineNotice = isOfflineData ? `
    <div style="margin-bottom: 16px; padding: 10px 16px; border-radius: var(--radius-md); background: rgba(59, 130, 246, 0.08); border: 1px solid var(--primary); font-size: 0.85rem; color: var(--primary); display: flex; align-items: center; justify-content: space-between;">
      <span>📱 <strong>Offline Mode:</strong> Showing cached appointments and locally queued consultation drafts.</span>
      <span class="badge badge-info" style="font-size: 0.7rem;">IndexedDB</span>
    </div>
  ` : '';

  container.innerHTML = offlineNotice + allDisplayAppointments.map(appt => {
    // Parse date for visual badge
    const apptDate = appt.date ? new Date(appt.date) : new Date();
    const day = isNaN(apptDate.getDate()) ? '--' : apptDate.getDate();
    const month = isNaN(apptDate.getDate()) ? '---' : apptDate.toLocaleString([], { month: 'short' });

    let statusBadgeClass = 'badge-success';
    if (appt._isDraft) statusBadgeClass = 'badge-warning';
    else if (appt.status === 'Cancelled') statusBadgeClass = 'badge-danger';
    else if (appt.status === 'Completed') statusBadgeClass = 'badge-info';

    return `
      <div class="glass-card appt-card" style="${appt._isDraft ? 'border: 1.5px dashed #F59E0B;' : ''}">
        <div class="appt-main-info">
          <div class="appt-date-badge" style="${appt._isDraft ? 'background: rgba(245, 158, 11, 0.15); color: #B45309;' : ''}">
            <div class="appt-date-day">${day}</div>
            <div class="appt-date-month">${month}</div>
          </div>
          
          <div class="appt-body">
            <div class="appt-doctor">
              ${appt.doctorName}
              ${appt._isDraft ? '<span class="badge badge-warning" style="font-size: 0.65rem; margin-left: 6px;">Queued Sync</span>' : ''}
            </div>
            <div style="font-size: 0.85rem; font-weight: 500; color: var(--primary);">${appt.department}</div>
            <div class="appt-meta">
              <i data-lucide="map-pin" style="width: 12px; height: 12px;"></i>
              <span>${appt.hospitalName}</span>
            </div>
            <div class="appt-meta">
              <i data-lucide="clock" style="width: 12px; height: 12px;"></i>
              <span>Time: ${appt.time} • Alert: ${appt.reminderMinutes || 60} mins before</span>
            </div>
            ${appt.notes ? `
              <div class="appt-meta" style="margin-top: 4px; padding: 6px 10px; background-color: var(--background); border-radius: var(--radius-sm); border: 1px solid var(--border);">
                <span>Note: ${appt.notes}</span>
              </div>
            ` : ''}
          </div>
        </div>

        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 16px;">
          <span class="badge ${statusBadgeClass}">${appt.status}</span>
          <div class="appt-actions">
            ${!appt._isDraft ? `
              <button class="btn btn-secondary btn-icon" onclick="editAppt('${appt._id}')" title="Edit Appointment">
                <i data-lucide="edit-3" style="width: 16px; height: 16px;"></i>
              </button>
            ` : ''}
            <button class="btn btn-danger btn-icon" onclick="deleteAppt('${appt._id}')" title="${appt._isDraft ? 'Discard Draft' : 'Delete Appointment'}">
              <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.warn('Failed to load appointments:', err);
    container.innerHTML = `<div style="text-align: center; color: var(--error); padding: 48px;">Failed to retrieve appointments.</div>`;
  }
}
