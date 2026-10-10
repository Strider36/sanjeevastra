const Medicine = require('../models/Medicine');

// @desc    Get user medicines
// @route   GET /api/medicines
// @access  Private
exports.getMedicines = async (req, res) => {
  try {
    const medicines = await Medicine.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: medicines.length, data: medicines });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Create new medicine
// @route   POST /api/medicines
// @access  Private
exports.createMedicine = async (req, res) => {
  try {
    const { name, dosage, frequency, timings, startDate, endDate, reminderTime, instructions } = req.body;

    if (!name || !dosage || !frequency) {
      return res.status(400).json({ success: false, error: 'Please provide name, dosage, and frequency' });
    }

    const medicine = await Medicine.create({
      user: req.user.id,
      name,
      dosage,
      frequency,
      timings: timings || ['Morning'],
      startDate: startDate || new Date(),
      endDate,
      reminderTime,
      instructions
    });

    res.status(201).json({ success: true, data: medicine });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Update medicine details
// @route   PUT /api/medicines/:id
// @access  Private
exports.updateMedicine = async (req, res) => {
  try {
    let medicine = await Medicine.findById(req.params.id);

    if (!medicine) {
      return res.status(404).json({ success: false, error: 'Medicine not found' });
    }

    // Verify owner
    if (medicine.user.toString() !== req.user.id) {
      return res.status(401).json({ success: false, error: 'Not authorized' });
    }

    const updates = { ...req.body };
    delete updates.user; // Prevent changing ownership

    medicine = await Medicine.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true
    });

    res.status(200).json({ success: true, data: medicine });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Delete medicine
// @route   DELETE /api/medicines/:id
// @access  Private
exports.deleteMedicine = async (req, res) => {
  try {
    const medicine = await Medicine.findById(req.params.id);

    if (!medicine) {
      return res.status(404).json({ success: false, error: 'Medicine not found' });
    }

    // Verify owner
    if (medicine.user.toString() !== req.user.id) {
      return res.status(401).json({ success: false, error: 'Not authorized' });
    }

    await medicine.deleteOne();

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Log medicine compliance (Taken/Missed)
// @route   POST /api/medicines/:id/log
// @access  Private
exports.logAdherence = async (req, res) => {
  try {
    const { date, timeSlot, status } = req.body;

    if (!date || !timeSlot || !status) {
      return res.status(400).json({ success: false, error: 'Please provide date, timeSlot, and status' });
    }

    const medicine = await Medicine.findById(req.params.id);

    if (!medicine) {
      return res.status(404).json({ success: false, error: 'Medicine not found' });
    }

    // Verify owner
    if (medicine.user.toString() !== req.user.id) {
      return res.status(401).json({ success: false, error: 'Not authorized' });
    }

    // Find if log already exists
    const logIndex = medicine.history.findIndex(
      (log) => log.date === date && log.timeSlot === timeSlot
    );

    if (logIndex > -1) {
      // Update existing log
      medicine.history[logIndex].status = status;
      medicine.history[logIndex].takenAt = status === 'Taken' ? new Date() : null;
    } else {
      // Add new log
      medicine.history.push({
        date,
        timeSlot,
        status,
        takenAt: status === 'Taken' ? new Date() : null
      });
    }

    await medicine.save();
    res.status(200).json({ success: true, data: medicine });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
