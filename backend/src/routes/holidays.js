// Hospital-wide OPD holidays. Nobody can book on these days.
const router = require('express').Router();
const Holiday = require('../models/Holiday');
const Appointment = require('../models/Appointment');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate, Joi, objectId, date } = require('../middleware/validate');
const { badRequest, notFound } = require('../utils/httpError');
const clock = require('../utils/time');
const { cancelMatching } = require('../services/booking');
const { appointmentCancelled, notify } = require('../services/notifications');

// Public: upcoming holidays (the booking page greys these days out).
router.get('/', async (req, res) => {
  const from = req.query.all === 'true' ? '0000-00-00' : clock.todayString();
  res.json(await Holiday.find({ date: { $gte: from } }).sort({ date: 1 }).lean());
});

// How many appointments would be cancelled (shown before confirming).
router.get('/impact', authenticate, requireRole('admin'), validate(Joi.object({ date: date.required() }), 'query'), async (req, res) => {
  res.json({ count: await Appointment.countDocuments({ date: req.validQuery.date, status: 'scheduled' }) });
});

router.post(
  '/',
  authenticate,
  requireRole('admin'),
  validate(Joi.object({ date: date.required(), name: Joi.string().trim().min(2).max(80).required() })),
  async (req, res) => {
    const { date: day, name } = req.body;
    if (!clock.isValidDateString(day)) throw badRequest('Please enter a real calendar date.');
    if (day < clock.todayString()) throw badRequest('That date has already passed.');
    const holiday = await Holiday.create({ date: day, name });
    const cancelled = await cancelMatching({ date: day }, `The hospital OPD is closed on this day (${name}). Please book another date.`);
    cancelled.forEach((a) => notify(appointmentCancelled, a));
    res.status(201).json({ holiday, cancelledAppointments: cancelled.length });
  }
);

router.delete('/:id', authenticate, requireRole('admin'), validate(Joi.object({ id: objectId.required() }), 'params'), async (req, res) => {
  const holiday = await Holiday.findByIdAndDelete(req.params.id);
  if (!holiday) throw notFound('Holiday not found.');
  res.json({ message: 'Holiday removed.' });
});

module.exports = router;
