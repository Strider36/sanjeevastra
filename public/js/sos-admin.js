/* Sanjeev Astra Health Worker & Admin Dispatch Controller */
import { apiFetch, showToast } from './api.js';

let allRequests = [];
let selectedRequest = null;
let adminMap = null;

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadSosQueue();
});

function setupEventListeners() {
  const refreshBtn = document.getElementById('btn-refresh-queue');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadSosQueue());
  }

  const filterSelect = document.getElementById('filter-status');
  if (filterSelect) {
    filterSelect.addEventListener('change', () => renderQueueList());
  }

  // Status Action Buttons
  document.getElementById('btn-status-accept')?.addEventListener('click', () => updateStatus('ACCEPTED'));
  document.getElementById('btn-status-enroute')?.addEventListener('click', () => updateStatus('EN_ROUTE'));
  document.getElementById('btn-status-arrived')?.addEventListener('click', () => updateStatus('ARRIVED'));
  document.getElementById('btn-status-completed')?.addEventListener('click', () => updateStatus('COMPLETED'));
}

async function loadSosQueue() {
  const container = document.getElementById('sos-queue-list');
  const countEl = document.getElementById('queue-count');

  if (container) {
    container.innerHTML = '<div style="text-align: center; padding: 30px; color: var(--text-secondary);">Updating emergency queue...</div>';
  }

  try {
    const res = await apiFetch('/sos');
    if (res && res.success) {
      allRequests = res.data || [];
      if (countEl) countEl.textContent = allRequests.length;
      renderQueueList();

      if (selectedRequest) {
        // Keep selected request updated
        selectedRequest = allRequests.find(r => r._id === selectedRequest._id) || null;
        if (selectedRequest) renderDetail(selectedRequest);
      }
    } else {
      if (container) container.innerHTML = `<div style="text-align: center; color: var(--error); padding: 30px;">Failed to load queue: ${res.error || 'Server error'}</div>`;
    }
  } catch (err) {
    console.error('Queue load error:', err);
    if (container) container.innerHTML = '<div style="text-align: center; color: var(--error); padding: 30px;">Network connection error.</div>';
  }
}

function renderQueueList() {
  const container = document.getElementById('sos-queue-list');
  const filter = document.getElementById('filter-status')?.value || 'ALL';
  if (!container) return;

  const filtered = filter === 'ALL' ? allRequests : allRequests.filter(r => r.status === filter);

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary); background: var(--surface); border-radius: var(--radius-md); border: 1px solid var(--border);">No emergency requests matching criteria.</div>';
    return;
  }

  container.innerHTML = filtered.map(req => {
    const isSelected = selectedRequest && selectedRequest._id === req._id;
    return `
      <div class="sos-req-card ${isSelected ? 'active-selected' : ''}" data-id="${req._id}" style="cursor: pointer;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <div style="font-weight: 700; font-size: 1.05rem; display: flex; align-items: center; gap: 6px;">
              <span>🚨</span> ${req.patientName || 'Emergency Caller'}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">
              📞 ${req.patientPhone || 'No phone recorded'} • ⏰ ${new Date(req.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          <span class="status-pill status-${req.status}">${req.status}</span>
        </div>

        <div style="font-size: 0.85rem; color: var(--text-primary); line-height: 1.4;">
          <strong>Destination:</strong> ${req.destinationFacility ? req.destinationFacility.name : 'District Hospital'}
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: var(--text-secondary); border-top: 1px solid var(--border); padding-top: 8px;">
          <span>Ambulance: <strong>${req.ambulance ? req.ambulance.vehicleNumber : 'Pending'}</strong></span>
          <span style="color: var(--primary); font-weight: 600;">View & Manage →</span>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.sos-req-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      const found = allRequests.find(r => r._id === id);
      if (found) {
        selectedRequest = found;
        renderQueueList();
        renderDetail(found);
      }
    });
  });
}

function renderDetail(req) {
  const emptyMsg = document.getElementById('detail-empty-message');
  const activeView = document.getElementById('detail-active-view');
  const statusPill = document.getElementById('detail-status-pill');

  if (emptyMsg) emptyMsg.style.display = 'none';
  if (activeView) activeView.style.display = 'flex';

  if (statusPill) {
    statusPill.className = `status-pill status-${req.status}`;
    statusPill.textContent = req.status;
  }

  document.getElementById('detail-patient-name').textContent = req.patientName || 'Emergency Caller';
  document.getElementById('detail-patient-contact').textContent = `Phone: ${req.patientPhone || 'N/A'}`;
  document.getElementById('detail-patient-location').textContent = req.latitude && req.longitude 
    ? `📍 Coordinates: ${req.latitude.toFixed(4)}, ${req.longitude.toFixed(4)}`
    : `📍 Location: ${req.locationAddress || 'Address on file'}`;

  document.getElementById('detail-destination-name').textContent = req.destinationFacility ? req.destinationFacility.name : 'District Hospital';
  document.getElementById('detail-destination-addr').textContent = req.destinationFacility ? `${req.destinationFacility.address} (Phone: ${req.destinationFacility.phone})` : '';

  const respBox = document.getElementById('detail-responder-box');
  if (respBox) {
    if (req.assignedResponder && (req.assignedResponder.name || req.assignedResponder.user)) {
      respBox.style.display = 'block';
      document.getElementById('detail-responder-name').textContent = `${req.assignedResponder.name || 'Community Responder'} (${req.assignedResponder.responderType || 'first responder'})`;
      document.getElementById('detail-responder-meta').textContent = `ETA: ~${req.assignedResponder.etaMinutes || 5} mins • Phone: ${req.assignedResponder.phone || 'On file'}`;
    } else {
      respBox.style.display = 'none';
    }
  }

  document.getElementById('detail-ambulance-vehicle').textContent = req.ambulance ? req.ambulance.vehicleNumber : 'Pending Assignment';
  document.getElementById('detail-ambulance-driver').textContent = req.ambulance 
    ? `Driver: ${req.ambulance.driverName} • Phone: ${req.ambulance.phone}`
    : 'No driver assigned';

  // Render detail map
  setTimeout(() => {
    renderAdminMap(req);
  }, 100);
}

function renderAdminMap(req) {
  const mapContainer = document.getElementById('admin-detail-map');
  if (!mapContainer) return;

  const lat = req.latitude || 18.5204;
  const lng = req.longitude || 73.8567;

  if (window.L) {
    try {
      if (adminMap) {
        adminMap.remove();
      }

      adminMap = window.L.map(mapContainer).setView([lat, lng], 13);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '© OpenStreetMap'
      }).addTo(adminMap);

      window.L.marker([lat, lng]).addTo(adminMap).bindPopup(`<b>${req.patientName}</b><br>Emergency Scene`).openPopup();
      return;
    } catch (e) {
      console.warn('Leaflet error in admin map:', e);
    }
  }

  mapContainer.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary); font-size: 0.85rem;">
      📍 Patient Coordinates: ${lat}, ${lng}
    </div>
  `;
}

async function updateStatus(newStatus) {
  if (!selectedRequest) {
    showToast('Selection', 'Please select an SOS request first', 'warning');
    return;
  }

  try {
    const res = await apiFetch(`/sos/${selectedRequest._id}/status`, {
      method: 'PATCH',
      body: {
        status: newStatus,
        note: `Status updated to ${newStatus} by Dispatch Control`
      }
    });

    if (res && res.success) {
      showToast('Dispatch Updated', `Status changed to ${newStatus}`, 'success');
      await loadSosQueue();
    } else {
      showToast('Update Failed', res.error || 'Could not update status', 'error');
    }
  } catch (err) {
    console.error('Status update error:', err);
    showToast('Error', 'Network error during status update', 'error');
  }
}
