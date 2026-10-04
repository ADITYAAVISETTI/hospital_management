// Family members (dependants) a patient can book for: children, parents, etc.
// Each gets their own UHID and medical history, managed from the guardian's login.
const router = require('express').Router();
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const Report = require('../models/Report');
const PackageBooking = require('../models/PackageBooking');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate, Joi, objectId, date } = require('../middleware/validate');
const { badRequest, notFound, conflict } = require('../utils/httpError');
const { todayString } = require('../utils/time');

const MAX_MEMBERS = 10;

const memberSchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  relation: Joi.string().valid(...User.RELATIONS).required(),
  dateOfBirth: date.allow(''),
  gender: Joi.string().valid('male', 'female', 'other', ''),
  bloodGroup: Joi.string().valid(...User.BLOOD_GROUPS, ''),
});

const idParam = validate(Joi.object({ id: objectId.required() }), 'params');

router.use(authenticate, requireRole('patient'));

function checkDob(dob) {
  if (dob && dob > todayString()) throw badRequest('Date of birth cannot be in the future.');
}

async function ownMember(req) {
  const member = await User.findOne({ _id: req.params.id, guardian: req.user._id });
  if (!member) throw notFound('Family member not found.');
  return member;
}

router.get('/', async (req, res) => {
  const members = await User.find({ guardian: req.user._id }).sort({ createdAt: 1 });
  res.json(members.map((m) => m.toPublic()));
});

router.post('/', validate(memberSchema), async (req, res) => {
  if (req.user.guardian) throw badRequest('Family members cannot add their own family members.');
  checkDob(req.body.dateOfBirth);
  if ((await User.countDocuments({ guardian: req.user._id })) >= MAX_MEMBERS) {
    throw badRequest(`You can add up to ${MAX_MEMBERS} family members.`);
  }
  const member = await User.create({
    ...req.body,
    role: 'patient',
    guardian: req.user._id,
    // Contact details come from the guardian.
    phone: req.user.phone,
    address: req.user.address,
  });
  res.status(201).json(member.toPublic());
});

router.put('/:id', idParam, validate(memberSchema), async (req, res) => {
  checkDob(req.body.dateOfBirth);
  const member = await ownMember(req);
  Object.assign(member, req.body);
  await member.save();
  res.json(member.toPublic());
});

router.delete('/:id', idParam, async (req, res) => {
  const member = await ownMember(req);
  // Keep medical history intact: members with visits can't be removed.
  const hasHistory = await Promise.all([
    Appointment.exists({ patient: member._id }),
    Report.exists({ patient: member._id }),
    PackageBooking.exists({ patient: member._id }),
  ]);
  if (hasHistory.some(Boolean)) {
    throw conflict('This family member has medical history (appointments, reports or check-ups) and cannot be removed. Contact the hospital if details are wrong.');
  }
  await member.deleteOne();
  res.json({ message: 'Family member removed.' });
});

module.exports = router;
