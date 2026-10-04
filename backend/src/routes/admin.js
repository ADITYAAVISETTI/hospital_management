const router = require('express').Router();
const User = require('../models/User');
const Doctor = require('../models/Doctor');
const Department = require('../models/Department');
const Appointment = require('../models/Appointment');
const Enquiry = require('../models/Enquiry');
const PackageBooking = require('../models/PackageBooking');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate, Joi, objectId, email, phone, date } = require('../middleware/validate');
const { badRequest, notFound, conflict } = require('../utils/httpError');
const { toCsv, sendCsv } = require('../utils/csv');
const clock = require('../utils/time');
const { adminFilter, populateAppointment } = require('./appointments');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.use(authenticate, requireRole('admin'));

router.get('/stats', async (req, res) => {
  const today = clock.todayString();
  const weekStart = clock.addDays(today, -6);

  const [patients, doctors, departments, todayCount, upcoming, newEnquiries, pendingCheckups, rating, byStatus, lastWeek, byDepartment] =
    await Promise.all([
      User.countDocuments({ role: 'patient' }),
      Doctor.countDocuments({ active: true }),
      Department.countDocuments({ active: true }),
      Appointment.countDocuments({ date: today, status: { $ne: 'cancelled' } }),
      Appointment.countDocuments({ date: { $gte: today }, status: 'scheduled' }),
      Enquiry.countDocuments({ status: 'new' }),
      PackageBooking.countDocuments({ status: 'requested' }),
      Appointment.aggregate([
        { $match: { 'feedback.rating': { $exists: true } } },
        { $group: { _id: null, avg: { $avg: '$feedback.rating' }, count: { $sum: 1 } } },
      ]),
      Appointment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Appointment.aggregate([
        { $match: { date: { $gte: weekStart, $lte: today }, status: { $ne: 'cancelled' } } },
        { $group: { _id: '$date', count: { $sum: 1 } } },
      ]),
      Appointment.aggregate([
        { $match: { status: { $ne: 'cancelled' } } },
        { $group: { _id: '$department', count: { $sum: 1 } } },
        { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'dept' } },
        { $unwind: '$dept' },
        { $project: { _id: 0, name: '$dept.name', count: 1 } },
        { $sort: { count: -1 } },
      ]),
    ]);

  const perDay = new Map(lastWeek.map((d) => [d._id, d.count]));
  res.json({
    totals: {
      patients,
      doctors,
      departments,
      todayAppointments: todayCount,
      upcomingAppointments: upcoming,
      newEnquiries,
      pendingCheckups,
      averageRating: rating[0] ? Math.round(rating[0].avg * 10) / 10 : 0,
      ratingCount: rating[0] ? rating[0].count : 0,
    },
    byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
    last7Days: Array.from({ length: 7 }, (_, i) => {
      const day = clock.addDays(weekStart, i);
      return { date: day, count: perDay.get(day) || 0 };
    }),
    byDepartment,
  });
});

/* ---------- Patients ---------- */

async function patientRows(q, limit = 200) {
  const filter = { role: 'patient' };
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { uhid: rx }];
  }
  const patients = await User.find(filter).sort({ createdAt: -1 }).limit(limit).populate('guardian', 'name uhid');
  const counts = await Appointment.aggregate([
    { $match: { patient: { $in: patients.map((p) => p._id) } } },
    { $group: { _id: '$patient', count: { $sum: 1 }, last: { $max: '$date' } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c]));
  return patients.map((p) => {
    const c = byId.get(String(p._id));
    return {
      ...p.toPublic(),
      guardian: p.guardian ? { id: p.guardian._id, name: p.guardian.name, uhid: p.guardian.uhid } : null,
      appointmentCount: c ? c.count : 0,
      lastVisit: c ? c.last : null,
    };
  });
}

router.get('/patients', async (req, res) => {
  res.json(await patientRows(String(req.query.q || '').trim().slice(0, 80)));
});

const patientSchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  phone: phone.required(),
  email: email.allow(''),
  dateOfBirth: date.allow(''),
  gender: Joi.string().valid('male', 'female', 'other', ''),
  bloodGroup: Joi.string().valid(...User.BLOOD_GROUPS, ''),
  address: Joi.string().trim().max(300).allow(''),
});

function checkPatientBody(body) {
  if (body.dateOfBirth && body.dateOfBirth > clock.todayString()) throw badRequest('Date of birth cannot be in the future.');
  if (!body.email) delete body.email; // leave unset (unique index)
  return body;
}

// Front desk: register a walk-in / phone patient. No password is set; if an
// email is given, the patient can later use "Forgot password" to get online access.
router.post('/patients', validate(patientSchema), async (req, res) => {
  const body = checkPatientBody(req.body);
  if (body.email && (await User.exists({ email: body.email }))) {
    throw conflict('A patient with this email is already registered. Search for them instead.');
  }
  const patient = await User.create({ ...body, role: 'patient' });
  res.status(201).json(patient.toPublic());
});

router.put(
  '/patients/:id',
  validate(Joi.object({ id: objectId.required() }), 'params'),
  validate(patientSchema.fork(['phone'], (s) => s.allow(''))),
  async (req, res) => {
    const patient = await User.findOne({ _id: req.params.id, role: 'patient' }).select('+password');
    if (!patient) throw notFound('Patient not found.');
    const body = checkPatientBody(req.body);
    if (!body.email) {
      // The email is their login: don't let it be removed from an online account.
      if (patient.password) throw badRequest('This patient logs in with their email, so it cannot be removed.');
      patient.email = undefined;
    }
    Object.assign(patient, body);
    await patient.save();
    res.json(patient.toPublic());
  }
);

/* ---------- CSV exports ---------- */

const exportQuery = Joi.object({
  status: Joi.string().valid(...Appointment.STATUSES),
  date: date,
  from: date,
  to: date,
  doctor: objectId,
  department: objectId,
  q: Joi.string().trim().max(80).allow(''),
});

router.get('/export/appointments.csv', validate(exportQuery, 'query'), async (req, res) => {
  const filter = await adminFilter(req.validQuery);
  const list = await populateAppointment(Appointment.find(filter).sort({ date: -1, time: -1 }).limit(20000)).lean();
  const csv = toCsv(list, [
    ['Appointment No', (a) => a.appointmentNo],
    ['Date', (a) => a.date],
    ['Time', (a) => a.time],
    ['Status', (a) => a.status],
    ['Patient', (a) => a.patient && a.patient.name],
    ['UHID', (a) => a.patient && a.patient.uhid],
    ['Phone', (a) => a.patient && a.patient.phone],
    ['Doctor', (a) => a.doctor && a.doctor.user && a.doctor.user.name],
    ['Department', (a) => a.department && a.department.name],
    ['Fee (INR)', (a) => a.fee],
    ['Reason', (a) => a.reason],
    ['Booked by', (a) => a.bookedBy || 'patient'],
    ['Rating', (a) => (a.feedback ? a.feedback.rating : '')],
    ['Cancel reason', (a) => a.cancelReason],
    ['Booked on', (a) => a.createdAt && a.createdAt.toISOString().slice(0, 10)],
  ]);
  sendCsv(res, `appointments-${clock.todayString()}.csv`, csv);
});

router.get('/export/patients.csv', async (req, res) => {
  const rows = await patientRows(String(req.query.q || '').trim().slice(0, 80), 50000);
  const csv = toCsv(rows, [
    ['UHID', (p) => p.uhid],
    ['Name', (p) => p.name],
    ['Phone', (p) => p.phone],
    ['Email', (p) => p.email],
    ['Date of birth', (p) => p.dateOfBirth],
    ['Gender', (p) => p.gender],
    ['Blood group', (p) => p.bloodGroup],
    ['Address', (p) => p.address],
    ['Family of', (p) => (p.guardian ? `${p.guardian.name} (${p.guardian.uhid})` : '')],
    ['Relation', (p) => p.relation],
    ['Appointments', (p) => p.appointmentCount],
    ['Last visit', (p) => p.lastVisit || ''],
    ['Registered', (p) => p.createdAt && new Date(p.createdAt).toISOString().slice(0, 10)],
  ]);
  sendCsv(res, `patients-${clock.todayString()}.csv`, csv);
});

module.exports = router;
