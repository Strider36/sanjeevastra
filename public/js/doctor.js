/**
 * Sanjeev Astra - Doctor & Clinical Authority Portal Controller
 * Modular, clean, lightweight controller for doctor login, registration, and dashboard.
 */

// Helper: API Fetch with JWT Token
async function docFetch(path, options = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`/api${path}`, {
      ...options,
      headers
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, ...data };
  } catch (err) {
    return { ok: false, success: false, error: err.message || 'Network error' };
  }
}

// Helper: Toast Notifications
function showDocToast(message, type = 'info') {
  const toast = document.getElementById('doc-toast');
  if (!toast) return;

  toast.textContent = message;
  toast.style.display = 'flex';
  if (type === 'error') {
    toast.style.backgroundColor = '#b91c1c';
  } else if (type === 'success') {
    toast.style.backgroundColor = '#0d9488';
  } else {
    toast.style.backgroundColor = '#0f172a';
  }

  setTimeout(() => {
    toast.style.display = 'none';
  }, 3500);
}

// Format relative expiry time
function formatExpiry(expiryDateStr) {
  if (!expiryDateStr) return 'No expiry specified';
  const expiry = new Date(expiryDateStr);
  const now = new Date();
  const diffMs = expiry - now;

  if (diffMs <= 0) return 'Expired';

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} remaining`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} remaining (${expiry.toLocaleDateString()})`;
}

// Sanitize HTML helper
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
  const pagePath = window.location.pathname;

  // ----------------------------------------------------
  // 1. DOCTOR LOGIN PAGE LOGIC
  // ----------------------------------------------------
  const loginForm = document.getElementById('doctor-login-form');
  if (loginForm) {
    // If already logged in as doctor or admin, direct to dashboard
    const storedUser = JSON.parse(localStorage.getItem('user') || 'null');
    const storedToken = localStorage.getItem('token');
    if (storedToken && storedUser && (storedUser.role === 'doctor' || storedUser.role === 'admin')) {
      window.location.href = '/doctor-dashboard.html';
      return;
    }

    // Forgot Password Modal Triggers
    const forgotLink = document.getElementById('doctor-forgot-password');
    const forgotModal = document.getElementById('forgot-modal');
    const closeForgot = document.getElementById('close-forgot-modal');
    const dismissForgot = document.getElementById('dismiss-forgot-modal');

    if (forgotLink && forgotModal) {
      forgotLink.addEventListener('click', (e) => {
        e.preventDefault();
        forgotModal.style.display = 'flex';
      });
      closeForgot?.addEventListener('click', () => { forgotModal.style.display = 'none'; });
      dismissForgot?.addEventListener('click', () => { forgotModal.style.display = 'none'; });
      forgotModal.addEventListener('click', (e) => {
        if (e.target === forgotModal) forgotModal.style.display = 'none';
      });
    }

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const alertBox = document.getElementById('login-alert');
      const submitBtn = document.getElementById('doctor-login-btn');
      const email = document.getElementById('doctor-email').value.trim();
      const password = document.getElementById('doctor-password').value;

      if (!email || !password) {
        if (alertBox) {
          alertBox.textContent = 'Please enter both email and password.';
          alertBox.style.display = 'flex';
        }
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Verifying Credentials...';
      if (alertBox) alertBox.style.display = 'none';

      const res = await docFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });

      submitBtn.disabled = false;
      submitBtn.textContent = 'Log In';

      if (!res.ok || !res.success) {
        if (alertBox) {
          alertBox.textContent = res.error || 'Invalid clinician credentials.';
          alertBox.style.display = 'flex';
        }
        return;
      }

      // Check role authorization
      const user = res.user;
      if (user.role === 'patient') {
        if (alertBox) {
          alertBox.innerHTML = '<strong>Access Restricted:</strong> This portal is for doctors and clinical authorities. <a href="/login.html" style="color: inherit; text-decoration: underline;">Click here for the Patient Portal</a>.';
          alertBox.style.display = 'flex';
        }
        return;
      }

      // Save credentials & redirect
      localStorage.setItem('token', res.token);
      localStorage.setItem('user', JSON.stringify(res.user));
      window.location.href = '/doctor-dashboard.html';
    });
  }

  // ----------------------------------------------------
  // 2. DOCTOR REGISTRATION PAGE LOGIC
  // ----------------------------------------------------
  const registerForm = document.getElementById('doctor-register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const alertBox = document.getElementById('register-alert');
      const submitBtn = document.getElementById('doctor-reg-btn');

      const name = document.getElementById('reg-name').value.trim();
      const email = document.getElementById('reg-email').value.trim();
      const password = document.getElementById('reg-password').value;
      const confirmPassword = document.getElementById('reg-confirm-password').value;
      const licenseNumber = document.getElementById('reg-license').value.trim();
      const specialization = document.getElementById('reg-specialization').value.trim();
      const hospitalAffiliation = document.getElementById('reg-hospital').value.trim();
      const phone = document.getElementById('reg-phone')?.value.trim() || '';

      if (password !== confirmPassword) {
        if (alertBox) {
          alertBox.className = 'doc-alert doc-alert-danger';
          alertBox.textContent = 'Passwords do not match.';
          alertBox.style.display = 'flex';
        }
        return;
      }

      if (password.length < 6) {
        if (alertBox) {
          alertBox.className = 'doc-alert doc-alert-danger';
          alertBox.textContent = 'Password must be at least 6 characters.';
          alertBox.style.display = 'flex';
        }
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting Registration...';
      if (alertBox) alertBox.style.display = 'none';

      const payload = {
        name,
        email,
        password,
        role: 'doctor',
        medicalRegistrationNumber: licenseNumber,
        specialization,
        hospitalAffiliation,
        phone,
        qualifications: ['MBBS']
      };

      const res = await docFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit for Administrative Verification';

      if (!res.ok || !res.success) {
        if (alertBox) {
          alertBox.className = 'doc-alert doc-alert-danger';
          alertBox.textContent = res.error || 'Registration failed. Please check your details.';
          alertBox.style.display = 'flex';
        }
        return;
      }

      // Registration successful with pending status
      registerForm.reset();
      if (alertBox) {
        alertBox.className = 'doc-alert doc-alert-success';
        alertBox.innerHTML = '<strong>Application Received:</strong> Your doctor account has been registered. Your credentials are now pending administrative verification. Redirecting to Doctor Login...';
        alertBox.style.display = 'flex';
      }

      setTimeout(() => {
        window.location.href = '/doctor-login.html';
      }, 2500);
    });
  }

  // ----------------------------------------------------
  // 3. DOCTOR DASHBOARD PAGE LOGIC
  // ----------------------------------------------------
  const dashboardContainer = document.querySelector('.doctor-layout');
  if (dashboardContainer && document.getElementById('shared-records-body')) {
    initDoctorDashboard();
  }
});

/**
 * Initialize Doctor Dashboard components & data feeds
 */
async function initDoctorDashboard() {
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || 'null');

  // Verify authentication
  if (!token || !user) {
    window.location.href = '/doctor-login.html';
    return;
  }

  if (user.role === 'patient') {
    window.location.href = '/dashboard.html';
    return;
  }

  // Set clinician details in top nav
  const navName = document.getElementById('doc-nav-name');
  if (navName) {
    navName.textContent = user.name.startsWith('Dr.') ? user.name : `Dr. ${user.name}`;
  }

  // Setup Logout
  const logoutBtn = document.getElementById('doc-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/doctor-login.html';
    });
  }

  // Setup Tabs
  const tabButtons = document.querySelectorAll('.doc-tab-btn');
  const tabPanes = document.querySelectorAll('.doc-tab-pane');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(`pane-${targetTab}`);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // Admin Tab conditional visibility
  if (user.role === 'admin') {
    const adminTabBtn = document.getElementById('tab-btn-admin-verify');
    if (adminTabBtn) {
      adminTabBtn.style.display = 'flex';
      loadPendingDoctors();
      document.getElementById('refresh-pending-btn')?.addEventListener('click', loadPendingDoctors);
    }
  }

  // Setup Details Modal
  const recordModal = document.getElementById('record-details-modal');
  const closeRecordModal = document.getElementById('close-record-modal');
  const dismissRecordModal = document.getElementById('dismiss-record-modal');

  const hideRecordModal = () => { if (recordModal) recordModal.style.display = 'none'; };
  closeRecordModal?.addEventListener('click', hideRecordModal);
  dismissRecordModal?.addEventListener('click', hideRecordModal);
  recordModal?.addEventListener('click', (e) => {
    if (e.target === recordModal) hideRecordModal();
  });

  // Load core sections
  await loadDoctorProfile();
  await loadSharedRecords();
  await loadNotifications();

  // Attach button triggers
  document.getElementById('refresh-records-btn')?.addEventListener('click', loadSharedRecords);
  document.getElementById('refresh-notifs-btn')?.addEventListener('click', loadNotifications);
  document.getElementById('mark-all-read-btn')?.addEventListener('click', markAllNotificationsRead);

  // Search filter for shared records
  const searchInput = document.getElementById('records-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterSharedRecords(e.target.value.toLowerCase().trim());
    });
  }

  // Profile save form
  const profileForm = document.getElementById('doctor-profile-form');
  if (profileForm) {
    profileForm.addEventListener('submit', handleProfileUpdate);
  }
}

// In-memory records cache for searching & modal inspection
let currentSharedRecordsList = [];

/**
 * Load Doctor Profile and update verification badge/status
 */
async function loadDoctorProfile() {
  const res = await docFetch('/doctors/profile/me');
  if (!res.ok || !res.data) return;

  const profile = res.data;
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  // Nav status badge
  const navStatus = document.getElementById('doc-nav-status');
  const unverifiedBanner = document.getElementById('unverified-banner');
  const profStatusDisplay = document.getElementById('prof-status-display');

  const status = profile.verificationStatus || 'pending';

  if (navStatus) {
    navStatus.textContent = status === 'verified' ? 'Verified Clinician' : (status === 'rejected' ? 'Rejected' : 'Pending Review');
    navStatus.className = `doc-status-pill doc-status-${status}`;
  }

  if (profStatusDisplay) {
    profStatusDisplay.innerHTML = `
      <span class="doc-status-pill doc-status-${status}" style="font-size: 13px; padding: 4px 10px;">
        ${status === 'verified' ? '✓ Verified Clinician' : (status === 'rejected' ? '✕ Application Rejected' : '⏳ Pending Admin Verification')}
      </span>
      ${status === 'verified' && profile.verifiedAt ? `<span style="font-size: 11px; color: var(--doc-text-muted); margin-left: 8px;">Approved on ${new Date(profile.verifiedAt).toLocaleDateString()}</span>` : ''}
    `;
  }

  // Toggle unverified warning banner
  if (unverifiedBanner) {
    if (status !== 'verified') {
      unverifiedBanner.style.display = 'flex';
      if (status === 'rejected') {
        unverifiedBanner.className = 'doc-alert doc-alert-danger';
        unverifiedBanner.innerHTML = `<strong>Verification Rejected:</strong> ${escapeHtml(profile.rejectionReason || 'Credentials could not be verified by hospital administration.')}`;
      }
    } else {
      unverifiedBanner.style.display = 'none';
    }
  }

  // Fill profile form
  const nameInput = document.getElementById('prof-name');
  const emailInput = document.getElementById('prof-email');
  const licenseInput = document.getElementById('prof-license');
  const specInput = document.getElementById('prof-specialization');
  const hospInput = document.getElementById('prof-hospital');
  const qualInput = document.getElementById('prof-qualifications');
  const expInput = document.getElementById('prof-experience');
  const bioInput = document.getElementById('prof-bio');

  if (nameInput) nameInput.value = profile.name || user.name || '';
  if (emailInput) emailInput.value = profile.email || user.email || '';
  if (licenseInput) licenseInput.value = profile.medicalRegistrationNumber || '';
  if (specInput) specInput.value = profile.specialization || '';
  if (hospInput) hospInput.value = profile.hospitalAffiliation || '';
  if (qualInput) qualInput.value = Array.isArray(profile.qualifications) ? profile.qualifications.join(', ') : (profile.qualifications || '');
  if (expInput) expInput.value = profile.experienceYears || '';
  if (bioInput) bioInput.value = profile.bio || '';
}

/**
 * Update Doctor Profile
 */
async function handleProfileUpdate(e) {
  e.preventDefault();
  const alertBox = document.getElementById('profile-alert');
  const saveBtn = document.getElementById('save-profile-btn');

  const medicalRegistrationNumber = document.getElementById('prof-license').value.trim();
  const specialization = document.getElementById('prof-specialization').value.trim();
  const hospitalAffiliation = document.getElementById('prof-hospital').value.trim();
  const qualifications = document.getElementById('prof-qualifications').value.split(',').map(s => s.trim()).filter(Boolean);
  const experienceYears = Number(document.getElementById('prof-experience').value) || 0;
  const bio = document.getElementById('prof-bio').value.trim();

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  if (alertBox) alertBox.style.display = 'none';

  const res = await docFetch('/doctors/profile/me', {
    method: 'PUT',
    body: JSON.stringify({
      medicalRegistrationNumber,
      specialization,
      hospitalAffiliation,
      qualifications,
      experienceYears,
      bio
    })
  });

  saveBtn.disabled = false;
  saveBtn.textContent = 'Save Profile Changes';

  if (!res.ok || !res.success) {
    if (alertBox) {
      alertBox.className = 'doc-alert doc-alert-danger';
      alertBox.textContent = res.error || 'Failed to update profile.';
      alertBox.style.display = 'flex';
    }
    return;
  }

  showDocToast('Doctor profile updated successfully.', 'success');
  if (alertBox) {
    alertBox.className = 'doc-alert doc-alert-success';
    alertBox.textContent = 'Profile changes saved successfully.';
    alertBox.style.display = 'flex';
  }

  // Reload profile to reflect potential verification status changes
  await loadDoctorProfile();
}

/**
 * Load Shared Patient Records with valid patient consent
 */
async function loadSharedRecords() {
  const tableBody = document.getElementById('shared-records-body');
  const emptyState = document.getElementById('records-empty-state');
  const tableWrapper = document.getElementById('records-table-wrapper');
  const countBadge = document.getElementById('count-shared-records');

  if (!tableBody) return;

  tableBody.innerHTML = `
    <tr>
      <td colspan="7" style="text-align: center; padding: 28px; color: var(--doc-text-muted);">
        Retrieving active consent grants...
      </td>
    </tr>
  `;

  const res = await docFetch('/shares/received');

  // Handle unverified doctor guard response (403 from backend)
  if (res.status === 403) {
    tableWrapper.style.display = 'none';
    emptyState.style.display = 'block';
    emptyState.innerHTML = `
      <div class="doc-empty-title">Access Restricted: Verification Required</div>
      <div class="doc-empty-desc">
        ${escapeHtml(res.error || 'Your clinician credentials have not been verified yet. Patient records cannot be viewed until verified.')}
      </div>
    `;
    if (countBadge) countBadge.textContent = '0';
    return;
  }

  if (!res.ok || !res.data) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 24px; color: var(--doc-danger);">
          Failed to load shared records: ${escapeHtml(res.error || 'Internal server error')}
        </td>
      </tr>
    `;
    return;
  }

  const shares = res.data;
  currentSharedRecordsList = [];

  // Flatten active shares and linked records
  shares.forEach(share => {
    const patient = share.patient || {};
    const records = share.records || [];
    const permissions = share.permissions || { canView: true, canDownload: false };
    const expiresAt = share.expiresAt;
    const shareId = share._id;

    if (records.length === 0) {
      currentSharedRecordsList.push({
        shareId,
        patient,
        record: { name: 'Full Health Vault Access', category: 'General Summary', date: share.createdAt, notes: '' },
        permissions,
        expiresAt
      });
    } else {
      records.forEach(rec => {
        currentSharedRecordsList.push({
          shareId,
          patient,
          record: rec,
          permissions,
          expiresAt
        });
      });
    }
  });

  if (countBadge) {
    countBadge.textContent = currentSharedRecordsList.length;
  }

  renderSharedRecords(currentSharedRecordsList);
}

/**
 * Render shared records table
 */
function renderSharedRecords(list) {
  const tableBody = document.getElementById('shared-records-body');
  const emptyState = document.getElementById('records-empty-state');
  const tableWrapper = document.getElementById('records-table-wrapper');

  if (!list || list.length === 0) {
    if (tableWrapper) tableWrapper.style.display = 'none';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (tableWrapper) tableWrapper.style.display = 'block';
  if (emptyState) emptyState.style.display = 'none';

  tableBody.innerHTML = list.map((item, index) => {
    const p = item.patient || {};
    const r = item.record || {};
    const pMeta = [
      p.age ? `${p.age} yrs` : null,
      p.gender || null,
      p.bloodGroup ? `Blood: ${p.bloodGroup}` : null
    ].filter(Boolean).join(' • ') || 'Not specified';

    const expiryLabel = formatExpiry(item.expiresAt);
    const permLabel = item.permissions?.canDownload ? 'View & Download' : 'View Only';

    return `
      <tr>
        <td style="font-weight: 600; color: var(--doc-text);">
          ${escapeHtml(p.name || 'Anonymous Patient')}
        </td>
        <td style="color: var(--doc-text-muted);">
          ${escapeHtml(pMeta)}
        </td>
        <td style="font-weight: 500;">
          ${escapeHtml(r.name || 'Unnamed Document')}
        </td>
        <td>
          <span style="display: inline-block; font-size: 11px; padding: 2px 6px; background-color: var(--doc-sidebar-bg); border: 1px solid var(--doc-border); border-radius: 4px;">
            ${escapeHtml(r.category || 'Clinical Record')}
          </span>
        </td>
        <td style="color: var(--doc-teal); font-weight: 500;">
          ${escapeHtml(expiryLabel)}
        </td>
        <td style="font-size: 12px; color: var(--doc-text-muted);">
          ${escapeHtml(permLabel)}
        </td>
        <td>
          <button 
            type="button" 
            class="doc-btn doc-btn-secondary doc-btn-sm btn-inspect-record" 
            data-index="${index}"
          >
            Inspect Record
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Attach inspection handlers
  document.querySelectorAll('.btn-inspect-record').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-index'));
      openRecordModal(list[idx]);
    });
  });
}

/**
 * Filter shared records by search text
 */
function filterSharedRecords(query) {
  if (!query) {
    renderSharedRecords(currentSharedRecordsList);
    return;
  }

  const filtered = currentSharedRecordsList.filter(item => {
    const pName = (item.patient?.name || '').toLowerCase();
    const rName = (item.record?.name || '').toLowerCase();
    const cat = (item.record?.category || '').toLowerCase();
    return pName.includes(query) || rName.includes(query) || cat.includes(query);
  });

  renderSharedRecords(filtered);
}

/**
 * Open Record Inspection Modal
 */
function openRecordModal(item) {
  if (!item) return;

  const modal = document.getElementById('record-details-modal');
  const title = document.getElementById('modal-record-title');
  const pName = document.getElementById('modal-patient-name');
  const pMeta = document.getElementById('modal-patient-meta');
  const cat = document.getElementById('modal-category');
  const date = document.getElementById('modal-date');
  const expiry = document.getElementById('modal-expiry');
  const perm = document.getElementById('modal-permission');
  const notes = document.getElementById('modal-notes');
  const fileLink = document.getElementById('modal-file-link');
  const fileWrapper = document.getElementById('modal-file-wrapper');

  const p = item.patient || {};
  const r = item.record || {};

  if (title) title.textContent = r.name || 'Medical Record';
  if (pName) pName.textContent = p.name || 'Patient';
  if (pMeta) {
    pMeta.textContent = `Age: ${p.age || 'N/A'} | Gender: ${p.gender || 'N/A'} | Blood: ${p.bloodGroup || 'N/A'} | Email: ${p.email || 'N/A'}`;
  }
  if (cat) cat.textContent = r.category || 'General Health';
  if (date) date.textContent = r.date ? new Date(r.date).toLocaleDateString() : 'N/A';
  if (expiry) expiry.textContent = formatExpiry(item.expiresAt);
  if (perm) perm.textContent = item.permissions?.canDownload ? 'View & Download Allowed' : 'View Only (Restricted)';
  if (notes) notes.textContent = r.notes || 'No doctor notes attached to this record.';

  if (fileWrapper && fileLink) {
    if (r.fileUrl) {
      fileWrapper.style.display = 'block';
      fileLink.href = r.fileUrl;
      fileLink.textContent = item.permissions?.canDownload ? 'Download / View Attached Document' : 'View Attached Document';
    } else {
      fileWrapper.style.display = 'none';
    }
  }

  if (modal) modal.style.display = 'flex';
}

/**
 * Load Notifications
 */
async function loadNotifications() {
  const notifsList = document.getElementById('notifications-list');
  const emptyState = document.getElementById('notifs-empty-state');
  const unreadCountBadge = document.getElementById('count-unread-notifs');

  if (!notifsList) return;

  const res = await docFetch('/notifications');
  if (!res.ok || !res.data) {
    notifsList.innerHTML = `<div style="text-align: center; color: var(--doc-danger); padding: 20px;">Could not load notifications</div>`;
    return;
  }

  const notifs = res.data;
  const unreadCount = notifs.filter(n => !n.isRead).length;

  if (unreadCountBadge) {
    unreadCountBadge.textContent = unreadCount;
  }

  if (notifs.length === 0) {
    notifsList.style.display = 'none';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  notifsList.style.display = 'flex';
  if (emptyState) emptyState.style.display = 'none';

  notifsList.innerHTML = notifs.map(n => `
    <div class="doc-notif-item ${!n.isRead ? 'unread' : ''}" data-id="${n._id}">
      <div>
        <div class="doc-notif-title">${escapeHtml(n.title)}</div>
        <div class="doc-notif-msg">${escapeHtml(n.message)}</div>
        <div class="doc-notif-meta">${new Date(n.createdAt).toLocaleString()} • Type: ${escapeHtml(n.type || 'System')}</div>
      </div>
      ${!n.isRead ? `
        <button type="button" class="doc-btn doc-btn-secondary doc-btn-sm btn-mark-read" data-id="${n._id}" style="white-space: nowrap;">
          Mark Read
        </button>
      ` : ''}
    </div>
  `).join('');

  // Attach individual mark as read handlers
  document.querySelectorAll('.btn-mark-read').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      await docFetch(`/notifications/${id}/read`, { method: 'PUT' });
      await loadNotifications();
    });
  });
}

/**
 * Mark all notifications as read
 */
async function markAllNotificationsRead() {
  await docFetch('/notifications/read-all', { method: 'PUT' });
  showDocToast('All notifications marked as read', 'success');
  await loadNotifications();
}

/**
 * Load Pending Doctors for Admin Verification Tab
 */
async function loadPendingDoctors() {
  const tableBody = document.getElementById('pending-doctors-body');
  const emptyState = document.getElementById('pending-empty-state');
  const countBadge = document.getElementById('count-pending-verifications');

  if (!tableBody) return;

  const res = await docFetch('/doctors/pending');
  if (!res.ok || !res.data) {
    tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--doc-danger);">Failed to load pending doctor applications.</td></tr>`;
    return;
  }

  const pendingList = res.data;
  if (countBadge) countBadge.textContent = pendingList.length;

  if (pendingList.length === 0) {
    tableBody.parentElement.style.display = 'none';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  tableBody.parentElement.style.display = 'table';
  if (emptyState) emptyState.style.display = 'none';

  tableBody.innerHTML = pendingList.map(doc => `
    <tr>
      <td style="font-weight: 600;">${escapeHtml(doc.name)}</td>
      <td style="color: var(--doc-text-muted);">${escapeHtml(doc.user?.email || doc.email || 'N/A')}</td>
      <td style="font-family: monospace; font-weight: 600;">${escapeHtml(doc.medicalRegistrationNumber)}</td>
      <td>${escapeHtml(doc.specialization || 'General')}</td>
      <td>${escapeHtml(doc.hospitalAffiliation || 'N/A')}</td>
      <td style="font-size: 12px; color: var(--doc-text-muted);">${new Date(doc.createdAt).toLocaleDateString()}</td>
      <td>
        <div style="display: flex; gap: 6px;">
          <button type="button" class="doc-btn doc-btn-sm doc-btn-primary btn-approve-doc" data-id="${doc._id}">
            Verify
          </button>
          <button type="button" class="doc-btn doc-btn-sm doc-btn-danger btn-reject-doc" data-id="${doc._id}">
            Reject
          </button>
        </div>
      </td>
    </tr>
  `).join('');

  // Attach approve/reject handlers
  document.querySelectorAll('.btn-approve-doc').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      btn.disabled = true;
      const res = await docFetch(`/doctors/${id}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'verified' })
      });
      if (res.ok) {
        showDocToast('Doctor verified successfully!', 'success');
        await loadPendingDoctors();
      } else {
        showDocToast(res.error || 'Failed to verify doctor', 'error');
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll('.btn-reject-doc').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const reason = prompt('Please specify rejection reason for credential documentation:');
      if (!reason) return;

      btn.disabled = true;
      const res = await docFetch(`/doctors/${id}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'rejected', rejectionReason: reason })
      });
      if (res.ok) {
        showDocToast('Doctor registration rejected.', 'info');
        await loadPendingDoctors();
      } else {
        showDocToast(res.error || 'Failed to reject doctor', 'error');
        btn.disabled = false;
      }
    });
  });
}
