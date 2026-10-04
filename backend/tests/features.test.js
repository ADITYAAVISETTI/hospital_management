// Tests for: password reset, family members, rescheduling, doctor leave,
// holidays, front-desk (walk-in) booking, lab reports, health packages,
// doctor photos, feedback & ratings, CSV export, emails and reminders.
process.env.NODE_ENV = 'test';
process.env.DB_CONNECT = process.env.TEST_DB_CONNECT_2 || 'mongodb://127.0.0.1:27017/CityCareHospital_test2';
process.env.UPLOADS_DIR = require('path').join(require('os').tmpdir(), `citycare-test-uploads-${process.pid}`);

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const mongoose = require('mongoose');
const app = require('../src/app');
const { connectDb } = require('../src/db');
const User = require('../src/models/User');
const Department = require('../src/models/Department');
const Doctor = require('../src/models/Doctor');
const Appointment = require('../src/models/Appointment');
require('../src/models/Enquiry');
require('../src/models/Holiday');
require('../src/models/Report');
require('../src/models/HealthPackage');
require('../src/models/PackageBooking');
const clock = require('../src/utils/time');
const { outbox } = require('../src/utils/mailer');
const { sendDueReminders } = require('../src/services/notifications');

let server;
let base;
const s = {};

async function call(method, path, { body, token, raw = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (raw) return res;
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}

const settle = () => new Promise((r) => setTimeout(r, 150)); // let background emails run
const lastEmail = () => outbox[outbox.length - 1];

/** Nth date (from tomorrow) on which the doctor has a free slot, via the public API. */
async function freeSlot(doctorId, skip = 0) {
  let found = 0;
  for (let i = 1; i <= 40; i++) {
    const day = clock.addDays(clock.todayString(), i);
    const r = await call('GET', `/api/doctors/${doctorId}/slots?date=${day}`);
    const free = r.data.slots.filter((x) => x.available);
    if (free.length && found++ === skip) return { date: day, time: free[0].time, all: free.map((x) => x.time) };
  }
  throw new Error('no free slot found');
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

before(async () => {
  await connectDb();
  await mongoose.connection.dropDatabase();
  await connectDb(); // rebuild indexes on the empty database

  await User.create({ name: 'Admin', email: 'admin@test.io', password: 'Admin1234', role: 'admin' });
  const dept = await Department.create({ name: 'Cardiology', slug: 'cardiology', summary: 'Heart care services' });
  const docUser = await User.create({ name: 'Dr. Heart', email: 'heart@test.io', password: 'Doctor1234', role: 'doctor' });
  s.doctor = await Doctor.create({
    user: docUser._id,
    department: dept._id,
    specialization: 'Cardiologist',
    consultationFee: 800,
    schedule: [1, 2, 3, 4, 5, 6].map((day) => ({ day, start: '09:00', end: '11:00' })),
  });
  const doc2User = await User.create({ name: 'Dr. Other', email: 'other@test.io', password: 'Doctor1234', role: 'doctor' });
  s.doctor2 = await Doctor.create({ user: doc2User._id, department: dept._id, specialization: 'Cardiologist', schedule: [{ day: 1, start: '09:00', end: '10:00' }] });

  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;

  const login = async (email, password) => (await call('POST', '/api/auth/login', { body: { email, password } })).data.token;
  s.admin = await login('admin@test.io', 'Admin1234');
  s.doc = await login('heart@test.io', 'Doctor1234');
  s.doc2 = await login('other@test.io', 'Doctor1234');
  const a = await call('POST', '/api/auth/register', { body: { name: 'Asha Patel', email: 'asha@test.io', password: 'Secret123', phone: '+91 90000 00001' } });
  s.asha = a.data.token;
  s.ashaId = a.data.user.id;
  const b = await call('POST', '/api/auth/register', { body: { name: 'Ravi Kumar', email: 'ravi@test.io', password: 'Secret123', phone: '+91 90000 00002' } });
  s.ravi = b.data.token;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true });
});

describe('forgot / reset password', () => {
  test('same answer for known and unknown emails; email only for known', async () => {
    const before_ = outbox.length;
    const unknown = await call('POST', '/api/auth/forgot-password', { body: { email: 'nobody@test.io' } });
    assert.equal(unknown.status, 200);
    assert.equal(outbox.length, before_, 'no email for unknown address');
    const known = await call('POST', '/api/auth/forgot-password', { body: { email: 'asha@test.io' } });
    assert.equal(known.status, 200);
    assert.equal(known.data.message.replace('asha@test.io', 'X'), unknown.data.message.replace('nobody@test.io', 'X'));
    await settle();
    assert.equal(outbox.length, before_ + 1);
    const m = lastEmail().text.match(/reset-password\.html\?token=([a-f0-9]{64})/);
    assert.ok(m, 'email contains reset link');
    s.resetToken = m[1];
  });

  test('reset works once, then the link is dead; old sessions are signed out', async () => {
    const oldSession = s.asha;
    await new Promise((r) => setTimeout(r, 1100)); // tokens have 1-second precision
    let r = await call('POST', '/api/auth/reset-password', { body: { token: s.resetToken, password: 'Brandnew123' } });
    assert.equal(r.status, 200);
    r = await call('POST', '/api/auth/reset-password', { body: { token: s.resetToken, password: 'Another123' } });
    assert.equal(r.status, 400);
    assert.equal((await call('GET', '/api/auth/me', { token: oldSession })).status, 401);
    r = await call('POST', '/api/auth/login', { body: { email: 'asha@test.io', password: 'Brandnew123' } });
    assert.equal(r.status, 200);
    s.asha = r.data.token;
    r = await call('POST', '/api/auth/reset-password', { body: { token: 'f'.repeat(64), password: 'Brandnew123' } });
    assert.equal(r.status, 400);
  });
});

describe('family members', () => {
  test('add, list, edit; each gets a UHID', async () => {
    let r = await call('POST', '/api/family', { token: s.asha, body: { name: 'Riya Patel', relation: 'child', dateOfBirth: '2018-06-01', gender: 'female' } });
    assert.equal(r.status, 201);
    assert.match(r.data.uhid, /^CC\d{6}$/);
    assert.equal(r.data.email, '');
    s.memberId = r.data.id;
    r = await call('GET', '/api/family', { token: s.asha });
    assert.equal(r.data.length, 1);
    r = await call('PUT', `/api/family/${s.memberId}`, { token: s.asha, body: { name: 'Riya A. Patel', relation: 'child', bloodGroup: 'B+' } });
    assert.equal(r.data.bloodGroup, 'B+');
    assert.equal((await call('PUT', `/api/family/${s.memberId}`, { token: s.ravi, body: { name: 'Hack', relation: 'child' } })).status, 404);
    assert.equal((await call('POST', '/api/family', { token: s.asha, body: { name: 'X', relation: 'boss' } })).status, 400);
  });

  test('book for a family member; guardian manages it and gets the email', async () => {
    const slot = await freeSlot(s.doctor._id);
    const r = await call('POST', '/api/appointments', {
      token: s.asha,
      body: { doctor: String(s.doctor._id), date: slot.date, time: slot.time, patient: s.memberId, reason: 'Fever' },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.patient.name, 'Riya A. Patel');
    assert.equal(r.data.patient.isDependant, true);
    s.memberAppt = r.data.id;
    await settle();
    assert.equal(lastEmail().to, 'asha@test.io');
    assert.match(lastEmail().subject, /Appointment confirmed/);
    assert.match(lastEmail().text, /Patient: Riya A\. Patel/);

    const mine = await call('GET', '/api/appointments/mine', { token: s.asha });
    assert.ok(mine.data.some((a) => a.id === s.memberAppt));
    assert.equal((await call('GET', `/api/appointments/${s.memberAppt}`, { token: s.ravi })).status, 404);
    const hijack = await call('POST', '/api/appointments', {
      token: s.ravi,
      body: { doctor: String(s.doctor._id), date: slot.date, time: slot.all[1], patient: s.memberId },
    });
    assert.equal(hijack.status, 404, "can't book for someone else's family member");
  });

  test('members with history cannot be removed; new ones can', async () => {
    assert.equal((await call('DELETE', `/api/family/${s.memberId}`, { token: s.asha })).status, 409);
    const r = await call('POST', '/api/family', { token: s.asha, body: { name: 'Temp Person', relation: 'other' } });
    assert.equal((await call('DELETE', `/api/family/${r.data.id}`, { token: s.asha })).status, 200);
  });
});

describe('rescheduling', () => {
  test('patient moves an appointment; old slot frees up', async () => {
    const first = await freeSlot(s.doctor._id, 2);
    const created = await call('POST', '/api/appointments', { token: s.asha, body: { doctor: String(s.doctor._id), date: first.date, time: first.time } });
    assert.equal(created.status, 201);
    s.ashaAppt = created.data.id;

    const target = await freeSlot(s.doctor._id, 3);
    const r = await call('PATCH', `/api/appointments/${s.ashaAppt}/reschedule`, { token: s.asha, body: { date: target.date, time: target.time } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.date, target.date);
    assert.equal(r.data.rescheduleCount, 1);
    await settle();
    assert.match(lastEmail().subject, /rescheduled/);

    const old = await call('GET', `/api/doctors/${s.doctor._id}/slots?date=${first.date}`);
    assert.equal(old.data.slots.find((x) => x.time === first.time).available, true, 'old slot is free again');
  });

  test('cannot move onto a taken slot, and not someone else\'s appointment', async () => {
    const taken = await freeSlot(s.doctor._id, 4);
    await call('POST', '/api/appointments', { token: s.ravi, body: { doctor: String(s.doctor._id), date: taken.date, time: taken.time } });
    let r = await call('PATCH', `/api/appointments/${s.ashaAppt}/reschedule`, { token: s.asha, body: { date: taken.date, time: taken.time } });
    assert.equal(r.status, 409);
    r = await call('PATCH', `/api/appointments/${s.ashaAppt}/reschedule`, { token: s.ravi, body: { date: taken.date, time: taken.all[1] } });
    assert.equal(r.status, 404);
  });

  test('online reschedule limit; admin can still move it', async () => {
    const t2 = await freeSlot(s.doctor._id, 5);
    assert.equal((await call('PATCH', `/api/appointments/${s.ashaAppt}/reschedule`, { token: s.asha, body: { date: t2.date, time: t2.time } })).status, 200);
    const t3 = await freeSlot(s.doctor._id, 6);
    const r = await call('PATCH', `/api/appointments/${s.ashaAppt}/reschedule`, { token: s.asha, body: { date: t3.date, time: t3.time } });
    assert.equal(r.status, 400);
    assert.match(r.data.message, /up to 2 times/);
    assert.equal((await call('PATCH', `/api/appointments/${s.ashaAppt}/reschedule`, { token: s.admin, body: { date: t3.date, time: t3.time } })).status, 200);
  });
});

describe('doctor leave', () => {
  test('doctor adds leave: bookings that day are cancelled and patients emailed', async () => {
    const slot = await freeSlot(s.doctor._id, 8);
    const booked = await call('POST', '/api/appointments', { token: s.ravi, body: { doctor: String(s.doctor._id), date: slot.date, time: slot.time } });
    assert.equal(booked.status, 201);

    const impact = await call('GET', `/api/doctors/${s.doctor._id}/leaves/impact?from=${slot.date}&to=${slot.date}`, { token: s.doc });
    assert.equal(impact.data.count, 1);

    assert.equal((await call('POST', `/api/doctors/${s.doctor._id}/leaves`, { token: s.doc2, body: { from: slot.date, to: slot.date } })).status, 403);
    const r = await call('POST', `/api/doctors/${s.doctor._id}/leaves`, { token: s.doc, body: { from: slot.date, to: slot.date, reason: 'Conference' } });
    assert.equal(r.status, 201);
    assert.equal(r.data.cancelledAppointments, 1);
    s.leaveId = r.data.leave.id;
    s.leaveDay = slot.date;
    await settle();
    assert.equal(lastEmail().to, 'ravi@test.io');
    assert.match(lastEmail().text, /on leave/);

    const appt = await call('GET', `/api/appointments/${booked.data.id}`, { token: s.ravi });
    assert.equal(appt.data.status, 'cancelled');
  });

  test('leave days have no slots and cannot be booked; public sees dates only', async () => {
    const slots = await call('GET', `/api/doctors/${s.doctor._id}/slots?date=${s.leaveDay}`);
    assert.deepEqual(slots.data.slots, []);
    assert.match(slots.data.message, /on leave/);
    const r = await call('POST', '/api/appointments', { token: s.ravi, body: { doctor: String(s.doctor._id), date: s.leaveDay, time: '09:00' } });
    assert.equal(r.status, 400);
    const pub = await call('GET', `/api/doctors/${s.doctor._id}`);
    assert.deepEqual(pub.data.leaves, [{ from: s.leaveDay, to: s.leaveDay }], 'no reason shown publicly');
    const own = await call('GET', `/api/doctors/${s.doctor._id}`, { token: s.doc });
    assert.equal(own.data.leaves[0].reason, 'Conference');
  });

  test('bad ranges rejected; removing leave reopens the day', async () => {
    const today = clock.todayString();
    assert.equal((await call('POST', `/api/doctors/${s.doctor._id}/leaves`, { token: s.admin, body: { from: clock.addDays(today, 5), to: clock.addDays(today, 2) } })).status, 400);
    assert.equal((await call('POST', `/api/doctors/${s.doctor._id}/leaves`, { token: s.admin, body: { from: '2020-01-01', to: '2020-01-02' } })).status, 400);
    assert.equal((await call('DELETE', `/api/doctors/${s.doctor._id}/leaves/${s.leaveId}`, { token: s.doc })).status, 200);
    const slots = await call('GET', `/api/doctors/${s.doctor._id}/slots?date=${s.leaveDay}`);
    assert.ok(slots.data.slots.length > 0);
  });
});

describe('holidays', () => {
  test('admin adds a holiday: nobody can book, existing bookings cancelled', async () => {
    const slot = await freeSlot(s.doctor._id, 9);
    const booked = await call('POST', '/api/appointments', { token: s.ravi, body: { doctor: String(s.doctor._id), date: slot.date, time: slot.time } });
    assert.equal(booked.status, 201);

    assert.equal((await call('POST', '/api/holidays', { token: s.asha, body: { date: slot.date, name: 'Festival' } })).status, 403);
    const imp = await call('GET', `/api/holidays/impact?date=${slot.date}`, { token: s.admin });
    assert.equal(imp.data.count, 1);
    const r = await call('POST', '/api/holidays', { token: s.admin, body: { date: slot.date, name: 'Festival' } });
    assert.equal(r.status, 201);
    assert.equal(r.data.cancelledAppointments, 1);
    assert.equal((await call('POST', '/api/holidays', { token: s.admin, body: { date: slot.date, name: 'Again' } })).status, 409);

    const slots = await call('GET', `/api/doctors/${s.doctor._id}/slots?date=${slot.date}`);
    assert.match(slots.data.message, /closed.*Festival/);
    assert.ok((await call('GET', '/api/holidays')).data.some((h) => h.date === slot.date));

    assert.equal((await call('DELETE', `/api/holidays/${r.data.holiday._id}`, { token: s.admin })).status, 200);
  });
});

describe('front desk (walk-in) patients', () => {
  test('admin registers a walk-in without email and books for them', async () => {
    let r = await call('POST', '/api/admin/patients', { token: s.admin, body: { name: 'Walk In', phone: '+91 90000 11111', gender: 'male' } });
    assert.equal(r.status, 201);
    assert.match(r.data.uhid, /^CC/);
    s.walkIn = r.data.id;
    // A second walk-in without email must not clash on the unique email index.
    r = await call('POST', '/api/admin/patients', { token: s.admin, body: { name: 'Walk In Two', phone: '+91 90000 22222', email: '' } });
    assert.equal(r.status, 201);

    const slot = await freeSlot(s.doctor._id, 10);
    r = await call('POST', '/api/appointments', { token: s.admin, body: { doctor: String(s.doctor._id), date: slot.date, time: slot.time, patient: s.walkIn } });
    assert.equal(r.status, 201);
    assert.equal(r.data.bookedBy, 'admin');
    assert.equal((await call('POST', '/api/admin/patients', { token: s.asha, body: { name: 'X Y', phone: '+91 90000 33333' } })).status, 403);
  });

  test('walk-in with email can later claim the account via forgot password', async () => {
    let r = await call('POST', '/api/admin/patients', { token: s.admin, body: { name: 'Meena Rao', phone: '+91 90000 44444', email: 'meena@test.io' } });
    assert.equal(r.status, 201);
    assert.equal((await call('POST', '/api/admin/patients', { token: s.admin, body: { name: 'Dup', phone: '+91 90000 55555', email: 'meena@test.io' } })).status, 409);
    r = await call('POST', '/api/auth/login', { body: { email: 'meena@test.io', password: 'whatever1' } });
    assert.equal(r.status, 401, 'no password yet');
    r = await call('POST', '/api/auth/register', { body: { name: 'Meena Rao', email: 'meena@test.io', password: 'Secret123', phone: '+91 90000 44444' } });
    assert.equal(r.status, 409);
    assert.match(r.data.message, /Forgot password/);
    await call('POST', '/api/auth/forgot-password', { body: { email: 'meena@test.io' } });
    await settle();
    const token = lastEmail().text.match(/token=([a-f0-9]{64})/)[1];
    assert.equal((await call('POST', '/api/auth/reset-password', { body: { token, password: 'Meena1234' } })).status, 200);
    assert.equal((await call('POST', '/api/auth/login', { body: { email: 'meena@test.io', password: 'Meena1234' } })).status, 200);
  });

  test('admin edits a patient; cannot strip the email from an online account', async () => {
    let r = await call('PUT', `/api/admin/patients/${s.walkIn}`, { token: s.admin, body: { name: 'Walk In Fixed', phone: '+91 90000 11112', email: '' } });
    assert.equal(r.status, 200);
    assert.equal(r.data.name, 'Walk In Fixed');
    r = await call('PUT', `/api/admin/patients/${s.ashaId}`, { token: s.admin, body: { name: 'Asha Patel', phone: '+91 90000 00001', email: '' } });
    assert.equal(r.status, 400);
  });
});

describe('lab reports', () => {
  test('admin uploads; patient downloads exactly the same file', async () => {
    const r = await call('POST', '/api/reports', {
      token: s.admin,
      body: { patient: s.ashaId, title: 'Lipid profile', category: 'lab', reportDate: clock.todayString(), fileName: 'lipid.pdf', data: PDF },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    s.reportId = r.data.id;
    const mine = await call('GET', '/api/reports/mine', { token: s.asha });
    assert.equal(mine.data.length, 1);
    const file = await call('GET', `/api/reports/${s.reportId}/file`, { token: s.asha, raw: true });
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await file.arrayBuffer()).toString('base64'), PDF);
  });

  test('other patients and unrelated doctors are blocked; treating doctor allowed', async () => {
    assert.equal((await call('GET', `/api/reports/${s.reportId}/file`, { token: s.ravi })).status, 404);
    assert.equal((await call('GET', `/api/reports?patient=${s.ashaId}`, { token: s.doc2 })).status, 403);
    assert.equal((await call('GET', `/api/reports?patient=${s.ashaId}`, { token: s.doc })).status, 200, 'Dr. Heart has seen Asha');
    assert.equal((await call('GET', `/uploads/reports/anything.pdf`)).status, 404, 'reports are never public static files');
  });

  test('family member reports are visible to the guardian', async () => {
    const r = await call('POST', '/api/reports', {
      token: s.doc,
      body: { patient: s.memberId, title: 'Blood count', reportDate: clock.todayString(), fileName: 'cbc.png', data: PNG },
    });
    assert.equal(r.status, 201, 'treating doctor can upload');
    const mine = await call('GET', '/api/reports/mine', { token: s.asha });
    assert.equal(mine.data.length, 2);
  });

  test('wrong file types, fake PDFs and future dates are rejected', async () => {
    const bad = (extra) => call('POST', '/api/reports', { token: s.admin, body: { patient: s.ashaId, title: 'Bad', reportDate: clock.todayString(), fileName: 'x.pdf', data: PDF, ...extra } });
    assert.equal((await bad({ data: Buffer.from('<script>alert(1)</script>').toString('base64') })).status, 400);
    assert.equal((await bad({ data: 'not base64 !!' })).status, 400);
    assert.equal((await bad({ reportDate: clock.addDays(clock.todayString(), 3) })).status, 400);
    const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5.5 * 1024 * 1024)]).toString('base64');
    assert.ok([400, 413].includes((await bad({ data: big })).status));
  });

  test('doctors can only delete their own uploads', async () => {
    assert.equal((await call('DELETE', `/api/reports/${s.reportId}`, { token: s.doc })).status, 403);
    assert.equal((await call('DELETE', `/api/reports/${s.reportId}`, { token: s.admin })).status, 200);
  });
});

describe('health packages', () => {
  test('admin creates; public lists; patient books; admin confirms (email)', async () => {
    let r = await call('POST', '/api/packages', { token: s.admin, body: { name: 'Basic Check', summary: 'Essential screening', price: 1500, originalPrice: 2000, tests: ['CBC', 'Lipid'] } });
    assert.equal(r.status, 201);
    s.pkg = r.data._id;
    assert.equal((await call('POST', '/api/packages', { token: s.asha, body: { name: 'X pack', summary: 'Nope nope', price: 1 } })).status, 403);
    assert.equal((await call('GET', '/api/packages')).data.length, 1);

    let day = clock.addDays(clock.todayString(), 2);
    while (clock.dayOfWeek(day) === 0) day = clock.addDays(day, 1);
    r = await call('POST', `/api/packages/${s.pkg}/book`, { token: s.asha, body: { date: day, patient: s.memberId } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.match(r.data.bookingNo, /^HC\d{6}$/);
    assert.equal(r.data.patient.name, 'Riya A. Patel');
    s.pkgBooking = r.data.id;
    assert.equal((await call('POST', `/api/packages/${s.pkg}/book`, { token: s.asha, body: { date: day, patient: s.memberId } })).status, 409);

    let sunday = clock.addDays(clock.todayString(), 1);
    while (clock.dayOfWeek(sunday) !== 0) sunday = clock.addDays(sunday, 1);
    assert.equal((await call('POST', `/api/packages/${s.pkg}/book`, { token: s.asha, body: { date: sunday } })).status, 400);
    assert.equal((await call('POST', `/api/packages/${s.pkg}/book`, { token: s.asha, body: { date: clock.todayString() } })).status, 400);

    r = await call('PATCH', `/api/packages/bookings/${s.pkgBooking}/status`, { token: s.admin, body: { status: 'confirmed' } });
    assert.equal(r.data.status, 'confirmed');
    await settle();
    assert.match(lastEmail().subject, /check-up confirmed/);
  });

  test('patient sees and cancels; package with bookings cannot be deleted', async () => {
    const mine = await call('GET', '/api/packages/bookings/mine', { token: s.asha });
    assert.equal(mine.data.length, 1);
    assert.equal((await call('PATCH', `/api/packages/bookings/${s.pkgBooking}/cancel`, { token: s.ravi })).status, 404);
    assert.equal((await call('PATCH', `/api/packages/bookings/${s.pkgBooking}/cancel`, { token: s.asha })).data.status, 'cancelled');
    assert.equal((await call('DELETE', `/api/packages/${s.pkg}`, { token: s.admin })).status, 409);
  });
});

describe('doctor photos', () => {
  test('admin uploads a photo; it is publicly served', async () => {
    const r = await call('PUT', `/api/doctors/${s.doctor._id}/photo`, { token: s.admin, body: { data: `data:image/png;base64,${PNG}` } });
    assert.equal(r.status, 200);
    assert.match(r.data.photo, /^\/uploads\/doctors\/[a-f0-9]{32}\.png$/);
    const img = await call('GET', r.data.photo, { raw: true });
    assert.equal(img.status, 200);
    assert.match(img.headers.get('content-type'), /image\/png/);
    assert.equal((await call('GET', `/api/doctors/${s.doctor._id}`)).data.photo, r.data.photo);
    assert.equal((await call('PUT', `/api/doctors/${s.doctor._id}/photo`, { token: s.admin, body: { data: PDF } })).status, 400, 'PDF is not a photo');
    assert.equal((await call('PUT', `/api/doctors/${s.doctor._id}/photo`, { token: s.doc, body: { data: PNG } })).status, 403);
    assert.equal((await call('GET', '/uploads/doctors/missing.png')).status, 404);
  });
});

describe('feedback and ratings', () => {
  test('only completed visits can be rated, once', async () => {
    const past = await Appointment.create({
      appointmentNo: 'APT900001',
      patient: s.ashaId,
      account: s.ashaId,
      doctor: s.doctor._id,
      department: s.doctor.department,
      date: clock.addDays(clock.todayString(), -2),
      time: '09:00',
      holdsSlot: true,
    });
    assert.equal((await call('PATCH', `/api/appointments/${past._id}/feedback`, { token: s.asha, body: { rating: 5 } })).status, 400, 'not completed yet');
    await call('PATCH', `/api/appointments/${past._id}/consult`, { token: s.doc, body: { status: 'completed', diagnosis: 'OK' } });
    let r = await call('PATCH', `/api/appointments/${past._id}/feedback`, { token: s.asha, body: { rating: 4, comment: 'Very kind and clear doctor.' } });
    assert.equal(r.status, 200);
    assert.equal(r.data.feedback.rating, 4);
    assert.equal((await call('PATCH', `/api/appointments/${past._id}/feedback`, { token: s.asha, body: { rating: 1 } })).status, 409);
    assert.equal((await call('PATCH', `/api/appointments/${past._id}/feedback`, { token: s.ravi, body: { rating: 1 } })).status, 404);
    assert.equal((await call('PATCH', `/api/appointments/${past._id}/feedback`, { token: s.asha, body: { rating: 9 } })).status, 400);
    s.ratedAppt = String(past._id);

    const doc = await call('GET', `/api/doctors/${s.doctor._id}`);
    assert.deepEqual(doc.data.rating, { average: 4, count: 1 });
    r = await call('GET', `/api/doctors/${s.doctor._id}/reviews`);
    assert.equal(r.data.length, 1);
    assert.equal(r.data[0].name, 'Asha P.', 'only first name + initial is public');
  });

  test('admin can hide a review', async () => {
    const r = await call('PATCH', `/api/appointments/${s.ratedAppt}/feedback/visibility`, { token: s.admin, body: { hidden: true } });
    assert.equal(r.data.feedback.hidden, true);
    assert.equal((await call('GET', `/api/doctors/${s.doctor._id}/reviews`)).data.length, 0);
  });
});

describe('CSV export', () => {
  test('appointments and patients export; formula injection is neutralised', async () => {
    await call('POST', '/api/admin/patients', { token: s.admin, body: { name: '=HYPERLINK("x")', phone: '+91 90000 66666' } });
    let r = await call('GET', '/api/admin/export/patients.csv', { token: s.admin });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="patients-/);
    assert.ok(r.data.includes(`"'=HYPERLINK(""x"")"`), 'formula prefixed with apostrophe');
    assert.ok(r.data.split('\r\n')[0].includes('UHID'));

    r = await call('GET', '/api/admin/export/appointments.csv?status=completed', { token: s.admin });
    const lines = r.data.trim().split('\r\n');
    assert.ok(lines[0].includes('Appointment No'));
    assert.ok(lines.slice(1).every((l) => l.includes('completed')));
    assert.equal((await call('GET', '/api/admin/export/patients.csv', { token: s.asha })).status, 403);
  });
});

describe('reminders', () => {
  test('tomorrow\'s appointments get exactly one reminder email', async () => {
    const tomorrow = clock.addDays(clock.todayString(), 1);
    await Appointment.create({
      appointmentNo: 'APT900002',
      patient: s.ashaId,
      account: s.ashaId,
      doctor: s.doctor2._id,
      department: s.doctor2.department,
      date: tomorrow,
      time: '23:45',
    });
    const before_ = outbox.length;
    await sendDueReminders();
    await settle();
    const sent = outbox.slice(before_).filter((m) => /Reminder/.test(m.subject));
    assert.ok(sent.some((m) => m.to === 'asha@test.io' && m.text.includes('APT900002')));
    const count = outbox.length;
    await sendDueReminders();
    await settle();
    assert.equal(outbox.slice(count).filter((m) => m.text.includes('APT900002')).length, 0, 'not sent twice');
  });
});

describe('review fixes', () => {
  test('admin restoring a cancelled appointment follows the booking rules', async () => {
    const slot = await freeSlot(s.doctor._id, 15);
    const body = { doctor: String(s.doctor._id), date: slot.date, time: slot.time };
    const ravis = await call('POST', '/api/appointments', { token: s.ravi, body });
    assert.equal(ravis.status, 201);
    const restore = () => call('PATCH', `/api/appointments/${ravis.data.id}/status`, { token: s.admin, body: { status: 'scheduled' } });
    assert.equal((await call('PATCH', `/api/appointments/${ravis.data.id}/status`, { token: s.admin, body: { status: 'cancelled' } })).status, 200);

    // Someone else took the slot meanwhile: clear message naming that appointment.
    const ashas = await call('POST', '/api/appointments', { token: s.asha, body });
    assert.equal(ashas.status, 201);
    let r = await restore();
    assert.equal(r.status, 409);
    assert.match(r.data.message, new RegExp(`since been booked.*${ashas.data.appointmentNo}`));
    assert.equal((await call('PATCH', `/api/appointments/${ashas.data.id}/cancel`, { token: s.asha, body: {} })).status, 200);

    // Hospital closed that day.
    const h = await call('POST', '/api/holidays', { token: s.admin, body: { date: slot.date, name: 'Strike' } });
    assert.equal(h.status, 201);
    r = await restore();
    assert.equal(r.status, 400);
    assert.match(r.data.message, /closed/);
    await call('DELETE', `/api/holidays/${h.data.holiday._id}`, { token: s.admin });

    r = await restore();
    assert.equal(r.status, 200);
    assert.equal(r.data.status, 'scheduled');

    // A past cancelled visit can't come back as upcoming, but can be marked completed.
    const past = await Appointment.create({
      appointmentNo: 'APT900003', patient: s.ashaId, account: s.ashaId, doctor: s.doctor._id, department: s.doctor.department,
      date: clock.addDays(clock.todayString(), -3), time: '09:15', status: 'cancelled', holdsSlot: false,
    });
    r = await call('PATCH', `/api/appointments/${past._id}/status`, { token: s.admin, body: { status: 'scheduled' } });
    assert.equal(r.status, 400);
    r = await call('PATCH', `/api/appointments/${past._id}/status`, { token: s.admin, body: { status: 'completed' } });
    assert.equal(r.status, 200);
  });

  test('a rated visit stays completed, but the doctor can still correct notes', async () => {
    let r = await call('PATCH', `/api/appointments/${s.ratedAppt}/consult`, { token: s.doc, body: { status: 'no-show' } });
    assert.equal(r.status, 409);
    r = await call('PATCH', `/api/appointments/${s.ratedAppt}/consult`, { token: s.doc, body: { status: 'completed', prescription: 'Corrected dose' } });
    assert.equal(r.status, 200);
    assert.equal(r.data.prescription, 'Corrected dose');
  });

  test('hidden reviews do not count towards the public rating', async () => {
    // The only review was hidden earlier.
    assert.deepEqual((await call('GET', `/api/doctors/${s.doctor._id}`)).data.rating, { average: 0, count: 0 });
    await call('PATCH', `/api/appointments/${s.ratedAppt}/feedback/visibility`, { token: s.admin, body: { hidden: false } });
    assert.deepEqual((await call('GET', `/api/doctors/${s.doctor._id}`)).data.rating, { average: 4, count: 1 });
  });

  test('a family member given their own login can manage their visits; guardian keeps access', async () => {
    let r = await call('PUT', `/api/admin/patients/${s.memberId}`, { token: s.admin, body: { name: 'Riya A. Patel', phone: '', email: 'riya@test.io' } });
    assert.equal(r.status, 200);
    await call('POST', '/api/auth/forgot-password', { body: { email: 'riya@test.io' } });
    await settle();
    const token = lastEmail().text.match(/token=([a-f0-9]{64})/)[1];
    assert.equal((await call('POST', '/api/auth/reset-password', { body: { token, password: 'Riya12345' } })).status, 200);
    const riya = (await call('POST', '/api/auth/login', { body: { email: 'riya@test.io', password: 'Riya12345' } })).data.token;

    // Visit booked by the guardian: listed AND openable by the member.
    const mine = await call('GET', '/api/appointments/mine', { token: riya });
    assert.ok(mine.data.some((a) => String(a.id) === String(s.memberAppt)));
    assert.equal((await call('GET', `/api/appointments/${s.memberAppt}`, { token: riya })).status, 200);

    // Visit the member books themselves: the guardian still sees and manages it.
    const slot = await freeSlot(s.doctor._id, 16);
    r = await call('POST', '/api/appointments', { token: riya, body: { doctor: String(s.doctor._id), date: slot.date, time: slot.time } });
    assert.equal(r.status, 201);
    const own = r.data.id;
    assert.ok((await call('GET', '/api/appointments/mine', { token: s.asha })).data.some((a) => a.id === own));
    assert.equal((await call('PATCH', `/api/appointments/${own}/cancel`, { token: riya, body: {} })).status, 200);
    assert.equal((await call('GET', `/api/appointments/${own}`, { token: s.asha })).status, 200);
    assert.equal((await call('GET', `/api/appointments/${own}`, { token: s.ravi })).status, 404);

    // Same for health check-ups.
    let day = clock.addDays(clock.todayString(), 2);
    while (clock.dayOfWeek(day) === 0) day = clock.addDays(day, 1);
    r = await call('POST', `/api/packages/${s.pkg}/book`, { token: riya, body: { date: day } });
    assert.equal(r.status, 201);
    assert.ok((await call('GET', '/api/packages/bookings/mine', { token: riya })).data.some((b) => b.id === r.data.id));
    assert.ok((await call('GET', '/api/packages/bookings/mine', { token: s.asha })).data.some((b) => b.id === r.data.id));
    assert.equal((await call('PATCH', `/api/packages/bookings/${r.data.id}/cancel`, { token: riya })).status, 200);
  });

  test('a deactivated doctor is signed out and cannot log in until reactivated', async () => {
    let r = await call('POST', '/api/doctors', {
      token: s.admin,
      body: { name: 'Dr. Leaving', email: 'leaving@test.io', password: 'Doctor1234', department: String(s.doctor.department), specialization: 'Cardiologist' },
    });
    assert.equal(r.status, 201);
    const id = r.data.id;
    const login = () => call('POST', '/api/auth/login', { body: { email: 'leaving@test.io', password: 'Doctor1234' } });
    const session = (await login()).data.token;
    assert.equal((await call('GET', '/api/auth/me', { token: session })).status, 200);

    assert.equal((await call('DELETE', `/api/doctors/${id}`, { token: s.admin })).status, 200);
    assert.equal((await call('GET', '/api/auth/me', { token: session })).status, 401);
    r = await login();
    assert.equal(r.status, 401);
    assert.match(r.data.message, /deactivated/);

    assert.equal((await call('PUT', `/api/doctors/${id}`, { token: s.admin, body: { active: true } })).status, 200);
    assert.equal((await login()).status, 200);
  });
});

describe('report ownership', () => {
  test('reports say who uploaded them (used to show the delete button)', async () => {
    const up = await call('POST', '/api/reports', {
      token: s.admin,
      body: { patient: s.ashaId, title: 'Ownership check', reportDate: clock.todayString(), fileName: 'own.pdf', data: PDF },
    });
    assert.equal(up.status, 201);
    const me = (await call('GET', '/api/auth/me', { token: s.admin })).data.user;
    assert.equal(String(up.data.uploadedBy), String(me.id));
    const list = await call('GET', '/api/reports/mine', { token: s.asha });
    assert.ok(list.data.some((x) => x.id === up.data.id && String(x.uploadedBy) === String(me.id)));
  });
});
