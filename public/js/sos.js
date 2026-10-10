/* Sanjeev Astra Medical SOS Emergency Controller */
import { apiFetch, showToast } from './api.js';
import { t, getLanguage } from './i18n.js';
import { VoiceAssistant } from './voice.js';

const OFFLINE_QUEUE_KEY = 'swasthya_offline_sos_queue';
const CACHED_FACILITIES_KEY = 'swasthya_cached_facilities';

// Default fallback demo facilities for offline use
const DEFAULT_FALLBACK_FACILITIES = [
  {
    id: 'fac-dh-01',
    name: 'District Civil Hospital',
    type: 'District Hospital (Tertiary & Trauma)',
    address: 'Station Road, District HQ',
    latitude: 18.5204,
    longitude: 73.8567,
    services: ['24x7 Emergency', 'ICU', 'Trauma Care', 'Blood Bank'],
    phone: '020-26127394',
    distanceKm: 4.2
  },
  {
    id: 'fac-chc-03',
    name: 'Community Health Centre (CHC)',
    type: 'Community Health Centre (Rural Block)',
    address: 'Near Panchayat Samiti, Rural Block',
    latitude: 19.2064,
    longitude: 73.8763,
    services: ['Emergency Stabilization', 'Maternity', 'Pharmacy'],
    phone: '02132-222045',
    distanceKm: 7.8
  }
];

class SosManager {
  constructor() {
    this.currentPosition = null;
    this.locationPermissionDenied = false;
    this.activeSos = null;
    this.nearbyFacilities = [];
    this.selectedFacility = null;
    this.leafletMap = null;
    this.markers = {};
    this.voiceAssistant = null;

    this.init();
  }

  init() {
    // 1. Ensure modal backdrop exists in DOM
    this.ensureModalDOM();

    // 2. Setup offline/online sync listeners
    this.setupNetworkListeners();

    // 3. Check for any existing active SOS on server
    this.checkActiveSos();

    // 4. Listen for language changes to update SOS modal if open
    window.addEventListener('swasthya:languageChanged', () => {
      if (this.isModalOpen()) {
        this.renderModalContent();
      }
    });
  }

  // Network sync and offline queue handlers
  setupNetworkListeners() {
    window.addEventListener('online', () => {
      this.syncOfflineQueue();
      showToast(t('common.success'), t('sos.syncSuccess'), 'success');
    });

    window.addEventListener('offline', () => {
      showToast(t('common.warning'), t('sos.offlineNotice'), 'warning');
    });
  }

  // Check if active SOS already exists for this patient
  async checkActiveSos() {
    try {
      const token = typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function' ? localStorage.getItem('token') : null;
      if (!token) return;

      const res = await apiFetch('/sos/active');
      if (res && res.success && res.data) {
        this.activeSos = res.data;
        this.updateActiveSosBanner();
      }
    } catch (e) {
      console.warn('Failed to check active SOS:', e);
    }
  }

  // Ensure SOS Modal Container exists in document
  ensureModalDOM() {
    if (document.getElementById('sos-modal-root')) return;

    const modalRoot = document.createElement('div');
    modalRoot.id = 'sos-modal-root';
    modalRoot.className = 'modal-backdrop';
    modalRoot.style.display = 'none';
    modalRoot.innerHTML = `
      <div class="modal-dialog sos-modal-dialog" style="max-width: 680px; border-radius: var(--radius-xl); overflow: hidden; border: 2px solid var(--error); padding: 0; background: var(--surface); box-shadow: 0 25px 50px -12px rgba(239, 68, 68, 0.25);">
        <div id="sos-modal-header" style="background: linear-gradient(135deg, #EF4444, #B91C1C); color: white; padding: 18px 24px; display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 36px; height: 36px; border-radius: 50%; background: rgba(255, 255, 255, 0.2); display: flex; align-items: center; justify-content: center; font-size: 1.25rem;">🚑</div>
            <div>
              <h3 style="color: white; margin: 0; font-size: 1.25rem; font-weight: 700; letter-spacing: -0.02em;" data-i18n="sos.modalTitle">EMERGENCY MEDICAL SOS</h3>
              <p style="color: rgba(255, 255, 255, 0.85); margin: 2px 0 0; font-size: 0.75rem;" data-i18n="sos.prototypeNotice">Prototype ambulance coordination • Demo ambulance availability</p>
            </div>
          </div>
          <button id="sos-modal-close" style="background: none; border: none; color: white; font-size: 1.8rem; cursor: pointer; line-height: 1; padding: 0 6px;">&times;</button>
        </div>

        <div id="sos-modal-body" style="padding: 24px; max-height: calc(85vh - 75px); overflow-y: auto;">
          <!-- Dynamically populated -->
        </div>
      </div>
    `;

    if (document.body && typeof document.body.appendChild === 'function') {
      document.body.appendChild(modalRoot);
    }

    // Bind close events
    const closeBtn = modalRoot.querySelector('#sos-modal-close');
    if (closeBtn && typeof closeBtn.addEventListener === 'function') {
      closeBtn.addEventListener('click', () => this.closeModal());
    }

    modalRoot.addEventListener('click', (e) => {
      if (e.target === modalRoot) {
        this.closeModal();
      }
    });
  }

  isModalOpen() {
    const root = document.getElementById('sos-modal-root');
    return root && root.classList.contains('open');
  }

  openModal() {
    const root = document.getElementById('sos-modal-root');
    if (!root) return;

    root.style.display = 'flex';
    root.style.zIndex = '2500';
    setTimeout(() => {
      root.classList.add('open');
    }, 10);
    document.body.style.overflow = 'hidden';

    // Start geolocation capture proactively
    this.requestLocation();

    // Render appropriate state
    this.renderModalContent();
  }

  closeModal() {
    const root = document.getElementById('sos-modal-root');
    if (root) {
      root.classList.remove('open');
      setTimeout(() => {
        if (!root.classList.contains('open')) root.style.display = 'none';
      }, 250);
    }
    document.body.style.overflow = '';
  }

  // Request browser location without faking GPS
  requestLocation(callback) {
    if (!navigator.geolocation) {
      this.locationPermissionDenied = true;
      this.fetchFacilities();
      if (callback) callback();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.currentPosition = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
        this.locationPermissionDenied = false;
        this.fetchFacilities();
        if (callback) callback();
      },
      (err) => {
        console.warn('Geolocation denied or error:', err.message);
        this.locationPermissionDenied = true;
        this.fetchFacilities();
        if (callback) callback();
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  }

  // Fetch facilities based on coordinates or fallback
  async fetchFacilities() {
    let url = '/sos/facilities/nearby';
    if (this.currentPosition) {
      url += `?lat=${this.currentPosition.latitude}&lng=${this.currentPosition.longitude}`;
    }

    try {
      if (navigator.onLine) {
        const res = await apiFetch(url);
        if (res && res.success && res.data) {
          this.nearbyFacilities = res.data;
          this.selectedFacility = this.nearbyFacilities[0] || null;
          localStorage.setItem(CACHED_FACILITIES_KEY, JSON.stringify(this.nearbyFacilities));
          return;
        }
      }
    } catch (e) {
      console.warn('Error fetching facilities:', e);
    }

    // Offline / fallback cache
    const cached = localStorage.getItem(CACHED_FACILITIES_KEY);
    this.nearbyFacilities = cached ? JSON.parse(cached) : DEFAULT_FALLBACK_FACILITIES;
    this.selectedFacility = this.nearbyFacilities[0] || null;
  }

  // Render view depending on whether there is an active SOS or new request
  renderModalContent() {
    const body = document.getElementById('sos-modal-body');
    if (!body) return;

    if (this.activeSos && ['REQUESTED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'ESCALATED'].includes(this.activeSos.status)) {
      this.renderActiveTrackingView(body);
    } else {
      this.renderInitialEmergencyView(body);
    }
  }

  // Initial Emergency View with 4 Big Rural-Friendly Buttons
  renderInitialEmergencyView(container) {
    const isOffline = !navigator.onLine;

    container.innerHTML = `
      <!-- Safety Disclaimer Alert Banner -->
      <div style="background-color: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: var(--radius-md); padding: 12px 16px; margin-bottom: 20px; display: flex; gap: 12px; align-items: flex-start;">
        <span style="font-size: 1.3rem;">⚠️</span>
        <div style="font-size: 0.8rem; color: #B91C1C; line-height: 1.4;">
          <strong data-i18n="app.name">Sanjeev Astra</strong> • <span data-i18n="sos.safetyDisclaimer">Medical SOS is intended to connect you with emergency assistance. In a life-threatening situation, contact local emergency services immediately.</span>
        </div>
      </div>

      ${isOffline ? `
        <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: var(--radius-md); padding: 12px 16px; margin-bottom: 20px; display: flex; gap: 10px; align-items: center;">
          <span style="font-size: 1.2rem;">📡</span>
          <div style="font-size: 0.8rem; color: #B45309;">
            <strong data-i18n="sos.offlineNotice">Internet connection unavailable. Your SOS request cannot be confirmed online.</strong>
            <div data-i18n="sos.offlineActionHelp">Please use immediate emergency dial hotlines below while offline:</div>
          </div>
        </div>
      ` : ''}

      <!-- Question Prompt -->
      <div style="text-align: center; margin-bottom: 24px;">
        <h4 style="font-size: 1.35rem; font-weight: 700; color: var(--text-primary); margin: 0 0 6px;" data-i18n="sos.question">Are you experiencing a medical emergency?</h4>
        <p style="color: var(--text-secondary); font-size: 0.9rem; margin: 0;" data-i18n="sos.subQuestion">Select the type of help you need immediately:</p>
      </div>

      <!-- 4 High-Contrast Large Touch Options -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
        <!-- Option 1: Request Ambulance -->
        <button id="sos-btn-ambulance" class="sos-action-card" style="display: flex; flex-direction: column; align-items: center; text-align: center; padding: 22px 16px; border: 2px solid var(--error); border-radius: var(--radius-lg); background: rgba(239, 68, 68, 0.04); cursor: pointer; transition: var(--transition);">
          <div style="width: 52px; height: 52px; border-radius: 50%; background: #EF4444; color: white; display: flex; align-items: center; justify-content: center; font-size: 1.6rem; margin-bottom: 12px; box-shadow: 0 4px 10px rgba(239, 68, 68, 0.3);">🚑</div>
          <span style="font-size: 1.05rem; font-weight: 700; color: #EF4444;" data-i18n="sos.requestAmbulance">Request Ambulance</span>
          <span style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 4px;" data-i18n="sos.requestAmbulanceSub">Dispatch nearest emergency transport</span>
        </button>

        <!-- Option 2: Find Nearest Hospital -->
        <button id="sos-btn-hospital" class="sos-action-card" style="display: flex; flex-direction: column; align-items: center; text-align: center; padding: 22px 16px; border: 2px solid var(--primary); border-radius: var(--radius-lg); background: rgba(59, 130, 246, 0.04); cursor: pointer; transition: var(--transition);">
          <div style="width: 52px; height: 52px; border-radius: 50%; background: var(--primary); color: white; display: flex; align-items: center; justify-content: center; font-size: 1.6rem; margin-bottom: 12px; box-shadow: 0 4px 10px rgba(59, 130, 246, 0.3);">🏥</div>
          <span style="font-size: 1.05rem; font-weight: 700; color: var(--primary);" data-i18n="sos.findHospital">Find Nearest Hospital</span>
          <span style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 4px;" data-i18n="sos.findHospitalSub">Locate nearby emergency rooms & clinics</span>
        </button>

        <!-- Option 3: Need Medical Help (Voice / Guidance) -->
        <button id="sos-btn-voice-help" class="sos-action-card" style="display: flex; flex-direction: column; align-items: center; text-align: center; padding: 22px 16px; border: 2px solid var(--secondary); border-radius: var(--radius-lg); background: rgba(6, 182, 212, 0.04); cursor: pointer; transition: var(--transition);">
          <div style="width: 52px; height: 52px; border-radius: 50%; background: var(--secondary); color: white; display: flex; align-items: center; justify-content: center; font-size: 1.6rem; margin-bottom: 12px; box-shadow: 0 4px 10px rgba(6, 182, 212, 0.3);">🧑‍⚕️</div>
          <span style="font-size: 1.05rem; font-weight: 700; color: var(--secondary);" data-i18n="sos.needMedicalHelp">Need Medical Help</span>
          <span style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 4px;" data-i18n="sos.needMedicalHelpSub">Speak or describe symptoms for guidance</span>
        </button>

        <!-- Option 4: Emergency Contact / Hotline Speed-Dial -->
        <button id="sos-btn-contacts" class="sos-action-card" style="display: flex; flex-direction: column; align-items: center; text-align: center; padding: 22px 16px; border: 2px solid var(--warning); border-radius: var(--radius-lg); background: rgba(245, 158, 11, 0.04); cursor: pointer; transition: var(--transition);">
          <div style="width: 52px; height: 52px; border-radius: 50%; background: var(--warning); color: white; display: flex; align-items: center; justify-content: center; font-size: 1.6rem; margin-bottom: 12px; box-shadow: 0 4px 10px rgba(245, 158, 11, 0.3);">📞</div>
          <span style="font-size: 1.05rem; font-weight: 700; color: #D97706;" data-i18n="sos.emergencyContact">Emergency Contacts</span>
          <span style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 4px;" data-i18n="sos.emergencyContactSub">Alert family and dial helpline 112 / 108</span>
        </button>
      </div>

      <!-- Quick National Emergency Dial Banner -->
      <div style="display: flex; gap: 12px;">
        <a href="tel:112" class="btn" style="flex: 1; background: #EF4444; color: white; font-weight: 700; padding: 14px; border-radius: var(--radius-md); text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.95rem;">
          <span>📞</span> <span data-i18n="dashboard.dialEmergency">DIAL NATIONAL EMERGENCY (112)</span>
        </a>
        <a href="tel:108" class="btn" style="flex: 1; background: #2563EB; color: white; font-weight: 700; padding: 14px; border-radius: var(--radius-md); text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.95rem;">
          <span>🚑</span> <span data-i18n="dashboard.dialAmbulance">DIAL AMBULANCE (108)</span>
        </a>
      </div>
    `;

    // Bind Option Clicks
    container.querySelector('#sos-btn-ambulance').addEventListener('click', () => {
      this.renderAmbulanceConfirmView(container);
    });

    container.querySelector('#sos-btn-hospital').addEventListener('click', () => {
      this.renderHospitalListView(container);
    });

    container.querySelector('#sos-btn-voice-help').addEventListener('click', () => {
      this.renderVoiceGuidanceView(container);
    });

    container.querySelector('#sos-btn-contacts').addEventListener('click', () => {
      this.renderContactsView(container);
    });
  }

  // Step 2: Ambulance Dispatch Confirmation View with Location Status & Facility Selector
  renderAmbulanceConfirmView(container) {
    const isOffline = !navigator.onLine;

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <button id="sos-btn-back" class="btn btn-secondary" style="font-size: 0.85rem; padding: 6px 14px;">
          ← <span data-i18n="common.back">Back</span>
        </button>
        <span class="badge badge-danger" style="font-size: 0.8rem; font-weight: 600;" data-i18n="sos.requestAmbulance">Request Ambulance</span>
      </div>

      <!-- Location Detection Box -->
      <div style="background: var(--background); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 16px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <strong style="font-size: 0.9rem;" data-i18n="sos.locationStatus">Location Status</strong>
          <span id="sos-loc-status-pill" class="badge ${this.currentPosition ? 'badge-success' : (this.locationPermissionDenied ? 'badge-danger' : 'badge-warning')}">
            ${this.currentPosition ? t('sos.locationGranted') : (this.locationPermissionDenied ? t('common.error') : t('sos.detectingLocation'))}
          </span>
        </div>

        <div id="sos-location-detail" style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.4;">
          ${this.currentPosition 
            ? `📍 Coordinates: ${this.currentPosition.latitude.toFixed(4)}, ${this.currentPosition.longitude.toFixed(4)} (Accuracy: ~${Math.round(this.currentPosition.accuracy || 10)}m)`
            : (this.locationPermissionDenied 
              ? `<div style="color: #DC2626;">⚠️ ${t('sos.locationDenied')}</div>`
              : `⏳ ${t('sos.detectingLocation')}`
            )
          }
        </div>
      </div>

      <!-- Destination Facility Selector -->
      <div style="margin-bottom: 20px;">
        <label style="display: block; font-size: 0.9rem; font-weight: 600; margin-bottom: 8px;" data-i18n="sos.selectDestination">Select Destination Healthcare Facility</label>
        <div id="facility-options-list" style="display: flex; flex-direction: column; gap: 10px; max-height: 220px; overflow-y: auto;">
          ${this.nearbyFacilities.map((fac, idx) => `
            <div class="facility-choice-card ${this.selectedFacility && this.selectedFacility.id === fac.id ? 'active' : ''}" data-id="${fac.id}" style="padding: 12px 16px; border: 2px solid ${this.selectedFacility && this.selectedFacility.id === fac.id ? 'var(--primary)' : 'var(--border)'}; border-radius: var(--radius-md); background: ${this.selectedFacility && this.selectedFacility.id === fac.id ? 'rgba(59, 130, 246, 0.05)' : 'var(--surface)'}; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-weight: 600; font-size: 0.95rem;">${fac.name}</div>
                <div style="font-size: 0.75rem; color: var(--text-secondary);">${fac.type} • ${fac.address}</div>
                <div style="font-size: 0.75rem; color: var(--primary); margin-top: 2px;">📞 ${fac.phone}</div>
              </div>
              <div style="text-align: right;">
                <span class="badge badge-info" style="font-size: 0.8rem; font-weight: 700;">${fac.distanceKm ? fac.distanceKm + ' km' : '~4 km'}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      ${isOffline ? `
        <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: var(--radius-md); padding: 12px; margin-bottom: 16px; font-size: 0.8rem; color: #B45309;">
          ⚠️ <strong data-i18n="sos.offlineNotice">Internet connection unavailable.</strong> <span data-i18n="sos.offlineQueued">Request queued locally (LOCAL / PENDING). Will auto-sync when online.</span>
        </div>
      ` : ''}

      <!-- Emergency Confirmation Trigger Button -->
      <button id="sos-btn-confirm-ambulance" class="btn btn-danger" style="width: 100%; padding: 16px; font-size: 1.1rem; font-weight: 700; border-radius: var(--radius-lg); display: flex; align-items: center; justify-content: center; gap: 10px; box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4);">
        <span>🚑</span> <span data-i18n="sos.confirmAmbulance">Confirm & Dispatch Ambulance</span>
      </button>
    `;

    // Facility selection click handlers
    container.querySelectorAll('.facility-choice-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        this.selectedFacility = this.nearbyFacilities.find(f => f.id === id) || this.nearbyFacilities[0];
        this.renderAmbulanceConfirmView(container);
      });
    });

    // Back click
    container.querySelector('#sos-btn-back').addEventListener('click', () => {
      this.renderInitialEmergencyView(container);
    });

    // Confirm dispatch
    container.querySelector('#sos-btn-confirm-ambulance').addEventListener('click', async () => {
      await this.dispatchAmbulanceRequest();
    });
  }

  // Dispatch Ambulance Request (Online API or Offline Local Queue)
  async dispatchAmbulanceRequest() {
    const isOffline = !navigator.onLine;
    const patientUser = JSON.parse(localStorage.getItem('user') || '{}');

    const payload = {
      latitude: this.currentPosition ? this.currentPosition.latitude : null,
      longitude: this.currentPosition ? this.currentPosition.longitude : null,
      locationAddress: this.currentPosition 
        ? `GPS: ${this.currentPosition.latitude.toFixed(4)}, ${this.currentPosition.longitude.toFixed(4)}`
        : 'Manual Selection / Address',
      emergencyType: 'Ambulance',
      destinationFacilityId: this.selectedFacility ? this.selectedFacility.id : 'fac-dh-01',
      patientPhone: patientUser.phone || '',
      isOfflineQueued: isOffline
    };

    if (isOffline) {
      // Offline local queuing
      const offlineSos = {
        _id: 'local-' + Date.now(),
        patientName: patientUser.name || 'Emergency Caller',
        patientPhone: patientUser.phone || '',
        latitude: payload.latitude,
        longitude: payload.longitude,
        locationAddress: payload.locationAddress,
        emergencyType: 'Ambulance',
        destinationFacility: this.selectedFacility || DEFAULT_FALLBACK_FACILITIES[0],
        ambulance: {
          id: 'amb-a01',
          vehicleNumber: 'MH 12 QX 4521 (Demo ALS)',
          driverName: 'Rajesh Patil',
          phone: '+91 98230 11221',
          etaMinutes: 12
        },
        status: 'REQUESTED',
        isOfflineQueued: true,
        timeline: [
          { status: 'REQUESTED', timestamp: new Date(), note: 'Saved in offline local queue' }
        ],
        createdAt: new Date().toISOString()
      };

      // Save to offline queue
      const existingQueue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
      existingQueue.push(payload);
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(existingQueue));

      this.activeSos = offlineSos;
      showToast(t('common.warning'), t('sos.offlineQueued'), 'warning');
      this.renderModalContent();
      this.updateActiveSosBanner();
      return;
    }

    // Online request
    try {
      const res = await apiFetch('/sos', {
        method: 'POST',
        body: payload
      });

      if (res && res.success && res.data) {
        this.activeSos = res.data;
        const count = res.meta ? (res.meta.totalNotifiedCount || res.meta.notifiedUsersCount || res.meta.notifiedRespondersCount) : null;
        const msg = count ? `Emergency alert broadcasted! Notified ${count} nearby community users & emergency responders.` : t('sos.requestCreatedTitle');
        showToast(t('common.success'), msg, 'success');
        this.renderModalContent();
        this.updateActiveSosBanner();
      } else {
        showToast(t('common.error'), res.error || 'Failed to dispatch SOS', 'error');
      }
    } catch (err) {
      console.error('Failed to dispatch SOS:', err);
      showToast(t('common.error'), 'Network error occurred. Saving to offline queue.', 'warning');
    }
  }

  // Active Emergency Tracking Screen (Map, ETA, Ambulance info, Status steps)
  renderActiveTrackingView(container) {
    const sos = this.activeSos;
    if (!sos) return;

    const statusLabels = {
      REQUESTED: { label: t('sos.statusSearching'), color: 'badge-warning', step: 1 },
      ACCEPTED: { label: t('sos.statusAccepted'), color: 'badge-info', step: 2 },
      EN_ROUTE: { label: t('sos.statusEnRoute'), color: 'badge-primary', step: 3 },
      ARRIVED: { label: t('sos.statusArrived'), color: 'badge-success', step: 4 },
      COMPLETED: { label: t('sos.statusCompleted'), color: 'badge-success', step: 5 },
      RESOLVED: { label: 'RESOLVED', color: 'badge-success', step: 5 },
      ESCALATED: { label: 'ESCALATED (DIAL 112 / 108)', color: 'badge-danger', step: 1 },
      CANCELLED: { label: t('sos.statusCancelled'), color: 'badge-danger', step: 0 }
    };

    const currentStatusMeta = statusLabels[sos.status] || statusLabels.REQUESTED;
    const isEscalated = sos.status === 'ESCALATED';
    const hasResponder = sos.assignedResponder && (sos.assignedResponder.name || sos.assignedResponder.user);

    container.innerHTML = `
      ${sos.isOfflineQueued ? `
        <!-- Offline Emergency Warning Banner -->
        <div style="background: rgba(239, 68, 68, 0.15); border: 2px solid #EF4444; border-radius: var(--radius-md); padding: 18px; margin-bottom: 20px;">
          <div style="display: flex; gap: 8px; align-items: center; color: #DC2626; font-weight: 800; font-size: 1.05rem;">
            <span>⚠️</span> DEVICE IS OFFLINE — EMERGENCY NOT DELIVERED TO SERVER
          </div>
          <p style="font-size: 0.88rem; color: var(--text-primary); margin: 8px 0 14px; line-height: 1.5;">
            Your browser cannot dispatch ambulances or notify responders while disconnected from the network. <strong>Please use your device's telephone dialer immediately to call emergency response:</strong>
          </p>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <a href="tel:112" class="btn" style="background: #EF4444; color: white; flex: 1; text-align: center; font-weight: 700; padding: 12px; border-radius: var(--radius-md); text-decoration: none; font-size: 0.95rem;">
              📞 Call 112 (National Emergency)
            </a>
            <a href="tel:108" class="btn" style="background: #2563EB; color: white; flex: 1; text-align: center; font-weight: 700; padding: 12px; border-radius: var(--radius-md); text-decoration: none; font-size: 0.95rem;">
              🚑 Call 108 (Ambulance Dispatch)
            </a>
          </div>
        </div>
      ` : ''}

      ${isEscalated ? `
        <!-- Direct Emergency Escalation Alert -->
        <div style="background: rgba(239, 68, 68, 0.1); border: 2px solid #EF4444; border-radius: var(--radius-md); padding: 16px; margin-bottom: 20px;">
          <div style="display: flex; gap: 8px; align-items: center; color: #DC2626; font-weight: 700; font-size: 1rem;">
            <span>🚨</span> NATIONAL EMERGENCY ESCALATION
          </div>
          <p style="font-size: 0.85rem; color: var(--text-primary); margin: 6px 0 14px; line-height: 1.45;">
            No local community responders were able to accept within the timeout window. For immediate life-saving care, please call national emergency dispatch services immediately:
          </p>
          <div style="display: flex; gap: 10px;">
            <a href="tel:112" class="btn" style="background: #EF4444; color: white; flex: 1; text-align: center; font-weight: 700; padding: 12px; border-radius: var(--radius-md); text-decoration: none; font-size: 0.9rem;">
              📞 Call 112 (National Emergency)
            </a>
            <a href="tel:108" class="btn" style="background: #2563EB; color: white; flex: 1; text-align: center; font-weight: 700; padding: 12px; border-radius: var(--radius-md); text-decoration: none; font-size: 0.9rem;">
              🚑 Call 108 (Ambulance)
            </a>
          </div>
        </div>
      ` : ''}

      ${hasResponder ? `
        <!-- Community First Responder Card -->
        <div style="padding: 14px 18px; border: 1.5px solid var(--primary); border-radius: var(--radius-md); background: rgba(59, 130, 246, 0.05); margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
          <div>
            <div style="font-size: 0.75rem; color: var(--primary); text-transform: uppercase; font-weight: 700; display: flex; align-items: center; gap: 6px;">
              <span>🛡️</span> Assigned Community First Responder
            </div>
            <div style="font-weight: 700; font-size: 1.05rem; margin-top: 2px;">
              ${sos.assignedResponder.name || 'Nearby Responder'}
              <span class="badge badge-info" style="font-size: 0.65rem; text-transform: capitalize; margin-left: 6px;">${sos.assignedResponder.responderType || 'first responder'}</span>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">
              ${sos.assignedResponder.phone ? `Phone: <a href="tel:${sos.assignedResponder.phone}" style="color: var(--primary); font-weight: 600;">${sos.assignedResponder.phone}</a> • ` : ''}
              Accepted At: ${sos.assignedResponder.acceptedAt ? new Date(sos.assignedResponder.acceptedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now'}
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 0.72rem; color: var(--text-secondary);">Responder ETA</div>
            <div style="font-size: 1.25rem; font-weight: 800; color: var(--primary);">~${sos.assignedResponder.etaMinutes || 5} min</div>
          </div>
        </div>
      ` : ''}

      <!-- Emergency Header Status -->
      <div style="background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.15); border-radius: var(--radius-lg); padding: 18px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div>
            <span style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: var(--text-secondary);" data-i18n="common.status">Status</span>
            <div style="font-size: 1.15rem; font-weight: 700; color: #EF4444; margin-top: 2px;">
              ${sos.isOfflineQueued ? '<span class="badge badge-warning" style="margin-right: 6px;">LOCAL / PENDING</span>' : '<span class="badge badge-success" style="margin-right: 6px;">SERVER CONFIRMED</span>'}
              ${currentStatusMeta.label}
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 0.75rem; color: var(--text-secondary);" data-i18n="sos.eta">Estimated Arrival</div>
            <div style="font-size: 1.4rem; font-weight: 800; color: var(--primary);" id="sos-eta-val">
              ${sos.ambulance && sos.ambulance.etaMinutes ? sos.ambulance.etaMinutes + ' ' + t('common.minutes') : 'Searching...'}
            </div>
          </div>
        </div>

        <!-- 4-step progress dots -->
        <div style="display: flex; justify-content: space-between; align-items: center; position: relative; margin-top: 14px; padding: 0 10px;">
          <div style="position: absolute; top: 12px; left: 24px; right: 24px; height: 3px; background: var(--border); z-index: 1;"></div>
          ${[
            { num: 1, key: 'Requested', code: 'REQUESTED' },
            { num: 2, key: 'Accepted', code: 'ACCEPTED' },
            { num: 3, key: 'En Route', code: 'EN_ROUTE' },
            { num: 4, key: 'Arrived', code: 'ARRIVED' }
          ].map(s => {
            const isDone = currentStatusMeta.step >= s.num;
            return `
              <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; z-index: 2;">
                <div style="width: 26px; height: 26px; border-radius: 50%; background: ${isDone ? '#EF4444' : 'var(--surface)'}; border: 2px solid ${isDone ? '#EF4444' : 'var(--border)'}; color: ${isDone ? 'white' : 'var(--text-secondary)'}; font-size: 0.75rem; font-weight: 700; display: flex; align-items: center; justify-content: center;">
                  ${isDone ? '✓' : s.num}
                </div>
                <span style="font-size: 0.7rem; font-weight: 600; color: ${isDone ? '#EF4444' : 'var(--text-secondary)'};">${s.key}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Interactive Map Frame -->
      <div style="margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-weight: 600; font-size: 0.9rem;" data-i18n="sos.viewMap">Live Coordination Map</span>
          <span style="font-size: 0.75rem; color: var(--text-secondary);" data-i18n="sos.prototypeNotice">Prototype ambulance coordination</span>
        </div>
        <div id="sos-leaflet-map" style="width: 100%; height: 240px; border-radius: var(--radius-md); border: 1px solid var(--border); background: #E2E8F0; position: relative; overflow: hidden;">
          <!-- Leaflet or fallback schematic map loaded here -->
        </div>
      </div>

      <!-- Ambulance & Destination Metadata Cards -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px;">
        <div style="padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface);">
          <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 600;" data-i18n="sos.vehicle">Assigned Ambulance</div>
          <div style="font-weight: 700; font-size: 1rem; color: var(--primary); margin-top: 4px;">
            ${sos.ambulance ? sos.ambulance.vehicleNumber : 'Searching fleet...'}
          </div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">
            Driver: ${sos.ambulance ? sos.ambulance.driverName : 'Coordination center'}
          </div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">
            Phone: <a href="tel:${sos.ambulance ? sos.ambulance.phone : '108'}" style="color: var(--primary); font-weight: 600;">${sos.ambulance ? sos.ambulance.phone : '108'}</a>
          </div>
        </div>

        <div style="padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface);">
          <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 600;" data-i18n="sos.destination">Destination Facility</div>
          <div style="font-weight: 700; font-size: 1rem; color: var(--text-primary); margin-top: 4px;">
            ${sos.destinationFacility ? sos.destinationFacility.name : 'District Hospital'}
          </div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">
            ${sos.destinationFacility ? sos.destinationFacility.type : 'General Hospital'}
          </div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">
            Phone: <a href="tel:${sos.destinationFacility ? sos.destinationFacility.phone : '112'}" style="color: var(--primary); font-weight: 600;">${sos.destinationFacility ? sos.destinationFacility.phone : '112'}</a>
          </div>
        </div>
      </div>

      <!-- Action Buttons Row -->
      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        <!-- Demo simulation advance button for Hackathon presentation -->
        <button id="sos-btn-step-demo" class="btn btn-secondary" style="flex: 1; font-size: 0.85rem; font-weight: 600; padding: 12px;">
          <span data-i18n="sos.simulateProgress">⚡ Step Demo Dispatch Workflow</span>
        </button>

        <!-- Cancel Request Button -->
        <button id="sos-btn-cancel-request" class="btn btn-outline" style="border-color: var(--error); color: var(--error); font-weight: 600; padding: 12px 20px;">
          <span data-i18n="sos.cancelRequest">Cancel Request</span>
        </button>
      </div>
    `;

    // Initialize Map on this element
    setTimeout(() => {
      this.initMap(sos);
    }, 100);

    // Bind Demo Step Progress Trigger
    container.querySelector('#sos-btn-step-demo').addEventListener('click', async () => {
      await this.advanceDemoStep();
    });

    // Bind Cancel Trigger
    container.querySelector('#sos-btn-cancel-request').addEventListener('click', async () => {
      if (confirm('Are you sure you want to cancel this emergency request?')) {
        await this.cancelRequest();
      }
    });
  }

  // Interactive Map Initializer using Leaflet or clean SVG schematic fallback
  initMap(sos) {
    const mapContainer = document.getElementById('sos-leaflet-map');
    if (!mapContainer) return;

    const patientLat = sos.latitude || (this.currentPosition ? this.currentPosition.latitude : 18.5204);
    const patientLng = sos.longitude || (this.currentPosition ? this.currentPosition.longitude : 73.8567);

    const destLat = (sos.destinationFacility && sos.destinationFacility.latitude) || 18.5304;
    const destLng = (sos.destinationFacility && sos.destinationFacility.longitude) || 73.8467;

    const ambLat = (sos.ambulance && sos.ambulance.currentLat) || (patientLat + 0.008);
    const ambLng = (sos.ambulance && sos.ambulance.currentLng) || (patientLng + 0.008);

    if (window.L) {
      try {
        if (this.leafletMap) {
          this.leafletMap.remove();
        }

        this.leafletMap = window.L.map(mapContainer).setView([patientLat, patientLng], 13);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '© OpenStreetMap contributors'
        }).addTo(this.leafletMap);

        // Patient Marker
        window.L.marker([patientLat, patientLng])
          .addTo(this.leafletMap)
          .bindPopup('<b>📍 Patient Location</b><br>Coordinates captured via GPS')
          .openPopup();

        // Destination Hospital Marker
        window.L.marker([destLat, destLng])
          .addTo(this.leafletMap)
          .bindPopup(`<b>🏥 ${sos.destinationFacility ? sos.destinationFacility.name : 'Hospital'}</b>`);

        // Ambulance Marker
        window.L.marker([ambLat, ambLng])
          .addTo(this.leafletMap)
          .bindPopup(`<b>🚑 ${sos.ambulance ? sos.ambulance.vehicleNumber : 'Ambulance'}</b>`);

        // Connecting route line
        const polyline = window.L.polyline([[ambLat, ambLng], [patientLat, patientLng], [destLat, destLng]], {
          color: '#EF4444',
          dashArray: '6, 8',
          weight: 4
        }).addTo(this.leafletMap);

        this.leafletMap.fitBounds(polyline.getBounds(), { padding: [30, 30] });
        return;
      } catch (err) {
        console.warn('Leaflet error, using SVG schematic map:', err);
      }
    }

    // High quality interactive SVG schematic map fallback
    mapContainer.innerHTML = `
      <svg width="100%" height="100%" viewBox="0 0 600 240" style="background: #F8FAFC;">
        <!-- Grid lines -->
        <defs>
          <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#E2E8F0" stroke-width="1"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Route line -->
        <path d="M 120 160 Q 280 80 480 120" fill="none" stroke="#EF4444" stroke-width="4" stroke-dasharray="6,6"/>

        <!-- Patient Pin -->
        <g transform="translate(120, 160)">
          <circle r="18" fill="rgba(239, 68, 68, 0.2)" />
          <circle r="10" fill="#EF4444" />
          <text y="-16" font-size="11" font-weight="700" fill="#EF4444" text-anchor="middle">📍 Patient (You)</text>
        </g>

        <!-- Ambulance Pin -->
        <g transform="translate(290, 110)">
          <circle r="16" fill="rgba(59, 130, 246, 0.2)" />
          <circle r="10" fill="#3B82F6" />
          <text y="-14" font-size="11" font-weight="700" fill="#3B82F6" text-anchor="middle">🚑 Ambulance (${sos.ambulance ? sos.ambulance.vehicleNumber : 'Fleet'})</text>
        </g>

        <!-- Destination Facility Pin -->
        <g transform="translate(480, 120)">
          <circle r="18" fill="rgba(16, 185, 129, 0.2)" />
          <circle r="10" fill="#10B981" />
          <text y="-16" font-size="11" font-weight="700" fill="#10B981" text-anchor="middle">🏥 ${sos.destinationFacility ? sos.destinationFacility.name : 'Hospital'}</text>
        </g>
      </svg>
    `;
  }

  // Step Demo Dispatch Workflow for Hackathon evaluation
  async advanceDemoStep() {
    if (!this.activeSos) return;

    const sequence = ['REQUESTED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'COMPLETED'];
    const currentIdx = sequence.indexOf(this.activeSos.status);
    const nextStatus = sequence[(currentIdx + 1) % sequence.length];

    if (this.activeSos.isOfflineQueued) {
      this.activeSos.status = nextStatus;
      if (nextStatus === 'COMPLETED') {
        showToast(t('common.success'), 'Demo workflow reached completion!', 'success');
        this.activeSos = null;
      }
      this.renderModalContent();
      this.updateActiveSosBanner();
      return;
    }

    try {
      const res = await apiFetch(`/sos/${this.activeSos._id}/status`, {
        method: 'PATCH',
        body: { status: nextStatus, note: `Demo workflow transitioned to ${nextStatus}` }
      });

      if (res && res.success) {
        this.activeSos = res.data;
        showToast(t('common.info'), `Status updated: ${nextStatus}`, 'info');
        if (nextStatus === 'COMPLETED') {
          this.activeSos = null;
        }
        this.renderModalContent();
        this.updateActiveSosBanner();
      }
    } catch (err) {
      console.warn('Failed to advance demo step:', err);
    }
  }

  // Cancel Request
  async cancelRequest() {
    if (!this.activeSos) return;

    if (this.activeSos.isOfflineQueued) {
      this.activeSos = null;
      showToast(t('common.info'), t('sos.statusCancelled'), 'info');
      this.renderModalContent();
      this.updateActiveSosBanner();
      return;
    }

    try {
      const res = await apiFetch(`/sos/${this.activeSos._id}/cancel`, {
        method: 'POST',
        body: { reason: 'User cancelled emergency request' }
      });

      if (res && res.success) {
        this.activeSos = null;
        showToast(t('common.info'), t('sos.statusCancelled'), 'info');
        this.renderModalContent();
        this.updateActiveSosBanner();
      }
    } catch (err) {
      console.warn('Failed to cancel request:', err);
    }
  }

  // Option 2: Find Nearest Hospital List View
  renderHospitalListView(container) {
    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <button id="sos-btn-back" class="btn btn-secondary" style="font-size: 0.85rem; padding: 6px 14px;">
          ← <span data-i18n="common.back">Back</span>
        </button>
        <span class="badge badge-info" style="font-size: 0.8rem; font-weight: 600;" data-i18n="sos.findHospital">Nearest Healthcare Facilities</span>
      </div>

      <div style="display: flex; flex-direction: column; gap: 14px; max-height: 380px; overflow-y: auto;">
        ${this.nearbyFacilities.map(fac => `
          <div style="padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <h4 style="margin: 0; font-size: 1.05rem; color: var(--text-primary); font-weight: 700;">${fac.name}</h4>
                <div style="font-size: 0.8rem; color: var(--primary); font-weight: 600; margin-top: 2px;">${fac.type}</div>
              </div>
              <span class="badge badge-info" style="font-size: 0.85rem; font-weight: 700;">${fac.distanceKm ? fac.distanceKm + ' km' : '~4 km'}</span>
            </div>
            
            <div style="font-size: 0.8rem; color: var(--text-secondary);">
              📍 ${fac.address} • ⏰ ${fac.openHours || '24 Hours Open'}
            </div>

            <div style="display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0;">
              ${(fac.services || []).map(s => `<span class="badge" style="background: rgba(var(--primary-rgb), 0.08); color: var(--primary); font-size: 0.7rem;">${s}</span>`).join('')}
            </div>

            <div style="display: flex; gap: 10px; margin-top: 6px;">
              <a href="tel:${fac.phone}" class="btn btn-secondary" style="flex: 1; padding: 8px; font-size: 0.85rem; display: flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none;">
                📞 Call: ${fac.phone}
              </a>
              <button class="btn btn-primary btn-select-facility-dispatch" data-id="${fac.id}" style="flex: 1; padding: 8px; font-size: 0.85rem;">
                🚑 Request Transport
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    container.querySelector('#sos-btn-back').addEventListener('click', () => {
      this.renderInitialEmergencyView(container);
    });

    container.querySelectorAll('.btn-select-facility-dispatch').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        this.selectedFacility = this.nearbyFacilities.find(f => f.id === id) || this.nearbyFacilities[0];
        this.renderAmbulanceConfirmView(container);
      });
    });
  }

  // Option 3: Voice / Text Symptom Assessment View (Non-diagnostic preliminary guidance)
  renderVoiceGuidanceView(container) {
    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <button id="sos-btn-back" class="btn btn-secondary" style="font-size: 0.85rem; padding: 6px 14px;">
          ← <span data-i18n="common.back">Back</span>
        </button>
        <span class="badge badge-secondary" style="font-size: 0.8rem; font-weight: 600;" data-i18n="voice.title">Voice Health Assistant</span>
      </div>

      <!-- Disclaimer Banner -->
      <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: var(--radius-md); padding: 10px 14px; margin-bottom: 16px; font-size: 0.75rem; color: #B45309; line-height: 1.4;">
        ℹ️ <strong data-i18n="voice.assessment">Preliminary Assessment</strong>: <span data-i18n="voice.disclaimer">This is a preliminary guidance tool, not a medical diagnosis. Consult a doctor for any illness.</span>
      </div>

      <!-- Microphone Touch Target -->
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; background: var(--background); border-radius: var(--radius-lg); margin-bottom: 16px;">
        <button id="sos-voice-mic-btn" style="width: 74px; height: 74px; border-radius: 50%; background: var(--primary); color: white; border: none; font-size: 2rem; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: var(--transition); box-shadow: 0 4px 15px rgba(59, 130, 246, 0.4);">
          🎤
        </button>
        <div id="sos-voice-status" style="margin-top: 12px; font-size: 0.85rem; font-weight: 600; color: var(--text-primary);" data-i18n="voice.speakPrompt">
          Tap the mic and speak your symptoms in your preferred language
        </div>
      </div>

      <!-- Text input fallback -->
      <div style="margin-bottom: 16px;">
        <div style="display: flex; gap: 8px;">
          <input type="text" id="sos-symptom-input" class="form-control" placeholder="Or type your symptoms here (e.g. fever, chest pain, nausea)..." style="font-size: 0.85rem;">
          <button id="sos-btn-symptom-submit" class="btn btn-primary" style="padding: 0 16px; font-weight: 600;" data-i18n="common.confirm">Analyze</button>
        </div>
      </div>

      <!-- Assessment Result Box -->
      <div id="sos-assessment-result" style="display: none; padding: 16px; border-radius: var(--radius-md); border: 1px solid var(--border); background: var(--surface);">
        <!-- Filled on result -->
      </div>
    `;

    const micBtn = container.querySelector('#sos-voice-mic-btn');
    const statusText = container.querySelector('#sos-voice-status');
    const inputEl = container.querySelector('#sos-symptom-input');
    const submitBtn = container.querySelector('#sos-btn-symptom-submit');
    const resultBox = container.querySelector('#sos-assessment-result');

    this.voiceAssistant = new VoiceAssistant({
      onStatusChange: (status) => {
        if (status === 'listening') {
          micBtn.style.background = '#EF4444';
          micBtn.style.boxShadow = '0 0 0 10px rgba(239, 68, 68, 0.2)';
          statusText.textContent = t('voice.listening');
        } else if (status === 'processing') {
          micBtn.style.background = '#F59E0B';
          statusText.textContent = t('voice.processing');
        } else {
          micBtn.style.background = 'var(--primary)';
          micBtn.style.boxShadow = '0 4px 15px rgba(59, 130, 246, 0.4)';
          statusText.textContent = t('voice.speakPrompt');
        }
      },
      onResult: (result) => {
        this.displaySymptomAssessment(resultBox, result);
      },
      onError: (err) => {
        micBtn.style.background = 'var(--primary)';
        statusText.textContent = t('voice.notSupported');
      }
    });

    micBtn.addEventListener('click', () => {
      this.voiceAssistant.startListening();
    });

    submitBtn.addEventListener('click', () => {
      const val = inputEl.value.trim();
      if (val) {
        const res = this.voiceAssistant.processSymptomText(val);
        this.displaySymptomAssessment(resultBox, res);
      }
    });

    inputEl.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') submitBtn.click();
    });

    container.querySelector('#sos-btn-back').addEventListener('click', () => {
      if (this.voiceAssistant) this.voiceAssistant.stopListening();
      this.renderInitialEmergencyView(container);
    });
  }

  // Display symptom assessment result with care level
  displaySymptomAssessment(container, result) {
    if (!result) return;
    container.style.display = 'block';
    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: var(--text-secondary);" data-i18n="voice.careLevel">Suggested Care Level</span>
        <span class="badge ${result.badgeClass}" style="font-size: 0.8rem; font-weight: 700;">${result.careLevelLabel}</span>
      </div>

      <div style="font-size: 0.95rem; font-weight: 600; color: ${result.color}; margin-bottom: 6px;">
        ${result.isEmergency ? '🚨 Immediate Emergency Attention Suggested' : '⚕️ Clinical Care Level Suggestion'}
      </div>

      <div style="font-size: 0.85rem; color: var(--text-primary); line-height: 1.5; margin-bottom: 12px;">
        ${result.specificAdvice}
      </div>

      <div style="font-size: 0.7rem; color: var(--text-secondary); border-top: 1px solid var(--border); padding-top: 8px;">
        <em>${result.disclaimer}</em>
      </div>

      ${result.isEmergency ? `
        <div style="margin-top: 12px; display: flex; gap: 8px;">
          <button class="btn btn-danger" id="sos-voice-escalate-ambulance" style="flex: 1; padding: 10px; font-weight: 700;">
            🚑 Request Ambulance Now
          </button>
        </div>
      ` : ''}
    `;

    const escalateBtn = container.querySelector('#sos-voice-escalate-ambulance');
    if (escalateBtn) {
      escalateBtn.addEventListener('click', () => {
        const body = document.getElementById('sos-modal-body');
        if (body) this.renderAmbulanceConfirmView(body);
      });
    }
  }

  // Option 4: Emergency Contacts & National Helplines View
  renderContactsView(container) {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const contacts = user.emergencyContacts || [];

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <button id="sos-btn-back" class="btn btn-secondary" style="font-size: 0.85rem; padding: 6px 14px;">
          ← <span data-i18n="common.back">Back</span>
        </button>
        <span class="badge badge-warning" style="font-size: 0.8rem; font-weight: 600;" data-i18n="sos.emergencyContact">Emergency Contacts</span>
      </div>

      <!-- Quick National Dialers -->
      <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
        <a href="tel:112" class="btn btn-danger" style="padding: 12px; font-size: 0.95rem; font-weight: 700; text-decoration: none; display: flex; justify-content: space-between; align-items: center;">
          <span>🚨 National Emergency Helpline</span>
          <span style="background: rgba(255,255,255,0.25); padding: 4px 10px; border-radius: var(--radius-full);">112</span>
        </a>
        <a href="tel:108" class="btn btn-primary" style="padding: 12px; font-size: 0.95rem; font-weight: 700; text-decoration: none; display: flex; justify-content: space-between; align-items: center;">
          <span>🚑 Government Free Ambulance Service</span>
          <span style="background: rgba(255,255,255,0.25); padding: 4px 10px; border-radius: var(--radius-full);">108</span>
        </a>
        <a href="tel:104" class="btn btn-secondary" style="padding: 12px; font-size: 0.95rem; font-weight: 700; text-decoration: none; display: flex; justify-content: space-between; align-items: center;">
          <span>📞 Medical Advice Helpline</span>
          <span style="background: rgba(0,0,0,0.1); padding: 4px 10px; border-radius: var(--radius-full);">104</span>
        </a>
      </div>

      <!-- User's configured personal emergency contacts -->
      <h5 style="font-size: 0.9rem; margin-bottom: 10px;" data-i18n="dashboard.emergencyContacts">Personal Emergency Contacts</h5>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${contacts.length > 0 ? contacts.map(c => `
          <div style="padding: 10px 14px; border: 1px solid var(--border); border-radius: var(--radius-md); display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 600; font-size: 0.9rem;">${c.name} (${c.relationship})</div>
              <div style="font-size: 0.8rem; color: var(--text-secondary);">${c.phone}</div>
            </div>
            <a href="tel:${c.phone}" class="btn btn-primary btn-icon" style="border-radius: var(--radius-full);">
              📞
            </a>
          </div>
        `).join('') : `
          <div style="padding: 14px; text-align: center; color: var(--text-secondary); font-size: 0.85rem;" data-i18n="dashboard.noContacts">
            No contacts configured yet. Add emergency contacts in your Profile.
          </div>
        `}
      </div>
    `;

    container.querySelector('#sos-btn-back').addEventListener('click', () => {
      this.renderInitialEmergencyView(container);
    });
  }

  // Synchronize queued offline SOS items when connectivity is restored
  async syncOfflineQueue() {
    const queueStr = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!queueStr) return;

    try {
      const queue = JSON.parse(queueStr);
      if (!Array.isArray(queue) || queue.length === 0) return;

      const item = queue.shift(); // process first pending SOS

      // Prevent stale queued emergency alerts from triggering dispatch hours later
      const createdAtMs = item.createdAt ? new Date(item.createdAt).getTime() : Date.now();
      const ageMinutes = (Date.now() - createdAtMs) / (60 * 1000);
      if (ageMinutes > 20) {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
        showToast(
          'Emergency Alert Expired',
          'Queued SOS alert was older than 20 minutes and has been expired. Please call 112 directly if you still require immediate assistance.',
          'warning'
        );
        return;
      }

      const res = await apiFetch('/sos', {
        method: 'POST',
        body: item
      });

      if (res && res.success) {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
        this.activeSos = res.data;
        this.renderModalContent();
        this.updateActiveSosBanner();
      }
    } catch (e) {
      console.warn('Sync failed, will retry later:', e);
    }
  }

  // Update top sticky / dashboard alert banner for active SOS
  updateActiveSosBanner() {
    let banner = document.getElementById('active-sos-top-banner');
    if (!this.activeSos || ['COMPLETED', 'CANCELLED'].includes(this.activeSos.status)) {
      if (banner) banner.remove();
      return;
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'active-sos-top-banner';
      banner.style.cssText = 'background: #EF4444; color: white; padding: 10px 20px; font-weight: 600; font-size: 0.85rem; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 9999; box-shadow: 0 4px 10px rgba(239,68,68,0.3);';
      document.body.prepend(banner);
    }

    banner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.1rem; animation: pulse 1s infinite;">🚨</span>
        <span><strong>${t('sos.bannerTitle')}:</strong> ${this.activeSos.status} • Ambulance: ${this.activeSos.ambulance ? this.activeSos.ambulance.vehicleNumber : 'Fleet'}</span>
      </div>
      <button id="btn-banner-view-sos" style="background: white; color: #EF4444; border: none; padding: 4px 14px; border-radius: var(--radius-full); font-weight: 700; cursor: pointer; font-size: 0.8rem;">
        ${t('sos.viewMap')}
      </button>
    `;

    banner.querySelector('#btn-banner-view-sos').addEventListener('click', () => {
      this.openModal();
    });
  }
}

// Global Singleton Instance
export const sosManager = new SosManager();

// Global Helper to trigger SOS from any button or page
export function triggerMedicalSos() {
  sosManager.openModal();
}
