const Prescription = require('../models/Prescription');
const HealthRecord = require('../models/HealthRecord');
const fs = require('fs');
const path = require('path');

// @desc    Get user prescriptions
// @route   GET /api/prescriptions
// @access  Private
exports.getPrescriptions = async (req, res) => {
  try {
    const prescriptions = await Prescription.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: prescriptions.length, data: prescriptions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Create new prescription (with optional upload & Health Record synchronization)
// @route   POST /api/prescriptions
// @access  Private
exports.createPrescription = async (req, res) => {
  try {
    const { doctorName, hospitalName, date, notes, rawOcrText, saveToRecords } = req.body;
    let medicines = [];

    // Parse medicines from body (might be sent as stringified JSON)
    if (req.body.medicines) {
      try {
        medicines = typeof req.body.medicines === 'string' 
          ? JSON.parse(req.body.medicines) 
          : req.body.medicines;
      } catch (err) {
        console.error('Failed to parse medicines array:', err);
      }
    }

    let fileUrl = '';
    if (req.file) {
      fileUrl = `/uploads/${req.file.filename}`;
    }

    // Automatically create linked HealthRecord if a file was uploaded
    let healthRecordId = null;
    if (fileUrl && saveToRecords !== 'false') {
      try {
        const medSummary = medicines.map(m => m.name + (m.dosage ? ` (${m.dosage})` : '')).join(', ');
        const recordNotes = [
          notes ? `Notes: ${notes}` : '',
          hospitalName ? `Facility: ${hospitalName}` : '',
          medSummary ? `Prescribed: ${medSummary}` : ''
        ].filter(Boolean).join(' • ');

        const hr = await HealthRecord.create({
          user: req.user.id,
          name: `Prescription - ${doctorName || 'Doctor'} (${new Date(date || Date.now()).toLocaleDateString()})`,
          category: 'Prescription',
          date: date || new Date(),
          fileUrl,
          notes: recordNotes
        });
        healthRecordId = hr._id;
      } catch (hrErr) {
        console.warn('Could not auto-create linked HealthRecord:', hrErr.message);
      }
    }

    const prescription = await Prescription.create({
      user: req.user.id,
      doctorName: doctorName || 'Unknown Doctor',
      hospitalName: hospitalName || '',
      date: date || new Date(),
      medicines,
      fileUrl,
      notes: notes || '',
      rawOcrText: rawOcrText || '',
      healthRecord: healthRecordId
    });

    res.status(201).json({ success: true, data: prescription, linkedRecordId: healthRecordId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Delete prescription
// @route   DELETE /api/prescriptions/:id
// @access  Private
exports.deletePrescription = async (req, res) => {
  try {
    const prescription = await Prescription.findById(req.params.id);

    if (!prescription) {
      return res.status(404).json({ success: false, error: 'Prescription not found' });
    }

    // Verify owner
    if (prescription.user.toString() !== req.user.id) {
      return res.status(401).json({ success: false, error: 'Not authorized' });
    }

    // Delete associated file if it exists
    if (prescription.fileUrl) {
      const filePath = path.join(__dirname, '../..', prescription.fileUrl);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await prescription.deleteOne();

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
