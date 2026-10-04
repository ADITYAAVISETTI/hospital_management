const router = require('express').Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const User = require('../models/User');
const Doctor = require('../models/Doctor');
const { signToken, authenticate, assertCanSignIn } = require('../middleware/auth');
const { validate, Joi, email, phone, date, password } = require('../middleware/validate');
const { unauthorized, badRequest, conflict } = require('../utils/httpError');
const { todayString } = require('../utils/time');
const { sendMail } = require('../utils/mailer');

const limiter = (limit, message) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config.env === 'test',
    message: { message },
  });
const authLimiter = limiter(20, 'Too many attempts. Please wait 15 minutes and try again.');
const resetLimiter = limiter(5, 'Too many reset requests. Please wait 15 minutes and try again.');

const RESET_MINUTES = 30;
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

const profileFields = {
  name: Joi.string().trim().min(2).max(80),
  phone: phone.allow(''),
  dateOfBirth: date.allow(''),
  gender: Joi.string().valid('male', 'female', 'other', ''),
  bloodGroup: Joi.string().valid(...User.BLOOD_GROUPS, ''),
  address: Joi.string().trim().max(300).allow(''),
};

const registerSchema = Joi.object({
  ...profileFields,
  name: profileFields.name.required(),
  email: email.required(),
  password: password.required(),
  phone: phone.required(),
});

const loginSchema = Joi.object({
  email: email.required(),
  password: Joi.string().required().max(64),
});

const updateSchema = Joi.object(profileFields).min(1);

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required().max(64),
  newPassword: password.required(),
});

async function sessionPayload(user) {
  const payload = { token: signToken(user), user: user.toPublic() };
  if (user.role === 'doctor') {
    const doctor = await Doctor.findOne({ user: user._id }).select('_id');
    payload.user.doctorId = doctor ? doctor._id : null;
  }
  return payload;
}

function checkDateOfBirth(dob) {
  if (dob && dob > todayString()) throw badRequest('Date of birth cannot be in the future.');
}

// Public sign-up always creates a patient. Doctors and admins are created by an admin.
router.post('/register', authLimiter, validate(registerSchema), async (req, res) => {
  checkDateOfBirth(req.body.dateOfBirth);
  const existing = await User.findOne({ email: req.body.email }).select('+password');
  if (existing) {
    throw conflict(
      existing.password
        ? 'An account with this email already exists.'
        : 'You are already registered with the hospital. Use "Forgot password" on the login page to set a password.'
    );
  }
  const user = await User.create({ ...req.body, role: 'patient' });
  res.status(201).json(await sessionPayload(user));
});

router.post('/login', authLimiter, validate(loginSchema), async (req, res) => {
  const user = await User.findOne({ email: req.body.email }).select('+password');
  // Same message for unknown email and wrong password, so attackers can't probe accounts.
  if (!user || !(await user.checkPassword(req.body.password))) {
    throw unauthorized('Incorrect email or password.');
  }
  await assertCanSignIn(user);
  res.json(await sessionPayload(user));
});

// Always answers the same way, so it can't be used to find out who has an account.
router.post('/forgot-password', resetLimiter, validate(Joi.object({ email: email.required() })), async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    user.resetTokenHash = hashToken(token);
    user.resetTokenExpires = new Date(Date.now() + RESET_MINUTES * 60 * 1000);
    await user.save();
    const link = `${config.appUrl}/reset-password.html?token=${token}`;
    // Not awaited: the response time must not reveal whether the account exists.
    sendMail({
      to: user.email,
      subject: 'Reset your CityCare password',
      text: `Dear ${user.name},\n\nWe received a request to set a new password for your CityCare account.\n\nOpen this link within ${RESET_MINUTES} minutes:\n${link}\n\nIf you did not ask for this, you can ignore this email; your password will not change.\n\nCityCare Multispeciality Hospital`,
    });
  }
  res.json({ message: `If an account exists for ${req.body.email}, we have emailed a link to reset the password. It is valid for ${RESET_MINUTES} minutes.` });
});

router.post(
  '/reset-password',
  resetLimiter,
  validate(Joi.object({ token: Joi.string().hex().length(64).required(), password: password.required() })),
  async (req, res) => {
    const user = await User.findOne({
      resetTokenHash: hashToken(req.body.token),
      resetTokenExpires: { $gt: new Date() },
    }).select('+resetTokenHash +resetTokenExpires');
    if (!user) throw badRequest('This reset link is invalid or has expired. Please request a new one.');
    user.password = req.body.password;
    user.resetTokenHash = undefined;
    user.resetTokenExpires = undefined;
    await user.save(); // also invalidates all existing sessions (passwordChangedAt)
    res.json({ message: 'Your password has been set. You can now log in.' });
  }
);

router.get('/me', authenticate, async (req, res) => {
  const { user } = await sessionPayload(req.user);
  res.json({ user });
});

router.patch('/me', authenticate, validate(updateSchema), async (req, res) => {
  checkDateOfBirth(req.body.dateOfBirth);
  Object.assign(req.user, req.body);
  await req.user.save();
  const { user } = await sessionPayload(req.user);
  res.json({ user });
});

router.post('/change-password', authenticate, validate(changePasswordSchema), async (req, res) => {
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.checkPassword(req.body.currentPassword))) {
    throw badRequest('Your current password is incorrect.');
  }
  user.password = req.body.newPassword;
  await user.save();
  // Other sessions are now invalid; give this one a fresh token.
  res.json({ message: 'Password updated.', token: signToken(user) });
});

module.exports = router;
