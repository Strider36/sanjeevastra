/* Sanjeev Astra Health Records & Secure Sharing Controller */
import { apiFetch, showToast } from './api.js';
import { offlineStorage } from './db.js';

let activeCategory = 'All';
let searchQuery = '';
let userRecords = [];
let currentUser = null;
let doctorProfile = null;
let activeShares = [];

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const storedUser = localStorage.getItem('user');
    currentUser = storedUser ? JSON.parse(storedUser) : { role: 'patient' };
  } catch (e) {
    currentUser = { role: 'patient' };
  }

  setupRoleUI();
  await loadRecords();
  setupFilters();
  setupSearch();
  setupUploadModal();
  setupShareModal();
  setupActiveSharesModal();
});

// Configure UI adjustments based on authenticated role
async function setupRoleUI() {
  const isDoctor = currentUser.role === 'doctor';
  const pageTitle = document.getElementById('page-title-text');
  const pageSubtitle = document.getElementById('page-subtitle-text');
  const uploadBtn = document.getElementById('btn-open-record-modal');
  const shareBtn = document.getElementById('btn-open-share-modal');
  const sharesLabel = document.getElementById('shares-btn-label');
  const banner = document.getElementById('doctor-verification-banner');

  if (isDoctor) {
    if (pageTitle) pageTitle.textContent = 'Clinical Patient Records';
    if (pageSubtitle) pageSubtitle.textContent = 'Authorized patient medical documentation shared under explicit consent.';
    if (uploadBtn) uploadBtn.style.display = 'none';
    if (shareBtn) shareBtn.style.display = 'none';
    if (sharesLabel) sharesLabel.textContent = 'My Active Patient Grants';

    // Fetch doctor's verification status
    try {
      const res = await apiFetch('/doctors/profile');
      if (res && res.success && res.data) {
        doctorProfile = res.data;
        if (doctorProfile.verificationStatus !== 'verified') {
          if (banner) {
            banner.style.display = 'block';
            const badge = document.getElementById('doc-status-badge');
            if (badge) {
              badge.textContent = doctorProfile.verificationStatus === 'rejected' ? 'Rejected' : 'Pending Review';
              badge.className = `badge ${doctorProfile.verificationStatus === 'rejected' ? 'badge-danger' : 'badge-warning'}`;
            }
          }
        }
      }
    } catch (e) {
      console.warn('Could not fetch doctor profile:', e);
    }
  } else {
    if (banner) banner.style.display = 'none';
    if (uploadBtn) uploadBtn.style.display = 'inline-flex';
    if (shareBtn) shareBtn.style.display = 'inline-flex';
  }
}

// 1. UPLOAD RECORD MODAL HANDLERS
function setupUploadModal() {
  const addBtn = document.getElementById('btn-open-record-modal');
  const modal = document.getElementById('record-modal');
  const closeBtn = document.getElementById('record-modal-close');
  const cancelBtn = document.getElementById('record-modal-cancel');
  const form = document.getElementById('record-form');
  const dateInput = document.getElementById('rec-date');

  if (dateInput) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  const openModal = () => {
    if (modal) {
      form.reset();
      if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
      modal.classList.add('open');
    }
  };

  const closeModal = () => {
    if (modal) modal.classList.remove('open');
  };

  if (addBtn) addBtn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = document.getElementById('rec-name').value.trim();
      const category = document.getElementById('rec-cat').value;
      const date = document.getElementById('rec-date').value;
      const notes = document.getElementById('rec-notes').value.trim();
      const fileInput = document.getElementById('rec-file');

      if (!navigator.onLine) {
        showToast('Online Connection Required', 'Uploading health records requires an active secure connection for file scanning and encryption.', 'warning');
        return;
      }

      if (!fileInput.files || fileInput.files.length === 0) {
        showToast('File Error', 'Please select a file attachment', 'warning');
        return;
      }

      const formData = new FormData();
      formData.append('name', name);
      formData.append('category', category);
      formData.append('date', date);
      formData.append('notes', notes);
      formData.append('file', fileInput.files[0]);

      const submitBtn = document.getElementById('btn-record-submit');
      const originalText = submitBtn.innerHTML;
      submitBtn.innerHTML = 'Uploading Document...';
      submitBtn.disabled = true;

      const result = await apiFetch('/records', {
        method: 'POST',
        body: formData
      });

      submitBtn.innerHTML = originalText;
      submitBtn.disabled = false;

      if (result.success) {
        showToast('Document Uploaded', 'Document added to your Health Locker', 'success');
        closeModal();
        loadRecords();
      } else {
        showToast('Upload Failed', result.error, 'error');
      }
    });
  }

  window.deleteRecord = async (id) => {
    if (confirm('Are you sure you want to permanently delete this document from your locker?')) {
      const res = await apiFetch(`/records/${id}`, { method: 'DELETE' });
      if (res.success) {
        showToast('Record Deleted', 'Document deleted successfully', 'success');
        loadRecords();
      } else {
        showToast('Failed to Delete', res.error, 'error');
      }
    }
  };
}

// 2. PATIENT-CONTROLLED RECORD SHARING MODAL
function setupShareModal() {
  const shareBtn = document.getElementById('btn-open-share-modal');
  const modal = document.getElementById('share-modal');
  const closeBtn = document.getElementById('share-modal-close');
  const cancelBtn = document.getElementById('share-modal-cancel');
  const form = document.getElementById('share-record-form');
  const doctorSelect = document.getElementById('share-doctor-select');
  const scopeSpecific = document.getElementById('share-scope-specific');
  const scopeAll = document.getElementById('share-scope-all');
  const specificBox = document.getElementById('share-specific-records-box');

  const openShareModal = async () => {
    if (!modal) return;
    modal.classList.add('open');

    // Populate Verified Doctors
    if (doctorSelect) {
      doctorSelect.innerHTML = '<option value="" disabled selected>Loading verified doctors...</option>';
      const res = await apiFetch('/doctors/verified');
      if (res && res.success && res.data && res.data.length > 0) {
        doctorSelect.innerHTML = '<option value="" disabled selected>-- Select a Verified Doctor --</option>' +
          res.data.map(doc => {
            const userObj = doc.user || {};
            const spec = doc.specialization ? ` (${doc.specialization})` : '';
            const hosp = doc.hospitalAffiliation ? ` • ${doc.hospitalAffiliation}` : '';
            return `<option value="${doc._id}">Dr. ${userObj.name || 'Medical Practitioner'}${spec}${hosp}</option>`;
          }).join('');
      } else {
        doctorSelect.innerHTML = '<option value="" disabled selected>No verified doctors currently available</option>';
      }
    }

    // Populate Specific Records checklist
    renderSpecificRecordsChecklist();
  };

  const closeShareModal = () => {
    if (modal) modal.classList.remove('open');
  };

  if (shareBtn) shareBtn.addEventListener('click', openShareModal);
  if (closeBtn) closeBtn.addEventListener('click', closeShareModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeShareModal);

  // Toggle specific checklist visibility
  if (scopeAll && scopeSpecific && specificBox) {
    scopeAll.addEventListener('change', () => {
      specificBox.style.display = scopeAll.checked ? 'none' : 'block';
    });
    scopeSpecific.addEventListener('change', () => {
      specificBox.style.display = scopeSpecific.checked ? 'block' : 'none';
    });
  }

  // Handle Share Submission
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const doctorProfileId = doctorSelect.value;
      if (!doctorProfileId) {
        showToast('Selection Required', 'Please select a verified doctor from the list', 'warning');
        return;
      }

      const isAll = scopeAll.checked;
      let selectedRecordIds = [];

      if (!isAll) {
        const checkboxes = specificBox.querySelectorAll('input[type="checkbox"]:checked');
        selectedRecordIds = Array.from(checkboxes).map(cb => cb.value);
        if (selectedRecordIds.length === 0) {
          showToast('Selection Required', 'Please select at least one document to share, or choose All Records', 'warning');
          return;
        }
      }

      if (!navigator.onLine) {
        showToast('Online Connection Required', 'Medical record sharing grants cannot be authorized offline. An active connection is required to verify doctor credentials and record audit logs.', 'warning');
        return;
      }

      const permissions = ['read'];
      if (document.getElementById('perm-download')?.checked) {
        permissions.push('download');
      }

      const expiryDays = Number(document.getElementById('share-expiry-days')?.value || 30);
      const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
      const purpose = document.getElementById('share-purpose')?.value.trim() || 'Clinical Review';

      const submitBtn = document.getElementById('btn-share-submit');
      const originalText = submitBtn.innerHTML;
      submitBtn.innerHTML = 'Securing & Granting...';
      submitBtn.disabled = true;

      const payload = {
        doctorProfileId,
        allRecords: isAll,
        records: isAll ? [] : selectedRecordIds,
        permissions,
        expiresAt,
        purpose
      };

      const res = await apiFetch('/shares', {
        method: 'POST',
        body: payload
      });

      submitBtn.innerHTML = originalText;
      submitBtn.disabled = false;

      if (res.success) {
        showToast('Access Granted', 'Selected records securely shared with the verified doctor', 'success');
        closeShareModal();
      } else {
        showToast('Sharing Failed', res.error, 'error');
      }
    });
  }
}

function renderSpecificRecordsChecklist() {
  const specificBox = document.getElementById('share-specific-records-box');
  if (!specificBox) return;

  if (userRecords.length === 0) {
    specificBox.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-secondary); padding: 8px;">No records available to select.</div>';
    return;
  }

  specificBox.innerHTML = userRecords.map(rec => `
    <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; padding: 6px 0; border-bottom: 1px solid rgba(0,0,0,0.05); cursor: pointer;">
      <input type="checkbox" value="${rec._id}" checked>
      <span style="font-weight: 500;">${rec.name}</span>
      <span class="badge badge-info" style="font-size: 0.65rem; margin-left: auto;">${rec.category}</span>
    </label>
  `).join('');
}

// 3. ACTIVE SHARES & AUDIT LOGS MODAL
function setupActiveSharesModal() {
  const openBtn = document.getElementById('btn-open-active-shares');
  const modal = document.getElementById('active-shares-modal');
  const closeBtn = document.getElementById('active-shares-modal-close');
  const dismissBtn = document.getElementById('active-shares-modal-dismiss');
  const tabActiveGrants = document.getElementById('tab-btn-active-grants');
  const tabAuditLogs = document.getElementById('tab-btn-audit-logs');
  const contentActiveGrants = document.getElementById('tab-content-active-grants');
  const contentAuditLogs = document.getElementById('tab-content-audit-logs');

  const openModal = async () => {
    if (!modal) return;
    modal.classList.add('open');
    await loadActiveGrants();
  };

  const closeModal = () => {
    if (modal) modal.classList.remove('open');
  };

  if (openBtn) openBtn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (dismissBtn) dismissBtn.addEventListener('click', closeModal);

  // Tab switching
  if (tabActiveGrants && tabAuditLogs) {
    tabActiveGrants.addEventListener('click', () => {
      tabActiveGrants.classList.add('active');
      tabAuditLogs.classList.remove('active');
      contentActiveGrants.style.display = 'block';
      contentAuditLogs.style.display = 'none';
      loadActiveGrants();
    });

    tabAuditLogs.addEventListener('click', () => {
      tabAuditLogs.classList.add('active');
      tabActiveGrants.classList.remove('active');
      contentActiveGrants.style.display = 'none';
      contentAuditLogs.style.display = 'block';
      loadAuditLogs();
    });
  }

  window.revokeShare = async (shareId) => {
    if (confirm('Are you sure you want to immediately revoke access for this doctor? They will lose access to these records.')) {
      const res = await apiFetch(`/shares/${shareId}/revoke`, { method: 'POST' });
      if (res.success) {
        showToast('Consent Revoked', 'Doctor access has been revoked successfully', 'success');
        loadActiveGrants();
      } else {
        showToast('Revocation Failed', res.error, 'error');
      }
    }
  };
}

async function loadActiveGrants() {
  const container = document.getElementById('active-grants-list');
  const countEl = document.getElementById('active-grants-count');
  if (!container) return;

  container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 30px;">Loading active sharing consents...</div>';

  const isDoctor = currentUser.role === 'doctor';
  const endpoint = isDoctor ? '/shares/received' : '/shares/sent';
  const res = await apiFetch(endpoint);

  if (res.success) {
    activeShares = res.data || [];
    if (countEl) countEl.textContent = activeShares.length;

    if (activeShares.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 30px; color: var(--text-secondary); background: var(--background); border-radius: var(--radius-md);">
          ${isDoctor ? 'No patients have actively granted record access to your account.' : 'You have not granted record access to any doctors.'}
        </div>
      `;
      return;
    }

    container.innerHTML = activeShares.map(share => {
      const otherUser = isDoctor ? (share.patient || {}) : (share.doctor || {});
      const otherName = otherUser.name || (isDoctor ? 'Patient' : 'Dr. Medical Practitioner');
      const isExpired = new Date(share.expiresAt) < new Date();
      const permsBadge = (share.permissions || []).includes('download') ? 'Read & Download' : 'Read Only';

      return `
        <div style="padding: 14px 18px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); display: flex; justify-content: space-between; align-items: center; gap: 14px;">
          <div>
            <div style="font-weight: 700; font-size: 0.95rem; display: flex; align-items: center; gap: 8px;">
              <span>${isDoctor ? '👤' : '🩺'}</span> ${otherName}
              <span class="badge ${isExpired ? 'badge-danger' : 'badge-success'}" style="font-size: 0.65rem;">
                ${isExpired ? 'Expired' : 'Active'}
              </span>
              <span class="badge badge-info" style="font-size: 0.65rem;">${permsBadge}</span>
            </div>
            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 4px;">
              Scope: <strong>${share.allRecords ? 'All Records' : `${(share.records || []).length} specific records`}</strong> • 
              Expires: <strong>${new Date(share.expiresAt).toLocaleDateString()}</strong>
            </div>
            ${share.purpose ? `<div style="font-size: 0.75rem; color: var(--primary); margin-top: 2px;">Purpose: ${share.purpose}</div>` : ''}
          </div>

          ${!isDoctor ? `
            <button class="btn btn-outline" onclick="revokeShare('${share._id}')" style="border-color: var(--error); color: var(--error); font-size: 0.75rem; padding: 6px 12px; font-weight: 600;">
              Revoke Access
            </button>
          ` : ''}
        </div>
      `;
    }).join('');
  } else {
    container.innerHTML = `<div style="text-align: center; color: var(--error); padding: 30px;">${res.error || 'Failed to load grants'}</div>`;
  }
}

async function loadAuditLogs() {
  const container = document.getElementById('audit-logs-list');
  if (!container) return;

  container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 30px;">Loading access history logs...</div>';

  const res = await apiFetch('/shares/audit-logs');
  if (res.success) {
    const logs = res.data || [];
    if (logs.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 30px; color: var(--text-secondary);">No record access events logged yet.</div>';
      return;
    }

    container.innerHTML = logs.map(log => {
      let icon = '👁️';
      let actionLabel = 'Record Viewed';
      if (log.action === 'RECORD_DOWNLOAD') { icon = '📥'; actionLabel = 'Record Downloaded'; }
      if (log.action === 'SHARE_GRANTED') { icon = '🔐'; actionLabel = 'Access Granted'; }
      if (log.action === 'SHARE_REVOKED') { icon = '🚫'; actionLabel = 'Access Revoked'; }
      if (log.action === 'ACCESS_DENIED') { icon = '🛑'; actionLabel = 'Unauthorized Access Blocked'; }

      const actorName = log.actor?.name || 'Authorized Doctor';
      const timeStr = new Date(log.createdAt).toLocaleString();

      return `
        <div style="padding: 10px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--background); font-size: 0.8rem; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong>${icon} ${actionLabel}</strong> by <span style="color: var(--primary); font-weight: 600;">${actorName}</span>
            <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 2px;">
              ${log.details?.recordName ? `Document: "${log.details.recordName}" • ` : ''}IP: ${log.ipAddress || '127.0.0.1'}
            </div>
          </div>
          <div style="color: var(--text-secondary); font-size: 0.75rem; white-space: nowrap;">
            ${timeStr}
          </div>
        </div>
      `;
    }).join('');
  } else {
    container.innerHTML = `<div style="text-align: center; color: var(--error); padding: 30px;">${res.error || 'Failed to load audit trail'}</div>`;
  }
}

// 4. FILTER & SEARCH HANDLERS
function setupFilters() {
  const tabs = document.querySelectorAll('.filter-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeCategory = tab.getAttribute('data-category');
      loadRecords();
    });
  });
}

function setupSearch() {
  const searchInput = document.getElementById('record-search-input');
  if (!searchInput) return;

  let debounceTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchQuery = e.target.value.trim();
      loadRecords();
    }, 400);
  });
}

// 5. FETCH & RENDER HEALTH RECORDS GRID (WITH OFFLINE INDEXEDDB FALLBACK)
async function loadRecords() {
  const grid = document.getElementById('records-grid-container');
  if (!grid) return;

  const userId = currentUser?._id || currentUser?.id;
  const isDoctor = currentUser.role === 'doctor';
  let isOfflineData = false;

  const endpoint = `/records?category=${activeCategory}&search=${encodeURIComponent(searchQuery)}`;
  const result = await apiFetch(endpoint);

  if (result.success) {
    userRecords = result.data || [];
    // Only cache patient's own records to ensure patient confidentiality across shared device boundaries
    if (userId && !isDoctor) {
      await offlineStorage.saveHealthRecords(userId, userRecords);
    }
  } else {
    // Read from IndexedDB for authorized patient
    isOfflineData = true;
    if (userId && !isDoctor) {
      let cached = await offlineStorage.getHealthRecords(userId);
      if (activeCategory && activeCategory !== 'All') {
        cached = cached.filter(r => r.category === activeCategory);
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        cached = cached.filter(r => (r.name && r.name.toLowerCase().includes(q)) || (r.notes && r.notes.toLowerCase().includes(q)));
      }
      userRecords = cached;
    } else {
      userRecords = [];
    }
  }

  const offlineBanner = isOfflineData ? `
    <div style="grid-column: 1 / -1; margin-bottom: 20px; padding: 14px 18px; border-radius: var(--radius-md); background: rgba(59, 130, 246, 0.08); border: 1px solid var(--primary); font-size: 0.85rem; color: var(--text-primary);">
      <div style="font-weight: 700; color: var(--primary); margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;">
        <span>🔒 Offline Read-Only Health Locker</span>
        <span class="badge badge-info" style="font-size: 0.7rem;">Cached Documents</span>
      </div>
      <div>Displaying locally cached medical document metadata for your account. Note: Offline mode cannot reflect real-time server revocations or doctor permission changes. Document uploads and sharing grants require an active internet connection.</div>
    </div>
  ` : '';

  if (userRecords.length === 0) {
    grid.innerHTML = offlineBanner + `
      <div style="grid-column: 1 / -1;" class="empty-state">
        <div class="empty-icon"><i data-lucide="folder-heart" style="width: 48px; height: 48px;"></i></div>
        <div class="empty-title">${isDoctor ? 'No shared patient records available' : (isOfflineData ? 'No cached records found offline' : 'No documents found')}</div>
        <div class="empty-subtitle">${isDoctor ? 'No patients have actively granted consent for your account, or no documents match your filter.' : (isOfflineData ? 'No documents have been cached on this device for offline review yet.' : 'Your search query or category filter returned empty results.')}</div>
        ${!isDoctor && !isOfflineData ? `<button class="btn btn-primary" onclick="document.getElementById('btn-open-record-modal').click()"><i data-lucide="plus"></i> Upload Document</button>` : ''}
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  grid.innerHTML = offlineBanner + userRecords.map(rec => {
    let fileIcon = 'file-text';
    const ext = (rec.fileUrl || '').split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg'].includes(ext)) fileIcon = 'file-image';
    if (ext === 'pdf') fileIcon = 'file-check';

    let catBadgeClass = 'badge-info';
    if (rec.category === 'Prescription') catBadgeClass = 'badge-success';
    if (rec.category === 'Bill') catBadgeClass = 'badge-warning';
    if (rec.category === 'Insurance') catBadgeClass = 'badge-success';

    const patientName = rec.user?.name || 'Patient';

    return `
      <div class="glass-card record-card">
        <div>
          <div style="display: flex; align-items: start; gap: 12px;">
            <div style="width: 40px; height: 40px; background-color: rgba(59, 130, 246, 0.08); color: var(--primary); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <i data-lucide="${fileIcon}"></i>
            </div>
            <div style="overflow: hidden; width: 100%;">
              <div class="record-title" title="${rec.name}">${rec.name}</div>
              <div class="record-meta">
                <span class="badge ${catBadgeClass}" style="font-size: 0.65rem;">${rec.category}</span>
                <span>• ${new Date(rec.date).toLocaleDateString()}</span>
                ${isDoctor ? `<span class="badge badge-info" style="font-size: 0.65rem;">Patient: ${patientName}</span>` : ''}
              </div>
            </div>
          </div>

          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 14px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;" title="${rec.notes || 'No description'}">
            ${rec.notes || 'No clinical summary listed'}
          </div>
        </div>

        <div class="record-footer">
          <div style="display: flex; gap: 6px; align-items: center;">
            ${rec.fileUrl ? `
              <a href="${rec.fileUrl}" target="_blank" class="btn btn-secondary btn-icon" style="padding: 6px 12px; font-size: 0.75rem; border-radius: var(--radius-sm);" title="Open / Preview Attachment">
                <i data-lucide="eye" style="width: 14px; height: 14px;"></i> Preview
              </a>
            ` : ''}
            ${isDoctor && rec._id ? `
              <a href="/api/records/${rec._id}/download" class="btn btn-secondary btn-icon" style="padding: 6px 12px; font-size: 0.75rem; border-radius: var(--radius-sm);" title="Download File (Permitted)">
                <i data-lucide="download" style="width: 14px; height: 14px;"></i>
              </a>
            ` : ''}
          </div>

          ${!isDoctor && !isOfflineData ? `
            <button class="btn btn-danger btn-icon" onclick="deleteRecord('${rec._id}')" title="Delete record">
              <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}
