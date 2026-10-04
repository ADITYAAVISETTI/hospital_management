// Sends email through SMTP when SMTP_HOST is set in .env. Otherwise the email
// is printed in the server window, so everything still works during development.
const nodemailer = require('nodemailer');
const config = require('../config');

let transport = null;
if (config.mail.host) {
  transport = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.port === 465,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
  });
}

/** Test hook: every email "sent" while NODE_ENV=test is kept here. */
const outbox = [];

/** Never throws: a failed email must not break a booking. */
async function sendMail({ to, subject, text }) {
  if (!to) return false;
  const message = { from: config.mail.from, to, subject, text };
  if (config.env === 'test') {
    outbox.push(message);
    return true;
  }
  try {
    if (transport) {
      await transport.sendMail(message);
    } else {
      console.log(`\n----- EMAIL (not sent: SMTP not configured) -----\nTo: ${to}\nSubject: ${subject}\n\n${text}\n--------------------------------------------------\n`);
    }
    return true;
  } catch (err) {
    console.error(`Email to ${to} failed:`, err.message);
    return false;
  }
}

module.exports = { sendMail, outbox, isConfigured: () => Boolean(transport) };
