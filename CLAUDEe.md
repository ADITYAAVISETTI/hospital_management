# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

CityCare Multispeciality Hospital website: public pages, online appointment booking, and patient / doctor / admin portals.

- `backend/`: Node.js, Express 5, MongoDB (Mongoose 8). Serves the API under `/api` **and** the static `frontend/` folder on one port.
- `frontend/`: plain HTML/CSS/JS, no build step. Every page loads `assets/js/app.js` (shared helpers, header/footer) and then its own page script.

## Commands (run in `backend/`)

```bash
npm install
npm run seed         # sample departments, doctors, demo logins (idempotent)
npm run seed:reset   # wipe hospital data, then seed
npm start            # http://localhost:3000
npm run dev          # nodemon
npm test             # node:test suites (tests/*.test.js), use CityCareHospital_test / _test2 DBs
```

`backend/.env` needs `DB_CONNECT`, `TOKEN_SECRET`, `PORT` (see README). `TOKEN_SECRET` is required outside tests.

## Architecture notes

- Roles: `patient` (public sign-up, front-desk registration, or a family member with `guardian` set and no email/password), `doctor` (created by admin, linked 1:1 to a `Doctor` profile), `admin` (seed script).
- Auth: JWT in `Authorization: Bearer`, 7-day expiry; `middleware/auth.js` reloads the user on every request. `requireRole(...)` guards routes.
- Validation: Joi via `middleware/validate.js` (synchronous; query results land in `req.validQuery` because `req.query` is read-only in Express 5).
- Errors: throw `HttpError` helpers from `utils/httpError.js`; `errorHandler` turns everything (incl. Mongo duplicate keys) into JSON `{ message }`. Express 5 forwards async errors, so no try/catch wrappers are needed.
- Dates are `YYYY-MM-DD` strings and times `HH:MM` strings in server-local time (`utils/time.js`). Slots come from `Doctor.schedule` (weekly windows) and `slotMinutes`.
- Double booking is prevented by a unique partial index on `Appointment {doctor, date, time}` where `holdsSlot: true`; cancelling sets `holdsSlot: false`.
- Doctors are deactivated, never deleted (DELETE sets `active: false` and cancels their future appointments).
- Patients never receive `doctorNotes`; public doctor data never includes email/phone or leave reasons.
- All booking paths (patient, family, front desk, reschedule) go through `services/booking.js` (`assertBookable`: window, past, holiday, leave, schedule, patient clashes). Appointment `account` = the login that manages it (guardian for family members).
- Emails: `utils/mailer.js` (SMTP if `SMTP_HOST` set, else printed to console; `outbox` in tests). Send from routes via `notify(fn, ...)` so failures never break requests or crash the process. Reminder job in `services/notifications.js` runs from `server.js` only.
- Uploads are base64 JSON checked by magic bytes (`utils/files.js`). Doctor photos are public under `/uploads/doctors`; reports are private and only served via `GET /api/reports/:id/file` after a permission check.
- Time zone: `config.js` sets `process.env.TZ` from `HOSPITAL_TZ` (default Asia/Kolkata) before any Date use.

## Frontend conventions

- Always escape server/user data with `esc()` before inserting into HTML.
- No inline `onclick` / `<script>`: the helmet CSP (`app.js` in backend) blocks them. Bind with `addEventListener`.
- When editing JS via shell commands, beware `$$` (the `$$()` helper) being expanded to a process id by bash inside double quotes; prefer the Edit tool.
- Use `downloadFile()` for protected files, `patientReportsModal()` for reports, `avatar(name, size, photo)` and `starsHtml()`.
- Use `api()` for requests (handles token, JSON errors, expired sessions), `toast()`, `openModal()`, `confirmDialog()`, `withLoading()`, `validateForm()`.
- Hospital name and contact details live in `SITE` in `frontend/assets/js/app.js`.
