// Dates are handled as "YYYY-MM-DD" strings and times as "HH:MM" strings in
// the hospital's local time (see config.js, HOSPITAL_TZ). This keeps a 10:30
// appointment at 10:30 no matter which timezone the browser is in.

const pad = (n) => String(n).padStart(2, '0');

function toDateString(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayString(now = new Date()) {
  return toDateString(now);
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return toDateString(new Date(y, m - 1, d + days));
}

function isValidDateString(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(mins) {
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

function nowMinutes(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * All consultation start times a doctor offers on a date, from their weekly
 * schedule. Does not look at leave, holidays or existing bookings.
 */
function slotsForDate(doctor, dateStr) {
  const day = dayOfWeek(dateStr);
  const step = doctor.slotMinutes || 15;
  const times = [];
  for (const block of doctor.schedule || []) {
    if (block.day !== day) continue;
    const end = toMinutes(block.end);
    for (let t = toMinutes(block.start); t + step <= end; t += step) {
      times.push(fromMinutes(t));
    }
  }
  return [...new Set(times)].sort();
}

/** The leave entry covering this date, if any. */
function leaveOn(doctor, dateStr) {
  return (doctor.leaves || []).find((l) => l.from <= dateStr && dateStr <= l.to) || null;
}

/** True if the date+time is already in the past (hospital local time). */
function isPast(dateStr, time, now = new Date()) {
  const today = todayString(now);
  if (dateStr < today) return true;
  if (dateStr > today) return false;
  return toMinutes(time) <= nowMinutes(now);
}

module.exports = {
  todayString,
  addDays,
  isValidDateString,
  dayOfWeek,
  toMinutes,
  slotsForDate,
  leaveOn,
  isPast,
};
