// Emails to patients about their appointments. Emails go to the account that
// manages the appointment (a parent for a child's visit, for example).
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const config = require('../config');
const clock = require('../utils/time');
const { sendMail } = require('../utils/mailer');

const HOSPITAL = 'CityCare Multispeciality Hospital';

function when(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const day = new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `${day} at ${((h + 11) % 12) + 1}:${String(min).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** Loads what the email needs: recipient + readable names. */
async function load(apptOrId) {
  const appt = await Appointment.findById(apptOrId._id || apptOrId)
    .populate('patient', 'name email')
    .populate({ path: 'doctor', select: 'user', populate: { path: 'user', select: 'name' } })
    .populate('department', 'name');
  if (!appt) return null;
  const account = appt.account ? await User.findById(appt.account).select('name email') : appt.patient;
  const to = account && account.email;
  if (!to) return null; // walk-in patient without email
  return { appt, to, greeting: account.name };
}

function details(a) {
  return [
    `Appointment no.: ${a.appointmentNo}`,
    `Patient: ${a.patient.name}`,
    `Doctor: ${a.doctor.user ? a.doctor.user.name : ''} (${a.department ? a.department.name : ''})`,
    `When: ${when(a.date, a.time)}`,
  ].join('\n');
}

const footer = `\n\nManage your appointments: ${config.appUrl}/portal.html\nIn a medical emergency, call 108.\n\n${HOSPITAL}`;

async function appointmentBooked(appt) {
  const x = await load(appt);
  if (!x) return;
  await sendMail({
    to: x.to,
    subject: `Appointment confirmed: ${x.appt.appointmentNo}`,
    text: `Dear ${x.greeting},\n\nYour appointment is confirmed.\n\n${details(x.appt)}\nConsultation fee: ₹${x.appt.fee} (pay at the hospital)\n\nPlease arrive 15 minutes early with a photo ID and any previous reports.${footer}`,
  });
}

async function appointmentRescheduled(appt) {
  const x = await load(appt);
  if (!x) return;
  await sendMail({
    to: x.to,
    subject: `Appointment rescheduled: ${x.appt.appointmentNo}`,
    text: `Dear ${x.greeting},\n\nYour appointment has been moved to a new time.\n\n${details(x.appt)}${footer}`,
  });
}

async function appointmentCancelled(appt) {
  const x = await load(appt);
  if (!x) return;
  const reason = x.appt.cancelReason ? `\nReason: ${x.appt.cancelReason}` : '';
  await sendMail({
    to: x.to,
    subject: `Appointment cancelled: ${x.appt.appointmentNo}`,
    text: `Dear ${x.greeting},\n\nThe following appointment has been cancelled.${reason}\n\n${details(x.appt)}\n\nYou can book a new appointment at ${config.appUrl}/book.html${footer}`,
  });
}

async function appointmentReminder(appt) {
  const x = await load(appt);
  if (!x) return;
  await sendMail({
    to: x.to,
    subject: `Reminder: appointment tomorrow (${x.appt.appointmentNo})`,
    text: `Dear ${x.greeting},\n\nThis is a reminder of your appointment tomorrow.\n\n${details(x.appt)}\n\nIf you can't make it, please cancel or reschedule online so another patient can use the slot.${footer}`,
  });
}

/** Sends reminders for tomorrow's appointments that haven't had one yet. */
async function sendDueReminders() {
  const tomorrow = clock.addDays(clock.todayString(), 1);
  const due = await Appointment.find({ date: tomorrow, status: 'scheduled', reminderSentAt: { $exists: false } }).select('_id');
  for (const { _id } of due) {
    // Claim it first so two server instances never send the same reminder twice.
    const claimed = await Appointment.findOneAndUpdate(
      { _id, reminderSentAt: { $exists: false } },
      { reminderSentAt: new Date() }
    );
    if (claimed) await appointmentReminder(_id);
  }
  return due.length;
}

function startReminderJob() {
  const run = () => sendDueReminders().catch((err) => console.error('Reminder job failed:', err.message));
  setTimeout(run, 10 * 1000);
  return setInterval(run, 30 * 60 * 1000);
}

/** Fire-and-forget wrapper so an email problem never fails the request. */
function notify(fn, ...args) {
  Promise.resolve(fn(...args)).catch((err) => console.error('Notification failed:', err.message));
}

module.exports = {
  appointmentBooked,
  appointmentRescheduled,
  appointmentCancelled,
  sendDueReminders,
  startReminderJob,
  notify,
};
