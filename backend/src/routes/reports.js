// Medical reports (lab results, scans, discharge summaries) as PDF/image files.
// Files live in backend/uploads/reports/ and are only served through the
// permission check below, never as public static files.
const router = require('express').Router();
const Report = require('../models/Report');
const User = require('../models/User');
const Doctor = require('../models/Doctor');
const Appointment = require('../models/Appointment');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate, Joi, objectId, date } = require('../middleware/validate');
const { badRequest, forbidden, notFound } = require('../utils/httpError');
const { decodeUpload, saveUpload, removeUpload, uploadPath, randomName } = require('../utils/files');
const clock = require('../utils/time');

const MAX_BYTES = 5 * 1024 * 1024;

function format(r) {
  return {
    id: r._id,
    patient: r.patient && r.patient.name ? { id: r.patient._id, name: r.patient.name, uhid: r.patient.uhid } : { id: r.patient },
    title: r.title,
    category: r.category,
    reportDate: r.reportDate,
    notes: r.notes,
    fileName: r.fileName,
    mimeType: r.mimeType,
    size: r.size,
    uploadedBy: r.uploadedBy || null,
    uploadedByName: r.uploadedByName,
    createdAt: r.createdAt,
  };
}

/** A doctor may work with a patient they have a (non-cancelled) appointment with. */
async function doctorTreats(user, patientId) {
  const doctor = await Doctor.findOne({ user: user._id }).select('_id');
  return Boolean(
    doctor && (await Appointment.exists({ doctor: doctor._id, patient: patientId, status: { $ne: 'cancelled' } }))
  );
}

async function canAccessPatient(user, patientId) {
  if (user.role === 'admin') return true;
  if (user.role === 'doctor') return doctorTreats(user, patientId);
  if (String(patientId) === String(user._id)) return true;
  return Boolean(await User.exists({ _id: patientId, guardian: user._id }));
}

const idParam = validate(Joi.object({ id: objectId.required() }), 'params');

router.use(authenticate);

// Patient: own reports and those of family members.
router.get('/mine', requireRole('patient'), async (req, res) => {
  const ids = [req.user._id, ...(await User.find({ guardian: req.user._id }).distinct('_id'))];
  const list = await Report.find({ patient: { $in: ids } }).sort({ reportDate: -1, createdAt: -1 }).populate('patient', 'name uhid').lean();
  res.json(list.map(format));
});

// Staff: reports for one patient.
router.get('/', requireRole('admin', 'doctor'), validate(Joi.object({ patient: objectId.required() }), 'query'), async (req, res) => {
  const { patient } = req.validQuery;
  if (!(await canAccessPatient(req.user, patient))) throw forbidden('You can only see reports of your own patients.');
  const list = await Report.find({ patient }).sort({ reportDate: -1, createdAt: -1 }).populate('patient', 'name uhid').lean();
  res.json(list.map(format));
});

const uploadSchema = Joi.object({
  patient: objectId.required(),
  title: Joi.string().trim().min(2).max(120).required(),
  category: Joi.string().valid(...Report.CATEGORIES).default('lab'),
  reportDate: date.required(),
  notes: Joi.string().trim().max(1000).allow(''),
  fileName: Joi.string().trim().min(1).max(200).required(),
  data: Joi.string().required(),
});

router.post('/', requireRole('admin', 'doctor'), validate(uploadSchema), async (req, res) => {
  const { patient: patientId, data, fileName, ...fields } = req.body;
  if (!clock.isValidDateString(fields.reportDate) || fields.reportDate > clock.todayString()) {
    throw badRequest('Report date must be today or earlier.');
  }
  const patient = await User.findOne({ _id: patientId, role: 'patient' });
  if (!patient) throw notFound('Patient not found.');
  if (!(await canAccessPatient(req.user, patient._id))) throw forbidden('You can only upload reports for your own patients.');

  const file = decodeUpload(data, { allowed: ['application/pdf', 'image/jpeg', 'image/png'], maxBytes: MAX_BYTES });
  const storedName = randomName(file.ext);
  await saveUpload('reports', storedName, file.buffer);
  try {
    const report = await Report.create({
      ...fields,
      patient: patient._id,
      fileName: fileName.replace(/[\\/:*?"<>|\r\n]+/g, '_'),
      mimeType: file.mime,
      size: file.buffer.length,
      storedName,
      uploadedBy: req.user._id,
      uploadedByName: req.user.name,
    });
    await report.populate('patient', 'name uhid');
    res.status(201).json(format(report));
  } catch (err) {
    await removeUpload('reports', storedName);
    throw err;
  }
});

router.get('/:id/file', idParam, async (req, res) => {
  const report = await Report.findById(req.params.id);
  if (!report || !(await canAccessPatient(req.user, report.patient))) throw notFound('Report not found.');
  res.set('Content-Type', report.mimeType);
  res.set('Content-Disposition', `attachment; filename="${report.fileName.replace(/"/g, '')}"`);
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(uploadPath('reports', report.storedName), (err) => {
    if (err && !res.headersSent) res.status(404).json({ message: 'The report file is missing. Please contact the hospital.' });
  });
});

router.delete('/:id', requireRole('admin', 'doctor'), idParam, async (req, res) => {
  const report = await Report.findById(req.params.id);
  if (!report) throw notFound('Report not found.');
  if (req.user.role === 'doctor' && String(report.uploadedBy) !== String(req.user._id)) {
    throw forbidden('Doctors can only delete reports they uploaded.');
  }
  await removeUpload('reports', report.storedName);
  await report.deleteOne();
  res.json({ message: 'Report deleted.' });
});

module.exports = router;
