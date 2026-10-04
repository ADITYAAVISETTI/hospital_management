// Health check-up packages and patients' requests to book them.
const router = require('express').Router();
const HealthPackage = require('../models/HealthPackage');
const PackageBooking = require('../models/PackageBooking');
const Holiday = require('../models/Holiday');
const User = require('../models/User');
const config = require('../config');
const { nextSequence } = require('../models/Counter');
const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');
const { validate, Joi, objectId, date } = require('../middleware/validate');
const { badRequest, notFound, conflict } = require('../utils/httpError');
const { sendMail } = require('../utils/mailer');
const { notify } = require('../services/notifications');
const clock = require('../utils/time');

const slugify = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const idParam = validate(Joi.object({ id: objectId.required() }), 'params');

function formatBooking(b) {
  return {
    id: b._id,
    bookingNo: b.bookingNo,
    package: b.package ? { id: b.package._id, name: b.package.name, preparation: b.package.preparation } : null,
    patient: b.patient ? { id: b.patient._id, name: b.patient.name, uhid: b.patient.uhid, phone: b.patient.phone, relation: b.patient.relation || '' } : null,
    date: b.date,
    price: b.price,
    status: b.status,
    notes: b.notes,
    createdAt: b.createdAt,
  };
}
const populateBooking = (q) => q.populate('package', 'name preparation').populate('patient', 'name uhid phone relation');

async function emailBooking(booking, subject, intro) {
  const b = await populateBooking(PackageBooking.findById(booking._id));
  const account = await User.findById(b.account).select('name email');
  if (!account || !account.email) return;
  await sendMail({
    to: account.email,
    subject: `${subject}: ${b.bookingNo}`,
    text: `Dear ${account.name},\n\n${intro}\n\nBooking no.: ${b.bookingNo}\nPackage: ${b.package.name}\nPatient: ${b.patient.name}\nDate: ${b.date}\nPrice: ₹${b.price}\n${b.package.preparation ? `\nPreparation: ${b.package.preparation}\n` : ''}\nManage your bookings: ${config.appUrl}/portal.html#checkups\n\nCityCare Multispeciality Hospital`,
  });
}

/* ---------- Bookings ---------- */

router.get('/bookings/mine', authenticate, requireRole('patient'), async (req, res) => {
  const me = req.user._id;
  const list = await populateBooking(PackageBooking.find({ $or: [{ account: me }, { patient: me }] }).sort({ date: -1 }));
  res.json(list.map(formatBooking));
});

router.get('/bookings', authenticate, requireRole('admin'), async (req, res) => {
  const filter = PackageBooking.STATUSES.includes(req.query.status) ? { status: req.query.status } : {};
  const list = await populateBooking(PackageBooking.find(filter).sort({ date: 1, createdAt: 1 }).limit(300));
  res.json(list.map(formatBooking));
});

router.patch('/bookings/:id/cancel', authenticate, requireRole('patient'), idParam, async (req, res) => {
  const b = await PackageBooking.findOne({ _id: req.params.id, $or: [{ account: req.user._id }, { patient: req.user._id }] });
  if (!b) throw notFound('Booking not found.');
  if (!['requested', 'confirmed'].includes(b.status)) throw conflict(`This booking is already ${b.status}.`);
  if (b.date < clock.todayString()) throw badRequest('This date has already passed.');
  b.status = 'cancelled';
  await b.save();
  res.json(formatBooking(await populateBooking(PackageBooking.findById(b._id))));
});

router.patch(
  '/bookings/:id/status',
  authenticate,
  requireRole('admin'),
  idParam,
  validate(Joi.object({ status: Joi.string().valid(...PackageBooking.STATUSES).required() })),
  async (req, res) => {
    const b = await PackageBooking.findById(req.params.id);
    if (!b) throw notFound('Booking not found.');
    const before = b.status;
    b.status = req.body.status;
    await b.save();
    if (before !== b.status && b.status === 'confirmed') {
      notify(emailBooking, b, 'Health check-up confirmed', 'Your health check-up is confirmed. Please report to the Health Check-up desk at 8:00 AM.');
    }
    if (before !== b.status && b.status === 'cancelled') {
      notify(emailBooking, b, 'Health check-up cancelled', 'Your health check-up booking has been cancelled by the hospital. Please call us to choose another date.');
    }
    res.json(formatBooking(await populateBooking(PackageBooking.findById(b._id))));
  }
);

/* ---------- Packages ---------- */

router.get('/', optionalAuth, async (req, res) => {
  const all = req.user && req.user.role === 'admin' && req.query.all === 'true';
  res.json(await HealthPackage.find(all ? {} : { active: true }).sort({ price: 1 }).lean());
});

const packageSchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  summary: Joi.string().trim().min(5).max(200).required(),
  tests: Joi.array().items(Joi.string().trim().min(1).max(100)).max(80),
  price: Joi.number().min(0).max(1000000).required(),
  originalPrice: Joi.number().min(0).max(1000000).allow(null),
  recommendedFor: Joi.string().trim().max(120).allow(''),
  preparation: Joi.string().trim().max(500).allow(''),
  active: Joi.boolean(),
});

function packageFields(body) {
  const slug = slugify(body.name);
  if (!slug) throw badRequest('Package name must contain letters or numbers.');
  if (body.originalPrice && body.originalPrice <= body.price) body.originalPrice = null;
  return { ...body, slug };
}

router.post('/', authenticate, requireRole('admin'), validate(packageSchema), async (req, res) => {
  res.status(201).json(await HealthPackage.create(packageFields(req.body)));
});

router.put('/:id', authenticate, requireRole('admin'), idParam, validate(packageSchema), async (req, res) => {
  const pkg = await HealthPackage.findByIdAndUpdate(req.params.id, packageFields(req.body), { new: true, runValidators: true });
  if (!pkg) throw notFound('Package not found.');
  res.json(pkg);
});

router.delete('/:id', authenticate, requireRole('admin'), idParam, async (req, res) => {
  if (await PackageBooking.exists({ package: req.params.id })) {
    throw conflict('This package has bookings. Untick "Show on website" to hide it instead.');
  }
  const pkg = await HealthPackage.findByIdAndDelete(req.params.id);
  if (!pkg) throw notFound('Package not found.');
  res.json({ message: 'Package deleted.' });
});

// Patient requests a package on a preferred date (for themselves or a family member).
router.post(
  '/:id/book',
  authenticate,
  requireRole('patient'),
  idParam,
  validate(Joi.object({ date: date.required(), patient: objectId, notes: Joi.string().trim().max(500).allow('') })),
  async (req, res) => {
    const pkg = await HealthPackage.findOne({ _id: req.params.id, active: true });
    if (!pkg) throw notFound('Package not found.');

    const { date: day, notes } = req.body;
    if (!clock.isValidDateString(day)) throw badRequest('Please choose a real date.');
    const today = clock.todayString();
    if (day <= today) throw badRequest('Please choose a date from tomorrow onwards (fasting tests are done in the morning).');
    if (day > clock.addDays(today, config.bookingWindowDays)) throw badRequest(`You can book up to ${config.bookingWindowDays} days ahead.`);
    if (clock.dayOfWeek(day) === 0) throw badRequest('Health check-ups are not done on Sundays.');
    const holiday = await Holiday.findOne({ date: day });
    if (holiday) throw badRequest(`The hospital OPD is closed on this day (${holiday.name}).`);

    let patient = req.user;
    if (req.body.patient && String(req.body.patient) !== String(req.user._id)) {
      patient = await User.findOne({ _id: req.body.patient, guardian: req.user._id });
      if (!patient) throw notFound('Family member not found.');
    }
    if (await PackageBooking.exists({ patient: patient._id, date: day, status: { $in: ['requested', 'confirmed'] } })) {
      throw conflict('This person already has a health check-up booked on that day.');
    }

    const seq = await nextSequence('package-booking');
    const booking = await PackageBooking.create({
      bookingNo: `HC${String(seq).padStart(6, '0')}`,
      package: pkg._id,
      patient: patient._id,
      account: req.user.guardian || req.user._id,
      date: day,
      price: pkg.price,
      notes,
    });
    notify(emailBooking, booking, 'Health check-up request received', 'We have received your health check-up request. Our team will call you to confirm the timing.');
    res.status(201).json(formatBooking(await populateBooking(PackageBooking.findById(booking._id))));
  }
);

module.exports = router;
