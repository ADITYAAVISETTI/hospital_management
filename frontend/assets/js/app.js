/* CityCare Hospital – shared code for every page. Loaded before the page script. */
'use strict';

const SITE = {
  name: 'CityCare',
  fullName: 'CityCare Multispeciality Hospital',
  tagline: 'Multispeciality Hospital',
  phone: '+91 40 4000 1000',
  emergency: '108',
  emergencyDesk: '+91 40 4000 1111',
  email: 'care@citycare.test',
  address: 'Plot 21, Health City Road, Banjara Hills, Hyderabad 500034',
  opdHours: 'Mon–Sat, 9:00 AM – 7:00 PM',
};

// The backend normally serves these pages itself (http://localhost:3000), so the
// API is on the same origin. If the page was opened from disk or from a separate
// static server (VS Code Live Server, `npx serve`, …), call the backend directly.
const BACKEND_URL = 'http://localhost:3000';
const STATIC_DEV_PORTS = ['5000', '5500', '5501', '8000', '8080', '5173'];
const API_BASE =
  location.protocol === 'file:' || STATIC_DEV_PORTS.includes(location.port) ? `${BACKEND_URL}/api` : '/api';

/* ---------------- Utilities ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Escape text before putting it inside HTML. Use for ALL data from the server or user. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const params = new URLSearchParams(location.search);

const pad = (n) => String(n).padStart(2, '0');
function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function todayStr() {
  return toDateStr(new Date());
}
function addDays(str, n) {
  const d = parseDate(str);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}
function fmtDate(str, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!str) return '';
  return parseDate(str).toLocaleDateString('en-IN', opts);
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${pad(m)} ${suffix}`;
}
function fmtMoney(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}
function isPastSlot(date, time) {
  const now = new Date();
  const [h, m] = time.split(':').map(Number);
  const d = parseDate(date);
  d.setHours(h, m, 0, 0);
  return d <= now;
}
function age(dob) {
  if (!dob) return '';
  const b = parseDate(dob);
  const n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a -= 1;
  return a;
}
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

function initials(name) {
  return String(name || '?')
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}
const AVATAR_COLORS = ['#0a66b7', '#0c9a8a', '#7a4fd1', '#c2410c', '#0e7490', '#be185d', '#4d7c0f', '#b45309'];
/** Absolute URL for a server file such as a doctor photo ("/uploads/..."). */
function assetUrl(path) {
  if (!path) return '';
  return /^\/uploads\/[\w./-]+$/.test(path) ? API_BASE.replace(/\/api$/, '') + path : '';
}

/** Round photo if there is one, otherwise coloured initials. */
function avatar(name, size = '', photo = '') {
  const src = assetUrl(photo);
  if (src) return `<img class="avatar ${size}" src="${esc(src)}" alt="" loading="lazy">`;
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  return `<span class="avatar ${size}" style="background:${color}" aria-hidden="true">${esc(initials(name))}</span>`;
}

/** ★★★★☆ display for an average rating (0–5). */
function starsHtml(value, { count = null, small = false } = {}) {
  const v = Math.max(0, Math.min(5, Number(value) || 0));
  const icons = [1, 2, 3, 4, 5]
    .map((i) => `<i class="${v >= i ? 'ri-star-fill' : v >= i - 0.5 ? 'ri-star-half-fill' : 'ri-star-line'}"></i>`)
    .join('');
  const label = count === null ? '' : ` <span class="muted">${v.toFixed(1)} (${count})</span>`;
  return `<span class="stars ${small ? 'stars-sm' : ''}" aria-label="${v.toFixed(1)} out of 5 stars">${icons}</span>${label}`;
}

const RELATION_LABELS = { spouse: 'Spouse', child: 'Child', parent: 'Parent', sibling: 'Sibling', grandparent: 'Grandparent', other: 'Family' };

/** Reads a chosen file as a data: URL (for uploads). */
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

/** Downloads a protected file (report, CSV) using the login token. */
async function downloadFile(path, fallbackName) {
  let res;
  try {
    res = await fetch(API_BASE + path, { headers: Session.token ? { Authorization: `Bearer ${Session.token}` } : {} });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Please try again.');
  }
  if (!res.ok) {
    let message = `Download failed (${res.status}).`;
    try { message = (await res.json()).message || message; } catch { /* not JSON */ }
    throw new ApiError(res.status, message);
  }
  const match = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = match ? match[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function fmtSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function statusBadge(status) {
  const label = status === 'no-show' ? 'No-show' : cap(status);
  return `<span class="badge badge-${esc(status)}">${esc(label)}</span>`;
}

function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ---------------- Session ---------------- */

const Session = {
  get token() {
    try { return localStorage.getItem('cc_token'); } catch { return null; }
  },
  get user() {
    try { return JSON.parse(localStorage.getItem('cc_user') || 'null'); } catch { return null; }
  },
  save({ token, user }) {
    try {
      if (token) localStorage.setItem('cc_token', token);
      if (user) localStorage.setItem('cc_user', JSON.stringify(user));
    } catch { /* storage unavailable */ }
  },
  clear() {
    try {
      localStorage.removeItem('cc_token');
      localStorage.removeItem('cc_user');
    } catch { /* storage unavailable */ }
  },
};

function homeFor(role) {
  return { admin: 'admin.html', doctor: 'doctor-portal.html', patient: 'portal.html' }[role] || 'index.html';
}

/** Redirects to login unless the user is signed in with one of the roles. Returns the user. */
function requireLogin(...roles) {
  const user = Session.user;
  if (!Session.token || !user) {
    location.replace(`login.html?next=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`);
    throw new Error('redirecting to login');
  }
  if (roles.length && !roles.includes(user.role)) {
    location.replace(homeFor(user.role));
    throw new Error('wrong role');
  }
  return user;
}

function logout() {
  Session.clear();
  location.href = 'index.html';
}

/* ---------------- API ---------------- */

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && Session.token) headers.Authorization = `Bearer ${Session.token}`;

  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Please check that it is running and try again.');
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Not JSON: this page is not talking to the CityCare backend.
      throw new ApiError(
        res.status,
        `Cannot reach the CityCare server. Start it with "npm start" in the backend folder and open ${BACKEND_URL}.`
      );
    }
  }

  if (!res.ok) {
    if (res.status === 401 && auth && Session.token) {
      Session.clear();
      toast('Your session has ended. Please log in again.', 'error');
      setTimeout(() => location.replace(`login.html?next=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`), 900);
    }
    throw new ApiError(res.status, (data && data.message) || `Request failed (${res.status}).`);
  }
  return data;
}

/* ---------------- Feedback: toasts, modals, confirm ---------------- */

function toast(message, type = 'info', ms = 4500) {
  let stack = $('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  const icon = { success: 'ri-checkbox-circle-fill', error: 'ri-error-warning-fill', info: 'ri-information-fill' }[type];
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<i class="${icon}"></i><div>${esc(message)}</div>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

/**
 * Opens a modal. `body` is trusted HTML (escape data yourself).
 * Returns { el, close }. `onClose` runs when it is dismissed.
 */
function openModal({ title, body, footer = '', size = '', onClose } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head">
        <h3 id="modal-title">${esc(title)}</h3>
        <button type="button" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  const previousFocus = document.activeElement;
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (previousFocus && previousFocus.focus) previousFocus.focus();
    if (onClose) onClose();
  };
  const onKey = (e) => {
    // Only the top-most dialog reacts when dialogs are stacked.
    if (e.key === 'Escape' && $$('.modal-backdrop').pop() === backdrop) close();
  };
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  $('.modal-close', backdrop).addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  const first = $('input, select, textarea, button:not(.modal-close)', backdrop);
  if (first) first.focus();
  return { el: backdrop, close };
}

/** Promise-based confirmation dialog. Resolves to true/false. */
function confirmDialog(message, { title = 'Please confirm', confirmText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const m = openModal({
      title,
      body: `<p class="mb-0">${esc(message)}</p>`,
      footer: `<button type="button" class="btn btn-ghost" data-no>Go back</button>
               <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(confirmText)}</button>`,
      onClose: () => { if (!answered) resolve(false); },
    });
    $('[data-no]', m.el).addEventListener('click', () => m.close());
    $('[data-yes]', m.el).addEventListener('click', () => {
      answered = true;
      m.close();
      resolve(true);
    });
  });
}

/** Adds a spinner to a button while an async task runs. */
async function withLoading(button, task) {
  button.disabled = true;
  button.classList.add('loading');
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.classList.remove('loading');
  }
}

/** Reads a form's named fields into a plain object (trimmed strings). */
function formData(form) {
  const out = {};
  for (const [k, v] of new FormData(form).entries()) out[k] = typeof v === 'string' ? v.trim() : v;
  return out;
}

function loaderHtml() {
  return '<div class="loader" role="status"><span class="sr-only">Loading…</span></div>';
}
function emptyHtml(icon, title, text = '', action = '') {
  return `<div class="empty"><i class="${icon}"></i><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;
}
function errorHtml(err) {
  return `<div class="alert alert-danger"><i class="ri-error-warning-line"></i><div>${esc(err.message || err)}</div></div>`;
}

/* ---------------- Layout: header & footer ---------------- */

const NAV = [
  ['index.html', 'Home', 'home'],
  ['departments.html', 'Departments', 'departments'],
  ['doctors.html', 'Find a Doctor', 'doctors'],
  ['packages.html', 'Health Check-ups', 'packages'],
  ['contact.html', 'Contact', 'contact'],
];

function brandHtml() {
  return `<a class="brand" href="index.html" aria-label="${esc(SITE.fullName)} home">
      <span class="brand-mark"><i class="ri-hospital-fill"></i></span>
      <span class="brand-name">${esc(SITE.name)}<small>${esc(SITE.tagline)}</small></span>
    </a>`;
}

function renderHeader() {
  const slot = $('#site-header');
  if (!slot) return;
  const page = document.body.dataset.page;
  const user = Session.token ? Session.user : null;

  const account = user
    ? `<div class="user-menu">
         <button type="button" class="user-menu-btn" aria-haspopup="true" aria-expanded="false">
           ${avatar(user.name)}<span class="nowrap">${esc(user.name.split(' ').slice(0, 2).join(' '))}</span><i class="ri-arrow-down-s-line"></i>
         </button>
         <div class="user-menu-list">
           <div class="role-label">${esc(cap(user.role))} account</div>
           <a href="${homeFor(user.role)}"><i class="ri-dashboard-line"></i>${user.role === 'patient' ? 'My Health Portal' : 'Dashboard'}</a>
           ${user.role === 'patient' ? '<a href="book.html"><i class="ri-calendar-check-line"></i>Book appointment</a>' : ''}
           <button type="button" data-logout><i class="ri-logout-box-r-line"></i>Log out</button>
         </div>
       </div>`
    : `<a class="btn btn-ghost btn-sm" href="login.html"><i class="ri-user-line"></i>Login</a>`;

  slot.outerHTML = `
    <div class="topbar">
      <div class="container">
        <div class="topbar-items">
          <span><i class="ri-phone-line"></i><a href="tel:${esc(SITE.phone.replace(/\s/g, ''))}">${esc(SITE.phone)}</a></span>
          <span class="hide-sm"><i class="ri-mail-line"></i><a href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a></span>
          <span class="hide-sm"><i class="ri-time-line"></i>OPD: ${esc(SITE.opdHours)}</span>
        </div>
        <a class="topbar-emergency" href="tel:${esc(SITE.emergency)}"><i class="ri-alarm-warning-fill"></i>Emergency 24x7: ${esc(SITE.emergency)}</a>
      </div>
    </div>
    <header class="site-header">
      <div class="container">
        ${brandHtml()}
        <button type="button" class="nav-toggle" aria-label="Menu" aria-expanded="false"><i class="ri-menu-line"></i></button>
        <nav class="main-nav" aria-label="Main">
          ${NAV.map(([href, label, key]) => `<a href="${href}" class="${page === key ? 'active' : ''}">${label}</a>`).join('')}
        </nav>
        <div class="header-actions">
          ${!user || user.role === 'patient' ? '<a class="btn btn-primary btn-sm btn-book-header" href="book.html"><i class="ri-calendar-check-line"></i>Book Now</a>' : ''}
          ${account}
        </div>
      </div>
    </header>`;

  const toggle = $('.nav-toggle');
  const nav = $('.main-nav');
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.innerHTML = open ? '<i class="ri-close-line"></i>' : '<i class="ri-menu-line"></i>';
  });

  const menu = $('.user-menu');
  if (menu) {
    const btn = $('.user-menu-btn', menu);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', () => menu.classList.remove('open'));
    $('[data-logout]', menu).addEventListener('click', logout);
  }
}

function renderFooter() {
  const slot = $('#site-footer');
  if (!slot) return;
  const year = new Date().getFullYear();
  slot.outerHTML = `
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div>
            ${brandHtml()}
            <p>Compassionate, evidence-based care across all major specialities, with 24x7 emergency services and online appointments.</p>
          </div>
          <div>
            <h4>Patients</h4>
            <ul>
              <li><a href="book.html">Book an appointment</a></li>
              <li><a href="doctors.html">Find a doctor</a></li>
              <li><a href="packages.html">Health check-up packages</a></li>
              <li><a href="portal.html">Patient portal &amp; reports</a></li>
              <li><a href="faq.html">FAQs</a></li>
            </ul>
          </div>
          <div>
            <h4>Hospital</h4>
            <ul>
              <li><a href="index.html#about">About us</a></li>
              <li><a href="departments.html">Departments</a></li>
              <li><a href="contact.html">Contact &amp; directions</a></li>
              <li><a href="contact.html#visiting">Visiting hours</a></li>
              <li><a href="privacy.html">Privacy policy</a></li>
              <li><a href="terms.html">Terms of use</a></li>
              <li><a href="login.html">Staff login</a></li>
            </ul>
          </div>
          <div>
            <h4>Reach us</h4>
            <ul>
              <li><i class="ri-map-pin-line"></i><span>${esc(SITE.address)}</span></li>
              <li><i class="ri-phone-line"></i><a href="tel:${esc(SITE.phone.replace(/\s/g, ''))}">${esc(SITE.phone)}</a></li>
              <li><i class="ri-alarm-warning-line"></i><span>Emergency: <a href="tel:${esc(SITE.emergency)}">${esc(SITE.emergency)}</a> / ${esc(SITE.emergencyDesk)}</span></li>
              <li><i class="ri-mail-line"></i><a href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a></li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <span>&copy; ${year} ${esc(SITE.fullName)}. All rights reserved.</span>
          <span>In a medical emergency, call ${esc(SITE.emergency)} immediately.</span>
        </div>
      </div>
    </footer>`;
}

/* ---------------- Shared renderers ---------------- */

function doctorCardHtml(d) {
  return `
    <article class="card card-hover doctor-card">
      ${avatar(d.name, 'avatar-lg', d.photo)}
      <h3>${esc(d.name)}</h3>
      <div class="spec">${esc(d.specialization)}</div>
      ${d.rating && d.rating.count ? `<div class="small" style="margin-top:4px">${starsHtml(d.rating.average, { count: d.rating.count, small: true })}</div>` : ''}
      <div class="meta">
        ${esc(d.department ? d.department.name : '')}<br>
        ${esc(d.experienceYears)}+ years experience · ${esc(fmtMoney(d.consultationFee))}
      </div>
      <div class="actions">
        <a class="btn btn-ghost btn-sm" href="doctor.html?id=${encodeURIComponent(d.id)}">View profile</a>
        <a class="btn btn-primary btn-sm" href="book.html?doctor=${encodeURIComponent(d.id)}">Book</a>
      </div>
    </article>`;
}

function departmentCardHtml(d) {
  return `
    <a class="card card-hover dept-card" href="department.html?slug=${encodeURIComponent(d.slug)}">
      <span class="dept-icon"><i class="${esc(d.icon || 'ri-hospital-line')}"></i></span>
      <h3>${esc(d.name)}</h3>
      <p>${esc(d.summary)}</p>
      <span class="link-more">${d.doctorCount ? `${esc(d.doctorCount)} doctor${d.doctorCount > 1 ? 's' : ''} · ` : ''}Learn more <i class="ri-arrow-right-line"></i></span>
    </a>`;
}

/** Uses the browser's built-in checks and shows the message under each field. */
function validateForm(form) {
  let ok = true;
  $$('.field', form).forEach((f) => {
    f.classList.remove('invalid');
    const old = $('.field-error', f);
    if (old) old.remove();
  });
  $$('input, select, textarea', form).forEach((input) => {
    if (!input.checkValidity()) {
      ok = false;
      const field = input.closest('.field');
      if (field) {
        field.classList.add('invalid');
        field.insertAdjacentHTML('beforeend', `<span class="field-error">${esc(input.validationMessage)}</span>`);
      }
    }
  });
  if (!ok) {
    const first = $('.field.invalid input, .field.invalid select, .field.invalid textarea', form);
    if (first) first.focus();
  }
  return ok;
}

/** Show/hide password buttons for inputs marked with data-pw-toggle. */
function initPasswordToggles(root = document) {
  $$('[data-pw-toggle]', root).forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? '<i class="ri-eye-off-line"></i>' : '<i class="ri-eye-line"></i>';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderHeader();
  renderFooter();
});

/* ---------------- Shared: a patient's reports (doctor & admin) ---------------- */

const REPORT_CATEGORIES = { lab: 'Lab', radiology: 'Radiology / scan', 'discharge-summary': 'Discharge summary', prescription: 'Prescription', other: 'Other' };

/** Modal listing a patient's reports with download, upload and (own) delete. */
function patientReportsModal(patient) {
  const me = Session.user || {};
  const m = openModal({
    title: `Reports · ${patient.name}`,
    size: 'modal-lg',
    body: `
      <p class="muted small">${esc(patient.uhid ? `UHID ${patient.uhid}` : '')}</p>
      <div id="rep-list">${loaderHtml()}</div>
      <h4 style="margin-top:24px">Upload a report</h4>
      <form id="rep-form" class="form-grid" novalidate>
        <div class="field"><label>Title <span class="req">*</span></label><input name="title" required minlength="2" maxlength="120" placeholder="e.g. Complete blood count"></div>
        <div class="field"><label>Type</label><select name="category">${Object.entries(REPORT_CATEGORIES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
        <div class="field"><label>Report date <span class="req">*</span></label><input name="reportDate" type="date" required max="${todayStr()}" value="${todayStr()}"></div>
        <div class="field"><label>File (PDF, JPG or PNG, max 5 MB) <span class="req">*</span></label><input name="file" type="file" required accept="application/pdf,image/jpeg,image/png"></div>
        <div class="field full"><label>Notes for the patient <span class="muted">(optional)</span></label><input name="notes" maxlength="1000"></div>
      </form>`,
    footer: `<button type="button" class="btn btn-ghost" data-close>Close</button><button type="button" class="btn btn-primary" data-upload><i class="ri-upload-2-line"></i>Upload</button>`,
  });
  $('[data-close]', m.el).addEventListener('click', m.close);

  const load = async () => {
    const box = $('#rep-list', m.el);
    try {
      const list = await api(`/reports?patient=${encodeURIComponent(patient.id)}`);
      box.innerHTML = list.length
        ? list
            .map(
              (r) => `<div class="file-row">
            <span class="file-icon ${r.mimeType === 'application/pdf' ? '' : 'img'}"><i class="${r.mimeType === 'application/pdf' ? 'ri-file-pdf-2-line' : 'ri-image-line'}"></i></span>
            <div class="grow"><div class="cell-main">${esc(r.title)}</div><div class="cell-sub">${esc(fmtDate(r.reportDate))} · ${esc(REPORT_CATEGORIES[r.category] || r.category)} · ${esc(fmtSize(r.size))} · by ${esc(r.uploadedByName || '—')}</div></div>
            <button type="button" class="btn btn-ghost btn-sm" data-dl="${esc(r.id)}" data-name="${esc(r.fileName)}" title="Download"><i class="ri-download-2-line"></i></button>
            ${me.role === 'admin' || r.uploadedByName === me.name ? `<button type="button" class="btn btn-ghost btn-sm" data-del="${esc(r.id)}" title="Delete" style="color:var(--danger)"><i class="ri-delete-bin-line"></i></button>` : ''}
          </div>`
            )
            .join('')
        : '<p class="muted">No reports uploaded yet.</p>';
      $$('[data-dl]', box).forEach((b) => b.addEventListener('click', () => withLoading(b, () => downloadFile(`/reports/${b.dataset.dl}/file`, b.dataset.name).catch((err) => toast(err.message, 'error')))));
      $$('[data-del]', box).forEach((b) =>
        b.addEventListener('click', async () => {
          if (!(await confirmDialog('Delete this report permanently? The patient will no longer see it.', { title: 'Delete report', confirmText: 'Delete', danger: true }))) return;
          try {
            await api(`/reports/${b.dataset.del}`, { method: 'DELETE' });
            toast('Report deleted.', 'success');
            load();
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      );
    } catch (err) {
      box.innerHTML = errorHtml(err);
    }
  };
  load();

  $('[data-upload]', m.el).addEventListener('click', async (e) => {
    const form = $('#rep-form', m.el);
    if (!validateForm(form)) return;
    const file = form.file.files[0];
    if (file.size > 5 * 1024 * 1024) {
      toast('The file is larger than 5 MB.', 'error');
      return;
    }
    await withLoading(e.currentTarget, async () => {
      try {
        await api('/reports', {
          method: 'POST',
          body: {
            patient: patient.id,
            title: form.title.value.trim(),
            category: form.category.value,
            reportDate: form.reportDate.value,
            notes: form.notes.value.trim(),
            fileName: file.name,
            data: await readFileAsDataUrl(file),
          },
        });
        form.reset();
        form.reportDate.value = todayStr();
        toast('Report uploaded. The patient can now download it from their portal.', 'success', 6000);
        load();
      } catch (err) {
        toast(err.message, 'error', 7000);
      }
    });
  });
}
