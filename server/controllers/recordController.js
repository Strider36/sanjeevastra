const HealthRecord = require('../models/HealthRecord');
const RecordShare = require('../models/RecordShare');
const DoctorProfile = require('../models/DoctorProfile');
const AuditLog = require('../models/AuditLog');
const fs = require('fs');
const path = require('path');

// Helper to escape regex special characters
function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

// @desc    Get health records (Patient sees own; Doctor sees actively shared patient records only)
// @route   GET /api/records
// @access  Private
exports.getRecords = async (req, res) => {
  try {
    const { category, search, patientId } = req.query;
    const isDoctor = req.user.role === 'doctor';

    let query = {};

    if (isDoctor) {
      // 1. Verify doctor is certified/verified
      const profile = await DoctorProfile.findOne({ user: req.user.id });
      if (!profile || profile.verificationStatus !== 'verified') {
        return res.status(403).json({
          success: false,
          error: 'Doctor account is pending verification. Access to patient records is prohibited until verified.'
        });
      }

      // 2. Find active, non-expired, non-revoked shares for this doctor
      const shareQuery = {
        doctor: req.user.id,
        status: 'active',
        expiresAt: { $gt: new Date() }
      };

      if (patientId) {
        shareQuery.patient = patientId;
      }

      const activeShares = await RecordShare.find(shareQuery);

      if (activeShares.length === 0) {
        return res.status(200).json({ success: true, count: 0, data: [], note: 'No active shared records' });
      }

      // Check if any share grants 'allRecords'
      const hasAllRecords = activeShares.some(s => s.allRecords);
      const authorizedPatients = [...new Set(activeShares.map(s => s.patient.toString()))];

      if (hasAllRecords) {
        query.user = { $in: authorizedPatients };
      } else {
        const allowedRecordIds = activeShares.flatMap(s => s.records);
        query._id = { $in: allowedRecordIds };
      }

      // Log doctor access in AuditLog
      await AuditLog.create({
        action: 'RECORD_VIEW',
        actor: req.user.id,
        actorRole: 'doctor',
        targetUser: patientId || (authorizedPatients.length === 1 ? authorizedPatients[0] : null),
        resourceType: 'HealthRecord',
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent') || '',
        details: { patientId: patientId || 'all_authorized', count: activeShares.length }
      });
    } else {
      // Standard Patient view: strictly own records
      query.user = req.user.id;
    }

    // Apply category filter if provided
    if (category && category !== 'All') {
      query.category = category;
    }

    // Apply safe text search query
    if (search && search.trim()) {
      const safeSearch = escapeRegex(search.trim());
      query.$or = [
        { name: { $regex: safeSearch, $options: 'i' } },
        { notes: { $regex: safeSearch, $options: 'i' } }
      ];
    }

    const records = await HealthRecord.find(query).sort({ date: -1 });
    res.status(200).json({ success: true, count: records.length, data: records });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Get single health record by ID with strict authorization verification
// @route   GET /api/records/:id
// @access  Private
exports.getRecordById = async (req, res) => {
  try {
    const record = await HealthRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Health record not found' });
    }

    const isOwner = record.user.toString() === req.user.id;
    const isDoctor = req.user.role === 'doctor';

    if (isOwner || req.user.role === 'admin') {
      return res.status(200).json({ success: true, data: record });
    }

    if (isDoctor) {
      // Verify doctor is approved
      const profile = await DoctorProfile.findOne({ user: req.user.id });
      if (!profile || profile.verificationStatus !== 'verified') {
        await AuditLog.create({
          action: 'ACCESS_DENIED',
          actor: req.user.id,
          actorRole: 'doctor',
          targetUser: record.user,
          resourceType: 'HealthRecord',
          resourceId: record._id.toString(),
          details: { reason: 'Unverified doctor attempted record view' }
        });
        return res.status(403).json({ success: false, error: 'Unverified doctor account' });
      }

      // Check active non-expired share grant
      const activeShare = await RecordShare.findOne({
        doctor: req.user.id,
        patient: record.user,
        status: 'active',
        expiresAt: { $gt: new Date() },
        $or: [
          { allRecords: true },
          { records: record._id }
        ]
      });

      if (!activeShare) {
        await AuditLog.create({
          action: 'ACCESS_DENIED',
          actor: req.user.id,
          actorRole: 'doctor',
          targetUser: record.user,
          resourceType: 'HealthRecord',
          resourceId: record._id.toString(),
          details: { reason: 'No active share grant found for record' }
        });
        return res.status(403).json({ success: false, error: 'Not authorized to view this patient record' });
      }

      // Record access in share history and AuditLog
      activeShare.accessHistory.push({
        action: 'view',
        recordId: record._id,
        doctorIp: req.ip || ''
      });
      await activeShare.save();

      await AuditLog.create({
        action: 'RECORD_VIEW',
        actor: req.user.id,
        actorRole: 'doctor',
        targetUser: record.user,
        resourceType: 'HealthRecord',
        resourceId: record._id.toString(),
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent') || '',
        details: { shareId: activeShare._id.toString() }
      });

      return res.status(200).json({ success: true, data: record, permissions: activeShare.permissions });
    }

    // Neither owner nor doctor
    await AuditLog.create({
      action: 'ACCESS_DENIED',
      actor: req.user.id,
      actorRole: req.user.role,
      targetUser: record.user,
      resourceType: 'HealthRecord',
      resourceId: record._id.toString(),
      details: { reason: 'Unauthorized third-party access attempt' }
    });

    return res.status(403).json({ success: false, error: 'Not authorized to access this record' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Download health record file with permission verification
// @route   GET /api/records/:id/download
// @access  Private
exports.downloadRecord = async (req, res) => {
  try {
    const record = await HealthRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Health record not found' });
    }

    const isOwner = record.user.toString() === req.user.id;
    const isDoctor = req.user.role === 'doctor';

    if (!isOwner && !isDoctor && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    if (isDoctor) {
      // Check share grant includes 'download' permission
      const activeShare = await RecordShare.findOne({
        doctor: req.user.id,
        patient: record.user,
        status: 'active',
        expiresAt: { $gt: new Date() },
        $or: [
          { allRecords: true },
          { records: record._id }
        ]
      });

      if (!activeShare) {
        return res.status(403).json({ success: false, error: 'No active share grant for this record' });
      }

      if (!activeShare.permissions.includes('download')) {
        await AuditLog.create({
          action: 'ACCESS_DENIED',
          actor: req.user.id,
          actorRole: 'doctor',
          targetUser: record.user,
          resourceType: 'HealthRecord',
          resourceId: record._id.toString(),
          details: { reason: 'Doctor attempted download without download permission' }
        });
        return res.status(403).json({
          success: false,
          error: 'Download permission not granted. Patient has granted read-only view permission.'
        });
      }

      // Log download in accessHistory and AuditLog
      activeShare.accessHistory.push({
        action: 'download',
        recordId: record._id,
        doctorIp: req.ip || ''
      });
      await activeShare.save();

      await AuditLog.create({
        action: 'RECORD_DOWNLOAD',
        actor: req.user.id,
        actorRole: 'doctor',
        targetUser: record.user,
        resourceType: 'HealthRecord',
        resourceId: record._id.toString(),
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent') || '',
        details: { shareId: activeShare._id.toString() }
      });
    }

    if (!record.fileUrl) {
      return res.status(404).json({ success: false, error: 'No attached file for this record' });
    }

    const filePath = path.join(__dirname, '../..', record.fileUrl);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found on storage server' });
    }

    res.download(filePath, record.name + path.extname(filePath));
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Create new health record
// @route   POST /api/records
// @access  Private
exports.createRecord = async (req, res) => {
  try {
    const { name, category, date, notes } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Please provide record name' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Please upload a file' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;

    const record = await HealthRecord.create({
      user: req.user.id,
      name,
      category: category || 'Other',
      date: date || new Date(),
      fileUrl,
      notes: notes || ''
    });

    res.status(201).json({ success: true, data: record });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Delete health record (Owner only)
// @route   DELETE /api/records/:id
// @access  Private
exports.deleteRecord = async (req, res) => {
  try {
    const record = await HealthRecord.findById(req.params.id);

    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    // Verify owner - doctors can NEVER delete patient records
    if (record.user.toString() !== req.user.id) {
      return res.status(401).json({ success: false, error: 'Not authorized' });
    }

    // Delete associated file if it exists
    if (record.fileUrl) {
      const filePath = path.join(__dirname, '../..', record.fileUrl);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await record.deleteOne();

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
