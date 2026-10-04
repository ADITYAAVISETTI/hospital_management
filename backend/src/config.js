const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Appointment times are in the hospital's local time. Set this before any
// Date is used so a server in another country still uses hospital time.
process.env.TZ = process.env.HOSPITAL_TZ || process.env.TZ || 'Asia/Kolkata';

const env = process.env.NODE_ENV || 'development';
const port = Number(process.env.PORT) || 3000;

const config = {
  env,
  port,
  mongoUri: process.env.DB_CONNECT || 'mongodb://127.0.0.1:27017/CityCareHospital',
  jwtSecret: process.env.TOKEN_SECRET,
  jwtExpiresIn: process.env.TOKEN_EXPIRES_IN || '7d',
  // Public address of the site, used in emailed links.
  appUrl: (process.env.APP_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  frontendDir: path.join(__dirname, '..', '..', 'frontend'),
  uploadsDir: process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'),
  // Behind a hosting proxy / load balancer (Render, Railway, Nginx…) set
  // TRUST_PROXY=1 so rate limits see each visitor's real IP address.
  trustProxy: process.env.TRUST_PROXY ? (/^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY) : false,
  // How far ahead patients may book, in days.
  bookingWindowDays: 60,
  // How many times a patient may move one appointment.
  maxReschedules: 2,
  mail: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'CityCare Hospital <no-reply@citycare.test>',
  },
};

// A short secret on the live site would let attackers forge logins.
if (env === 'production' && (!config.jwtSecret || config.jwtSecret.length < 32)) {
  throw new Error('TOKEN_SECRET must be at least 32 random characters on the live site (NODE_ENV=production).');
}

if (!config.jwtSecret) {
  if (env === 'test') {
    config.jwtSecret = 'test-secret';
  } else {
    throw new Error('TOKEN_SECRET is missing. Add it to backend/.env (see README).');
  }
}

module.exports = config;
