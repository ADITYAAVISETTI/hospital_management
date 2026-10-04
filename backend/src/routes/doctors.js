const router = require('express').Router();
const mongoose = require('mongoose');
const Doctor = require('../models/Doctor');
const Department = require('../models/Department');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');
const { validate, Joi, objectId, email, password, time, date } = require('../middleware/validate');
const { notFound, badRequest, forbidden } = require('../utils/httpError');
const clock = require('../utils/time');
const { dayAvailability, cancelMatching } = require('../services/booking');
const { appointmentCancelled, notify } = require('../services/notifications');
const { decodeUpload, saveUpload, removeUpload, randomName } = require('../utils/files');

const isAdmin = (req) => Boolean(req.user && req.user.role === 'admin');
const isSelf = (req, doc) => Boolean(req.user && req.user.role === 'doctor' && doc.user && String(doc.user._id || doc.user) === String(req.user._id));

/** Average rating per doctor from visible patient feedback. */
async function ratingsFor(doctorIds) {
  const rows = await Appointment.aggregate([
    { $match: { doctor: { $in: doctorIds }, 'feedback.rating': { $exists: true }, 'feedback.hidden': { $ne: true } } },
    { $group: { _id: '$doctor', avg: { $avg: '$feedback.rating' }, count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { average: Math.round(r.avg * 10) / 10, count: r.count }]));
}

/** Shapes a populated Doctor document for API responses. */
function formatDoctor(doc, { includePrivate = false, rating = null } = {}) {
  const today = clock.todayString();
  const out = {
    id: doc._id,
    name: doc.user ? doc.user.name : 'Unknown',
    gender: doc.user ? doc.user.gender : '',
    department: doc.department
      ? { id: doc.department._id, name: doc.department.name, slug: doc.department.slug }
      : null,
    specialization: doc.specialization,
    qualifications: doc.qualifications,
    experienceYears: doc.experienceYears,
    consultationFee: doc.consultationFee,
    bio: doc.bio,
    languages: doc.languages,
    schedule: doc.schedule,
    slotMinutes: doc.slotMinutes,
    photo: doc.photo || '',
    rating: rating || { average: 0, count: 0 },
    // Public: only current/future leave dates (so booking can grey them out), no reasons.
    leaves: (doc.leaves || [])
      .filter((l) => l.to >= today)
      .map((l) => (includePrivate ? { id: l._id, from: l.from, to: l.to, reason: l.reason } : { from: l.from, to: l.to })),
    active: doc.active,
  };
  if (includePrivate && doc.user) {
    out.email = doc.user.email;
    out.phone = doc.user.phone;
    out.userId = doc.user._id;
  }
  return out;
}

function populateDoctor(query) {
  return query.populate('user', 'name email phone gender').populate('department', 'name slug');
}

/** Doctors matching a filter, sorted by name. Used by departments too. */
async function publicDoctorQuery(filter = {}, { includeInactive = false, includePrivate = false } = {}) {
  const docs = await populateDoctor(Doctor.find(includeInactive ? filter : { ...filter, active: true })).lean();
  const ratings = await ratingsFor(docs.map((d) => d._id));
  return docs
    .map((d) => formatDoctor(d, { includePrivate, rating: ratings.get(String(d._id)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function loadFormatted(id, includePrivate) {
  const doc = await populateDoctor(Doctor.findById(id)).lean();
  const ratings = await ratingsFor([doc._id]);
  return formatDoctor(doc, { includePrivate, rating: ratings.get(String(doc._id)) });
}

const scheduleItem = Joi.object({
  day: Joi.number().integer().min(0).max(6).required(),
  start: time.required(),
  end: time.required(),
}).custom((v, helpers) =>
  clock.toMinutes(v.start) < clock.toMinutes(v.end) ? v : helpers.message('schedule end time must be after start time')
);

const profileFields = {
  department: objectId,
  specialization: Joi.string().trim().min(2).max(120),
  qualifications: Joi.string().trim().max(200).allow(''),
  experienceYears: Joi.number().integer().min(0).max(70),
  consultationFee: Joi.number().min(0).max(100000),
  bio: Joi.string().trim().max(2000).allow(''),
  languages: Joi.array().items(Joi.string().trim().min(2).max(30)).max(10),
  schedule: Joi.array().items(scheduleItem).max(21),
  slotMinutes: Joi.number().valid(10, 15, 20, 30),
  active: Joi.boolean(),
  name: Joi.string().trim().min(2).max(80),
  email,
  phone: Joi.string().trim().max(20).allow(''),
  gender: Joi.string().valid('male', 'female', 'other', ''),
};

const createSchema = Joi.object({
  ...profileFields,
  name: profileFields.name.required(),
  email: email.required(),
  password: password.required(),
  department: objectId.required(),
  specialization: profileFields.specialization.required(),
});

const updateSchema = Joi.object({ ...profileFields, password }).min(1);

const idParam = validate(Joi.object({ id: objectId.required() }), 'params');

async function resolveDepartment(value) {
  if (!value) return null;
  const query = mongoose.isValidObjectId(value) ? { _id: value } : { slug: value };
  return Department.findOne(query).select('_id');
}

// GET /api/doctors?department=<slug|id>&q=<search>&all=true(admin)
router.get('/', optionalAuth, async (req, res) => {
  const filter = {};
  if (req.query.department) {
    const dept = await resolveDepartment(String(req.query.department));
    if (!dept) return res.json([]);
    filter.department = dept._id;
  }
  const includeInactive = isAdmin(req) && req.query.all === 'true';
  let doctors = await publicDoctorQuery(filter, { includeInactive, includePrivate: isAdmin(req) });

  const q = String(req.query.q || '').trim().toLowerCase();
  if (q) {
    doctors = doctors.filter((d) =>
      [d.name, d.specialization, d.department && d.department.name, d.qualifications]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(q))
    );
  }
  res.json(doctors);
});

router.get('/:id', optionalAuth, idParam, async (req, res) => {
  const doc = await Doctor.findById(req.params.id).select('active user').lean();
  if (!doc || (!doc.active && !isAdmin(req) && !isSelf(req, doc))) throw notFound('Doctor not found.');
  res.json(await loadFormatted(req.params.id, isAdmin(req) || isSelf(req, doc)));
});

// Latest visible patient reviews (first name + initial only).
router.get('/:id/reviews', idParam, async (req, res) => {
  const list = await Appointment.find({
    doctor: req.params.id,
    'feedback.rating': { $exists: true },
    'feedback.hidden': { $ne: true },
    'feedback.comment': { $nin: ['', null] },
  })
    .sort({ 'feedback.createdAt': -1 })
    .limit(10)
    .populate('patient', 'name')
    .lean();
  res.json(
    list.map((a) => {
      const parts = (a.patient ? a.patient.name : 'Patient').trim().split(/\s+/);
      return {
        rating: a.feedback.rating,
        comment: a.feedback.comment,
        date: a.feedback.createdAt,
        name: parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0],
      };
    })
  );
});

// Available appointment times for one day.
router.get(
  '/:id/slots',
  idParam,
  validate(Joi.object({ date: date.required() }), 'query'),
  async (req, res) => {
    const { date: day } = req.validQuery;
    if (!clock.isValidDateString(day)) throw badRequest('date is not a real calendar date');
    const doctor = await Doctor.findOne({ _id: req.params.id, active: true }).lean();
    if (!doctor) throw notFound('Doctor not found.');
    res.json({ date: day, ...(await dayAvailability(doctor, day)) });
  }
);

router.post('/', authenticate, requireRole('admin'), validate(createSchema), async (req, res) => {
  const { name, email: mail, password: pass, phone, gender, ...profile } = req.body;
  if (!(await Department.exists({ _id: profile.department }))) throw badRequest('Department not found.');

  const user = await User.create({ name, email: mail, password: pass, phone, gender, role: 'doctor' });
  try {
    const doctor = await Doctor.create({ ...profile, user: user._id });
    res.status(201).json(await loadFormatted(doctor._id, true));
  } catch (err) {
    await User.deleteOne({ _id: user._id }); // don't leave a login without a profile
    throw err;
  }
});

router.put('/:id', authenticate, requireRole('admin'), idParam, validate(updateSchema), async (req, res) => {
  const doctor = await Doctor.findById(req.params.id);
  if (!doctor) throw notFound('Doctor not found.');

  const { name, email: mail, password: pass, phone, gender, ...profile } = req.body;
  if (profile.department && !(await Department.exists({ _id: profile.department }))) {
    throw badRequest('Department not found.');
  }

  const user = await User.findById(doctor.user);
  if (user) {
    if (name !== undefined) user.name = name;
    if (mail !== undefined) user.email = mail;
    if (phone !== undefined) user.phone = phone;
    if (gender !== undefined) user.gender = gender;
    if (pass) user.password = pass;
    await user.save();
  }

  Object.assign(doctor, profile);
  await doctor.save();
  res.json(await loadFormatted(doctor._id, true));
});

// Doctors are never hard-deleted, because past appointments refer to them.
// Deactivating hides them from the site and cancels their upcoming appointments.
router.delete('/:id', authenticate, requireRole('admin'), idParam, async (req, res) => {
  const doctor = await Doctor.findById(req.params.id);
  if (!doctor) throw notFound('Doctor not found.');
  doctor.active = false;
  await doctor.save();

  const cancelled = await cancelMatching(
    { doctor: doctor._id, date: { $gte: clock.todayString() } },
    'Doctor is no longer available. Please book with another doctor.'
  );
  cancelled.forEach((a) => notify(appointmentCancelled, a));
  res.json({ message: 'Doctor deactivated.', cancelledAppointments: cancelled.length });
});

/* ---------- Profile photo (admin) ---------- */

router.put(
  '/:id/photo',
  authenticate,
  requireRole('admin'),
  idParam,
  validate(Joi.object({ data: Joi.string().required() })),
  async (req, res) => {
    const doctor = await Doctor.findById(req.params.id);
    if (!doctor) throw notFound('Doctor not found.');
    const file = decodeUpload(req.body.data, { allowed: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 2 * 1024 * 1024 });
    const name = randomName(file.ext);
    await saveUpload('doctors', name, file.buffer);
    if (doctor.photo) await removeUpload('doctors', doctor.photo);
    doctor.photo = `/uploads/doctors/${name}`;
    await doctor.save();
    res.json({ photo: doctor.photo });
  }
);

router.delete('/:id/photo', authenticate, requireRole('admin'), idParam, async (req, res) => {
  const doctor = await Doctor.findById(req.params.id);
  if (!doctor) throw notFound('Doctor not found.');
  await removeUpload('doctors', doctor.photo);
  doctor.photo = '';
  await doctor.save();
  res.json({ photo: '' });
});

/* ---------- Leave (admin, or the doctor themselves) ---------- */

async function doctorForLeave(req) {
  const doctor = await Doctor.findById(req.params.id);
  if (!doctor) throw notFound('Doctor not found.');
  if (!isAdmin(req) && !isSelf(req, doctor)) throw forbidden();
  return doctor;
}

const leaveSchema = Joi.object({
  from: date.required(),
  to: date.required(),
  reason: Joi.string().trim().max(120).allow(''),
});

router.post('/:id/leaves', authenticate, idParam, validate(leaveSchema), async (req, res) => {
  const doctor = await doctorForLeave(req);
  const { from, to, reason } = req.body;
  if (!clock.isValidDateString(from) || !clock.isValidDateString(to)) throw badRequest('Please enter real calendar dates.');
  if (to < from) throw badRequest('The leave must end on or after its start date.');
  const today = clock.todayString();
  if (to < today) throw badRequest('That leave is entirely in the past.');
  if (clock.addDays(from, 90) < to) throw badRequest('A single leave can be at most 90 days. Add another for longer periods.');

  doctor.leaves.push({ from, to, reason });
  // Drop leaves that ended long ago to keep the list short.
  doctor.leaves = doctor.leaves.filter((l) => l.to >= clock.addDays(today, -30));
  await doctor.save();

  const cancelled = await cancelMatching(
    { doctor: doctor._id, date: { $gte: from < today ? today : from, $lte: to } },
    'The doctor is on leave on this day. Please book another date or doctor.'
  );
  cancelled.forEach((a) => notify(appointmentCancelled, a));
  const leave = doctor.leaves[doctor.leaves.length - 1];
  res.status(201).json({
    leave: { id: leave._id, from: leave.from, to: leave.to, reason: leave.reason },
    cancelledAppointments: cancelled.length,
  });
});

router.delete(
  '/:id/leaves/:leaveId',
  authenticate,
  validate(Joi.object({ id: objectId.required(), leaveId: objectId.required() }), 'params'),
  async (req, res) => {
    const doctor = await doctorForLeave(req);
    const leave = doctor.leaves.id(req.params.leaveId);
    if (!leave) throw notFound('Leave not found.');
    leave.deleteOne();
    await doctor.save();
    res.json({ message: 'Leave removed. Those days are open for booking again.' });
  }
);

/** How many scheduled appointments a new leave would cancel (for the confirm dialog). */
router.get(
  '/:id/leaves/impact',
  authenticate,
  idParam,
  validate(Joi.object({ from: date.required(), to: date.required() }), 'query'),
  async (req, res) => {
    const doctor = await doctorForLeave(req);
    const { from, to } = req.validQuery;
    const count = await Appointment.countDocuments({
      doctor: doctor._id,
      status: 'scheduled',
      date: { $gte: from < clock.todayString() ? clock.todayString() : from, $lte: to },
    });
    res.json({ count });
  }
);

module.exports = router;
module.exports.publicDoctorQuery = publicDoctorQuery;
