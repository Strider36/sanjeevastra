/* Sanjeev Astra Dashboard Controller */
import { apiFetch, showToast, triggerReminderAudio } from './api.js';
import { triggerMedicalSos } from './sos.js';
import { t } from './i18n.js';
import { VoiceAssistant } from './voice.js';
import { offlineStorage } from './db.js';
import './networkStatus.js';

let activeMedicines = [];
let activeAppointments = [];
let chartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
  loadDashboardData();
  setupEmergencyModal();
  setupWaterTracker();
  setupSosTrigger();
  setupSanjeevAstraAI();
  setupResponderMode();

  window.addEventListener('swasthya:languageChanged', () => {
    buildTodayChecklist();
    calculateAdherenceTrend();
  });
});

function setupSosTrigger() {
  const dashSosBtn = document.getElementById('btn-dashboard-sos');
  if (dashSosBtn) {
    dashSosBtn.addEventListener('click', (e) => {
      e.preventDefault();
      triggerMedicalSos();
    });
  }
}

// 🩺 Sanjeev Astra AI Healthcare Navigation Assistant Handler
function setupSanjeevAstraAI() {
  const input = document.getElementById('sanjeev-problem-input');
  const voiceBtn = document.getElementById('btn-sanjeev-voice');
  const guideBtn = document.getElementById('btn-sanjeev-guide');
  const resultBox = document.getElementById('sanjeev-guidance-result');

  if (!guideBtn || !resultBox) return;

  const voiceAssistant = new VoiceAssistant({
    onStatusChange: (status) => {
      if (status === 'listening') {
        voiceBtn.style.background = '#EF4444';
        voiceBtn.innerHTML = '<span>🔴</span> <span>Listening...</span>';
      } else {
        voiceBtn.style.background = '';
        voiceBtn.innerHTML = '<span>🎤</span> <span>Tell us your problem</span>';
      }
    },
    onResult: (res) => {
      if (input) input.value = res.transcript;
      renderSanjeevGuidance(res.transcript, resultBox);
    },
    onError: () => {
      voiceBtn.style.background = '';
      voiceBtn.innerHTML = '<span>🎤</span> <span>Tell us your problem</span>';
      showToast('Voice Assistant', 'Voice not supported or permitted. Please type your problem.', 'warning');
    }
  });

  voiceBtn?.addEventListener('click', () => {
    voiceAssistant.startListening();
  });

  guideBtn.addEventListener('click', () => {
    const text = input?.value?.trim();
    if (!text) {
      showToast('Input Required', 'Please describe your health problem or symptoms', 'warning');
      return;
    }
    renderSanjeevGuidance(text, resultBox);
  });

  input?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') guideBtn.click();
  });
}

function renderSanjeevGuidance(text, container) {
  const lower = text.toLowerCase();
  
  // Rule categorization for emergency vs clinical vs self care
  const isUrgent = ['chest', 'heart', 'breath', 'stroke', 'bleed', 'unconscious', 'faint', 'chok', 'paraly', 'trauma', 'burn', 'छाती', 'सांस', 'खून', 'दौरा', 'छातीत', 'श्वास', 'बेशुद्ध'].some(kw => lower.includes(kw));
  const isModerate = ['fever', 'vomit', 'diarrhea', 'stomach', 'fracture', 'rash', 'pain', 'cough', 'headache', 'बुखार', 'उल्टी', 'दस्त', 'पेट', 'खांसी', 'ताप', 'उलटी', 'जुलाब', 'पोटदुखी', 'खोकला'].some(kw => lower.includes(kw));

  let urgency, careType, facility, steps, isEmergency = false;

  if (isUrgent) {
    isEmergency = true;
    urgency = { label: 'High / Critical Urgency (Level 3)', badge: 'badge-danger', color: '#EF4444' };
    careType = 'District Hospital Emergency / Trauma Centre';
    facility = { name: 'District Civil Hospital (24x7 Emergency & ICU)', phone: '020-26127394', distance: '4.2 km' };
    steps = 'Do not wait. Rest quietly and keep calm. Activate Medical SOS to request emergency transport or dial 108 immediately.';
  } else if (isModerate) {
    urgency = { label: 'Moderate Urgency / Clinical Visit (Level 2)', badge: 'badge-warning', color: '#F59E0B' };
    careType = 'Primary Health Centre (PHC) / Community Health Centre (CHC)';
    facility = { name: 'Community Health Centre (CHC) - Rural Block', phone: '02132-222045', distance: '7.8 km' };
    steps = 'A physical clinical examination is advised. Visit your nearest PHC or schedule an appointment with a doctor for diagnosis.';
  } else {
    urgency = { label: 'Mild Symptoms / Self-Care (Level 1)', badge: 'badge-success', color: '#10B981' };
    careType = 'Home Care & Hydration';
    facility = { name: 'Primary Health Centre (PHC) Village OPD', phone: '02132-242100', distance: '3.1 km' };
    steps = 'Rest adequately and maintain proper hydration. If symptoms worsen or persist for more than 48 hours, seek clinical consultation.';
  }

  container.style.display = 'block';
  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
      <div>
        <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: var(--text-secondary);">Sanjeev Astra AI Recommendation</div>
        <h4 style="font-size: 1.15rem; font-weight: 700; color: ${urgency.color}; margin: 2px 0 0;">
          ${isEmergency ? '🚨 Urgent Emergency Attention Needed' : '⚕️ Healthcare Navigation Guidance'}
        </h4>
      </div>
      <span class="badge ${urgency.badge}" style="font-size: 0.8rem; font-weight: 700;">${urgency.label}</span>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
      <div style="padding: 10px 14px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--background);">
        <div style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 600;">Recommended Care Type</div>
        <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary); margin-top: 2px;">${careType}</div>
      </div>
      <div style="padding: 10px 14px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--background);">
        <div style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 600;">Nearby Relevant Facility</div>
        <div style="font-weight: 700; font-size: 0.95rem; color: var(--primary); margin-top: 2px;">${facility.name}</div>
        <div style="font-size: 0.75rem; color: var(--text-secondary);">Distance: ${facility.distance} • 📞 ${facility.phone}</div>
      </div>
    </div>

    <div style="font-size: 0.85rem; line-height: 1.5; color: var(--text-primary); margin-bottom: 14px;">
      <strong>Suggested Next Steps:</strong> ${steps}
    </div>

    <div style="display: flex; gap: 10px; flex-wrap: wrap; border-top: 1px solid var(--border); padding-top: 12px;">
      ${isEmergency ? `
        <button class="btn btn-danger" id="sanjeev-trigger-sos-btn" style="flex: 1; padding: 10px 16px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <span>🚑</span> <span>Request Medical SOS Now</span>
        </button>
        <a href="tel:108" class="btn btn-secondary" style="padding: 10px 16px; font-weight: 700; text-decoration: none;">
          📞 Dial 108
        </a>
      ` : `
        <a href="/appointments.html" class="btn btn-primary" style="flex: 1; padding: 10px 16px; font-weight: 600; text-decoration: none; text-align: center;">
          📅 Book Consultation / Appointment
        </a>
        <button class="btn btn-secondary" id="sanjeev-trigger-sos-btn" style="padding: 10px 16px; font-weight: 600;">
          🚑 View Emergency SOS
        </button>
      `}
    </div>

    <div style="font-size: 0.7rem; color: var(--text-secondary); margin-top: 10px; line-height: 1.3;">
      <em>Disclaimer: Sanjeev Astra AI provides preliminary healthcare navigation and level-of-care guidance. It does not provide medical diagnoses. Always consult a qualified physician.</em>
    </div>
  `;

  container.querySelector('#sanjeev-trigger-sos-btn')?.addEventListener('click', () => {
    triggerMedicalSos();
  });
}

// Load summary metrics, checklist, and charts (with IndexedDB offline fallback)
async function loadDashboardData() {
  let storedUser = null;
  try {
    storedUser = JSON.parse(localStorage.getItem('user') || '{}');
  } catch (e) {}
  const userId = storedUser?._id || storedUser?.id;

  // 1. Fetch medicines
  const medRes = await apiFetch('/medicines');
  if (medRes.success && Array.isArray(medRes.data)) {
    activeMedicines = medRes.data;
    if (userId) {
      await offlineStorage.cacheMedicines(userId, activeMedicines);
    }
  } else if (userId) {
    // Offline fallback from IndexedDB
    activeMedicines = await offlineStorage.getMedicines(userId);
  }

  const statMedEl = document.getElementById('stat-medicines');
  if (statMedEl) statMedEl.textContent = activeMedicines.length;

  // 2. Fetch appointments
  const apptRes = await apiFetch('/appointments');
  if (apptRes.success && Array.isArray(apptRes.data)) {
    activeAppointments = apptRes.data.filter(a => a.status === 'Scheduled');
    if (userId) {
      await offlineStorage.cacheAppointments(userId, apptRes.data);
    }
  } else if (userId) {
    // Offline fallback from IndexedDB
    const cachedAppts = await offlineStorage.getAppointments(userId);
    activeAppointments = cachedAppts.filter(a => a.status === 'Scheduled' || a.isOfflineDraft);
  }

  const statApptEl = document.getElementById('stat-appointments');
  if (statApptEl) statApptEl.textContent = activeAppointments.length;

  // 3. Compile compliance percentages & render checklist
  buildTodayChecklist();
  calculateAdherenceTrend();

  // Save compiled dashboard summary to IndexedDB
  if (userId) {
    await offlineStorage.saveDashboardSummary(userId, {
      medicinesCount: activeMedicines.length,
      appointmentsCount: activeAppointments.length,
      compliancePercent: 0
    });
  }
}

// Build checklist of medications scheduled for today (YYYY-MM-DD)
function buildTodayChecklist() {
  const container = document.getElementById('checklist-today');
  if (!container) return;

  const todayStr = new Date().toISOString().split('T')[0];
  const checklistItems = [];

  // Parse each medicine schedule to see if it qualifies for today
  activeMedicines.forEach(med => {
    // Check if within start and end dates
    const start = new Date(med.startDate).toISOString().split('T')[0];
    const end = med.endDate ? new Date(med.endDate).toISOString().split('T')[0] : null;

    if (todayStr >= start && (!end || todayStr <= end)) {
      med.timings.forEach(slot => {
        // Find existing history log for today & slot
        const log = med.history.find(h => h.date === todayStr && h.timeSlot === slot);
        checklistItems.push({
          medId: med._id,
          name: med.name,
          dosage: med.dosage,
          instructions: med.instructions,
          timeSlot: slot,
          status: log ? log.status : 'Pending'
        });
      });
    }
  });

  // Render checklist container
  if (checklistItems.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">No medications today</div>
        <div class="empty-subtitle">You have no active medications scheduled for today's slots.</div>
        <a href="/medicines.html" class="btn btn-primary btn-icon"><i data-lucide="plus"></i> Add Medicine</a>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    document.getElementById('checklist-summary').textContent = '0 left';
    return;
  }

  // Count pending items
  const pendingCount = checklistItems.filter(i => i.status === 'Pending').length;
  document.getElementById('checklist-summary').textContent = `${pendingCount} left`;
  document.getElementById('checklist-summary').className = `badge ${pendingCount === 0 ? 'badge-success' : 'badge-warning'}`;

  container.innerHTML = checklistItems.map(item => {
    let statusClass = '';
    let buttonsHtml = '';
    
    if (item.status === 'Taken') {
      statusClass = 'done';
      buttonsHtml = `
        <span class="badge badge-success"><i data-lucide="check" style="width: 14px; height: 14px;"></i> Taken</span>
        <button class="btn btn-secondary btn-icon btn-log" data-id="${item.medId}" data-slot="${item.timeSlot}" data-status="Pending" title="Reset Status">
          <i data-lucide="rotate-ccw" style="width: 14px; height: 14px;"></i>
        </button>
      `;
    } else if (item.status === 'Missed') {
      statusClass = 'missed';
      buttonsHtml = `
        <span class="badge badge-danger">Missed</span>
        <button class="btn btn-secondary btn-icon btn-log" data-id="${item.medId}" data-slot="${item.timeSlot}" data-status="Taken" title="Mark Taken">
          <i data-lucide="check" style="width: 14px; height: 14px;"></i>
        </button>
      `;
    } else {
      buttonsHtml = `
        <button class="btn btn-primary btn-icon btn-log" data-id="${item.medId}" data-slot="${item.timeSlot}" data-status="Taken">
          <i data-lucide="check" style="width: 14px; height: 14px;"></i> Taken
        </button>
        <button class="btn btn-danger btn-icon btn-log" data-id="${item.medId}" data-slot="${item.timeSlot}" data-status="Missed">
          <i data-lucide="x" style="width: 14px; height: 14px;"></i> Missed
        </button>
      `;
    }

    return `
      <div class="checklist-item ${statusClass}">
        <div class="checklist-info">
          <div class="checklist-title">${item.name} <span style="font-size: 0.8rem; font-weight: normal; color: var(--text-secondary);">(${item.dosage})</span></div>
          <div class="checklist-meta">${item.timeSlot} slot • ${item.instructions || 'No instructions'}</div>
        </div>
        <div class="checklist-actions">
          ${buttonsHtml}
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();

  // Attach event handlers to buttons
  container.querySelectorAll('.btn-log').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const target = e.currentTarget;
      const id = target.getAttribute('data-id');
      const slot = target.getAttribute('data-slot');
      const status = target.getAttribute('data-status');

      const res = await apiFetch(`/medicines/${id}/log`, {
        method: 'POST',
        body: { date: todayStr, timeSlot: slot, status }
      });

      if (res.success) {
        if (status === 'Taken') {
          triggerReminderAudio();
          showToast('Adherence Saved', 'Medication marked as taken!', 'success');
        }
        loadDashboardData();
      } else {
        showToast('Error', res.error, 'error');
      }
    });
  });
}

// Calculate adherence over the past 7 days and draw chart.js visual
function calculateAdherenceTrend() {
  const complianceText = document.getElementById('compliance-text');
  const complianceRing = document.getElementById('compliance-ring');

  const daysLabel = [];
  const complianceData = [];

  const now = new Date();
  
  // Calculate stats for the last 7 days
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(now.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    
    // Day label (e.g. Mon, Tue)
    daysLabel.push(d.toLocaleDateString([], { weekday: 'short' }));

    // Count scheduled medicines on this day
    let totalScheduled = 0;
    let totalTaken = 0;

    activeMedicines.forEach(med => {
      const start = new Date(med.startDate).toISOString().split('T')[0];
      const end = med.endDate ? new Date(med.endDate).toISOString().split('T')[0] : null;

      if (dateStr >= start && (!end || dateStr <= end)) {
        med.timings.forEach(slot => {
          totalScheduled++;
          const log = med.history.find(h => h.date === dateStr && h.timeSlot === slot);
          if (log && log.status === 'Taken') {
            totalTaken++;
          }
        });
      }
    });

    const rate = totalScheduled > 0 ? Math.round((totalTaken / totalScheduled) * 100) : 100;
    complianceData.push(rate);
  }

  // Calculate current today/weekly average compliance
  const sum = complianceData.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / complianceData.length);
  
  if (complianceText) complianceText.textContent = `${avg}%`;
  
  // Set SVG progress ring stroke offset (circumference = 201.06)
  if (complianceRing) {
    const offset = 201.06 - (avg / 100) * 201.06;
    complianceRing.style.strokeDashoffset = offset;
  }

  // Draw/update Chart.js Adherence Curve
  const ctx = document.getElementById('adherence-chart');
  if (!ctx) return;

  if (chartInstance) {
    chartInstance.destroy();
  }

  const isDark = document.body.classList.contains('dark');
  const gridColor = isDark ? '#1F2937' : '#E2E8F0';
  const textColor = isDark ? '#94A3B8' : '#64748B';

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: daysLabel,
      datasets: [{
        label: 'Adherence Rate (%)',
        data: complianceData,
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 3,
        tension: 0.3,
        fill: true,
        pointBackgroundColor: '#3B82F6',
        pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          grid: { color: gridColor },
          ticks: { color: textColor, font: { family: 'Inter' } }
        },
        x: {
          grid: { display: false },
          ticks: { color: textColor, font: { family: 'Inter' } }
        }
      }
    }
  });
}

// Emergency Modal Drawer integration
function setupEmergencyModal() {
  const triggerBtn = document.getElementById('btn-trigger-emergency');
  const modal = document.getElementById('emergency-modal');
  const closeBtn = document.getElementById('emergency-modal-close');

  if (!triggerBtn || !modal) return;

  triggerBtn.addEventListener('click', async () => {
    // Fetch profile data
    const res = await apiFetch('/auth/me');
    if (res.success && res.data) {
      const user = res.data;
      
      document.getElementById('emerg-name').textContent = user.name || 'Patient';
      document.getElementById('emerg-avatar').textContent = (user.name || 'P').charAt(0).toUpperCase();
      document.getElementById('emerg-blood').textContent = user.bloodGroup || 'Not specified';
      
      const ageStr = user.age ? `${user.age} Years` : 'Age unknown';
      const genderStr = user.gender ? `, ${user.gender}` : '';
      document.getElementById('emerg-age').textContent = `${ageStr}${genderStr}`;

      // Render Allergies
      const allergyContainer = document.getElementById('emerg-allergies');
      if (user.allergies && user.allergies.length > 0) {
        allergyContainer.innerHTML = user.allergies.map(a => `<span class="badge badge-danger">${a}</span>`).join('');
      } else {
        allergyContainer.innerHTML = `<span class="badge badge-success">No allergies listed</span>`;
      }

      // Render Conditions
      const conditionContainer = document.getElementById('emerg-conditions');
      if (user.conditions && user.conditions.length > 0) {
        conditionContainer.innerHTML = user.conditions.map(c => `<span class="badge badge-warning">${c}</span>`).join('');
      } else {
        conditionContainer.innerHTML = `<span class="badge badge-success">No chronic conditions listed</span>`;
      }

      // Render Emergency Contacts
      const contactContainer = document.getElementById('emerg-contacts');
      if (user.emergencyContacts && user.emergencyContacts.length > 0) {
        contactContainer.innerHTML = user.emergencyContacts.map(c => `
          <div style="padding: 12px; background-color: var(--background); border: 1px solid var(--border); border-radius: var(--radius-md); display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 600; font-size: 0.9rem;">${c.name} (${c.relationship})</div>
              <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px;">Phone: ${c.phone}</div>
            </div>
            <a href="tel:${c.phone}" class="btn btn-secondary btn-icon" style="border-radius: var(--radius-full);">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--primary)" stroke-width="2" fill="none"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            </a>
          </div>
        `).join('');
      } else {
        contactContainer.innerHTML = `<div style="font-size: 0.85rem; color: var(--text-secondary); text-align: center; padding: 10px; border: 1px dashed var(--border); border-radius: var(--radius-md);">No emergency contacts configured. Please configure in profile settings.</div>`;
      }

      modal.classList.add('open');
    }
  });

  const closeModal = () => modal.classList.remove('open');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
}

// Hydration Tracker state logic (stored locally per browser session/cache)
function setupWaterTracker() {
  const countEl = document.getElementById('water-count');
  const addBtn = document.getElementById('btn-add-water');
  if (!countEl || !addBtn) return;

  const todayKey = `water_${new Date().toISOString().split('T')[0]}`;
  let glasses = parseInt(localStorage.getItem(todayKey)) || 0;

  countEl.textContent = `${glasses} / 8 glasses`;

  addBtn.addEventListener('click', () => {
    glasses = (glasses + 1) % 12; // cap at 11 or rotate
    localStorage.setItem(todayKey, glasses);
    countEl.textContent = `${glasses} / 8 glasses`;
    
    if (glasses === 8) {
      triggerReminderAudio();
      showToast('Hydrated!', 'Great job! You met your daily water intake goal of 8 glasses!', 'success');
    } else {
      showToast('Water Logged', 'Stay hydrated!', 'info');
    }
  });
}

// 🛡️ Community First Responder Mode Handler
async function setupResponderMode() {
  const toggleBtn = document.getElementById('btn-toggle-responder');
  const statusPill = document.getElementById('responder-status-pill');
  const label = document.getElementById('responder-toggle-label');

  if (!toggleBtn || !statusPill) return;

  let isAvailable = false;

  const updateUI = (active) => {
    isAvailable = active;
    if (active) {
      statusPill.textContent = 'ACTIVE (ONLINE)';
      statusPill.className = 'badge badge-success';
      if (label) label.textContent = 'Go Offline / Stop Responding';
      toggleBtn.className = 'btn btn-outline';
      toggleBtn.style.borderColor = 'var(--error)';
      toggleBtn.style.color = 'var(--error)';
    } else {
      statusPill.textContent = 'OFFLINE';
      statusPill.className = 'badge badge-secondary';
      if (label) label.textContent = 'Opt In as Nearby Responder';
      toggleBtn.className = 'btn btn-secondary';
      toggleBtn.style.borderColor = '';
      toggleBtn.style.color = '';
    }
  };

  // Fetch initial profile
  try {
    const res = await apiFetch('/sos/responder/profile');
    if (res && res.success && res.data && res.data.isAvailable) {
      updateUI(true);
    }
  } catch (e) {
    console.warn('Could not fetch responder profile:', e);
  }

  toggleBtn.addEventListener('click', async () => {
    if (isAvailable) {
      // Opt out
      toggleBtn.disabled = true;
      const res = await apiFetch('/sos/responder/opt-out', { method: 'POST' });
      toggleBtn.disabled = false;
      if (res.success) {
        updateUI(false);
        showToast('Responder Offline', 'You are now offline and will not receive alerts', 'info');
      } else {
        showToast('Error', res.error, 'error');
      }
    } else {
      // Opt in: capture coordinates
      toggleBtn.disabled = true;
      if (!navigator.geolocation) {
        showToast('Geolocation Required', 'Geolocation is required to opt in as a responder', 'warning');
        toggleBtn.disabled = false;
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const res = await apiFetch('/sos/responder/opt-in', {
            method: 'POST',
            body: {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              searchRadiusKm: 15
            }
          });
          toggleBtn.disabled = false;
          if (res.success) {
            updateUI(true);
            showToast('Responder Mode Active', 'You are now active to receive nearby medical emergency alerts!', 'success');
          } else {
            showToast('Opt-In Failed', res.error, 'error');
          }
        },
        (err) => {
          toggleBtn.disabled = false;
          showToast('Location Required', `Could not obtain GPS location: ${err.message}`, 'warning');
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    }
  });
}
