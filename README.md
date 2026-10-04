# CityCare Multispeciality Hospital – Website

A complete hospital website with online appointment booking, and separate portals for patients, doctors and hospital staff.

| Who | What they can do |
|-----|------------------|
| **Visitors** | Browse departments and services · search doctors by name, speciality or language (with photos, ratings and reviews) · health check-up packages · FAQs · contact form with Google Map · privacy policy and terms |
| **Patients** | Register (get a **UHID**) · **forgot / reset password** · book appointments with live slots · **book for family members** · **reschedule** or cancel · print slips · see diagnoses and prescriptions · **download lab reports** · **book health check-ups** · **rate visits** · email confirmations and reminders |
| **Doctors** | Day schedule, upcoming list, history · record diagnosis, prescription and private notes · **manage their own leave** · **view and upload patient reports** |
| **Admin / front desk** | Dashboard and charts · **walk-in / phone booking** (register patients on the spot) · reschedule, change status, **hide inappropriate reviews** · doctors with timings, **photos** and **leave** · departments · patients (**add / edit**, reports) · **health packages and check-up requests** · **OPD holidays** · enquiries · **CSV export** for Excel |

**Technology:** Node.js + Express 5 + MongoDB (Mongoose) backend; plain HTML/CSS/JavaScript frontend (no build step). One server serves both the website and the API.

---

## 1. Install these first

| Tool | Download |
|------|----------|
| **Git** | https://git-scm.com/downloads |
| **Node.js 18 or newer** (LTS) | https://nodejs.org |
| **MongoDB Community Server** | https://www.mongodb.com/try/download/community (keep "Install as a Service" ticked) |

## 2. Get the code

```powershell
cd D:\projects
git clone https://github.com/ADITYAAVISETTI/Hotel-Mangement.git
cd Hotel-Mangement\backend
npm install
```

## 3. Create `backend/.env`

This file holds your settings and secrets. It is **not** on GitHub; create it inside `backend`:

```
DB_CONNECT=mongodb://127.0.0.1:27017/CityCareHospital
TOKEN_SECRET=put_a_long_random_secret_here
PORT=3000
```

Or generate it (PowerShell, inside `backend`):
```powershell
$s = -join ((1..48) | % { '{0:x}' -f (Get-Random -Max 16) }); "DB_CONNECT=mongodb://127.0.0.1:27017/CityCareHospital`nTOKEN_SECRET=$s`nPORT=3000" | Set-Content .env
```

### Optional settings

| Setting | What it does | Default |
|---------|--------------|---------|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Send real emails (booking confirmations, reminders, password resets). Works with Gmail (app password), Outlook, Zoho, SendGrid, Brevo, etc. | Not set: emails are **printed in the server window** instead |
| `MAIL_FROM` | Sender shown on emails, e.g. `CityCare Hospital <care@yourhospital.in>` | `no-reply@citycare.test` |
| `APP_URL` | Public address of the site, used in email links, e.g. `https://www.yourhospital.in` | `http://localhost:3000` |
| `HOSPITAL_TZ` | Time zone for appointment times | `Asia/Kolkata` |
| `UPLOADS_DIR` | Where doctor photos and medical reports are stored | `backend/uploads` |

Example for Gmail (create an "App password" in your Google account first):
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=yourhospital@gmail.com
SMTP_PASS=your-16-letter-app-password
MAIL_FROM=CityCare Hospital <yourhospital@gmail.com>
```

## 4. Load sample data (first time)

```powershell
npm run seed
```

This adds 8 departments, 14 doctors with weekly timings, 4 health check-up packages, upcoming public holidays, and demo logins:

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@citycare.test` | `Admin@1234` |
| Doctor (all 14 use this password) | `arjun.mehta@citycare.test` | `Doctor@1234` |
| Patient | `patient@citycare.test` | `Patient@1234` |

> **Change these passwords before real use.** `npm run seed` is safe to run again. `npm run seed:reset` **deletes all hospital data** first.

## 5. Start the website

```powershell
npm start
```

Open **http://localhost:3000**. Press **Ctrl + C** to stop. While developing, `npm run dev` restarts automatically when code changes. After changing backend code while using `npm start`, stop and start it again.

---

## 6. Try it out

1. **Patient:** Book Now → pick a doctor, date and time → create an account. In **My Health Portal**: add a **Family** member and book for them, **Reschedule** an appointment, book a **Health check-up**.
2. **Forgot password:** Login → *Forgot password?* → without SMTP, the reset link appears in the server window. Open it to set a new password.
3. **Admin:** Appointments → **New appointment** to book a walk-in (search or register the patient). Patients → 📄 to **upload a report**. Doctors → **Edit** to add a photo, **Leave** to block dates. **Holidays** and **Check-ups** tabs. **Export CSV** on Appointments and Patients.
4. **Doctor:** Day schedule → **Consult** to write the diagnosis and prescription. 📄 opens the patient's reports. **My profile** → add leave.
5. **Patient again:** see the prescription in **Medical records**, download the report under **Reports**, and **Rate visit**. The review appears on the doctor's public profile.

---

## 7. Automated tests

```powershell
cd backend
npm test
```

69 tests cover login and security, booking rules (including two people booking the same slot at once), family members, rescheduling, leave and holidays, walk-in booking, reports (including file-type checks and privacy), packages, photos, reviews, CSV export, emails and reminders. They use separate test databases that are created and deleted automatically.

---

## 8. Customising

| What | Where |
|------|-------|
| Hospital name, phones, address, OPD hours | `SITE` at the top of `frontend/assets/js/app.js` |
| Colours, fonts | variables at the top of `frontend/assets/css/site.css` |
| Home page text, statistics, testimonials | `frontend/index.html` |
| Privacy policy, terms, FAQs | `frontend/privacy.html`, `terms.html`, `faq.html` |
| Packages, holidays, doctors | the admin dashboard, or `backend/scripts/seed.js` for the samples |
| Booking window (60 days), reschedule limit (2) | `backend/src/config.js` |

Home-page statistics and testimonials are **placeholders**. The privacy policy and terms are a **starting template**: have them reviewed by a lawyer before going live.

---

## 9. Going live (Render + MongoDB Atlas)

1. **Database:** create a cluster on https://www.mongodb.com/atlas in the **Mumbai (ap-south-1)** region. Add a database user, allow network access, and copy the connection string (`mongodb+srv://…/CityCareHospital`). For real patient data, choose a tier with **automatic backups**.
2. **Server:** on https://render.com create a **Web Service** from your GitHub repo:
   - Root directory: `backend` · Build command: `npm install` · Start command: `npm start`
   - Health check path: `/api/health`
   - Choose a paid instance and **add a Disk** mounted at `/var/data` (1 GB is plenty to start). Without a disk, uploaded reports and photos are lost on every deploy.
3. **Environment variables** (Render → Environment):
   ```
   NODE_ENV=production
   DB_CONNECT=<your Atlas connection string>
   TOKEN_SECRET=<64 random characters>
   TRUST_PROXY=1
   UPLOADS_DIR=/var/data/uploads
   APP_URL=https://www.your-hospital-domain.in
   HOSPITAL_TZ=Asia/Kolkata
   SMTP_HOST=… SMTP_PORT=587 SMTP_USER=… SMTP_PASS=… MAIL_FROM=Your Hospital <care@your-hospital-domain.in>
   ```
   Generate a secret in PowerShell: `-join ((1..64) | % { '{0:x}' -f (Get-Random -Max 16) })`
4. **Create your admin** (run once from your PC, using the live database):
   ```powershell
   cd backend
   $env:DB_CONNECT="<Atlas connection string>"; $env:ADMIN_EMAIL="you@your-hospital-domain.in"; $env:ADMIN_PASSWORD="<strong password>"
   npm run seed:production
   ```
   This creates only your admin plus editable starter departments, packages and holidays. No demo accounts.
5. **Domain & HTTPS:** Render → Settings → Custom Domains → add your domain and create the DNS records it shows at your domain registrar. Render issues the HTTPS certificate automatically.
6. **Before announcing:** log in as admin, add your real doctors and timings, replace the hospital details in `frontend/assets/js/app.js` (`SITE`) and the home-page statistics/testimonials, and test a booking, an email and a password reset on the live site.

## 10. Common problems

| Problem | Fix |
|---------|-----|
| `TOKEN_SECRET is missing` | Create `backend/.env` (step 3). |
| `Could not connect to MongoDB` | Start MongoDB: Win+R → `services.msc` → **MongoDB Server** → Start. |
| `EADDRINUSE :::3000` | The server is already running in another window. Close it or change `PORT`. |
| Page shows "Cannot reach the CityCare server" | Start the backend (`npm start`) and open http://localhost:3000. |
| New features missing after an update | Restart the server (Ctrl+C, then `npm start`) and press Ctrl+F5 in the browser. |
| Emails not arriving | Without `SMTP_*` settings they're printed in the server window. With SMTP, check the server window for "Email … failed". |
| Doctor can't see an appointment | Log in as **that** doctor. Future appointments show under **Upcoming**, and on the Day schedule when today is empty. |
| Too many login attempts | Login is limited to 20 tries per 15 minutes. Wait, or restart the server. |

---

## 11. Project structure

```
backend/
├── src/
│   ├── server.js            starts the app + reminder job
│   ├── app.js               security headers, API routes, serves frontend/
│   ├── config.js            reads .env
│   ├── models/              User, Department, Doctor, Appointment, Holiday, Report,
│   │                        HealthPackage, PackageBooking, Enquiry, Counter
│   ├── routes/              auth, departments, doctors, appointments, family, holidays,
│   │                        reports, packages, enquiries, admin
│   ├── services/            booking rules (booking.js), emails & reminders (notifications.js)
│   ├── middleware/          login + roles, validation, error handling
│   └── utils/               time/slots, mailer, safe file uploads, CSV
├── scripts/seed.js          sample data
├── tests/                   api.test.js, features.test.js
└── uploads/                 doctor photos (public) and reports (private). Not in git.

frontend/
├── index, departments, department, doctors, doctor, packages, contact, faq, privacy, terms
├── book.html                booking + rescheduling
├── login, register, forgot-password, reset-password
├── portal.html              patient portal
├── doctor-portal.html       doctor dashboard
├── admin.html               admin dashboard
├── slip.html                printable slip / prescription
└── assets/                  site.css, app.js (shared) and one script per page
```

### API overview (all under `/api`, errors are JSON `{ "message" }`)

| Area | Endpoints |
|------|-----------|
| Auth | `POST /auth/register`, `/auth/login`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password` · `GET/PATCH /auth/me` |
| Public | `GET /departments`, `/departments/:slug`, `/doctors`, `/doctors/:id`, `/doctors/:id/slots?date=`, `/doctors/:id/reviews`, `/packages`, `/holidays` · `POST /enquiries` |
| Patient | `POST /appointments` · `GET /appointments/mine` · `PATCH /appointments/:id/cancel`, `/reschedule`, `/feedback` · `GET/POST/PUT/DELETE /family` · `GET /reports/mine`, `/reports/:id/file` · `POST /packages/:id/book` · `GET /packages/bookings/mine` |
| Doctor | `GET /appointments/for-doctor` · `PATCH /appointments/:id/consult` · `POST/DELETE /doctors/:id/leaves` · `GET/POST /reports` |
| Admin | `GET /admin/stats`, `/admin/patients` · `POST/PUT /admin/patients` · `GET /admin/export/appointments.csv`, `/patients.csv` · `GET /appointments` · `PATCH /appointments/:id/status`, `/feedback/visibility` · CRUD for doctors (+ `/photo`), departments, packages, holidays · `PATCH /packages/bookings/:id/status` |
