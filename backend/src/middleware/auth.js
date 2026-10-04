const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');
const { unauthorized, forbidden } = require('../utils/httpError');

function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function readToken(req) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

async function loadUser(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw unauthorized('Your session has expired. Please log in again.');
  }
  // Re-read the user so deleted accounts and role changes take effect at once.
  const user = await User.findById(payload.sub);
  if (!user) throw unauthorized('Your session has expired. Please log in again.');
  // Tokens issued before the last password change are no longer valid.
  // (iat has one-second precision, so compare whole seconds.)
  if (user.passwordChangedAt && payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
    throw unauthorized('Your password was changed. Please log in again.');
  }
  return user;
}

/** Requires a valid login. Sets req.user. */
async function authenticate(req, res, next) {
  const token = readToken(req);
  if (!token) throw unauthorized();
  req.user = await loadUser(token);
  next();
}

/** Sets req.user when a valid token is sent, but never rejects the request. */
async function optionalAuth(req, res, next) {
  const token = readToken(req);
  if (token) {
    try {
      req.user = await loadUser(token);
    } catch {
      req.user = null;
    }
  }
  next();
}

/** Use after authenticate. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

module.exports = { signToken, authenticate, optionalAuth, requireRole };
