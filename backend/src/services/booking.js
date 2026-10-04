// Availability and booking rules shared by patient booking, rescheduling and
// front-desk (admin) booking.
const Appointment = require('../models/Appointment');
const Holiday = require('../models/Holiday');
const config = require('../config');
const clock = require('../utils/time');
const { badRequest, conflict } = require('../utils/httpError');

function checkDateInWindow(day) {
  if (!clock.isValidDateString(day)) throw badRequest('date is not a real calendar date');
  const today = clock.todayString();
  if (day < today) throw badRequest('That date has already passed.');
  if (day > clock.addDays(today, config.bookingWindowDays)) {
    throw badRequest(`Appointments can be booked up to ${config.bookingWindowDays} days ahead.`);
  }
}

/** Why the doctor can't see patients on this day, or null. */
async function closedReason(doctor, day) {
  const holiday = await Holiday.findOne({ date: day }).lean();
  if (holiday) return `The hospital OPD is closed on this day (${holiday.name}).`;
  if (clock.leaveOn(doctor, day)) return 'The doctor is on leave on this day.';
  if (clock.slotsForDate(doctor, day).length === 0) return 'The doctor is not available on this day.';
  return null;
}

/** Slots for one day: { slots: [{ time, available }], message? } */
async function dayAvailability(doctor, day) {
  const today = clock.todayString();
  if (day < today || day > clock.addDays(today, config.bookingWindowDays)) {
    return { slots: [], message: `Appointments can be booked from today up to ${config.bookingWindowDays} days ahead.` };
  }
  const reason = await closedReason(doctor, day);
  if (reason) return { slots: [], message: reason };

  const taken = new Set(await Appointment.find({ doctor: doctor._id, date: day, holdsSlot: true }).distinct('time'));
  return {
    slots: clock.slotsForDate(doctor, day).map((t) => ({ time: t, available: !taken.has(t) && !clock.isPast(day, t) })),
  };
}

/**
 * Throws a 400/409 if this patient can't be booked with this doctor at day+slot.
 * `ignoreId` skips an existing appointment (used when rescheduling it).
 * The unique index still guards the slot itself against simultaneous requests.
 */
async function assertBookable({ doctor, day, slot, patientId, ignoreId = null }) {
  checkDateInWindow(day);
  if (clock.isPast(day, slot)) throw badRequest('That time has already passed. Please choose a later slot.');
  const reason = await closedReason(doctor, day);
  if (reason) throw badRequest(reason);
  if (!clock.slotsForDate(doctor, day).includes(slot)) {
    throw badRequest('The doctor does not consult at that time. Please choose one of the listed slots.');
  }

  const filter = {
    patient: patientId,
    status: 'scheduled',
    date: day,
    $or: [{ time: slot }, { doctor: doctor._id }],
  };
  if (ignoreId) filter._id = { $ne: ignoreId };
  const clash = await Appointment.findOne(filter);
  if (clash) {
    throw conflict(
      clash.time === slot
        ? 'This patient already has another appointment at this time.'
        : 'This patient already has an appointment with this doctor on this day.'
    );
  }
}

/**
 * Cancels scheduled appointments (e.g. for a new leave or holiday) and returns
 * the cancelled documents so patients can be told.
 */
async function cancelMatching(filter, reason) {
  const list = await Appointment.find({ ...filter, status: 'scheduled' });
  for (const appt of list) {
    appt.status = 'cancelled';
    appt.holdsSlot = false;
    appt.cancelledBy = 'admin';
    appt.cancelReason = reason;
    await appt.save();
  }
  return list;
}

module.exports = { dayAvailability, assertBookable, cancelMatching };
