const DoctorProfile = require('../models/DoctorProfile');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');

// @desc    Get all verified doctors (for patient record sharing selection)
// @route   GET /api/doctors/verified
// @access  Public or Private
exports.getVerifiedDoctors = async (req, res) => {
  try {
    const verifiedDoctors = await DoctorProfile.find({ verificationStatus: 'verified' })
      .select('user name specialization hospitalAffiliation qualifications experienceYears bio')
      .sort({ name: 1 });

    res.status(200).json({
      success: true,
      count: verifiedDoctors.length,
      data: verifiedDoctors
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Get pending doctors awaiting verification (Admin/HealthWorker only)
// @route   GET /api/doctors/pending
// @access  Private (Admin / HealthWorker)
exports.getPendingDoctors = async (req, res) => {
  try {
    const isStaff = req.user.role === 'admin' || req.user.role === 'health_worker';
    if (!isStaff) {
      return res.status(403).json({ success: false, error: 'Not authorized to view pending doctor applications' });
    }

    const pending = await DoctorProfile.find({ verificationStatus: 'pending' })
      .populate('user', 'email phone createdAt')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: pending.length,
      data: pending
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Verify or reject a doctor's credentials (Admin/HealthWorker only)
// @route   PATCH /api/doctors/:id/verify
// @access  Private (Admin / HealthWorker)
exports.verifyDoctor = async (req, res) => {
  try {
    const isStaff = req.user.role === 'admin' || req.user.role === 'health_worker';
    if (!isStaff) {
      return res.status(403).json({ success: false, error: 'Not authorized to verify medical credentials' });
    }

    const { status, rejectionReason } = req.body;
    if (!status || !['verified', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status must be either "verified" or "rejected"' });
    }

    const doctorProfile = await DoctorProfile.findById(req.params.id);
    if (!doctorProfile) {
      return res.status(404).json({ success: false, error: 'Doctor profile not found' });
    }

    doctorProfile.verificationStatus = status;
    doctorProfile.verifiedBy = req.user.id;
    doctorProfile.verifiedAt = new Date();
    if (status === 'rejected') {
      doctorProfile.rejectionReason = rejectionReason || 'Documentation did not meet verification criteria';
    } else {
      doctorProfile.rejectionReason = '';
    }

    await doctorProfile.save();

    // Log administrative action in AuditLog
    await AuditLog.create({
      action: status === 'verified' ? 'DOCTOR_VERIFIED' : 'DOCTOR_REJECTED',
      actor: req.user.id,
      actorRole: req.user.role,
      targetUser: doctorProfile.user,
      resourceType: 'DoctorProfile',
      resourceId: doctorProfile._id.toString(),
      ipAddress: req.ip || '',
      userAgent: req.get('user-agent') || '',
      details: {
        medicalRegistrationNumber: doctorProfile.medicalRegistrationNumber,
        status,
        rejectionReason: doctorProfile.rejectionReason
      }
    });

    // Notify doctor
    await Notification.create({
      user: doctorProfile.user,
      title: status === 'verified' ? 'Medical Credentials Verified' : 'Credential Verification Update',
      message: status === 'verified'
        ? 'Your professional credentials have been verified. Patients can now securely share medical records with you.'
        : `Your verification request was not approved: ${doctorProfile.rejectionReason}`,
      type: 'Health'
    });

    res.status(200).json({
      success: true,
      message: `Doctor status updated to ${status}`,
      data: doctorProfile
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Get currently authenticated doctor's profile
// @route   GET /api/doctors/profile/me
// @access  Private (Doctor only)
exports.getMyDoctorProfile = async (req, res) => {
  try {
    if (req.user.role !== 'doctor' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Only doctors can access professional profile' });
    }

    let profile = await DoctorProfile.findOne({ user: req.user.id });
    if (!profile) {
      profile = await DoctorProfile.create({
        user: req.user.id,
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone || '',
        medicalRegistrationNumber: `DOC-${Date.now()}`,
        specialization: 'General Medicine',
        hospitalAffiliation: 'Affiliated Hospital',
        verificationStatus: 'pending'
      });
    }

    res.status(200).json({
      success: true,
      data: profile
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Update authenticated doctor's credentials/bio
// @route   PUT /api/doctors/profile/me
// @access  Private (Doctor only)
exports.updateMyDoctorProfile = async (req, res) => {
  try {
    if (req.user.role !== 'doctor' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Only doctors can update professional credentials' });
    }

    let profile = await DoctorProfile.findOne({ user: req.user.id });
    if (!profile) {
      profile = new DoctorProfile({ user: req.user.id });
    }

    const {
      medicalRegistrationNumber,
      specialization,
      hospitalAffiliation,
      qualifications,
      experienceYears,
      bio
    } = req.body;

    if (medicalRegistrationNumber && medicalRegistrationNumber !== profile.medicalRegistrationNumber) {
      profile.medicalRegistrationNumber = medicalRegistrationNumber;
      profile.verificationStatus = 'pending'; // Re-trigger verification if license changed
    }

    if (specialization) profile.specialization = specialization;
    if (hospitalAffiliation) profile.hospitalAffiliation = hospitalAffiliation;
    if (qualifications) profile.qualifications = Array.isArray(qualifications) ? qualifications : [qualifications];
    if (experienceYears !== undefined) profile.experienceYears = Number(experienceYears);
    if (bio !== undefined) profile.bio = bio;

    profile.name = req.user.name;
    profile.email = req.user.email;
    profile.phone = req.user.phone || '';

    await profile.save();

    res.status(200).json({
      success: true,
      message: 'Doctor profile updated',
      data: profile
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
