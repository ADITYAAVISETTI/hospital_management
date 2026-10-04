// End-to-end API tests. Run with: npm test
// Uses a separate database (CityCareHospital_test) that is wiped on every run.
process.env.NODE_ENV = 'test';
process.env.DB_CONNECT = process.env.TEST_DB_CONNECT || 'mongodb://127.0.0.1:27017/CityCareHospital_test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const app = require('../src/app');
const { connectDb } = require('../src/db');
const User = require('../src/models/User');
const Department = require('../src/models/Department');
const Doctor = require('../src/models/Doctor');
const Appointment = require('../src/models/Appointment');
const Enquiry = require('../src/models/Enquiry');
const { Counter } = require('../src/models/Counter');
const clock = require('../src/utils/time');

let server;
let base;

async function call(method, path, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

/** First date from tomorrow on that the doctor works. */
function nextWorkingDate(doctor, skip = 0) {
  let found = 0;
  for (let i = 1; i <= 21; i++) {
    const day = clock.addDays(clock.todayString(), i);
    if (clock.slotsForDate(doctor, day).length > 0 && found++ === skip) return day;
  }
  throw new Error('doctor has no working day in the next 3 weeks');
}

const state = {};

before(async () => {
  await connectDb();
  await Promise.all([User, Department, Doctor, Appointment, Enquiry, Counter].map((m) => m.deleteMany({})));

  // Fixtures: one admin, two departments, two doctors.
  await User.create({ name: 'Admin', email: 'admin@test.io', password: 'Admin1234', role: 'admin' });
  state.cardio = await Department.create({ name: 'Cardiology', slug: 'cardiology', summary: 'Heart care services' });
  state.neuro = await Department.create({ name: 'Neurology', slug: 'neurology', summary: 'Brain and nerve care' });

  const docUser = await User.create({ name: 'Dr. Heart', email: 'heart@test.io', password: 'Doctor1234', role: 'doctor' });
  state.doctor = await Doctor.create({
    user: docUser._id,
    department: state.cardio._id,
    specialization: 'Cardiologist',
    consultationFee: 800,
    schedule: [1, 2, 3, 4, 5, 6].map((day) => ({ day, start: '09:00', end: '10:00' })),
    slotMinutes: 15,
  });
  const doc2User = await User.create({ name: 'Dr. Brain', email: 'brain@test.io', password: 'Doctor1234', role: 'doctor' });
  state.doctor2 = await Doctor.create({
    user: doc2User._id,
    department: state.neuro._id,
    specialization: 'Neurologist',
    schedule: [{ day: 1, start: '10:00', end: '12:00' }],
  });

  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('basics', () => {
  test('health check', async () => {
    const r = await call('GET', '/api/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { status: 'ok' });
  });

  test('unknown API route returns JSON 404', async () => {
    const r = await call('GET', '/api/nope');
    assert.equal(r.status, 404);
    assert.ok(r.data.message);
  });

  test('home page is served', async () => {
    const r = await call('GET', '/');
    assert.equal(r.status, 200);
    assert.match(r.data, /<html/i);
  });

  test('malformed JSON gives a clear 400', async () => {
    const res = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json',
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).message, /not valid JSON/);
  });
});

describe('auth', () => {
  test('register rejects bad input with a JSON message', async () => {
    let r = await call('POST', '/api/auth/register', {
      body: { name: 'A', email: 'bad', password: 'x', phone: '123' },
    });
    assert.equal(r.status, 400);
    assert.equal(typeof r.data.message, 'string');

    r = await call('POST', '/api/auth/register', {
      body: { name: 'Asha', email: 'asha@test.io', password: 'onlyletters', phone: '+91 90000 00001' },
    });
    assert.equal(r.status, 400);
    assert.match(r.data.message, /letter and one number/);
  });

  test('register creates a patient with a UHID and returns a token', async () => {
    const r = await call('POST', '/api/auth/register', {
      body: { name: 'Asha Patient', email: 'Asha@Test.io', password: 'Secret123', phone: '+91 90000 00001', role: 'admin' },
    });
    assert.equal(r.status, 201);
    assert.ok(r.data.token);
    assert.equal(r.data.user.role, 'patient', 'public sign-up must never create an admin');
    assert.equal(r.data.user.email, 'asha@test.io');
    assert.match(r.data.user.uhid, /^CC\d{6}$/);
    assert.equal(r.data.user.password, undefined);
    state.patientToken = r.data.token;
    state.patientId = r.data.user.id;
  });

  test('duplicate email is a 409 with a readable message', async () => {
    const r = await call('POST', '/api/auth/register', {
      body: { name: 'Asha Again', email: 'asha@test.io', password: 'Secret123', phone: '+91 90000 00001' },
    });
    assert.equal(r.status, 409);
    assert.match(r.data.message, /already exists/);
  });

  test('future date of birth is rejected', async () => {
    const r = await call('POST', '/api/auth/register', {
      body: { name: 'Future', email: 'future@test.io', password: 'Secret123', phone: '+91 90000 00009', dateOfBirth: clock.addDays(clock.todayString(), 5) },
    });
    assert.equal(r.status, 400);
  });

  test('login: wrong password and unknown email give the same JSON 401', async () => {
    const a = await call('POST', '/api/auth/login', { body: { email: 'asha@test.io', password: 'wrong123' } });
    const b = await call('POST', '/api/auth/login', { body: { email: 'nobody@test.io', password: 'wrong123' } });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.data.message, b.data.message);
  });

  test('login works for every role and doctors get their doctorId', async () => {
    const admin = await call('POST', '/api/auth/login', { body: { email: 'admin@test.io', password: 'Admin1234' } });
    assert.equal(admin.status, 200);
    assert.equal(admin.data.user.role, 'admin');
    state.adminToken = admin.data.token;

    const doc = await call('POST', '/api/auth/login', { body: { email: 'heart@test.io', password: 'Doctor1234' } });
    assert.equal(doc.status, 200);
    assert.equal(doc.data.user.doctorId, String(state.doctor._id));
    state.doctorToken = doc.data.token;

    const doc2 = await call('POST', '/api/auth/login', { body: { email: 'brain@test.io', password: 'Doctor1234' } });
    state.doctor2Token = doc2.data.token;

    const second = await call('POST', '/api/auth/register', {
      body: { name: 'Ravi Patient', email: 'ravi@test.io', password: 'Secret123', phone: '+91 90000 00002' },
    });
    state.patient2Token = second.data.token;
  });

  test('/me needs a valid token', async () => {
    assert.equal((await call('GET', '/api/auth/me')).status, 401);
    assert.equal((await call('GET', '/api/auth/me', { token: 'garbage' })).status, 401);
    const r = await call('GET', '/api/auth/me', { token: state.patientToken });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.name, 'Asha Patient');
  });

  test('profile update ignores role changes', async () => {
    const r = await call('PATCH', '/api/auth/me', {
      token: state.patientToken,
      body: { bloodGroup: 'O+', address: 'Hyderabad', role: 'admin' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.bloodGroup, 'O+');
    assert.equal(r.data.user.role, 'patient');
  });

  test('change password', async () => {
    let r = await call('POST', '/api/auth/change-password', {
      token: state.patientToken,
      body: { currentPassword: 'nope1234', newPassword: 'Newpass123' },
    });
    assert.equal(r.status, 400);
    r = await call('POST', '/api/auth/change-password', {
      token: state.patientToken,
      body: { currentPassword: 'Secret123', newPassword: 'Newpass123' },
    });
    assert.equal(r.status, 200);
    const fresh = r.data.token;
    state.patientToken = fresh; // the old token may now be rejected
    r = await call('POST', '/api/auth/login', { body: { email: 'asha@test.io', password: 'Newpass123' } });
    assert.equal(r.status, 200);
    assert.equal((await call('GET', '/api/auth/me', { token: fresh })).status, 200, 'token returned by change-password works');
  });

  test('old sessions stop working after a password change', async () => {
    const login = await call('POST', '/api/auth/login', { body: { email: 'ravi@test.io', password: 'Secret123' } });
    const oldToken = login.data.token;
    // iat has one-second precision: make sure the change happens in a later second.
    await new Promise((r) => setTimeout(r, 1100));
    const change = await call('POST', '/api/auth/change-password', {
      token: oldToken,
      body: { currentPassword: 'Secret123', newPassword: 'Changed123' },
    });
    assert.equal(change.status, 200);
    const stale = await call('GET', '/api/auth/me', { token: oldToken });
    assert.equal(stale.status, 401);
    assert.match(stale.data.message, /password was changed/);
    assert.equal((await call('GET', '/api/auth/me', { token: change.data.token })).status, 200);
    state.patient2Token = change.data.token;
  });
});

describe('departments and doctors (public)', () => {
  test('department list includes doctor counts', async () => {
    const r = await call('GET', '/api/departments');
    assert.equal(r.status, 200);
    const cardio = r.data.find((d) => d.slug === 'cardiology');
    assert.equal(cardio.doctorCount, 1);
  });

  test('department detail lists its doctors; unknown slug is 404', async () => {
    const r = await call('GET', '/api/departments/cardiology');
    assert.equal(r.status, 200);
    assert.equal(r.data.doctors.length, 1);
    assert.equal(r.data.doctors[0].name, 'Dr. Heart');
    assert.equal(r.data.doctors[0].email, undefined, 'public data must not expose doctor emails');
    assert.equal((await call('GET', '/api/departments/unknown')).status, 404);
  });

  test('doctor search by department and text', async () => {
    let r = await call('GET', '/api/doctors?department=neurology');
    assert.deepEqual(r.data.map((d) => d.name), ['Dr. Brain']);
    r = await call('GET', `/api/doctors?department=${state.cardio._id}`);
    assert.deepEqual(r.data.map((d) => d.name), ['Dr. Heart']);
    r = await call('GET', '/api/doctors?q=neuro');
    assert.deepEqual(r.data.map((d) => d.name), ['Dr. Brain']);
    r = await call('GET', '/api/doctors?department=nothing');
    assert.deepEqual(r.data, []);
  });

  test('doctor profile; invalid id is 400, missing is 404', async () => {
    const r = await call('GET', `/api/doctors/${state.doctor._id}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.consultationFee, 800);
    assert.equal((await call('GET', '/api/doctors/123')).status, 400);
    assert.equal((await call('GET', `/api/doctors/${new mongoose.Types.ObjectId()}`)).status, 404);
  });

  test('slots follow the weekly schedule', async () => {
    const day = nextWorkingDate(state.doctor);
    const r = await call('GET', `/api/doctors/${state.doctor._id}/slots?date=${day}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.slots.map((s) => s.time), ['09:00', '09:15', '09:30', '09:45']);
    assert.ok(r.data.slots.every((s) => s.available));
  });

  test('slots: day off, past date, bad date', async () => {
    // Find a Sunday in the next week (the doctor never works Sundays).
    let sunday = clock.addDays(clock.todayString(), 1);
    while (clock.dayOfWeek(sunday) !== 0) sunday = clock.addDays(sunday, 1);
    let r = await call('GET', `/api/doctors/${state.doctor._id}/slots?date=${sunday}`);
    assert.deepEqual(r.data.slots, []);
    assert.match(r.data.message, /not available/);

    r = await call('GET', `/api/doctors/${state.doctor._id}/slots?date=2020-01-06`);
    assert.deepEqual(r.data.slots, []);

    assert.equal((await call('GET', `/api/doctors/${state.doctor._id}/slots?date=2025-02-30`)).status, 400);
    assert.equal((await call('GET', `/api/doctors/${state.doctor._id}/slots?date=tomorrow`)).status, 400);
    assert.equal((await call('GET', `/api/doctors/${state.doctor._id}/slots`)).status, 400);
  });
});

describe('booking appointments', () => {
  test('must be logged in as a patient', async () => {
    const body = { doctor: String(state.doctor._id), date: nextWorkingDate(state.doctor), time: '09:00' };
    assert.equal((await call('POST', '/api/appointments', { body })).status, 401);
    const asAdmin = await call('POST', '/api/appointments', { body, token: state.adminToken });
    assert.equal(asAdmin.status, 400, 'front desk must choose a patient');
    assert.match(asAdmin.data.message, /Choose the patient/);
    assert.equal((await call('POST', '/api/appointments', { body, token: state.doctorToken })).status, 403);
  });

  test('patient books a slot', async () => {
    state.day = nextWorkingDate(state.doctor);
    const r = await call('POST', '/api/appointments', {
      token: state.patientToken,
      body: { doctor: String(state.doctor._id), date: state.day, time: '09:00', reason: 'Chest pain on exertion' },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.match(r.data.appointmentNo, /^APT\d{6}$/);
    assert.equal(r.data.status, 'scheduled');
    assert.equal(r.data.fee, 800);
    assert.equal(r.data.department.name, 'Cardiology');
    state.apptId = r.data.id;
  });

  test('booked slot shows as unavailable', async () => {
    const r = await call('GET', `/api/doctors/${state.doctor._id}/slots?date=${state.day}`);
    const nine = r.data.slots.find((s) => s.time === '09:00');
    assert.equal(nine.available, false);
  });

  test('another patient cannot take the same slot', async () => {
    const r = await call('POST', '/api/appointments', {
      token: state.patient2Token,
      body: { doctor: String(state.doctor._id), date: state.day, time: '09:00' },
    });
    assert.equal(r.status, 409);
    assert.match(r.data.message, /just booked/);
  });

  test('same patient cannot book the same doctor twice on one day', async () => {
    const r = await call('POST', '/api/appointments', {
      token: state.patientToken,
      body: { doctor: String(state.doctor._id), date: state.day, time: '09:30' },
    });
    assert.equal(r.status, 409);
  });

  test('times outside the schedule, past dates and far-future dates are rejected', async () => {
    const base_ = { doctor: String(state.doctor._id) };
    let r = await call('POST', '/api/appointments', { token: state.patient2Token, body: { ...base_, date: state.day, time: '09:05' } });
    assert.equal(r.status, 400);
    r = await call('POST', '/api/appointments', { token: state.patient2Token, body: { ...base_, date: state.day, time: '15:00' } });
    assert.equal(r.status, 400);
    r = await call('POST', '/api/appointments', { token: state.patient2Token, body: { ...base_, date: '2020-01-06', time: '09:00' } });
    assert.equal(r.status, 400);
    r = await call('POST', '/api/appointments', { token: state.patient2Token, body: { ...base_, date: clock.addDays(clock.todayString(), 120), time: '09:00' } });
    assert.equal(r.status, 400);
  });

  test('two patients racing for one slot: exactly one wins', async () => {
    const day = nextWorkingDate(state.doctor, 1);
    const body = { doctor: String(state.doctor._id), date: day, time: '09:45' };
    const results = await Promise.all([
      call('POST', '/api/appointments', { token: state.patientToken, body }),
      call('POST', '/api/appointments', { token: state.patient2Token, body }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409]);
  });

  test('patients see only their own appointments', async () => {
    const mine = await call('GET', '/api/appointments/mine', { token: state.patientToken });
    assert.equal(mine.status, 200);
    assert.ok(mine.data.some((a) => a.id === state.apptId));

    const other = await call('GET', `/api/appointments/${state.apptId}`, { token: state.patient2Token });
    assert.equal(other.status, 404);
    const cancelOther = await call('PATCH', `/api/appointments/${state.apptId}/cancel`, { token: state.patient2Token, body: {} });
    assert.equal(cancelOther.status, 404);
  });

  test('cancelling frees the slot for someone else', async () => {
    let r = await call('PATCH', `/api/appointments/${state.apptId}/cancel`, {
      token: state.patientToken,
      body: { reason: 'Feeling better' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.status, 'cancelled');
    assert.equal(r.data.cancelledBy, 'patient');

    r = await call('PATCH', `/api/appointments/${state.apptId}/cancel`, { token: state.patientToken, body: {} });
    assert.equal(r.status, 409, 'cannot cancel twice');

    r = await call('POST', '/api/appointments', {
      token: state.patient2Token,
      body: { doctor: String(state.doctor._id), date: state.day, time: '09:00' },
    });
    assert.equal(r.status, 201);
    state.appt2Id = r.data.id;
  });
});

describe('doctor portal', () => {
  test('doctor sees their own appointments only', async () => {
    const r = await call('GET', '/api/appointments/for-doctor', { token: state.doctorToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.length >= 1);
    assert.ok(r.data.every((a) => a.doctor.name === 'Dr. Heart'));
    assert.ok(r.data[0].patient.uhid, 'doctor sees patient details');

    const other = await call('GET', '/api/appointments/for-doctor', { token: state.doctor2Token });
    assert.deepEqual(other.data, []);
    assert.equal((await call('GET', `/api/appointments/${state.appt2Id}`, { token: state.doctor2Token })).status, 404);
    assert.equal((await call('GET', '/api/appointments/for-doctor', { token: state.patientToken })).status, 403);
  });

  test('cannot record a consultation before the appointment day', async () => {
    const r = await call('PATCH', `/api/appointments/${state.appt2Id}/consult`, {
      token: state.doctorToken,
      body: { status: 'completed', diagnosis: 'x' },
    });
    assert.equal(r.status, 400);
  });

  test('records a consultation; private notes are hidden from the patient', async () => {
    // An appointment from earlier today, inserted directly (the API won't book the past).
    const patient = await User.findOne({ email: 'asha@test.io' });
    const past = await Appointment.create({
      appointmentNo: 'APT900001',
      patient: patient._id,
      doctor: state.doctor._id,
      department: state.cardio._id,
      date: clock.addDays(clock.todayString(), -1),
      time: '09:15',
    });
    let r = await call('PATCH', `/api/appointments/${past._id}/consult`, {
      token: state.doctorToken,
      body: { status: 'completed', diagnosis: 'Stable angina', prescription: 'Tab. Aspirin 75 mg once daily', doctorNotes: 'Review lipid profile' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.status, 'completed');
    assert.equal(r.data.doctorNotes, 'Review lipid profile');

    r = await call('GET', `/api/appointments/${past._id}`, { token: state.patientToken });
    assert.equal(r.data.prescription, 'Tab. Aspirin 75 mg once daily');
    assert.equal(r.data.doctorNotes, undefined);

    r = await call('PATCH', `/api/appointments/${past._id}/cancel`, { token: state.patientToken, body: {} });
    assert.equal(r.status, 409, 'completed appointments cannot be cancelled');
  });
});

describe('admin', () => {
  test('non-admins are blocked from admin endpoints', async () => {
    for (const token of [undefined, state.patientToken, state.doctorToken]) {
      assert.ok([401, 403].includes((await call('GET', '/api/admin/stats', { token })).status));
      assert.ok([401, 403].includes((await call('GET', '/api/appointments', { token })).status));
      assert.ok([401, 403].includes((await call('POST', '/api/departments', { token, body: { name: 'X', summary: 'Hacked dept' } })).status));
      assert.ok([401, 403].includes((await call('GET', '/api/enquiries', { token })).status));
    }
  });

  test('department CRUD', async () => {
    let r = await call('POST', '/api/departments', {
      token: state.adminToken,
      body: { name: 'Ear, Nose & Throat', summary: 'ENT care for all ages', services: ['Hearing tests'], icon: 'ri-voiceprint-line' },
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.slug, 'ear-nose-and-throat');
    const id = r.data._id;

    r = await call('POST', '/api/departments', { token: state.adminToken, body: { name: 'Ear, Nose & Throat', summary: 'Duplicate dept' } });
    assert.equal(r.status, 409);

    r = await call('PUT', `/api/departments/${id}`, { token: state.adminToken, body: { name: 'ENT', summary: 'Ear, nose and throat care' } });
    assert.equal(r.status, 200);
    assert.equal(r.data.slug, 'ent');

    r = await call('DELETE', `/api/departments/${state.cardio._id}`, { token: state.adminToken });
    assert.equal(r.status, 409, 'cannot delete a department that has doctors');

    r = await call('DELETE', `/api/departments/${id}`, { token: state.adminToken });
    assert.equal(r.status, 200);

    r = await call('POST', '/api/departments', { token: state.adminToken, body: { name: '!!!', summary: 'No letters here' } });
    assert.equal(r.status, 400);
    assert.match(r.data.message, /letters or numbers/);
  });

  test('hidden departments are visible to admins only', async () => {
    const hidden = await Department.create({ name: 'Hidden Dept', slug: 'hidden-dept', summary: 'Not public yet', active: false });
    const pub = await call('GET', '/api/departments?all=true');
    assert.ok(!pub.data.some((d) => d.slug === 'hidden-dept'), 'public cannot list hidden departments');
    assert.equal(pub.data[0].totalDoctorCount, undefined);
    const patient = await call('GET', '/api/departments?all=true', { token: state.patientToken });
    assert.ok(!patient.data.some((d) => d.slug === 'hidden-dept'));
    const adm = await call('GET', '/api/departments?all=true', { token: state.adminToken });
    assert.ok(adm.data.some((d) => d.slug === 'hidden-dept'));
    assert.equal(typeof adm.data[0].totalDoctorCount, 'number');
    await hidden.deleteOne();
  });

  test('create, update and deactivate a doctor', async () => {
    let r = await call('POST', '/api/doctors', {
      token: state.adminToken,
      body: {
        name: 'Dr. New',
        email: 'new@test.io',
        password: 'Doctor1234',
        department: String(state.neuro._id),
        specialization: 'Neurologist',
        schedule: [{ day: 1, start: '09:00', end: '11:00' }],
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.email, 'new@test.io');
    const id = r.data.id;

    r = await call('POST', '/api/doctors', {
      token: state.adminToken,
      body: { name: 'Dr. Bad', email: 'bad@test.io', password: 'Doctor1234', department: String(state.neuro._id), specialization: 'X-ray', schedule: [{ day: 1, start: '11:00', end: '09:00' }] },
    });
    assert.equal(r.status, 400, 'end before start is rejected');
    assert.equal(await User.countDocuments({ email: 'bad@test.io' }), 0);

    r = await call('PUT', `/api/doctors/${id}`, { token: state.adminToken, body: { consultationFee: 1500, name: 'Dr. Renamed' } });
    assert.equal(r.status, 200);
    assert.equal(r.data.consultationFee, 1500);
    assert.equal(r.data.name, 'Dr. Renamed');

    const login = await call('POST', '/api/auth/login', { body: { email: 'new@test.io', password: 'Doctor1234' } });
    assert.equal(login.data.user.role, 'doctor');
  });

  test('deactivating a doctor hides them and cancels upcoming appointments', async () => {
    const r = await call('DELETE', `/api/doctors/${state.doctor._id}`, { token: state.adminToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.cancelledAppointments >= 1);

    assert.equal((await call('GET', `/api/doctors/${state.doctor._id}`)).status, 404);
    const adminView = await call('GET', `/api/doctors/${state.doctor._id}`, { token: state.adminToken });
    assert.equal(adminView.status, 200);
    assert.equal(adminView.data.active, false);

    const appt = await call('GET', `/api/appointments/${state.appt2Id}`, { token: state.patient2Token });
    assert.equal(appt.data.status, 'cancelled');
    assert.match(appt.data.cancelReason, /no longer available/);

    // Reactivate for the remaining tests.
    await call('PUT', `/api/doctors/${state.doctor._id}`, { token: state.adminToken, body: { active: true } });
  });

  test('appointment list with search and filters', async () => {
    let r = await call('GET', '/api/appointments?q=Asha', { token: state.adminToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.total >= 1);
    assert.ok(r.data.items.every((a) => a.patient.name === 'Asha Patient'));

    r = await call('GET', '/api/appointments?status=completed', { token: state.adminToken });
    assert.ok(r.data.items.every((a) => a.status === 'completed'));

    r = await call('GET', '/api/appointments?q=(((', { token: state.adminToken });
    assert.equal(r.status, 200, 'regex characters in search must not crash');

    r = await call('GET', '/api/appointments?limit=1', { token: state.adminToken });
    assert.equal(r.data.items.length, 1);
    assert.ok(r.data.pages >= 2);
  });

  test('status change; re-opening a taken slot is refused', async () => {
    // appt2 (09:00) was cancelled when the doctor was deactivated. Someone else books 09:00, then admin tries to restore appt2.
    const r1 = await call('POST', '/api/appointments', {
      token: state.patientToken,
      body: { doctor: String(state.doctor._id), date: state.day, time: '09:00' },
    });
    assert.equal(r1.status, 201);
    const r2 = await call('PATCH', `/api/appointments/${state.appt2Id}/status`, { token: state.adminToken, body: { status: 'scheduled' } });
    assert.equal(r2.status, 409);

    const r3 = await call('PATCH', `/api/appointments/${r1.data.id}/status`, { token: state.adminToken, body: { status: 'cancelled' } });
    assert.equal(r3.status, 200);
    assert.equal(r3.data.cancelledBy, 'admin');
  });

  test('stats and patients', async () => {
    const stats = await call('GET', '/api/admin/stats', { token: state.adminToken });
    assert.equal(stats.status, 200);
    assert.equal(stats.data.totals.patients, 2);
    assert.equal(stats.data.last7Days.length, 7);
    assert.ok(stats.data.byStatus.cancelled >= 1);

    const patients = await call('GET', '/api/admin/patients?q=ravi', { token: state.adminToken });
    assert.equal(patients.data.length, 1);
    assert.ok(patients.data[0].appointmentCount >= 1);
  });
});

describe('enquiries', () => {
  test('anyone can send an enquiry; bad input is rejected', async () => {
    let r = await call('POST', '/api/enquiries', { body: { name: 'Kiran', email: 'kiran@test.io', subject: 'Visiting hours', message: 'What are the ICU visiting hours?' } });
    assert.equal(r.status, 201);
    r = await call('POST', '/api/enquiries', { body: { name: 'K', email: 'nope', subject: '', message: 'hi' } });
    assert.equal(r.status, 400);
  });

  test('admin lists and resolves enquiries', async () => {
    let r = await call('GET', '/api/enquiries', { token: state.adminToken });
    assert.equal(r.data.length, 1);
    const id = r.data[0]._id;
    r = await call('PATCH', `/api/enquiries/${id}`, { token: state.adminToken, body: { status: 'resolved' } });
    assert.equal(r.data.status, 'resolved');
  });
});
