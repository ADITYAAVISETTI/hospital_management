// Admin dashboard.
let admin;
try {
  admin = requireLogin('admin');
} catch {
  /* redirecting */
}

const A = {
  departments: [],
  doctors: [],
  apptPage: 1,
  enqFilter: 'new',
  chkFilter: 'requested',
  packages: [],
  loaded: new Set(),
};

const TABS = ['overview', 'appointments', 'doctors', 'departments', 'patients', 'checkups', 'holidays', 'enquiries'];

/* ---------------- Navigation ---------------- */

function showTab(tab) {
  $$('.dash-nav [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('[data-view]').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== tab));
  history.replaceState(null, '', `admin.html#${tab}`);
  window.scrollTo(0, 0);
  const loaders = {
    overview: loadOverview,
    appointments: loadAppointments,
    doctors: loadDoctors,
    departments: loadDepartments,
    patients: loadPatients,
    checkups: loadCheckups,
    holidays: loadHolidays,
    enquiries: loadEnquiries,
  };
  loaders[tab]();
}

async function loadReferenceData() {
  [A.departments, A.doctors] = await Promise.all([api('/departments?all=true'), api('/doctors?all=true')]);
  A.loaded.add('ref');
  const docSelect = $('#appt-filter [name=doctor]');
  const current = docSelect.value;
  docSelect.innerHTML =
    '<option value="">All doctors</option>' +
    A.doctors.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}${d.active ? '' : ' (inactive)'}</option>`).join('');
  docSelect.value = current;
}

async function ensureReferenceData() {
  if (!A.loaded.has('ref')) await loadReferenceData();
}

function setBadge(id, n) {
  const badge = $(id);
  badge.textContent = n;
  badge.classList.toggle('hidden', !n);
}

/* ---------------- Overview ---------------- */

async function loadOverview() {
  $('#today-label').textContent = fmtDate(todayStr(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#stats-cards').innerHTML = loaderHtml();
  try {
    const [stats, today] = await Promise.all([api('/admin/stats'), api(`/appointments?date=${todayStr()}&limit=100`)]);
    const t = stats.totals;
    setBadge('#enq-count', t.newEnquiries);
    setBadge('#chk-count', t.pendingCheckups);
    $('#stats-cards').className = 'grid grid-4';
    $('#stats-cards').innerHTML = [
      ['ic-blue', 'ri-calendar-event-line', t.todayAppointments, "Today's appointments", 'appointments'],
      ['ic-teal', 'ri-calendar-schedule-line', t.upcomingAppointments, 'Upcoming (scheduled)', 'appointments'],
      ['ic-green', 'ri-group-line', t.patients, 'Registered patients', 'patients'],
      ['ic-blue', 'ri-stethoscope-line', t.doctors, 'Active doctors', 'doctors'],
      ['ic-teal', 'ri-hospital-line', t.departments, 'Departments', 'departments'],
      ['ic-red', 'ri-heart-pulse-line', t.pendingCheckups, 'Check-up requests', 'checkups'],
      ['ic-amber', 'ri-mail-unread-line', t.newEnquiries, 'New enquiries', 'enquiries'],
      ['ic-amber', 'ri-star-smile-line', t.ratingCount ? `${t.averageRating} ★` : '—', `Patient rating${t.ratingCount ? ` (${t.ratingCount})` : ''}`, 'appointments'],
    ]
      .map(
        ([c, i, n, l, tab]) =>
          `<button type="button" class="card card-hover stat-card" data-jump="${tab}" style="text-align:left;font:inherit;cursor:pointer"><span class="ic ${c}"><i class="${i}"></i></span><div><strong>${esc(n)}</strong><span>${esc(l)}</span></div></button>`
      )
      .join('');

    const max = Math.max(1, ...stats.last7Days.map((d) => d.count));
    $('#chart-week').innerHTML = `<div class="bar-chart" role="img" aria-label="Appointments per day for the last 7 days">${stats.last7Days
      .map(
        (d) => `<div class="bar-col"><span class="val">${d.count}</span><div class="bar" style="height:${(d.count / max) * 100}%"></div><span class="lbl">${esc(fmtDate(d.date, { weekday: 'short' }))}</span></div>`
      )
      .join('')}</div>`;

    const dmax = Math.max(1, ...stats.byDepartment.map((d) => d.count));
    $('#chart-dept').innerHTML = stats.byDepartment.length
      ? stats.byDepartment
          .map(
            (d) => `<div class="hbar"><span class="small">${esc(d.name)}</span><div class="hbar-track"><div class="hbar-fill" style="width:${(d.count / dmax) * 100}%"></div></div><strong class="small">${d.count}</strong></div>`
          )
          .join('')
      : '<p class="muted">No appointments yet.</p>';

    $('#today-list').innerHTML = today.items.length
      ? apptTableHtml([...today.items].sort((a, b) => a.time.localeCompare(b.time)))
      : emptyHtml('ri-calendar-line', 'No appointments today');
    bindApptActions($('#today-list'), loadOverview);
    $$('[data-jump]', $('#stats-cards')).forEach((b) => b.addEventListener('click', () => showTab(b.dataset.jump)));
  } catch (err) {
    $('#stats-cards').innerHTML = errorHtml(err);
  }
}

/* ---------------- Appointments ---------------- */

function apptTableHtml(items) {
  return `
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Appt. no.</th><th>Date &amp; time</th><th>Patient</th><th>Doctor</th><th>Status</th><th></th></tr></thead>
      <tbody>${items
        .map(
          (a) => `<tr>
          <td class="nowrap"><strong>${esc(a.appointmentNo)}</strong>${a.bookedBy === 'admin' ? '<div class="cell-sub">Front desk</div>' : ''}</td>
          <td class="nowrap">${esc(fmtDate(a.date, { day: 'numeric', month: 'short', year: 'numeric' }))}<div class="cell-sub">${esc(fmtTime(a.time))}</div></td>
          <td><div class="cell-main">${esc(a.patient ? a.patient.name : '—')}</div><div class="cell-sub">${esc(a.patient ? [a.patient.uhid, a.patient.phone].filter(Boolean).join(' · ') : '')}</div></td>
          <td><div>${esc(a.doctor.name)}</div><div class="cell-sub">${esc(a.department.name)}</div></td>
          <td>
            <select class="input" data-status-for="${esc(a.id)}" aria-label="Change status" style="padding:4px 8px;font-size:0.85rem;width:auto">
              ${['scheduled', 'completed', 'cancelled', 'no-show'].map((s) => `<option value="${s}" ${s === a.status ? 'selected' : ''}>${s === 'no-show' ? 'No-show' : cap(s)}</option>`).join('')}
            </select>
            ${a.feedback ? `<div class="small" style="margin-top:4px">${starsHtml(a.feedback.rating, { small: true })}</div>` : ''}
          </td>
          <td><div class="actions">
            <button type="button" class="btn btn-ghost btn-sm" data-view-appt="${esc(a.id)}" title="Details"><i class="ri-eye-line"></i></button>
            <a class="btn btn-ghost btn-sm" href="slip.html?id=${encodeURIComponent(a.id)}" title="Print slip"><i class="ri-printer-line"></i></a>
          </div></td>
        </tr>`
        )
        .join('')}</tbody>
    </table></div>`;
}

function bindApptActions(root, reload) {
  $$('[data-status-for]', root).forEach((sel) => {
    const original = sel.value;
    sel.addEventListener('change', async () => {
      const ok = await confirmDialog(`Change this appointment's status to "${sel.value}"?${sel.value === 'cancelled' ? ' The patient will be emailed.' : ''}`, { confirmText: 'Change status' });
      if (!ok) {
        sel.value = original;
        return;
      }
      try {
        await api(`/appointments/${sel.dataset.statusFor}/status`, { method: 'PATCH', body: { status: sel.value } });
        toast('Status updated.', 'success');
        reload();
      } catch (err) {
        sel.value = original;
        toast(err.message, 'error');
      }
    });
  });
  $$('[data-view-appt]', root).forEach((b) => b.addEventListener('click', () => viewAppointment(b.dataset.viewAppt, reload)));
}

async function viewAppointment(id, reload = loadAppointments) {
  let a;
  try {
    a = await api(`/appointments/${id}`);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  const p = a.patient || {};
  const m = openModal({
    title: `Appointment ${a.appointmentNo}`,
    size: 'modal-lg',
    body: `
      <div class="grid grid-2">
        <ul class="summary-list">
          <li><span>Patient</span><span>${esc(p.name)}</span></li>
          <li><span>UHID</span><span>${esc(p.uhid || '—')}</span></li>
          <li><span>Phone</span><span>${esc(p.phone || '—')}</span></li>
          <li><span>Email</span><span>${esc(p.email || '—')}</span></li>
          <li><span>Age / gender</span><span>${esc(p.dateOfBirth ? `${age(p.dateOfBirth)} yrs` : '—')} / ${esc(cap(p.gender) || '—')}</span></li>
        </ul>
        <ul class="summary-list">
          <li><span>Doctor</span><span>${esc(a.doctor.name)}</span></li>
          <li><span>Department</span><span>${esc(a.department.name)}</span></li>
          <li><span>When</span><span>${esc(fmtDate(a.date))}, ${esc(fmtTime(a.time))}</span></li>
          <li><span>Status</span><span>${statusBadge(a.status)}</span></li>
          <li><span>Fee</span><span>${esc(fmtMoney(a.fee))}</span></li>
        </ul>
      </div>
      ${a.reason ? `<h4>Reason for visit</h4><p>${esc(a.reason)}</p>` : ''}
      ${a.status === 'cancelled' ? `<h4>Cancellation</h4><p>By ${esc(a.cancelledBy || '—')}${a.cancelReason ? `: ${esc(a.cancelReason)}` : ''}</p>` : ''}
      ${a.diagnosis ? `<h4>Diagnosis</h4><p style="white-space:pre-wrap">${esc(a.diagnosis)}</p>` : ''}
      ${a.prescription ? `<h4>Prescription</h4><p style="white-space:pre-wrap">${esc(a.prescription)}</p>` : ''}
      ${a.doctorNotes ? `<h4>Doctor's private notes</h4><p style="white-space:pre-wrap">${esc(a.doctorNotes)}</p>` : ''}
      ${a.feedback ? `<h4>Patient feedback</h4>
        <p class="mb-0">${starsHtml(a.feedback.rating)} ${a.feedback.hidden ? '<span class="badge badge-inactive">Hidden from public</span>' : ''}</p>
        ${a.feedback.comment ? `<p style="white-space:pre-wrap">${esc(a.feedback.comment)}</p>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-toggle-review>${a.feedback.hidden ? 'Show on doctor profile' : 'Hide from doctor profile'}</button>` : ''}
      ${a.status === 'scheduled' ? `<h4 style="margin-top:20px">Reschedule</h4>
        <div class="form-grid" id="rs-box">
          <div class="field"><label>New date</label><input type="date" id="rs-date" min="${todayStr()}"></div>
          <div class="field"><label>New time</label><select id="rs-time" disabled><option value="">Pick a date first</option></select></div>
          <div class="full"><button type="button" class="btn btn-outline btn-sm" id="rs-save" disabled>Move appointment</button></div>
        </div>` : ''}
      <p class="muted small mb-0" style="margin-top:16px">Booked ${esc(new Date(a.createdAt).toLocaleString('en-IN'))}${a.bookedBy === 'admin' ? ' at the front desk' : ' online'}${a.rescheduleCount ? ` · rescheduled ${a.rescheduleCount}×` : ''}</p>`,
    footer: `<button type="button" class="btn btn-ghost" data-reports-for><i class="ri-file-pdf-2-line"></i>Patient reports</button><a class="btn btn-primary" href="slip.html?id=${encodeURIComponent(a.id)}"><i class="ri-printer-line"></i>Print slip</a>`,
  });

  $('[data-reports-for]', m.el).addEventListener('click', () => patientReportsModal(p));

  const toggle = $('[data-toggle-review]', m.el);
  if (toggle) {
    toggle.addEventListener('click', async () => {
      try {
        await api(`/appointments/${a.id}/feedback/visibility`, { method: 'PATCH', body: { hidden: !a.feedback.hidden } });
        toast(a.feedback.hidden ? 'Review is visible again.' : 'Review hidden from the public profile.', 'success');
        m.close();
        viewAppointment(id, reload);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  const rsDate = $('#rs-date', m.el);
  if (rsDate) {
    const rsTime = $('#rs-time', m.el);
    const rsSave = $('#rs-save', m.el);
    fillSlotSelect(rsDate, rsTime, () => a.doctor.id, rsSave);
    rsSave.addEventListener('click', async () => {
      await withLoading(rsSave, async () => {
        try {
          await api(`/appointments/${a.id}/reschedule`, { method: 'PATCH', body: { date: rsDate.value, time: rsTime.value } });
          toast('Appointment moved. The patient has been emailed.', 'success');
          m.close();
          reload();
        } catch (err) {
          toast(err.message, 'error', 6000);
        }
      });
    });
  }
}

/** Wires a date input to a <select> of free slots for a doctor. */
function fillSlotSelect(dateInput, timeSelect, getDoctorId, submitBtn) {
  dateInput.max = addDays(todayStr(), 60);
  const refresh = async () => {
    timeSelect.disabled = true;
    submitBtn.disabled = true;
    const doctorId = getDoctorId();
    if (!doctorId || !dateInput.value) {
      timeSelect.innerHTML = `<option value="">${doctorId ? 'Pick a date first' : 'Pick a doctor first'}</option>`;
      return;
    }
    timeSelect.innerHTML = '<option value="">Loading…</option>';
    try {
      const res = await api(`/doctors/${doctorId}/slots?date=${dateInput.value}`, { auth: false });
      const free = res.slots.filter((s) => s.available);
      timeSelect.innerHTML = free.length
        ? `<option value="">Choose a time (${free.length} free)</option>${free.map((s) => `<option value="${esc(s.time)}">${esc(fmtTime(s.time))}</option>`).join('')}`
        : `<option value="">${esc(res.message || 'No free slots on this day')}</option>`;
      timeSelect.disabled = !free.length;
    } catch (err) {
      timeSelect.innerHTML = `<option value="">${esc(err.message)}</option>`;
    }
  };
  dateInput.addEventListener('change', refresh);
  timeSelect.addEventListener('change', () => (submitBtn.disabled = !timeSelect.value));
  return refresh;
}

function apptQuery() {
  const f = formData($('#appt-filter'));
  const q = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => v && q.set(k, v));
  return q;
}

async function loadAppointments() {
  const box = $('#appt-table');
  box.innerHTML = loaderHtml();
  const q = apptQuery();
  q.set('page', A.apptPage);
  q.set('limit', 20);
  try {
    const res = await api(`/appointments?${q}`);
    box.innerHTML = res.items.length ? apptTableHtml(res.items) : emptyHtml('ri-calendar-line', 'No appointments match these filters');
    bindApptActions(box, loadAppointments);
    const pages = $('#appt-pages');
    pages.innerHTML =
      res.total > 0
        ? `<span>${res.total} appointment${res.total === 1 ? '' : 's'} · page ${res.page} of ${res.pages}</span>
           <button type="button" class="btn btn-ghost btn-sm" data-page="${res.page - 1}" ${res.page <= 1 ? 'disabled' : ''}><i class="ri-arrow-left-s-line"></i>Prev</button>
           <button type="button" class="btn btn-ghost btn-sm" data-page="${res.page + 1}" ${res.page >= res.pages ? 'disabled' : ''}>Next<i class="ri-arrow-right-s-line"></i></button>`
        : '';
    $$('[data-page]', pages).forEach((b) =>
      b.addEventListener('click', () => {
        A.apptPage = Number(b.dataset.page);
        loadAppointments();
      })
    );
  } catch (err) {
    box.innerHTML = errorHtml(err);
  }
}

/* ---------------- Front desk: new appointment ---------------- */

async function newAppointment(preselected = null) {
  try {
    await ensureReferenceData();
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  const active = A.doctors.filter((d) => d.active);
  let patient = preselected;
  const m = openModal({
    title: 'New appointment (front desk)',
    size: 'modal-lg',
    body: `
      <h4 style="margin-top:0">1. Patient</h4>
      <div id="na-patient"></div>
      <h4>2. Doctor &amp; time</h4>
      <div class="form-grid">
        <div class="field full"><label>Doctor</label><select id="na-doctor"><option value="">Choose a doctor…</option>${active
          .map((d) => `<option value="${esc(d.id)}">${esc(d.name)} · ${esc(d.department ? d.department.name : '')} · ${esc(fmtMoney(d.consultationFee))}</option>`)
          .join('')}</select></div>
        <div class="field"><label>Date</label><input type="date" id="na-date" min="${todayStr()}"></div>
        <div class="field"><label>Time</label><select id="na-time" disabled><option value="">Pick a doctor and date</option></select></div>
        <div class="field full"><label>Reason for visit <span class="muted">(optional)</span></label><input id="na-reason" maxlength="500"></div>
      </div>`,
    footer: `<button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="button" class="btn btn-primary" id="na-save" disabled>Book appointment</button>`,
  });
  $('[data-close]', m.el).addEventListener('click', m.close);
  const save = $('#na-save', m.el);
  const doctorSel = $('#na-doctor', m.el);
  const refreshSlots = fillSlotSelect($('#na-date', m.el), $('#na-time', m.el), () => doctorSel.value, save);
  doctorSel.addEventListener('change', refreshSlots);

  const patientBox = $('#na-patient', m.el);
  const renderPatient = () => {
    if (patient) {
      patientBox.innerHTML = `<div class="alert alert-info"><i class="ri-user-line"></i><div><strong>${esc(patient.name)}</strong> · UHID ${esc(patient.uhid)}${patient.phone ? ` · ${esc(patient.phone)}` : ''} <button type="button" class="btn btn-ghost btn-sm" id="na-change" style="margin-left:8px">Change</button></div></div>`;
      $('#na-change', m.el).addEventListener('click', () => {
        patient = null;
        renderPatient();
      });
      return;
    }
    patientBox.innerHTML = `
      <div class="input-icon"><i class="ri-search-line"></i><input class="input" id="na-search" type="search" placeholder="Search by name, phone or UHID"></div>
      <div id="na-results" style="margin-top:8px"></div>
      <p class="small" style="margin:8px 0 0">New patient? <a href="#" id="na-register">Register them now</a></p>`;
    const search = $('#na-search', m.el);
    const results = $('#na-results', m.el);
    search.focus();
    search.addEventListener(
      'input',
      debounce(async () => {
        const q = search.value.trim();
        if (q.length < 2) {
          results.innerHTML = '';
          return;
        }
        try {
          const list = await api(`/admin/patients?q=${encodeURIComponent(q)}`);
          results.innerHTML = list.length
            ? list
                .slice(0, 8)
                .map(
                  (p) => `<button type="button" class="doctor-option" style="width:100%;margin-bottom:6px" data-pick="${esc(p.id)}">${avatar(p.name)}<div><strong>${esc(p.name)}</strong><span>UHID ${esc(p.uhid)} · ${esc(p.phone || 'no phone')}${p.guardian ? ` · family of ${esc(p.guardian.name)}` : ''}</span></div></button>`
                )
                .join('')
            : '<p class="muted small">No matching patient. Register them below.</p>';
          $$('[data-pick]', results).forEach((b) =>
            b.addEventListener('click', () => {
              patient = list.find((p) => p.id === b.dataset.pick);
              renderPatient();
            })
          );
        } catch (err) {
          results.innerHTML = errorHtml(err);
        }
      }, 300)
    );
    $('#na-register', m.el).addEventListener('click', (e) => {
      e.preventDefault();
      patientForm(null, (created) => {
        patient = created;
        renderPatient();
      });
    });
  };
  renderPatient();

  save.addEventListener('click', async () => {
    if (!patient) {
      toast('Choose or register the patient first.', 'error');
      return;
    }
    await withLoading(save, async () => {
      try {
        const appt = await api('/appointments', {
          method: 'POST',
          body: { patient: patient.id, doctor: doctorSel.value, date: $('#na-date', m.el).value, time: $('#na-time', m.el).value, reason: $('#na-reason', m.el).value.trim() },
        });
        m.close();
        openModal({
          title: 'Appointment booked',
          body: `<div class="success-box"><div class="success-icon"><i class="ri-check-line"></i></div><div class="appt-no">${esc(appt.appointmentNo)}</div>
            <p>${esc(appt.patient.name)} with ${esc(appt.doctor.name)} on <strong>${esc(fmtDate(appt.date))}, ${esc(fmtTime(appt.time))}</strong>.</p></div>`,
          footer: `<a class="btn btn-primary" href="slip.html?id=${encodeURIComponent(appt.id)}"><i class="ri-printer-line"></i>Print slip</a>`,
        });
        if (!$('[data-view=appointments]').classList.contains('hidden')) loadAppointments();
      } catch (err) {
        toast(err.message, 'error', 6000);
      }
    });
  });
}

/* ---------------- Doctors ---------------- */

function renderDoctors() {
  const q = $('#doc-q').value.trim().toLowerCase();
  const rows = A.doctors.filter(
    (d) => !q || [d.name, d.specialization, d.email, d.department && d.department.name].filter(Boolean).some((x) => x.toLowerCase().includes(q))
  );
  const box = $('#doctor-table');
  box.innerHTML = rows.length
    ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Doctor</th><th>Department</th><th>Fee</th><th>OPD days</th><th>Rating</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows
        .map((d) => {
          const days = [...new Set(d.schedule.map((s) => s.day))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
          return `<tr>
            <td><div style="display:flex;gap:10px;align-items:center">${avatar(d.name, '', d.photo)}<div><div class="cell-main">${esc(d.name)}</div><div class="cell-sub">${esc(d.specialization)} · ${esc(d.email || '')}</div></div></div></td>
            <td>${esc(d.department ? d.department.name : '—')}</td>
            <td>${esc(fmtMoney(d.consultationFee))}</td>
            <td class="small">${esc(days.map((x) => DAYS[x].slice(0, 3)).join(', ') || '—')}${d.leaves.length ? `<div class="cell-sub" style="color:var(--warning)">${d.leaves.length} leave period${d.leaves.length > 1 ? 's' : ''}</div>` : ''}</td>
            <td class="small">${d.rating.count ? `${starsHtml(d.rating.average, { small: true })}<div class="cell-sub">${esc(d.rating.average)} (${esc(d.rating.count)})</div>` : '<span class="muted">—</span>'}</td>
            <td>${d.active ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Inactive</span>'}</td>
            <td><div class="actions">
              <button type="button" class="btn btn-ghost btn-sm" data-edit-doc="${esc(d.id)}"><i class="ri-edit-line"></i>Edit</button>
              <button type="button" class="btn btn-ghost btn-sm" data-leave-doc="${esc(d.id)}"><i class="ri-calendar-close-line"></i>Leave</button>
              ${d.active
                ? `<button type="button" class="btn btn-ghost btn-sm" data-deactivate="${esc(d.id)}" style="color:var(--danger)">Deactivate</button>`
                : `<button type="button" class="btn btn-ghost btn-sm" data-activate="${esc(d.id)}">Activate</button>`}
            </div></td>
          </tr>`;
        })
        .join('')}</tbody></table></div>`
    : emptyHtml('ri-stethoscope-line', q ? 'No matching doctors' : 'No doctors yet', '', q ? '' : '<button type="button" class="btn btn-primary" data-add-doc>Add the first doctor</button>');

  $$('[data-edit-doc]', box).forEach((b) => b.addEventListener('click', () => doctorForm(A.doctors.find((d) => d.id === b.dataset.editDoc))));
  $$('[data-leave-doc]', box).forEach((b) => b.addEventListener('click', () => leaveManager(A.doctors.find((d) => d.id === b.dataset.leaveDoc))));
  $$('[data-add-doc]', box).forEach((b) => b.addEventListener('click', () => doctorForm()));
  $$('[data-deactivate]', box).forEach((b) =>
    b.addEventListener('click', async () => {
      const d = A.doctors.find((x) => x.id === b.dataset.deactivate);
      const ok = await confirmDialog(
        `Deactivate ${d.name}? They will be hidden from the website, and all of their upcoming appointments will be cancelled (patients are emailed).`,
        { title: 'Deactivate doctor', confirmText: 'Deactivate', danger: true }
      );
      if (!ok) return;
      try {
        const res = await api(`/doctors/${d.id}`, { method: 'DELETE' });
        toast(`${d.name} deactivated. ${res.cancelledAppointments} upcoming appointment(s) cancelled.`, 'success', 7000);
        await loadDoctors(true);
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
  $$('[data-activate]', box).forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api(`/doctors/${b.dataset.activate}`, { method: 'PUT', body: { active: true } });
        toast('Doctor reactivated.', 'success');
        await loadDoctors(true);
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
}

async function loadDoctors(force = false) {
  if (force || !A.loaded.has('ref')) {
    $('#doctor-table').innerHTML = loaderHtml();
    try {
      await loadReferenceData();
    } catch (err) {
      $('#doctor-table').innerHTML = errorHtml(err);
      return;
    }
  }
  renderDoctors();
}

function scheduleRowHtml(s = { day: 1, start: '09:00', end: '13:00' }) {
  return `<div class="row">
    <select class="input" data-s="day" aria-label="Day">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}" ${d === s.day ? 'selected' : ''}>${DAYS[d]}</option>`).join('')}</select>
    <input class="input" type="time" data-s="start" value="${esc(s.start)}" aria-label="Start time" required>
    <input class="input" type="time" data-s="end" value="${esc(s.end)}" aria-label="End time" required>
    <button type="button" class="btn btn-ghost btn-sm" data-remove-row aria-label="Remove"><i class="ri-delete-bin-line"></i></button>
  </div>`;
}

function doctorForm(d = null) {
  const editing = Boolean(d);
  const deptOptions = A.departments
    .map((x) => `<option value="${esc(x._id)}" ${d && d.department && String(d.department.id) === String(x._id) ? 'selected' : ''}>${esc(x.name)}${x.active ? '' : ' (inactive)'}</option>`)
    .join('');
  const m = openModal({
    title: editing ? `Edit ${d.name}` : 'Add a doctor',
    size: 'modal-lg',
    body: `
      ${editing ? `<div style="display:flex;gap:16px;align-items:center;margin-bottom:20px" id="photo-box">
        <span id="photo-preview">${avatar(d.name, 'avatar-lg', d.photo)}</span>
        <div>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer"><i class="ri-image-add-line"></i>${d.photo ? 'Change photo' : 'Upload photo'}<input type="file" id="photo-file" accept="image/jpeg,image/png,image/webp" class="sr-only"></label>
          ${d.photo ? '<button type="button" class="btn btn-ghost btn-sm" id="photo-remove" style="color:var(--danger)">Remove</button>' : ''}
          <div class="hint small muted">Square JPG, PNG or WebP, up to 2 MB.</div>
        </div>
      </div>` : '<p class="muted small">You can add a photo after creating the doctor.</p>'}
      <form id="doctor-form" class="form-grid" novalidate>
        <div class="field"><label>Full name <span class="req">*</span></label><input name="name" required minlength="5" value="${esc(d ? d.name : '')}" placeholder="Dr. Full Name"></div>
        <div class="field"><label>Department <span class="req">*</span></label><select name="department" required><option value="">Select…</option>${deptOptions}</select></div>
        <div class="field"><label>Login email <span class="req">*</span></label><input name="email" type="email" required value="${esc(d ? d.email : '')}"></div>
        <div class="field"><label>${editing ? 'New password (leave blank to keep)' : 'Password <span class="req">*</span>'}</label><input name="password" type="password" ${editing ? '' : 'required'} minlength="8" pattern="(?=.*[A-Za-z])(?=.*\\d).{8,64}" autocomplete="new-password"><span class="hint">8+ characters with a letter and a number.</span></div>
        <div class="field"><label>Specialization <span class="req">*</span></label><input name="specialization" required value="${esc(d ? d.specialization : '')}" placeholder="e.g. Interventional Cardiologist"></div>
        <div class="field"><label>Qualifications</label><input name="qualifications" value="${esc(d ? d.qualifications : '')}" placeholder="e.g. MBBS, MD, DM"></div>
        <div class="field"><label>Experience (years)</label><input name="experienceYears" type="number" min="0" max="70" value="${esc(d ? d.experienceYears : 0)}"></div>
        <div class="field"><label>Consultation fee (₹)</label><input name="consultationFee" type="number" min="0" step="50" value="${esc(d ? d.consultationFee : 500)}"></div>
        <div class="field"><label>Gender</label><select name="gender"><option value="">—</option>${['female', 'male', 'other'].map((g) => `<option value="${g}" ${d && d.gender === g ? 'selected' : ''}>${cap(g)}</option>`).join('')}</select></div>
        <div class="field"><label>Slot length</label><select name="slotMinutes">${[10, 15, 20, 30].map((n) => `<option value="${n}" ${(d ? d.slotMinutes : 15) === n ? 'selected' : ''}>${n} minutes</option>`).join('')}</select></div>
        <div class="field full"><label>Languages</label><input name="languages" value="${esc(d ? d.languages.join(', ') : 'English')}" placeholder="Comma separated"></div>
        <div class="field full"><label>Short bio</label><textarea name="bio" rows="3" maxlength="2000">${esc(d ? d.bio : '')}</textarea></div>
        <div class="field full schedule-editor">
          <label>Weekly OPD timings</label>
          <div id="schedule-rows">${(d && d.schedule.length ? d.schedule : [{ day: 1, start: '09:00', end: '13:00' }]).map(scheduleRowHtml).join('')}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="add-row" style="align-self:flex-start"><i class="ri-add-line"></i>Add timing</button>
        </div>
      </form>`,
    footer: `<button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="button" class="btn btn-primary" data-save>${editing ? 'Save changes' : 'Add doctor'}</button>`,
  });

  const rows = $('#schedule-rows', m.el);
  const bindRemove = () => $$('[data-remove-row]', rows).forEach((b) => (b.onclick = () => b.closest('.row').remove()));
  bindRemove();
  $('#add-row', m.el).addEventListener('click', () => {
    rows.insertAdjacentHTML('beforeend', scheduleRowHtml());
    bindRemove();
  });
  $('[data-close]', m.el).addEventListener('click', m.close);

  if (editing) {
    $('#photo-file', m.el).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        toast('The photo is larger than 2 MB.', 'error');
        return;
      }
      try {
        const res = await api(`/doctors/${d.id}/photo`, { method: 'PUT', body: { data: await readFileAsDataUrl(file) } });
        d.photo = res.photo;
        $('#photo-preview', m.el).innerHTML = avatar(d.name, 'avatar-lg', d.photo);
        toast('Photo updated.', 'success');
        loadReferenceData().then(renderDoctors).catch(() => {});
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    const remove = $('#photo-remove', m.el);
    if (remove) {
      remove.addEventListener('click', async () => {
        try {
          await api(`/doctors/${d.id}/photo`, { method: 'DELETE' });
          d.photo = '';
          $('#photo-preview', m.el).innerHTML = avatar(d.name, 'avatar-lg');
          remove.remove();
          toast('Photo removed.', 'success');
          loadReferenceData().then(renderDoctors).catch(() => {});
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
  }

  $('[data-save]', m.el).addEventListener('click', async (e) => {
    const form = $('#doctor-form', m.el);
    if (!validateForm(form)) return;
    const f = formData(form);
    const schedule = $$('.row', rows).map((r) => ({
      day: Number($('[data-s=day]', r).value),
      start: $('[data-s=start]', r).value,
      end: $('[data-s=end]', r).value,
    }));
    const bad = schedule.find((s) => !s.start || !s.end || s.start >= s.end);
    if (bad) {
      toast(`Check the ${DAYS[bad.day]} timing: the end time must be after the start time.`, 'error');
      return;
    }
    const body = {
      name: f.name,
      department: f.department,
      email: f.email,
      specialization: f.specialization,
      qualifications: f.qualifications,
      experienceYears: Number(f.experienceYears || 0),
      consultationFee: Number(f.consultationFee || 0),
      gender: f.gender,
      slotMinutes: Number(f.slotMinutes),
      languages: f.languages.split(',').map((s) => s.trim()).filter(Boolean),
      bio: f.bio,
      schedule,
    };
    if (f.password) body.password = f.password;

    await withLoading(e.currentTarget, async () => {
      try {
        await api(editing ? `/doctors/${d.id}` : '/doctors', { method: editing ? 'PUT' : 'POST', body });
        m.close();
        toast(editing ? 'Doctor updated.' : 'Doctor added. Edit them to upload a photo; they can log in with the email and password you set.', 'success', 7000);
        await loadDoctors(true);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

function leaveManager(d) {
  const m = openModal({
    title: `Leave · ${d.name}`,
    body: `
      <ul class="info-list leave-list" id="lv-list">${d.leaves.length
        ? d.leaves.map((l) => `<li><span><strong>${esc(l.from === l.to ? fmtDate(l.from) : `${fmtDate(l.from)} – ${fmtDate(l.to)}`)}</strong>${l.reason ? ` <span class="muted">· ${esc(l.reason)}</span>` : ''}</span><button type="button" class="btn btn-ghost btn-sm" data-rm="${esc(l.id)}">Remove</button></li>`).join('')
        : '<li class="muted">No upcoming leave.</li>'}</ul>
      <form id="lv-form" class="form-grid" style="margin-top:16px" novalidate>
        <div class="field"><label>From</label><input name="from" type="date" required min="${todayStr()}"></div>
        <div class="field"><label>To</label><input name="to" type="date" required min="${todayStr()}"></div>
        <div class="field full"><label>Reason (staff only)</label><input name="reason" maxlength="120"></div>
      </form>
      <p class="muted small mb-0">Appointments already booked in the period are cancelled and the patients emailed.</p>`,
    footer: `<button type="button" class="btn btn-ghost" data-close>Close</button><button type="button" class="btn btn-primary" data-add>Add leave</button>`,
  });
  const form = $('#lv-form', m.el);
  form.from.addEventListener('change', () => {
    if (!form.to.value || form.to.value < form.from.value) form.to.value = form.from.value;
    form.to.min = form.from.value;
  });
  $('[data-close]', m.el).addEventListener('click', m.close);
  const refresh = async () => {
    await loadReferenceData();
    renderDoctors();
    m.close();
    leaveManager(A.doctors.find((x) => x.id === d.id));
  };
  $$('[data-rm]', m.el).forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api(`/doctors/${d.id}/leaves/${b.dataset.rm}`, { method: 'DELETE' });
        toast('Leave removed.', 'success');
        refresh();
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
  $('[data-add]', m.el).addEventListener('click', async (e) => {
    if (!validateForm(form)) return;
    const body = formData(form);
    await withLoading(e.currentTarget, async () => {
      try {
        const { count } = await api(`/doctors/${d.id}/leaves/impact?from=${body.from}&to=${body.to}`);
        if (count && !(await confirmDialog(`${count} booked appointment${count > 1 ? 's' : ''} will be cancelled and the patients emailed. Continue?`, { title: 'Add leave', confirmText: 'Add leave', danger: true }))) return;
        const res = await api(`/doctors/${d.id}/leaves`, { method: 'POST', body });
        toast(res.cancelledAppointments ? `Leave added. ${res.cancelledAppointments} appointment(s) cancelled.` : 'Leave added.', 'success', 6000);
        refresh();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

/* ---------------- Departments ---------------- */

async function loadDepartments() {
  const box = $('#dept-table');
  box.innerHTML = loaderHtml();
  try {
    await loadReferenceData();
  } catch (err) {
    box.innerHTML = errorHtml(err);
    return;
  }
  box.innerHTML = A.departments.length
    ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Department</th><th>Doctors</th><th>Services</th><th>Status</th><th></th></tr></thead>
      <tbody>${A.departments
        .map(
          (x) => `<tr>
          <td><div style="display:flex;gap:12px;align-items:center"><span class="dept-icon" style="width:40px;height:40px;font-size:1.2rem;margin:0"><i class="${esc(x.icon)}"></i></span><div><div class="cell-main">${esc(x.name)}</div><div class="cell-sub">${esc(x.summary)}</div></div></div></td>
          <td>${esc(x.doctorCount)}${x.totalDoctorCount > x.doctorCount ? `<div class="cell-sub">+${esc(x.totalDoctorCount - x.doctorCount)} inactive</div>` : ''}</td>
          <td class="small">${esc((x.services || []).length)}</td>
          <td>${x.active ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Hidden</span>'}</td>
          <td><div class="actions">
            <button type="button" class="btn btn-ghost btn-sm" data-edit-dept="${esc(x._id)}"><i class="ri-edit-line"></i>Edit</button>
            <button type="button" class="btn btn-ghost btn-sm" data-del-dept="${esc(x._id)}" style="color:var(--danger)"><i class="ri-delete-bin-line"></i></button>
          </div></td>
        </tr>`
        )
        .join('')}</tbody></table></div>`
    : emptyHtml('ri-hospital-line', 'No departments yet');

  $$('[data-edit-dept]', box).forEach((b) => b.addEventListener('click', () => departmentForm(A.departments.find((x) => x._id === b.dataset.editDept))));
  $$('[data-del-dept]', box).forEach((b) =>
    b.addEventListener('click', async () => {
      const x = A.departments.find((y) => y._id === b.dataset.delDept);
      const ok = await confirmDialog(`Delete the ${x.name} department permanently?`, { title: 'Delete department', confirmText: 'Delete', danger: true });
      if (!ok) return;
      try {
        await api(`/departments/${x._id}`, { method: 'DELETE' });
        toast('Department deleted.', 'success');
        loadDepartments();
      } catch (err) {
        toast(err.message, 'error', 8000);
      }
    })
  );
}

const ICON_CHOICES = ['ri-heart-pulse-line', 'ri-brain-line', 'ri-walk-line', 'ri-parent-line', 'ri-women-line', 'ri-stethoscope-line', 'ri-user-heart-line', 'ri-eye-line', 'ri-microscope-line', 'ri-first-aid-kit-line', 'ri-capsule-line', 'ri-lungs-line', 'ri-syringe-line', 'ri-test-tube-line', 'ri-hospital-line', 'ri-mental-health-line'];

function departmentForm(x = null) {
  const editing = Boolean(x);
  const current = x ? x.icon : ICON_CHOICES[0];
  const m = openModal({
    title: editing ? `Edit ${x.name}` : 'Add a department',
    size: 'modal-lg',
    body: `
      <form id="dept-form" class="form-grid" novalidate>
        <div class="field"><label>Name <span class="req">*</span></label><input name="name" required minlength="2" maxlength="80" value="${esc(x ? x.name : '')}"></div>
        <div class="field"><label>Icon</label><select name="icon">${ICON_CHOICES.map((i) => `<option value="${i}" ${i === current ? 'selected' : ''}>${i.replace(/^ri-|-line$/g, '').replace(/-/g, ' ')}</option>`).join('')}</select></div>
        <div class="field full"><label>Short summary <span class="req">*</span></label><input name="summary" required minlength="5" maxlength="200" value="${esc(x ? x.summary : '')}"><span class="hint">Shown on department cards (max 200 characters).</span></div>
        <div class="field full"><label>Description</label><textarea name="description" rows="4" maxlength="3000">${esc(x ? x.description : '')}</textarea></div>
        <div class="field full"><label>Services &amp; procedures</label><textarea name="services" rows="4" placeholder="One per line">${esc(x ? (x.services || []).join('\n') : '')}</textarea></div>
        <label class="checkbox full"><input type="checkbox" name="active" ${!x || x.active ? 'checked' : ''}><span>Show this department on the website</span></label>
      </form>`,
    footer: `<button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="button" class="btn btn-primary" data-save>${editing ? 'Save changes' : 'Add department'}</button>`,
  });
  $('[data-close]', m.el).addEventListener('click', m.close);
  $('[data-save]', m.el).addEventListener('click', async (e) => {
    const form = $('#dept-form', m.el);
    if (!validateForm(form)) return;
    const f = formData(form);
    const body = {
      name: f.name,
      icon: f.icon,
      summary: f.summary,
      description: f.description,
      services: f.services.split('\n').map((s) => s.trim()).filter(Boolean),
      active: form.active.checked,
    };
    await withLoading(e.currentTarget, async () => {
      try {
        await api(editing ? `/departments/${x._id}` : '/departments', { method: editing ? 'PUT' : 'POST', body });
        m.close();
        toast(editing ? 'Department updated.' : 'Department added.', 'success');
        loadDepartments();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

/* ---------------- Patients ---------------- */

let patientCache = [];

async function loadPatients() {
  const box = $('#patient-table');
  box.innerHTML = loaderHtml();
  try {
    const q = $('#patient-q').value.trim();
    patientCache = await api(`/admin/patients${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    box.innerHTML = patientCache.length
      ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>UHID</th><th>Patient</th><th>Contact</th><th>Age / gender</th><th>Visits</th><th>Last visit</th><th></th></tr></thead>
        <tbody>${patientCache
          .map(
            (p) => `<tr>
            <td class="nowrap"><strong>${esc(p.uhid || '—')}</strong></td>
            <td><div class="cell-main">${esc(p.name)}</div><div class="cell-sub">${p.guardian ? `${esc(RELATION_LABELS[p.relation] || 'Family')} of ${esc(p.guardian.name)}` : p.email ? 'Online account' : 'Front-desk registration'}${p.bloodGroup ? ` · Blood ${esc(p.bloodGroup)}` : ''}</div></td>
            <td><div>${esc(p.phone || '—')}</div><div class="cell-sub">${esc(p.email || '')}</div></td>
            <td>${esc(p.dateOfBirth ? `${age(p.dateOfBirth)} yrs` : '—')} / ${esc(cap(p.gender) || '—')}</td>
            <td>${esc(p.appointmentCount)}</td>
            <td class="nowrap">${esc(p.lastVisit ? fmtDate(p.lastVisit, { day: 'numeric', month: 'short', year: 'numeric' }) : '—')}</td>
            <td><div class="actions">
              <button type="button" class="btn btn-primary btn-sm" data-book-patient="${esc(p.id)}">Book</button>
              <button type="button" class="btn btn-ghost btn-sm" data-reports-patient="${esc(p.id)}" title="Reports"><i class="ri-file-pdf-2-line"></i></button>
              ${p.guardian ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-edit-patient="${esc(p.id)}" title="Edit"><i class="ri-edit-line"></i></button>`}
            </div></td>
          </tr>`
          )
          .join('')}</tbody></table></div>`
      : emptyHtml('ri-group-line', q ? 'No matching patients' : 'No patients registered yet');
    const find = (id) => patientCache.find((p) => p.id === id);
    $$('[data-book-patient]', box).forEach((b) => b.addEventListener('click', () => newAppointment(find(b.dataset.bookPatient))));
    $$('[data-reports-patient]', box).forEach((b) => b.addEventListener('click', () => patientReportsModal(find(b.dataset.reportsPatient))));
    $$('[data-edit-patient]', box).forEach((b) => b.addEventListener('click', () => patientForm(find(b.dataset.editPatient), () => loadPatients())));
  } catch (err) {
    box.innerHTML = errorHtml(err);
  }
}

/** Register (p = null) or edit a patient. onSaved receives the saved patient. */
function patientForm(p, onSaved) {
  const m = openModal({
    title: p ? `Edit ${p.name}` : 'Register a patient',
    body: `
      <form id="pt-form" class="form-grid" novalidate>
        <div class="field full"><label>Full name <span class="req">*</span></label><input name="name" required minlength="2" maxlength="80" value="${esc(p ? p.name : '')}"></div>
        <div class="field"><label>Mobile number <span class="req">*</span></label><input name="phone" type="tel" required pattern="[+\\d][\\d\\s\\-]{6,18}" value="${esc(p ? p.phone : '')}"></div>
        <div class="field"><label>Email <span class="muted">(optional)</span></label><input name="email" type="email" value="${esc(p ? p.email : '')}"><span class="hint">With an email, they can set a password later via "Forgot password".</span></div>
        <div class="field"><label>Date of birth</label><input name="dateOfBirth" type="date" max="${todayStr()}" value="${esc(p ? p.dateOfBirth : '')}"></div>
        <div class="field"><label>Gender</label><select name="gender"><option value="">—</option>${['female', 'male', 'other'].map((g) => `<option value="${g}" ${p && p.gender === g ? 'selected' : ''}>${cap(g)}</option>`).join('')}</select></div>
        <div class="field"><label>Blood group</label><select name="bloodGroup"><option value="">Unknown</option>${['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => `<option ${p && p.bloodGroup === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
        <div class="field full"><label>Address</label><input name="address" maxlength="300" value="${esc(p ? p.address : '')}"></div>
      </form>`,
    footer: `<button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="button" class="btn btn-primary" data-save>${p ? 'Save' : 'Register'}</button>`,
  });
  $('[data-close]', m.el).addEventListener('click', m.close);
  $('[data-save]', m.el).addEventListener('click', async (e) => {
    const form = $('#pt-form', m.el);
    if (!validateForm(form)) return;
    await withLoading(e.currentTarget, async () => {
      try {
        const saved = await api(p ? `/admin/patients/${p.id}` : '/admin/patients', { method: p ? 'PUT' : 'POST', body: formData(form) });
        m.close();
        toast(p ? 'Patient updated.' : `Registered. UHID ${saved.uhid}.`, 'success', 6000);
        if (onSaved) onSaved(saved);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

/* ---------------- Health check-ups ---------------- */

async function loadCheckups() {
  const box = $('#chk-box');
  box.innerHTML = loaderHtml();
  try {
    // `await` so a failure shows in the error box below instead of a stuck spinner.
    if (A.chkFilter === 'packages') return await renderPackages(box);
    const list = await api(`/packages/bookings${A.chkFilter ? `?status=${A.chkFilter}` : ''}`);
    if (A.chkFilter === 'requested') setBadge('#chk-count', list.length);
    box.innerHTML = list.length
      ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Booking</th><th>Date</th><th>Patient</th><th>Package</th><th>Status</th></tr></thead>
        <tbody>${list
          .map(
            (b) => `<tr>
            <td><strong>${esc(b.bookingNo)}</strong><div class="cell-sub">${esc(fmtMoney(b.price))}</div></td>
            <td class="nowrap">${esc(fmtDate(b.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</td>
            <td><div class="cell-main">${esc(b.patient.name)}</div><div class="cell-sub">${esc([b.patient.uhid, b.patient.phone].filter(Boolean).join(' · '))}</div>${b.notes ? `<div class="cell-sub">Note: ${esc(b.notes)}</div>` : ''}</td>
            <td>${esc(b.package ? b.package.name : '—')}</td>
            <td><select class="input" data-chk-status="${esc(b.id)}" style="padding:4px 8px;font-size:0.85rem;width:auto">${['requested', 'confirmed', 'completed', 'cancelled']
              .map((s) => `<option value="${s}" ${s === b.status ? 'selected' : ''}>${cap(s)}</option>`)
              .join('')}</select></td>
          </tr>`
          )
          .join('')}</tbody></table></div>`
      : emptyHtml('ri-heart-pulse-line', A.chkFilter === 'requested' ? 'No new check-up requests' : 'No bookings');
    $$('[data-chk-status]', box).forEach((sel) => {
      const original = sel.value;
      sel.addEventListener('change', async () => {
        if (sel.value === 'cancelled' && !(await confirmDialog('Cancel this check-up booking? The patient will be emailed.', { title: 'Cancel check-up', confirmText: 'Yes, cancel', danger: true }))) {
          sel.value = original;
          return;
        }
        try {
          await api(`/packages/bookings/${sel.dataset.chkStatus}/status`, { method: 'PATCH', body: { status: sel.value } });
          toast(sel.value === 'confirmed' ? 'Confirmed. The patient has been emailed.' : 'Status updated.', 'success');
          loadCheckups();
        } catch (err) {
          sel.value = original;
          toast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    box.innerHTML = errorHtml(err);
  }
}

async function renderPackages(box) {
  A.packages = await api('/packages?all=true');
  box.innerHTML = A.packages.length
    ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Package</th><th>Price</th><th>Tests</th><th>Status</th><th></th></tr></thead>
      <tbody>${A.packages
        .map(
          (p) => `<tr>
          <td><div class="cell-main">${esc(p.name)}</div><div class="cell-sub">${esc(p.summary)}</div></td>
          <td class="nowrap">${esc(fmtMoney(p.price))}${p.originalPrice ? `<div class="cell-sub"><s>${esc(fmtMoney(p.originalPrice))}</s></div>` : ''}</td>
          <td>${esc((p.tests || []).length)}</td>
          <td>${p.active ? '<span class="badge badge-active">On website</span>' : '<span class="badge badge-inactive">Hidden</span>'}</td>
          <td><div class="actions">
            <button type="button" class="btn btn-ghost btn-sm" data-edit-pkg="${esc(p._id)}"><i class="ri-edit-line"></i>Edit</button>
            <button type="button" class="btn btn-ghost btn-sm" data-del-pkg="${esc(p._id)}" style="color:var(--danger)"><i class="ri-delete-bin-line"></i></button>
          </div></td>
        </tr>`
        )
        .join('')}</tbody></table></div>`
    : emptyHtml('ri-heart-pulse-line', 'No packages yet');
  $$('[data-edit-pkg]', box).forEach((b) => b.addEventListener('click', () => packageForm(A.packages.find((p) => p._id === b.dataset.editPkg))));
  $$('[data-del-pkg]', box).forEach((b) =>
    b.addEventListener('click', async () => {
      const p = A.packages.find((x) => x._id === b.dataset.delPkg);
      if (!(await confirmDialog(`Delete the "${p.name}" package?`, { title: 'Delete package', confirmText: 'Delete', danger: true }))) return;
      try {
        await api(`/packages/${p._id}`, { method: 'DELETE' });
        toast('Package deleted.', 'success');
        loadCheckups();
      } catch (err) {
        toast(err.message, 'error', 7000);
      }
    })
  );
}

function packageForm(p = null) {
  const m = openModal({
    title: p ? `Edit ${p.name}` : 'Add a health package',
    size: 'modal-lg',
    body: `
      <form id="pkg-form" class="form-grid" novalidate>
        <div class="field"><label>Name <span class="req">*</span></label><input name="name" required minlength="2" maxlength="80" value="${esc(p ? p.name : '')}"></div>
        <div class="field"><label>Recommended for</label><input name="recommendedFor" maxlength="120" value="${esc(p ? p.recommendedFor : '')}" placeholder="e.g. Adults 30+"></div>
        <div class="field full"><label>Summary <span class="req">*</span></label><input name="summary" required minlength="5" maxlength="200" value="${esc(p ? p.summary : '')}"></div>
        <div class="field"><label>Price (₹) <span class="req">*</span></label><input name="price" type="number" min="0" step="1" required value="${esc(p ? p.price : '')}"></div>
        <div class="field"><label>Original price (₹) <span class="muted">(to show a discount)</span></label><input name="originalPrice" type="number" min="0" step="1" value="${esc(p && p.originalPrice ? p.originalPrice : '')}"></div>
        <div class="field full"><label>Tests included</label><textarea name="tests" rows="6" placeholder="One per line">${esc(p ? (p.tests || []).join('\n') : '')}</textarea></div>
        <div class="field full"><label>Preparation</label><input name="preparation" maxlength="500" value="${esc(p ? p.preparation : '')}" placeholder="e.g. 10–12 hours fasting"></div>
        <label class="checkbox full"><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}><span>Show on website</span></label>
      </form>`,
    footer: `<button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="button" class="btn btn-primary" data-save>${p ? 'Save' : 'Add package'}</button>`,
  });
  $('[data-close]', m.el).addEventListener('click', m.close);
  $('[data-save]', m.el).addEventListener('click', async (e) => {
    const form = $('#pkg-form', m.el);
    if (!validateForm(form)) return;
    const f = formData(form);
    const body = {
      name: f.name,
      summary: f.summary,
      recommendedFor: f.recommendedFor,
      price: Number(f.price),
      originalPrice: f.originalPrice ? Number(f.originalPrice) : null,
      tests: f.tests.split('\n').map((s) => s.trim()).filter(Boolean),
      preparation: f.preparation,
      active: form.active.checked,
    };
    await withLoading(e.currentTarget, async () => {
      try {
        await api(p ? `/packages/${p._id}` : '/packages', { method: p ? 'PUT' : 'POST', body });
        m.close();
        toast(p ? 'Package updated.' : 'Package added.', 'success');
        A.chkFilter = 'packages';
        $$('[data-chk]').forEach((x) => x.classList.toggle('active', x.dataset.chk === 'packages'));
        loadCheckups();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

/* ---------------- Holidays ---------------- */

async function loadHolidays() {
  const box = $('#holiday-list');
  box.innerHTML = loaderHtml();
  $('#h-date').min = todayStr();
  try {
    const list = await api('/holidays');
    box.innerHTML = list.length
      ? `<h3 style="margin-top:0">Upcoming holidays</h3><ul class="info-list leave-list">${list
          .map((h) => `<li><span><strong>${esc(fmtDate(h.date))}</strong> · ${esc(h.name)}</span><button type="button" class="btn btn-ghost btn-sm" data-del-holiday="${esc(h._id)}">Remove</button></li>`)
          .join('')}</ul>`
      : emptyHtml('ri-calendar-check-line', 'No upcoming holidays');
    $$('[data-del-holiday]', box).forEach((b) =>
      b.addEventListener('click', async () => {
        if (!(await confirmDialog('Remove this holiday? The day will open for booking again.', { confirmText: 'Remove' }))) return;
        try {
          await api(`/holidays/${b.dataset.delHoliday}`, { method: 'DELETE' });
          toast('Holiday removed.', 'success');
          loadHolidays();
        } catch (err) {
          toast(err.message, 'error');
        }
      })
    );
  } catch (err) {
    box.innerHTML = errorHtml(err);
  }
}

/* ---------------- Enquiries ---------------- */

async function loadEnquiries() {
  const box = $('#enq-list');
  box.innerHTML = loaderHtml();
  try {
    const list = await api(`/enquiries${A.enqFilter ? `?status=${A.enqFilter}` : ''}`);
    if (A.enqFilter === 'new') setBadge('#enq-count', list.length);
    box.innerHTML = list.length
      ? list
          .map(
            (e) => `<article class="card">
          <div class="dash-title" style="margin-bottom:6px">
            <div><h3 class="mb-0">${esc(e.subject)} ${statusBadge(e.status)}</h3>
            <div class="muted small">${esc(e.name)} · <a href="mailto:${esc(e.email)}">${esc(e.email)}</a>${e.phone ? ` · <a href="tel:${esc(e.phone.replace(/\s/g, ''))}">${esc(e.phone)}</a>` : ''} · ${esc(new Date(e.createdAt).toLocaleString('en-IN'))}</div></div>
            <button type="button" class="btn ${e.status === 'new' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-enq-id="${esc(e._id)}" data-enq-to="${e.status === 'new' ? 'resolved' : 'new'}">${e.status === 'new' ? '<i class="ri-check-line"></i>Mark resolved' : 'Reopen'}</button>
          </div>
          <p class="mb-0" style="white-space:pre-wrap">${esc(e.message)}</p>
        </article>`
          )
          .join('')
      : emptyHtml('ri-mail-check-line', A.enqFilter === 'new' ? 'No new enquiries. All caught up!' : 'No enquiries');
    $$('[data-enq-id]', box).forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await api(`/enquiries/${b.dataset.enqId}`, { method: 'PATCH', body: { status: b.dataset.enqTo } });
          loadEnquiries();
          api('/admin/stats').then((s) => setBadge('#enq-count', s.totals.newEnquiries)).catch(() => {});
        } catch (err) {
          toast(err.message, 'error');
        }
      })
    );
  } catch (err) {
    box.innerHTML = errorHtml(err);
  }
}

/* ---------------- Start ---------------- */

document.addEventListener('DOMContentLoaded', async () => {
  if (!admin) return;
  $('#dash-user').innerHTML = `${avatar(admin.name)}<div><strong>${esc(admin.name)}</strong><small>Administrator</small></div>`;

  $$('.dash-nav [data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('[data-view=overview] [data-jump]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.jump)));
  $('#refresh-stats').addEventListener('click', loadOverview);

  const apptFilter = $('#appt-filter');
  const reloadAppts = () => {
    A.apptPage = 1;
    loadAppointments();
  };
  apptFilter.addEventListener('submit', (e) => {
    e.preventDefault();
    reloadAppts();
  });
  $('[name=q]', apptFilter).addEventListener('input', debounce(reloadAppts, 350));
  $$('select, input[type=date]', apptFilter).forEach((el) => el.addEventListener('change', reloadAppts));
  $('#appt-clear').addEventListener('click', () => {
    apptFilter.reset();
    reloadAppts();
  });
  $('#new-appt').addEventListener('click', () => newAppointment());
  $('#export-appts').addEventListener('click', (e) =>
    withLoading(e.currentTarget, () => downloadFile(`/admin/export/appointments.csv?${apptQuery()}`, 'appointments.csv').catch((err) => toast(err.message, 'error')))
  );

  $('#add-doctor').addEventListener('click', () => doctorForm());
  $('#doc-q').addEventListener('input', debounce(renderDoctors, 150));
  $('#add-dept').addEventListener('click', () => departmentForm());

  $('#patient-q').addEventListener('input', debounce(loadPatients, 350));
  $('#add-patient').addEventListener('click', () => patientForm(null, () => loadPatients()));
  $('#export-patients').addEventListener('click', (e) => {
    const q = $('#patient-q').value.trim();
    withLoading(e.currentTarget, () => downloadFile(`/admin/export/patients.csv${q ? `?q=${encodeURIComponent(q)}` : ''}`, 'patients.csv').catch((err) => toast(err.message, 'error')));
  });

  $('#add-package').addEventListener('click', () => packageForm());
  $$('[data-chk]').forEach((b) =>
    b.addEventListener('click', () => {
      A.chkFilter = b.dataset.chk;
      $$('[data-chk]').forEach((x) => x.classList.toggle('active', x === b));
      loadCheckups();
    })
  );

  const holidayForm = $('#holiday-form');
  holidayForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(holidayForm)) return;
    const body = formData(holidayForm);
    await withLoading($('button[type=submit]', holidayForm), async () => {
      try {
        const { count } = await api(`/holidays/impact?date=${body.date}`);
        if (count && !(await confirmDialog(`${count} appointment${count > 1 ? 's are' : ' is'} booked on ${fmtDate(body.date)}. ${count > 1 ? 'They' : 'It'} will be cancelled and the patients emailed. Continue?`, { title: 'Add holiday', confirmText: 'Add holiday', danger: true }))) return;
        const res = await api('/holidays', { method: 'POST', body });
        holidayForm.reset();
        toast(res.cancelledAppointments ? `Holiday added. ${res.cancelledAppointments} appointment(s) cancelled.` : 'Holiday added.', 'success', 6000);
        loadHolidays();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  $$('[data-enq]').forEach((b) =>
    b.addEventListener('click', () => {
      A.enqFilter = b.dataset.enq;
      $$('[data-enq]').forEach((x) => x.classList.toggle('active', x === b));
      loadEnquiries();
    })
  );

  // Doctor list is needed for the appointment filter on every tab.
  loadReferenceData().catch(() => {});

  const initial = location.hash.slice(1);
  showTab(TABS.includes(initial) ? initial : 'overview');
});
