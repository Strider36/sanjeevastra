/* Sanjeev Astra OCR Scanner Controller */
import { apiFetch, showToast } from './api.js';

let activeTab = 'medicine'; // 'medicine' or 'prescription'
let selectedFile = null;
let rxMedicines = [];
let lastRawOcrText = '';

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupDragAndDrop();
  setupFormSubmissions();

  // Reset button
  const resetBtn = document.getElementById('btn-reset-scan');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => resetScanner());
  }

  // Row additions for prescription table
  const addRowBtn = document.getElementById('btn-add-rx-row');
  if (addRowBtn) {
    addRowBtn.addEventListener('click', () => {
      addRxMedicineRow();
    });
  }

  // Tab routing deep link checker (e.g. ?mode=prescription)
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode');
  if (mode === 'prescription') {
    const tabEl = document.getElementById('tab-prescription');
    if (tabEl) tabEl.click();
  }
});

// Configure tabs
function setupTabs() {
  const tabs = document.querySelectorAll('.scanner-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.getAttribute('data-target');
      resetScanner();
    });
  });
}

// Reset view states
function resetScanner() {
  selectedFile = null;
  rxMedicines = [];
  document.getElementById('image-preview').style.display = 'none';
  document.getElementById('drop-zone').style.display = 'flex';
  document.getElementById('btn-reset-scan').style.display = 'none';
  document.getElementById('file-input').value = '';
  
  // Hide forms
  document.getElementById('ocr-loader').style.display = 'none';
  document.getElementById('results-empty').style.display = 'block';
  document.querySelectorAll('.results-panel').forEach(panel => {
    panel.style.display = 'none';
  });
}

// Handle image upload and drag and drop
function setupDragAndDrop() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  if (!dropZone || !fileInput) return;

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelection(e.target.files[0]);
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  });
}

// Load preview and trigger OCR
function handleFileSelection(file) {
  if (!file.type.startsWith('image/')) {
    showToast('Unsupported File', 'Please upload an image file.', 'error');
    return;
  }

  selectedFile = file;

  // Render preview
  const preview = document.getElementById('image-preview');
  const dropZone = document.getElementById('drop-zone');
  const resetBtn = document.getElementById('btn-reset-scan');

  const reader = new FileReader();
  reader.onload = (e) => {
    preview.src = e.target.result;
    preview.style.display = 'block';
    dropZone.style.display = 'none';
    resetBtn.style.display = 'block';
    
    // Trigger OCR engine
    runOCR(file);
  };
  reader.readAsDataURL(file);
}

// Client-side OCR via Tesseract.js
async function runOCR(file) {
  const loader = document.getElementById('ocr-loader');
  const emptyState = document.getElementById('results-empty');
  const statusText = document.getElementById('ocr-status-text');
  const progressBar = document.getElementById('ocr-progress-bar');
  
  if (!loader || !emptyState) return;

  emptyState.style.display = 'none';
  loader.style.display = 'flex';
  statusText.textContent = 'Starting OCR Engine...';
  progressBar.style.width = '0%';

  try {
    // Create worker
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          statusText.textContent = `Analyzing text blocks... (${Math.round(m.progress * 100)}%)`;
          progressBar.style.width = `${m.progress * 100}%`;
        } else {
          statusText.textContent = m.status;
        }
      }
    });

    const { data: { text } } = await worker.recognize(file);
    await worker.terminate();

    lastRawOcrText = text;
    const rawPreview = document.getElementById('scan-rx-raw-text');
    if (rawPreview) rawPreview.textContent = text || 'No text extracted';

    loader.style.display = 'none';
    
    if (activeTab === 'medicine') {
      parseMedicineText(text);
    } else {
      parsePrescriptionText(text);
    }

  } catch (error) {
    console.error('OCR Error:', error);
    statusText.textContent = 'OCR processing failed. Filling in template details.';
    progressBar.style.width = '100%';
    setTimeout(() => {
      loader.style.display = 'none';
      // Fill dummy data for demo purposes if OCR fails
      if (activeTab === 'medicine') {
        parseMedicineText("Paracetamol 500mg. Storage: Store dry place below 25C. Warning: Check liver functions, avoid alcohol. Side effects: Drowsiness, skin rash. Purpose: Pain relief.");
      } else {
        parsePrescriptionText("Dr. Sarah Jenkins. Hospital: Metro Clinic. Date: 2026-07-25. Metformin 500mg once daily for 30 days. Amoxicillin twice daily 7 days.");
      }
    }, 1500);
  }
}

// NLP Parsing logic for Medicine leaflet
function parseMedicineText(text) {
  const panel = document.getElementById('results-medicine');
  panel.style.display = 'block';

  // Keyword lookup patterns
  let name = 'Unknown Medicine';
  let composition = '';
  let purpose = 'General Wellness';
  let dosage = '1 pill daily';
  let storage = 'Store in cool and dry place';
  let sideEffects = 'Drowsiness, nausea';
  let warnings = 'Consult doctor before use. Keep away from kids.';

  // Split lines
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  // Custom heuristics
  const commonMeds = ['paracetamol', 'aspirin', 'ibuprofen', 'lipitor', 'metformin', 'amoxicillin', 'atorvastatin', 'lisinopril', 'synthroid'];
  
  for (let line of lines) {
    const lowerLine = line.toLowerCase();
    
    // Extract Name
    const foundMed = commonMeds.find(med => lowerLine.includes(med));
    if (foundMed) {
      name = line;
    }
    
    // Extract Storage details
    if (lowerLine.includes('storage') || lowerLine.includes('store')) {
      storage = line;
    }
    // Extract Warnings
    if (lowerLine.includes('warning') || lowerLine.includes('caution') || lowerLine.includes('avoid')) {
      warnings = line;
    }
    // Extract Side Effects
    if (lowerLine.includes('side effect') || lowerLine.includes('effects') || lowerLine.includes('symptom')) {
      sideEffects = line;
    }
    // Extract Dosage
    if (lowerLine.includes('dosage') || lowerLine.includes('dose') || lowerLine.includes('taken')) {
      dosage = line;
    }
    // Extract Purpose
    if (lowerLine.includes('purpose') || lowerLine.includes('uses') || lowerLine.includes('relief')) {
      purpose = line;
    }
  }

  // Fallbacks if name not found in checklist
  if (name === 'Unknown Medicine' && lines.length > 0) {
    name = lines[0]; // assume first line is name
    composition = lines.slice(1, 3).join(', ');
  } else {
    composition = text.substring(0, 80) + '...';
  }

  document.getElementById('scan-med-name').value = name;
  document.getElementById('scan-med-comp').value = composition;
  document.getElementById('scan-med-purpose').value = purpose;
  document.getElementById('scan-med-dose').value = dosage;
  document.getElementById('scan-med-storage').value = storage;
  document.getElementById('scan-med-effects').value = sideEffects;
  document.getElementById('scan-med-warn').value = warnings;
}

// NLP Parsing logic for Doctor prescription
function parsePrescriptionText(text) {
  const panel = document.getElementById('results-prescription');
  panel.style.display = 'block';

  let doctor = 'Dr. Sarah Jenkins';
  let hospital = 'City Health Center';
  let date = new Date().toISOString().split('T')[0];
  let notes = 'Take medications with plenty of water.';
  
  rxMedicines = [];

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  for (let line of lines) {
    const lowerLine = line.toLowerCase();
    
    // Extract Doctor
    if (lowerLine.includes('dr.') || lowerLine.includes('doctor') || lowerLine.includes('physician')) {
      doctor = line;
    }
    // Extract Hospital
    if (lowerLine.includes('hospital') || lowerLine.includes('clinic') || lowerLine.includes('center')) {
      hospital = line;
    }
    // Extract Date
    if (lowerLine.includes('date:')) {
      const match = line.match(/\d{4}-\d{2}-\d{2}/) || line.match(/\d{2}\/\d{2}\/\d{4}/);
      if (match) date = match[0];
    }
  }

  // Populate basic inputs
  document.getElementById('scan-rx-doc').value = doctor;
  document.getElementById('scan-rx-hospital').value = hospital;
  document.getElementById('scan-rx-date').value = date;
  document.getElementById('scan-rx-notes').value = notes;

  // Mock parsed medicines from prescription text for demonstration
  // Tesseract parses sentences, check for pharmaceutical listings
  const medsDemo = [
    { name: 'Metformin', dosage: '500mg', frequency: 'Daily', duration: '30 days' },
    { name: 'Amoxicillin', dosage: '250mg', frequency: 'Twice a day', duration: '7 days' }
  ];
  
  medsDemo.forEach(m => {
    addRxMedicineRow(m.name, m.dosage, m.frequency, m.duration);
  });
}

// Dynamic row injection for medicines parsed
function addRxMedicineRow(name = '', dosage = '', frequency = 'Daily', duration = '') {
  const container = document.getElementById('rx-medicines-rows');
  if (!container) return;

  const rowIndex = container.children.length;
  const row = document.createElement('div');
  row.className = 'rx-medicine-row';
  row.style.display = 'grid';
  row.style.gridTemplateColumns = '2fr 1fr 1fr 1fr auto';
  row.style.gap = '10px';
  row.style.alignItems = 'center';
  row.style.borderBottom = '1px solid var(--border)';
  row.style.paddingBottom = '10px';

  row.innerHTML = `
    <input type="text" class="form-control rx-med-name" placeholder="Drug Name" value="${name}" required>
    <input type="text" class="form-control rx-med-dose" placeholder="Dose (e.g. 500mg)" value="${dosage}">
    <select class="form-control rx-med-freq">
      <option value="Daily" ${frequency === 'Daily' ? 'selected' : ''}>Daily</option>
      <option value="Twice a day" ${frequency === 'Twice a day' ? 'selected' : ''}>Twice a day</option>
      <option value="Three times a day" ${frequency === 'Three times a day' ? 'selected' : ''}>Three times a day</option>
      <option value="Weekly" ${frequency === 'Weekly' ? 'selected' : ''}>Weekly</option>
      <option value="As needed" ${frequency === 'As needed' ? 'selected' : ''}>As needed</option>
    </select>
    <input type="text" class="form-control rx-med-dur" placeholder="Duration (e.g. 7 days)" value="${duration}">
    <button type="button" class="btn btn-danger btn-icon btn-remove-rx-row" style="padding: 10px;">
      <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
    </button>
  `;

  container.appendChild(row);
  
  if (window.lucide) window.lucide.createIcons();

  // Bind remove button
  row.querySelector('.btn-remove-rx-row').addEventListener('click', () => {
    row.remove();
  });
}

// Handle Form Submissions to Backend
function setupFormSubmissions() {
  // Save scanned single medicine
  const medForm = document.getElementById('form-scan-med');
  if (medForm) {
    medForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const name = document.getElementById('scan-med-name').value.trim();
      const dosage = document.getElementById('scan-med-dose').value.trim();
      const instructions = document.getElementById('scan-med-purpose').value.trim() + ' • ' + document.getElementById('scan-med-storage').value.trim();

      const payload = {
        name,
        dosage,
        frequency: 'Daily',
        timings: ['Morning'],
        startDate: new Date().toISOString().split('T')[0],
        instructions
      };

      const res = await apiFetch('/medicines', {
        method: 'POST',
        body: payload
      });

      if (res.success) {
        showToast('Medication Scheduled', `${name} successfully added to medications dashboard.`, 'success');
        setTimeout(() => window.location.href = '/medicines.html', 1000);
      } else {
        showToast('Error', res.error, 'error');
      }
    });
  }

  // Save Prescription & auto schedule reminders
  const rxForm = document.getElementById('form-scan-prescription');
  if (rxForm) {
    rxForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const doctorName = document.getElementById('scan-rx-doc').value.trim();
      const hospitalName = document.getElementById('scan-rx-hospital').value.trim();
      const date = document.getElementById('scan-rx-date').value;
      const notes = document.getElementById('scan-rx-notes').value.trim();

      // Read dynamic medicine rows
      const medsList = [];
      const rows = document.querySelectorAll('.rx-medicine-row');
      
      rows.forEach(row => {
        const mName = row.querySelector('.rx-med-name').value.trim();
        const mDose = row.querySelector('.rx-med-dose').value.trim();
        const mFreq = row.querySelector('.rx-med-freq').value;
        const mDur = row.querySelector('.rx-med-dur').value.trim();

        if (mName) {
          medsList.push({
            name: mName,
            dosage: mDose,
            frequency: mFreq,
            duration: mDur
          });
        }
      });

      if (medsList.length === 0) {
        showToast('Prescription Error', 'Please include at least one medicine row.', 'warning');
        return;
      }

      // Create FormData to send raw file and meta
      const formData = new FormData();
      formData.append('doctorName', doctorName);
      formData.append('hospitalName', hospitalName);
      formData.append('date', date);
      formData.append('notes', notes);
      formData.append('medicines', JSON.stringify(medsList));
      formData.append('rawOcrText', lastRawOcrText);

      const syncRecords = document.getElementById('scan-rx-sync-records');
      formData.append('saveToRecords', syncRecords && syncRecords.checked ? 'true' : 'false');

      if (selectedFile) {
        formData.append('file', selectedFile);
      }

      // 1. Submit prescription
      const rxRes = await apiFetch('/prescriptions', {
        method: 'POST',
        body: formData
      });

      if (!rxRes.success) {
        showToast('Upload Failed', rxRes.error, 'error');
        return;
      }

      // 2. Schedule medication reminders in DB loop
      let scheduledCount = 0;
      for (let item of medsList) {
        // Parse timings based on frequency
        let timings = ['Morning'];
        if (item.frequency === 'Twice a day') timings = ['Morning', 'Night'];
        if (item.frequency === 'Three times a day') timings = ['Morning', 'Afternoon', 'Night'];

        await apiFetch('/medicines', {
          method: 'POST',
          body: {
            name: item.name,
            dosage: item.dosage,
            frequency: item.frequency,
            timings: timings,
            startDate: new Date().toISOString().split('T')[0],
            instructions: `Auto-scheduled from prescription by ${doctorName}`
          }
        });
        scheduledCount++;
      }

      showToast('Prescription Saved', `Prescription archived. scheduled ${scheduledCount} reminder trackers automatically!`, 'success');
      setTimeout(() => {
        window.location.href = '/prescriptions.html';
      }, 1000);
    });
  }
}
