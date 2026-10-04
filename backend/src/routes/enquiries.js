const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const config = require('../config');
const Enquiry = require('../models/Enquiry');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate, Joi, objectId, email, phone } = require('../middleware/validate');
const { notFound } = require('../utils/httpError');

const enquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.env === 'test',
  message: { message: 'You have sent several messages already. Please call us if it is urgent.' },
});

const enquirySchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  email: email.required(),
  phone: phone.allow(''),
  subject: Joi.string().trim().min(2).max(120).required(),
  message: Joi.string().trim().min(10).max(2000).required(),
});

router.post('/', enquiryLimiter, validate(enquirySchema), async (req, res) => {
  await Enquiry.create(req.body);
  res.status(201).json({ message: 'Thank you. Our team will get back to you within one working day.' });
});

router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  const filter = ['new', 'resolved'].includes(req.query.status) ? { status: req.query.status } : {};
  res.json(await Enquiry.find(filter).sort({ createdAt: -1 }).limit(200).lean());
});

router.patch(
  '/:id',
  authenticate,
  requireRole('admin'),
  validate(Joi.object({ id: objectId.required() }), 'params'),
  validate(Joi.object({ status: Joi.string().valid('new', 'resolved').required() })),
  async (req, res) => {
    const enquiry = await Enquiry.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    if (!enquiry) throw notFound('Enquiry not found.');
    res.json(enquiry);
  }
);

module.exports = router;
