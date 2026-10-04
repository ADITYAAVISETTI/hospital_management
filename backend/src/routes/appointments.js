const router = require('express').Router();
const Appointment = require('../models/Appointment');
const Doctor = require('../models/Doctor');
const User = require('../models/User');
const config = require('../config');
const { nextSequence } = require('../models/Counter');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate, Joi, objectId, date, time } = require('../middleware/validate');
const { badRequest, forbidden, notFound, conflict } = require('../utils/httpError');
const clock = require('../utils/time');
const { assertBookable } = require('../services/booking');
const { appointmentBooked, appointmentRescheduled, appointmentCancelled, notify } = require('../services/notifications');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function populateAppointment(query) {
  return query
    .populate('patient', 'name email phone uhid gender dateOfBirth bloodGroup guardian relation')
    .populate({ path: 'doctor', select: 'specialization user photo', populate: { path: 'user', select: 'name' } })
    .populate('department', 'name slug');
}

/** Shapes an appointment for the viewer. Internal doctor notes are hidden from patients. */
function formatAppointment(a, viewerRole) {
  const out = {
    id: a._id,
    appointmentNo: a.appointmentNo,
    date: a.date,
    time: a.time,
    status: a.status,
    reason: a.reason,
    fee: a.fee,
    bookedBy: a.bookedBy || 'patient',
    rescheduleCount: a.rescheduleCount || 0,
    doctor: a.doctor
      ? {
          id: a.doctor._id,
          name: a.doctor.user ? a.doctor.user.name : 'Unknown',
          specialization: a.doctor.specialization,
          photo: a.doctor.photo || '',
        }
      : null,
    department: a.department ? { name: a.department.name, slug: a.department.slug } : null,
    patient: a.patient
      ? {
          id: a.patient._id,
          name: a.patient.name,
          uhid: a.patient.uhid,
          phone: a.patient.phone,
          email: a.patient.email || '',
          gender: a.patient.gender,
          dateOfBirth: a.patient.dateOfBirth,
          bloodGroup: a.patient.bloodGroup,
          relation: a.patient.relation || '',
          isDependant: Boolean(a.patient.guardian),
        }
      : null,
    diagnosis: a.diagnosis,
    prescription: a.prescription,
    cancelReason: a.cancelReason,
    cancelledBy: a.cancelledBy,
    feedback: a.feedback && a.feedback.rating
      ? { rating: a.feedback.rating, comment: a.feedback.comment, createdAt: a.feedback.createdAt, ...(viewerRole === 'admin' && { hidden: a.feedback.hidden }) }
      : null,
    createdAt: a.createdAt,
  };
  if (viewerRole !== 'patient') out.doctorNotes = a.doctorNotes;
  return out;
}

const sortNewestFirst = { date: -1, time: -1 };

/** The patient login that manages an appointment (older records have no `account`). */
const accountOf = (appt) => String(appt.account || (appt.patient && appt.patient._id) || appt.patient);

async function getViewableAppointment(req) {
  const appt = await populateAppointment(Appointment.findById(req.params.id));
  if (!appt) throw notFound('Appointment not found.');
  const { role, _id } = req.user;
  // The managing login, or the patient themselves (a family member who was later given their own login).
  const isOwnerPatient =
    role === 'patient' && (accountOf(appt) === String(_id) || String(appt.patient && appt.patient._id) === String(_id));
  const isOwnerDoctor = role === 'doctor' && appt.doctor && appt.doctor.user && String(appt.doctor.user._id) === String(_id);
  if (!(role === 'admin' || isOwnerPatient || isOwnerDoctor)) throw notFound('Appointment not found.');
  return appt;
}

async function doctorProfileFor(user) {
  const doctor = await Doctor.findOne({ user: user._id });
  if (!doctor) throw forbidden('No doctor profile is linked to this account.');
  return doctor;
}

const idParam = validate(Joi.object({ id: objectId.required() }), 'params');

router.use(authenticate);

// ---- Booking (patients for themselves / family; admin for anyone) --------

const bookSchema = Joi.object({
  doctor: objectId.required(),
  date: date.required(),
  time: time.required(),
  reason: Joi.string().trim().max(500).allow(''),
  // Patient: optional family member id. Admin (front desk): required.
  patient: objectId,
});

/** Works out who the appointment is for and which login manages it. */
async function resolvePatient(req) {
  if (req.user.role === 'admin') {
    if (!req.body.patient) throw badRequest('Choose the patient to book for.');
    const patient = await User.findOne({ _id: req.body.patient, role: 'patient' });
    if (!patient) throw notFound('Patient not found.');
    return { patient, account: patient.guardian || patient._id, bookedBy: 'admin' };
  }
  const me = req.user;
  if (!req.body.patient || String(req.body.patient) === String(me._id)) {
    // A family member with their own login stays managed by their guardian (as for front-desk bookings).
    return { patient: me, account: me.guardian || me._id, bookedBy: 'patient' };
  }
  const member = await User.findOne({ _id: req.body.patient, guardian: me._id });
  if (!member) throw notFound('Family member not found.');
  return { patient: member, account: me._id, bookedBy: 'patient' };
}

router.post('/', requireRole('patient', 'admin'), validate(bookSchema), async (req, res) => {
  const { doctor: doctorId, date: day, time: slot, reason } = req.body;
  const { patient, account, bookedBy } = await resolvePatient(req);

  const doctor = await Doctor.findOne({ _id: doctorId, active: true });
  if (!doctor) throw notFound('Doctor not found.');
  await assertBookable({ doctor, day, slot, patientId: patient._id });

  const seq = await nextSequence('appointment');
  const created = await Appointment.create({
    appointmentNo: `APT${String(seq).padStart(6, '0')}`,
    patient: patient._id,
    account,
    bookedBy,
    doctor: doctor._id,
    department: doctor.department,
    date: day,
    time: slot,
    reason,
    fee: doctor.consultationFee,
  });
  notify(appointmentBooked, created);
  const appt = await populateAppointment(Appointment.findById(created._id));
  res.status(201).json(formatAppointment(appt, req.user.role));
});

router.get('/mine', requireRole('patient'), async (req, res) => {
  const me = req.user._id;
  const list = await populateAppointment(
    Appointment.find({ $or: [{ account: me }, { patient: me }] }).sort(sortNewestFirst)
  );
  res.json(list.map((a) => formatAppointment(a, 'patient')));
});

// ---- Doctors --------------------------------------------------------------

const doctorListQuery = Joi.object({
  date: date,
  from: date,
  to: date,
  status: Joi.string().valid(...Appointment.STATUSES),
});

router.get('/for-doctor', requireRole('doctor'), validate(doctorListQuery, 'query'), async (req, res) => {
  const doctor = await doctorProfileFor(req.user);
  const { date: day, from, to, status } = req.validQuery;
  const filter = { doctor: doctor._id };
  if (day) filter.date = day;
  else if (from || to) filter.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  if (status) filter.status = status;
  const list = await populateAppointment(Appointment.find(filter).sort({ date: 1, time: 1 }));
  res.json(list.map((a) => formatAppointment(a, 'doctor')));
});

const consultSchema = Joi.object({
  status: Joi.string().valid('completed', 'no-show').required(),
  diagnosis: Joi.string().trim().max(2000).allow(''),
  prescription: Joi.string().trim().max(4000).allow(''),
  doctorNotes: Joi.string().trim().max(4000).allow(''),
});

router.patch('/:id/consult', requireRole('doctor'), idParam, validate(consultSchema), async (req, res) => {
  const appt = await getViewableAppointment(req);
  if (appt.status === 'cancelled') throw conflict('This appointment was cancelled.');
  if (appt.date > clock.todayString()) {
    throw badRequest('You can only record a consultation on or after the appointment day.');
  }
  if (appt.feedback && appt.feedback.rating && req.body.status !== 'completed') {
    throw conflict('The patient has already rated this visit, so it must stay completed.');
  }
  Object.assign(appt, req.body);
  await appt.save();
  res.json(formatAppointment(appt, 'doctor'));
});

// ---- Admin ----------------------------------------------------------------

const adminListQuery = Joi.object({
  status: Joi.string().valid(...Appointment.STATUSES),
  date: date,
  from: date,
  to: date,
  doctor: objectId,
  department: objectId,
  patient: objectId,
  q: Joi.string().trim().max(80).allow(''),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

/** Mongo filter for the admin list and the CSV export. */
async function adminFilter(query) {
  const { status, date: day, from, to, doctor, department, patient, q } = query;
  const filter = {};
  if (status) filter.status = status;
  if (day) filter.date = day;
  else if (from || to) filter.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  if (doctor) filter.doctor = doctor;
  if (department) filter.department = department;
  if (patient) filter.patient = patient;
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const patients = await User.find({ role: 'patient', $or: [{ name: rx }, { uhid: rx }, { phone: rx }] }).distinct('_id');
    filter.$or = [{ appointmentNo: rx }, { patient: { $in: patients } }];
  }
  return filter;
}

router.get('/', requireRole('admin'), validate(adminListQuery, 'query'), async (req, res) => {
  const { page, limit } = req.validQuery;
  const filter = await adminFilter(req.validQuery);
  const [total, list] = await Promise.all([
    Appointment.countDocuments(filter),
    populateAppointment(Appointment.find(filter).sort(sortNewestFirst).skip((page - 1) * limit).limit(limit)),
  ]);
  res.json({
    items: list.map((a) => formatAppointment(a, 'admin')),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

router.patch(
  '/:id/status',
  requireRole('admin'),
  idParam,
  validate(Joi.object({ status: Joi.string().valid(...Appointment.STATUSES).required() })),
  async (req, res) => {
    const appt = await getViewableAppointment(req);
    const { status } = req.body;
    const wasCancelled = appt.status === 'cancelled';
    if (wasCancelled && status !== 'cancelled') {
      // Restoring a cancelled appointment takes its slot back.
      const taken = await Appointment.findOne({
        _id: { $ne: appt._id },
        doctor: appt.doctor._id,
        date: appt.date,
        time: appt.time,
        holdsSlot: true,
      }).select('appointmentNo');
      if (taken) throw conflict(`This slot has since been booked by another appointment (${taken.appointmentNo}), so it cannot be restored.`);
      if (status === 'scheduled') {
        // Back to an upcoming visit: the usual booking rules apply (not past, no holiday/leave, …).
        const doctor = await Doctor.findOne({ _id: appt.doctor._id, active: true });
        if (!doctor) throw badRequest('This doctor is no longer available, so the appointment cannot be restored.');
        await assertBookable({ doctor, day: appt.date, slot: appt.time, patientId: appt.patient._id, ignoreId: appt._id });
      }
    }
    appt.status = status;
    appt.holdsSlot = status !== 'cancelled';
    if (status === 'cancelled') {
      appt.cancelledBy = 'admin';
    } else {
      appt.cancelledBy = '';
      appt.cancelReason = '';
    }
    await appt.save(); // unique index rejects re-opening a slot someone else has taken
    if (status === 'cancelled' && !wasCancelled) notify(appointmentCancelled, appt);
    res.json(formatAppointment(appt, 'admin'));
  }
);

router.patch(
  '/:id/feedback/visibility',
  requireRole('admin'),
  idParam,
  validate(Joi.object({ hidden: Joi.boolean().required() })),
  async (req, res) => {
    const appt = await getViewableAppointment(req);
    if (!appt.feedback || !appt.feedback.rating) throw notFound('This appointment has no feedback.');
    appt.feedback.hidden = req.body.hidden;
    await appt.save();
    res.json(formatAppointment(appt, 'admin'));
  }
);

// ---- Shared ---------------------------------------------------------------

router.get('/:id', idParam, async (req, res) => {
  const appt = await getViewableAppointment(req);
  res.json(formatAppointment(appt, req.user.role));
});

router.patch(
  '/:id/cancel',
  idParam,
  validate(Joi.object({ reason: Joi.string().trim().max(300).allow('') })),
  async (req, res) => {
    const appt = await getViewableAppointment(req);
    if (appt.status !== 'scheduled') throw conflict(`This appointment is already ${appt.status}.`);
    if (req.user.role === 'patient' && clock.isPast(appt.date, appt.time)) {
      throw badRequest('This appointment time has already passed and can no longer be cancelled online.');
    }
    appt.status = 'cancelled';
    appt.holdsSlot = false;
    appt.cancelledBy = req.user.role;
    appt.cancelReason = req.body.reason || '';
    await appt.save();
    notify(appointmentCancelled, appt);
    res.json(formatAppointment(appt, req.user.role));
  }
);

// Move to another slot with the same doctor (patient who owns it, or admin).
router.patch(
  '/:id/reschedule',
  requireRole('patient', 'admin'),
  idParam,
  validate(Joi.object({ date: date.required(), time: time.required() })),
  async (req, res) => {
    const appt = await getViewableAppointment(req);
    if (appt.status !== 'scheduled') throw conflict(`This appointment is ${appt.status} and cannot be rescheduled.`);
    const isPatient = req.user.role === 'patient';
    if (isPatient && clock.isPast(appt.date, appt.time)) {
      throw badRequest('This appointment time has already passed and can no longer be rescheduled online.');
    }
    if (isPatient && appt.rescheduleCount >= config.maxReschedules) {
      throw badRequest(`An appointment can be rescheduled online up to ${config.maxReschedules} times. Please call us to change it again.`);
    }
    const { date: day, time: slot } = req.body;
    if (day === appt.date && slot === appt.time) throw badRequest('Please choose a different date or time.');

    const doctor = await Doctor.findOne({ _id: appt.doctor._id, active: true });
    if (!doctor) throw badRequest('This doctor is no longer available. Please cancel and book with another doctor.');
    await assertBookable({ doctor, day, slot, patientId: appt.patient._id, ignoreId: appt._id });

    appt.date = day;
    appt.time = slot;
    appt.rescheduleCount = (appt.rescheduleCount || 0) + 1;
    appt.reminderSentAt = undefined;
    await appt.save(); // unique index: 409 if someone took the slot meanwhile
    notify(appointmentRescheduled, appt);
    res.json(formatAppointment(appt, req.user.role));
  }
);

// Patient rates a completed visit (once).
router.patch(
  '/:id/feedback',
  requireRole('patient'),
  idParam,
  validate(Joi.object({ rating: Joi.number().integer().min(1).max(5).required(), comment: Joi.string().trim().max(1000).allow('') })),
  async (req, res) => {
    const appt = await getViewableAppointment(req);
    if (appt.status !== 'completed') throw badRequest('You can leave feedback after the consultation is completed.');
    if (appt.feedback && appt.feedback.rating) throw conflict('You have already given feedback for this visit. Thank you!');
    appt.feedback = { rating: req.body.rating, comment: req.body.comment || '', createdAt: new Date() };
    await appt.save();
    res.json(formatAppointment(appt, 'patient'));
  }
);

module.exports = router;
module.exports.adminFilter = adminFilter;
module.exports.populateAppointment = populateAppointment;
