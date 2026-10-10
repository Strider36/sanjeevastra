const RecordShare = require('../models/RecordShare');
const DoctorProfile = require('../models/DoctorProfile');
const HealthRecord = require('../models/HealthRecord');
const User = require('../models/User');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');

// @desc    Patient grants medical record access to a verified doctor
// @route   POST /api/shares
// @access  Private (Patient)
exports.createShare = async (req, res) => {
  try {
    const { doctorId, records, allRecords, permissions, expiresAt, reason } = req.body;

    if (!doctorId) {
      return res.status(400).json({ success: false, error: 'Please specify the doctor recipient' });
    }

    if (!expiresAt) {
      return res.status(400).json({ success: false, error: 'Please specify an access expiration date' });
    }

    const expiryDate = new Date(expiresAt);
    if (isNaN(expiryDate.getTime()) || expiryDate <= new Date()) {
      return res.status(400).json({ success: false, error: 'Expiration date must be a valid future date' });
    }

    // 1. Verify doctor exists and has verified professional status
    const doctorProfile = await DoctorProfile.findOne({
      $or: [{ user: doctorId }, { _id: doctorId }]
    });

    if (!doctorProfile) {
      return res.status(404).json({ success: false, error: 'Doctor profile not found' });
    }

    if (doctorProfile.verificationStatus !== 'verified') {
      return res.status(403).json({
        success: false,
        error: 'Cannot share records with unverified doctor. Only verified doctors can access patient records.'
      });
    }

    const targetDoctorUserId = doctorProfile.user;

    // 2. Validate selected records belong to authenticated patient
    let recordIds = [];
    if (!allRecords && Array.isArray(records) && records.length > 0) {
      const ownedRecords = await HealthRecord.find({
        _id: { $in: records },
        user: req.user.id
      }).select('_id');

      recordIds = ownedRecords.map(r => r._id);
      if (recordIds.length === 0) {
        return res.status(400).json({ success: false, error: 'None of the specified records were found in your library' });
      }
    } else if (!allRecords) {
      return res.status(400).json({ success: false, error: 'Please select specific records or check "all records"' });
    }

    // 3. Normalize permissions (default ['read'])
    let grantedPerms = ['read'];
    if (Array.isArray(permissions)) {
      grantedPerms = permissions.filter(p => ['read', 'download'].includes(p));
      if (!grantedPerms.includes('read')) grantedPerms.push('read');
    }

    // 4. Create RecordShare grant
    const share = await RecordShare.create({
      patient: req.user.id,
      doctor: targetDoctorUserId,
      doctorProfile: doctorProfile._id,
      records: recordIds,
      allRecords: !!allRecords,
      permissions: grantedPerms,
      status: 'active',
      expiresAt: expiryDate,
      reason: reason || 'Patient consultation'
    });

    // 5. Audit Log Entry
    await AuditLog.create({
      action: 'SHARE_GRANT',
      actor: req.user.id,
      actorRole: req.user.role || 'patient',
      targetUser: targetDoctorUserId,
      resourceType: 'RecordShare',
      resourceId: share._id.toString(),
      ipAddress: req.ip || '',
      userAgent: req.get('user-agent') || '',
      details: {
        recordCount: allRecords ? 'All Records' : recordIds.length,
        permissions: grantedPerms,
        expiresAt: expiryDate,
        reason
      }
    });

    // 6. Safe Notification to Doctor (zero sensitive health secrets in payload)
    const recordCountText = allRecords ? 'all current medical records' : `${recordIds.length} medical record(s)`;
    await Notification.create({
      user: targetDoctorUserId,
      title: 'New Medical Records Shared',
      message: `Patient ${req.user.name} has granted you ${grantedPerms.join('/')} access to ${recordCountText} until ${expiryDate.toLocaleDateString()}.`,
      type: 'Health'
    });

    res.status(201).json({
      success: true,
      message: 'Access granted securely to doctor',
      data: share
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Patient gets all record shares they have granted
// @route   GET /api/shares/sent
// @access  Private (Patient)
exports.getSentShares = async (req, res) => {
  try {
    const shares = await RecordShare.find({ patient: req.user.id })
      .populate('doctor', 'name email phone')
      .populate('doctorProfile', 'name specialization hospitalAffiliation verificationStatus')
      .populate('records', 'name category date')
      .sort({ createdAt: -1 });

    const now = new Date();
    // Update expired statuses
    for (const share of shares) {
      if (share.status === 'active' && share.expiresAt < now) {
        share.status = 'expired';
        await share.save();
      }
    }

    res.status(200).json({
      success: true,
      count: shares.length,
      data: shares
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Doctor gets all active shares granted to them
// @route   GET /api/shares/received
// @access  Private (Doctor)
exports.getReceivedShares = async (req, res) => {
  try {
    if (req.user.role !== 'doctor' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Only doctors can access shared patient records' });
    }

    // Verify doctor is approved
    const profile = await DoctorProfile.findOne({ user: req.user.id });
    if (!profile || profile.verificationStatus !== 'verified') {
      return res.status(403).json({
        success: false,
        error: 'Your doctor credentials have not been verified yet. Patient records cannot be viewed until verified.'
      });
    }

    const now = new Date();
    const shares = await RecordShare.find({
      doctor: req.user.id,
      status: 'active',
      expiresAt: { $gt: now }
    })
      .populate('patient', 'name email phone age gender bloodGroup')
      .populate('records', 'name category date fileUrl notes')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: shares.length,
      data: shares
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Patient revokes sharing access
// @route   PUT /api/shares/:id/revoke
// @access  Private (Patient)
exports.revokeShare = async (req, res) => {
  try {
    const share = await RecordShare.findById(req.params.id);
    if (!share) {
      return res.status(404).json({ success: false, error: 'Share record not found' });
    }

    // Verify ownership
    if (!share.patient.equals(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Not authorized to revoke this share' });
    }

    if (share.status === 'revoked') {
      return res.status(400).json({ success: false, error: 'Share has already been revoked' });
    }

    share.status = 'revoked';
    share.revokedAt = new Date();
    share.revokedReason = req.body.reason || 'Revoked by patient';
    await share.save();

    // Log in AuditLog
    await AuditLog.create({
      action: 'SHARE_REVOKE',
      actor: req.user.id,
      actorRole: req.user.role || 'patient',
      targetUser: share.doctor,
      resourceType: 'RecordShare',
      resourceId: share._id.toString(),
      ipAddress: req.ip || '',
      userAgent: req.get('user-agent') || '',
      details: {
        revokedReason: share.revokedReason
      }
    });

    // Notify doctor safely
    await Notification.create({
      user: share.doctor,
      title: 'Record Access Revoked',
      message: `Patient ${req.user.name} has revoked sharing permissions for their medical records.`,
      type: 'Health'
    });

    res.status(200).json({
      success: true,
      message: 'Access has been revoked successfully',
      data: share
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Get record access audit logs for authenticated patient
// @route   GET /api/shares/audit
// @access  Private
exports.getShareAuditLogs = async (req, res) => {
  try {
    const logs = await AuditLog.find({
      $or: [{ actor: req.user.id }, { targetUser: req.user.id }]
    })
      .populate('actor', 'name role')
      .populate('targetUser', 'name role')
      .sort({ timestamp: -1 })
      .limit(100);

    res.status(200).json({
      success: true,
      count: logs.length,
      data: logs
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
