// Patient portal.
let user;
try {
  user = requireLogin('patient');
} catch {
  /* redirecting */
}

const MAX_RESCHEDULES = 2;
const TABS = ['overview', 'appointments', 'records', 'reports', 'checkups', 'family', 'profile', 'security'];

const portal = {
  appointments: [],
  family: [],
  filter: 'upcoming',
  loaded: new Set(),
};

const isUpcoming = (a) => a.status === 'scheduled' && !isPastSlot(a.date, a.time);
const forWhom = (a) =>
  a.patient && a.patient.isDependant
    ? `<span class="for-chip"><i class="ri-user-heart-line"></i>For ${esc(a.patient.name)}${a.patient.relation ? ` · ${esc(RELATION_LABELS[a.patient.relation] || '')}` : ''}</span>`
    : '';

function renderUserBox() {
  $('#dash-user').innerHTML = `${avatar(user.name)}<div><strong>${esc(user.name)}</strong><small>UHID ${esc(user.uhid || '—')}</small></div>`;
}

function showTab(tab) {
  $$('.dash-nav [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('[data-view]').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== tab));
  history.replaceState(null, '', `portal.html#${tab}`);
  window.scrollTo(0, 0);
  // Load these sections the first time they are opened.
  if (tab === 'reports' && !portal.loaded.has('reports')) loadReports();
  if (tab === 'checkups' && !portal.loaded.has('checkups')) loadCheckups();
  if (tab === 'family' && !portal.loaded.has('family')) loadFamily();
}

/* ---------------- Appointments ---------------- */

function apptCardHtml(a, { actions = true } = {}) {
  const d = parseDate(a.date);
  const upcoming = isUpcoming(a);
  const missed = a.status === 'scheduled' && !upcoming;
  const canReschedule = upcoming && (a.rescheduleCount || 0) < MAX_RESCHEDULES;
  const canRate = a.status === 'completed' && !a.feedback;
  return `
    <article class="card appt-card">
      <div class="appt-date"><small>${d.toLocaleDateString('en-IN', { month: 'short' })}</small><strong>${d.getDate()}</strong><small>${d.toLocaleDateString('en-IN', { weekday: 'short' })}</small></div>
      <div class="appt-body">
        <h3>${esc(a.doctor.name)} ${missed ? '<span class="badge badge-no-show">Awaiting update</span>' : statusBadge(a.status)}</h3>
        <div class="muted small">${esc(a.doctor.specialization)} · ${esc(a.department.name)}</div>
        <div class="small" style="margin-top:6px"><i class="ri-time-line"></i> ${esc(fmtDate(a.date))}, ${esc(fmtTime(a.time))} · <span class="muted">${esc(a.appointmentNo)}</span></div>
        ${forWhom(a) ? `<div style="margin-top:6px">${forWhom(a)}</div>` : ''}
        ${a.reason ? `<div class="small muted" style="margin-top:4px">Reason: ${esc(a.reason)}</div>` : ''}
        ${a.status === 'cancelled' && a.cancelReason ? `<div class="small" style="margin-top:4px;color:var(--danger)">Cancelled: ${esc(a.cancelReason)}</div>` : ''}
        ${a.feedback ? `<div class="small" style="margin-top:4px">Your rating: ${starsHtml(a.feedback.rating, { small: true })}</div>` : ''}
      </div>
      ${actions ? `<div class="appt-actions">
        ${a.status === 'completed' && (a.diagnosis || a.prescription) ? `<button type="button" class="btn btn-outline btn-sm" data-view-record="${esc(a.id)}"><i class="ri-file-text-line"></i>View record</button>` : ''}
        ${canRate ? `<button type="button" class="btn btn-primary btn-sm" data-rate="${esc(a.id)}"><i class="ri-star-line"></i>Rate visit</button>` : ''}
        <a class="btn btn-ghost btn-sm" href="slip.html?id=${encodeURIComponent(a.id)}"><i class="ri-printer-line"></i>${a.status === 'completed' ? 'Print' : 'Slip'}</a>
        ${canReschedule ? `<a class="btn btn-ghost btn-sm" href="book.html?reschedule=${encodeURIComponent(a.id)}"><i class="ri-calendar-event-line"></i>Reschedule</a>` : ''}
        ${upcoming ? `<button type="button" class="btn btn-ghost btn-sm" data-cancel="${esc(a.id)}" style="color:var(--danger)"><i class="ri-close-circle-line"></i>Cancel</button>` : ''}
        ${!upcoming ? `<a class="btn btn-ghost btn-sm" href="book.html?doctor=${encodeURIComponent(a.doctor.id)}"><i class="ri-repeat-line"></i>Book again</a>` : ''}
      </div>` : ''}
    </article>`;
}

function bindApptActions(root) {
  $$('[data-cancel]', root).forEach((b) => b.addEventListener('click', () => cancelAppointment(b.dataset.cancel)));
  $$('[data-view-record]', root).forEach((b) => b.addEventListener('click', () => viewRecord(b.dataset.viewRecord)));
  $$('[data-rate]', root).forEach((b) => b.addEventListener('click', () => rateVisit(b.dataset.rate)));
}

function renderOverview() {
  const upcoming = portal.appointments.filter(isUpcoming).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const completed = portal.appointments.filter((a) => a.status === 'completed');
  const toRate = completed.filter((a) => !a.feedback);
  const next = upcoming[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const profileMissing = !user.dateOfBirth || !user.gender || !user.bloodGroup;

  const view = $('[data-view="overview"]');
  view.innerHTML = `
    <div class="dash-title">
      <div><h1>${greeting}, ${esc(user.name.split(' ')[0])}</h1><p class="muted mb-0">Here is a summary of your care at ${esc(SITE.name)}.</p></div>
      <a class="btn btn-primary" href="book.html"><i class="ri-calendar-check-line"></i>Book appointment</a>
    </div>
    ${profileMissing ? `<div class="alert alert-info" style="margin-bottom:20px"><i class="ri-information-line"></i><div>Complete your profile (date of birth, gender, blood group) to help doctors care for you. <a href="#profile" data-goto-tab="profile">Update profile</a></div></div>` : ''}
    ${toRate.length ? `<div class="alert alert-success" style="margin-bottom:20px"><i class="ri-star-smile-line"></i><div>How was your visit with ${esc(toRate[0].doctor.name)}? <a href="#" data-rate="${esc(toRate[0].id)}">Rate your visit</a>. It helps other patients.</div></div>` : ''}
    <div class="grid grid-3" style="margin-bottom:24px">
      <div class="card stat-card"><span class="ic ic-blue"><i class="ri-calendar-event-line"></i></span><div><strong>${upcoming.length}</strong><span>Upcoming</span></div></div>
      <div class="card stat-card"><span class="ic ic-green"><i class="ri-checkbox-circle-line"></i></span><div><strong>${completed.length}</strong><span>Completed visits</span></div></div>
      <div class="card stat-card"><span class="ic ic-teal"><i class="ri-id-card-line"></i></span><div><strong style="font-size:1.2rem">${esc(user.uhid || '—')}</strong><span>Your UHID</span></div></div>
    </div>
    <h2 style="font-size:1.2rem">Next appointment</h2>
    ${next ? apptCardHtml(next) : emptyHtml('ri-calendar-line', 'No upcoming appointments', 'Book a consultation with one of our specialists.', '<a class="btn btn-primary" href="book.html">Book now</a>')}
  `;
  bindApptActions(view);
  $$('[data-goto-tab]', view).forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      showTab(a.dataset.gotoTab);
    })
  );
  $$('a[data-rate]', view).forEach((a) => a.addEventListener('click', (e) => e.preventDefault()));
}

function renderAppointments() {
  const list = $('#appt-list');
  const f = portal.filter;
  let items = portal.appointments.filter((a) => {
    if (f === 'upcoming') return isUpcoming(a);
    if (f === 'cancelled') return a.status === 'cancelled';
    return a.status !== 'cancelled' && !isUpcoming(a);
  });
  if (f === 'upcoming') items = items.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const empty = {
    upcoming: ['ri-calendar-line', 'No upcoming appointments', 'When you book, your appointments will appear here.'],
    past: ['ri-history-line', 'No past visits yet', ''],
    cancelled: ['ri-close-circle-line', 'No cancelled appointments', ''],
  }[f];
  list.innerHTML = items.length ? items.map((a) => apptCardHtml(a)).join('') : emptyHtml(...empty);
  bindApptActions(list);
}

function renderRecords() {
  const list = $('#records-list');
  const items = portal.appointments.filter((a) => a.status === 'completed');
  list.innerHTML = items.length
    ? items
        .map(
          (a) => `
      <article class="card">
        <div class="dash-title" style="margin-bottom:8px">
          <div><h3 class="mb-0">${esc(fmtDate(a.date))} · ${esc(a.doctor.name)}</h3><div class="muted small">${esc(a.department.name)} · ${esc(a.appointmentNo)} ${forWhom(a)}</div></div>
          <a class="btn btn-ghost btn-sm" href="slip.html?id=${encodeURIComponent(a.id)}"><i class="ri-printer-line"></i>Print</a>
        </div>
        <div class="grid grid-2">
          <div><div class="muted small">Diagnosis</div><div style="white-space:pre-wrap">${esc(a.diagnosis || 'Not recorded')}</div></div>
          <div><div class="muted small">Prescription</div><div style="white-space:pre-wrap">${esc(a.prescription || 'None')}</div></div>
        </div>
      </article>`
        )
        .join('')
    : emptyHtml('ri-file-list-3-line', 'No records yet', 'After a consultation, your doctor’s diagnosis and prescription will appear here.');
}

function renderAll() {
  renderOverview();
  renderAppointments();
  renderRecords();
}

async function loadAppointments() {
  $('[data-view="overview"]').innerHTML = loaderHtml();
  try {
    portal.appointments = await api('/appointments/mine');
    renderAll();
  } catch (err) {
    $('[data-view="overview"]').innerHTML = errorHtml(err);
  }
}

function replaceAppt(updated) {
  portal.appointments = portal.appointments.map((x) => (x.id === updated.id ? updated : x));
  renderAll();
}

async function cancelAppointment(id) {
  const a = portal.appointments.find((x) => x.id === id);
  const ok = await confirmDialog(
    `Cancel the appointment with ${a.doctor.name} on ${fmtDate(a.date)} at ${fmtTime(a.time)}${a.patient.isDependant ? ` for ${a.patient.name}` : ''}? The slot will be released to other patients.`,
    { title: 'Cancel appointment', confirmText: 'Yes, cancel it', danger: true }
  );
  if (!ok) return;
  try {
    replaceAppt(await api(`/appointments/${id}/cancel`, { method: 'PATCH', body: { reason: 'Cancelled by patient online' } }));
    toast('Appointment cancelled.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function viewRecord(id) {
  const a = portal.appointments.find((x) => x.id === id);
  openModal({
    title: `Consultation on ${fmtDate(a.date)}`,
    size: 'modal-lg',
    body: `
      <ul class="summary-list">
        <li><span>Patient</span><span>${esc(a.patient.name)}</span></li>
        <li><span>Doctor</span><span>${esc(a.doctor.name)}</span></li>
        <li><span>Department</span><span>${esc(a.department.name)}</span></li>
        <li><span>Appointment no.</span><span>${esc(a.appointmentNo)}</span></li>
      </ul>
      <h4>Diagnosis</h4><p style="white-space:pre-wrap">${esc(a.diagnosis || 'Not recorded')}</p>
      <h4>Prescription</h4><p style="white-space:pre-wrap">${esc(a.prescription || 'None')}</p>`,
    footer: `<a class="btn btn-primary" href="slip.html?id=${encodeURIComponent(a.id)}"><i class="ri-printer-line"></i>Print</a>`,
  });
}

function rateVisit(id) {
  const a = portal.appointments.find((x) => x.id === id);
  let rating = 0;
  const m = openModal({
    title: `Rate your visit with ${a.doctor.name}`,
    body: `
      <p class="muted">${esc(fmtDate(a.date))} · ${esc(a.department.name)}</p>
      <div class="star-input" role="radiogroup" aria-label="Rating">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" role="radio" aria-checked="false" aria-label="${n} star${n > 1 ? 's' : ''}"><i class="ri-star-fill"></i></button>`).join('')}
      </div>
      <div class="field" style="margin-top:16px"><label for="fb-comment">Tell us more <span class="muted">(optional)</span></label>
        <textarea id="fb-comment" maxlength="1000" rows="3" placeholder="What went well? What could be better?"></textarea>
        <span class="hint">Your first name and initial may appear with your comment on the doctor's profile.</span></div>`,
    footer: `<button type="button" class="btn btn-ghost" data-close>Later</button><button type="button" class="btn btn-primary" data-save disabled>Submit rating</button>`,
  });
  const stars = $$('[data-star]', m.el);
  const save = $('[data-save]', m.el);
  const paint = (n) => stars.forEach((s) => s.classList.toggle('on', Number(s.dataset.star) <= n));
  stars.forEach((s) => {
    s.addEventListener('mouseenter', () => paint(Number(s.dataset.star)));
    s.addEventListener('mouseleave', () => paint(rating));
    s.addEventListener('click', () => {
      rating = Number(s.dataset.star);
      stars.forEach((x) => x.setAttribute('aria-checked', String(Number(x.dataset.star) === rating)));
      paint(rating);
      save.disabled = false;
    });
  });
  $('[data-close]', m.el).addEventListener('click', m.close);
  save.addEventListener('click', async () => {
    await withLoading(save, async () => {
      try {
        replaceAppt(await api(`/appointments/${a.id}/feedback`, { method: 'PATCH', body: { rating, comment: $('#fb-comment', m.el).value.trim() } }));
        m.close();
        toast('Thank you for your feedback!', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

/* ---------------- Reports ---------------- */

async function loadReports() {
  const box = $('#reports-list');
  box.innerHTML = loaderHtml();
  try {
    const list = await api('/reports/mine');
    portal.loaded.add('reports');
    box.innerHTML = list.length
      ? list
          .map(
            (r) => `<div class="file-row">
          <span class="file-icon ${r.mimeType === 'application/pdf' ? '' : 'img'}"><i class="${r.mimeType === 'application/pdf' ? 'ri-file-pdf-2-line' : 'ri-image-line'}"></i></span>
          <div class="grow">
            <div class="cell-main">${esc(r.title)}</div>
            <div class="cell-sub">${esc(fmtDate(r.reportDate))} · ${esc(cap(r.category.replace('-', ' ')))} · ${esc(fmtSize(r.size))}${r.patient && r.patient.id !== user.id ? ` · for ${esc(r.patient.name)}` : ''}</div>
            ${r.notes ? `<div class="small muted">${esc(r.notes)}</div>` : ''}
          </div>
          <button type="button" class="btn btn-outline btn-sm" data-download="${esc(r.id)}" data-name="${esc(r.fileName)}"><i class="ri-download-2-line"></i>Download</button>
        </div>`
          )
          .join('')
      : emptyHtml('ri-file-pdf-2-line', 'No reports yet', 'When the hospital uploads your lab or scan reports, you can download them here.');
    $$('[data-download]', box).forEach((b) =>
      b.addEventListener('click', () => withLoading(b, () => downloadFile(`/reports/${b.dataset.download}/file`, b.dataset.name).catch((err) => toast(err.message, 'error'))))
    );
  } catch (err) {
    box.innerHTML = errorHtml(err);
  }
}

/* ---------------- Health check-ups ---------------- */

async function loadCheckups() {
  const box = $('#checkup-list');
  box.innerHTML = loaderHtml();
  try {
    const list = await api('/packages/bookings/mine');
    portal.loaded.add('checkups');
    box.innerHTML = list.length
      ? list
          .map((b) => {
            const d = parseDate(b.date);
            const canCancel = ['requested', 'confirmed'].includes(b.status) && b.date >= todayStr();
            return `<article class="card appt-card">
            <div class="appt-date"><small>${d.toLocaleDateString('en-IN', { month: 'short' })}</small><strong>${d.getDate()}</strong><small>${d.toLocaleDateString('en-IN', { weekday: 'short' })}</small></div>
            <div class="appt-body">
              <h3>${esc(b.package ? b.package.name : 'Health check-up')} <span class="badge badge-${b.status === 'requested' ? 'new' : b.status === 'confirmed' ? 'scheduled' : esc(b.status)}">${esc(cap(b.status))}</span></h3>
              <div class="small muted">${esc(b.bookingNo)} · ${esc(fmtMoney(b.price))} · for ${esc(b.patient.name)}</div>
              ${b.status === 'requested' ? '<div class="small" style="margin-top:4px">Our team will call you to confirm the time.</div>' : ''}
              ${b.status === 'confirmed' ? '<div class="small" style="margin-top:4px">Please report to the Health Check-up desk at 8:00 AM.</div>' : ''}
              ${b.package && b.package.preparation && canCancel ? `<div class="small muted" style="margin-top:4px"><i class="ri-information-line"></i> ${esc(b.package.preparation)}</div>` : ''}
            </div>
            ${canCancel ? `<div class="appt-actions"><button type="button" class="btn btn-ghost btn-sm" data-cancel-checkup="${esc(b.id)}" style="color:var(--danger)">Cancel</button></div>` : ''}
          </article>`;
          })
          .join('')
      : emptyHtml('ri-heart-pulse-line', 'No health check-ups booked', 'Regular check-ups catch problems early.', '<a class="btn btn-primary" href="packages.html">See packages</a>');
    $$('[data-cancel-checkup]', box).forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!(await confirmDialog('Cancel this health check-up booking?', { title: 'Cancel check-up', confirmText: 'Yes, cancel', danger: true }))) return;
        try {
          await api(`/packages/bookings/${btn.dataset.cancelCheckup}/cancel`, { method: 'PATCH' });
          toast('Check-up booking cancelled.', 'success');
          loadCheckups();
        } catch (err) {
          toast(err.message, 'error');
        }
      })
    );
  } catch (err) {
    box.innerHTML = errorHtml(err);
  }
}

/* ---------------- Family ---------------- */

async function loadFamily() {
  const box = $('#family-list');
  box.innerHTML = loaderHtml();
  try {
    portal.family = await api('/family');
    portal.loaded.add('family');
    box.innerHTML = portal.family.length
      ? portal.family
          .map(
            (f) => `<div class="card">
          <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">${avatar(f.name)}<div><strong>${esc(f.name)}</strong><div class="small muted">${esc(RELATION_LABELS[f.relation] || 'Family')} · UHID ${esc(f.uhid)}</div></div></div>
          <ul class="summary-list">
            <li><span>Age</span><span>${esc(f.dateOfBirth ? `${age(f.dateOfBirth)} yrs` : '—')}</span></li>
            <li><span>Gender</span><span>${esc(cap(f.gender) || '—')}</span></li>
            <li><span>Blood group</span><span>${esc(f.bloodGroup || '—')}</span></li>
          </ul>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a class="btn btn-primary btn-sm" href="book.html?for=${encodeURIComponent(f.id)}">Book for ${esc(f.name.split(' ')[0])}</a>
            <button type="button" class="btn btn-ghost btn-sm" data-edit-member="${esc(f.id)}">Edit</button>
            <button type="button" class="btn btn-ghost btn-sm" data-remove-member="${esc(f.id)}" style="color:var(--danger)">Remove</button>
          </div>
        </div>`
          )
          .join('')
      : `<div style="grid-column:1/-1">${emptyHtml('ri-team-line', 'No family members yet', 'Add your children, parents or others you look after.')}</div>`;
    $$('[data-edit-member]', box).forEach((b) => b.addEventListener('click', () => memberForm(portal.family.find((f) => f.id === b.dataset.editMember))));
    $$('[data-remove-member]', box).forEach((b) =>
      b.addEventListener('click', async () => {
        const f = portal.family.find((x) => x.id === b.dataset.removeMember);
        if (!(await confirmDialog(`Remove ${f.name} from your family members?`, { title: 'Remove family member', confirmText: 'Remove', danger: true }))) return;
        try {
          await api(`/family/${f.id}`, { method: 'DELETE' });
          toast('Family member removed.', 'success');
          loadFamily();
        } catch (err) {
          toast(err.message, 'error', 8000);
        }
      })
    );
  } catch (err) {
    box.innerHTML = errorHtml(err);
  }
}

function memberForm(f = null) {
  const m = openModal({
    title: f ? `Edit ${f.name}` : 'Add a family member',
    body: `
      <form id="member-form" class="form-grid" novalidate>
        <div class="field full"><label>Full name <span class="req">*</span></label><input name="name" required minlength="2" maxlength="80" value="${esc(f ? f.name : '')}"></div>
        <div class="field"><label>Relation <span class="req">*</span></label>
          <select name="relation" required><option value="">Select…</option>${Object.entries(RELATION_LABELS)
            .map(([k, v]) => `<option value="${k}" ${f && f.relation === k ? 'selected' : ''}>${k === 'other' ? 'Other' : v}</option>`)
            .join('')}</select></div>
        <div class="field"><label>Date of birth</label><input name="dateOfBirth" type="date" max="${todayStr()}" value="${esc(f ? f.dateOfBirth : '')}"></div>
        <div class="field"><label>Gender</label><select name="gender"><option value="">—</option>${['female', 'male', 'other'].map((g) => `<option value="${g}" ${f && f.gender === g ? 'selected' : ''}>${cap(g)}</option>`).join('')}</select></div>
        <div class="field"><label>Blood group</label><select name="bloodGroup"><option value="">Unknown</option>${['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => `<option ${f && f.bloodGroup === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
      </form>
      <p class="muted small mb-0" style="margin-top:12px">They'll get their own UHID. Appointment emails come to you.</p>`,
    footer: `<button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="button" class="btn btn-primary" data-save>${f ? 'Save' : 'Add member'}</button>`,
  });
  $('[data-close]', m.el).addEventListener('click', m.close);
  $('[data-save]', m.el).addEventListener('click', async (e) => {
    const form = $('#member-form', m.el);
    if (!validateForm(form)) return;
    await withLoading(e.currentTarget, async () => {
      try {
        await api(f ? `/family/${f.id}` : '/family', { method: f ? 'PUT' : 'POST', body: formData(form) });
        m.close();
        toast(f ? 'Details updated.' : 'Family member added. You can now book for them.', 'success');
        loadFamily();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

/* ---------------- Profile ---------------- */

function fillProfile() {
  const f = $('#profile-form');
  f.name.value = user.name || '';
  $('#p-email').value = user.email || '';
  f.phone.value = user.phone || '';
  f.dateOfBirth.value = user.dateOfBirth || '';
  f.dateOfBirth.max = todayStr();
  f.gender.value = user.gender || '';
  f.bloodGroup.value = user.bloodGroup || '';
  f.address.value = user.address || '';
  $('#p-uhid').value = user.uhid || '';
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!user) return;
  renderUserBox();
  fillProfile();

  $$('.dash-nav [data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      portal.filter = b.dataset.filter;
      $$('[data-filter]').forEach((x) => x.classList.toggle('active', x === b));
      renderAppointments();
    })
  );
  $('#add-member').addEventListener('click', () => memberForm());
  const initial = location.hash.slice(1);
  if (TABS.includes(initial)) showTab(initial);

  // Profile
  const profileForm = $('#profile-form');
  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(profileForm)) return;
    await withLoading($('button[type=submit]', profileForm), async () => {
      try {
        const res = await api('/auth/me', { method: 'PATCH', body: formData(profileForm) });
        user = res.user;
        Session.save({ user });
        renderUserBox();
        renderOverview();
        toast('Profile updated.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  // Password
  const pwForm = $('#password-form');
  const confirmInput = pwForm.confirm;
  confirmInput.addEventListener('input', () => confirmInput.setCustomValidity(''));
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    confirmInput.setCustomValidity(confirmInput.value !== pwForm.newPassword.value ? 'Passwords do not match.' : '');
    if (!validateForm(pwForm)) return;
    await withLoading($('button[type=submit]', pwForm), async () => {
      try {
        const res = await api('/auth/change-password', {
          method: 'POST',
          body: { currentPassword: pwForm.currentPassword.value, newPassword: pwForm.newPassword.value },
        });
        Session.save({ token: res.token });
        pwForm.reset();
        toast('Password updated. You have been signed out on other devices.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  // Refresh the stored profile in case it changed elsewhere.
  api('/auth/me')
    .then((res) => {
      user = res.user;
      Session.save({ user });
      renderUserBox();
      fillProfile();
    })
    .catch(() => {});

  await loadAppointments();
});
