// Online booking (4 steps) and rescheduling (?reschedule=<appointmentId>).
document.addEventListener('DOMContentLoaded', async () => {
  const state = { doctor: null, date: null, time: null, step: 1, patient: '' };
  const BOOKING_WINDOW_DAYS = 60;
  const rescheduleId = params.get('reschedule');
  let rescheduling = null; // the appointment being moved
  let doctors = [];
  let holidays = new Map(); // date -> name
  let family = [];

  const el = {
    dept: $('#b-dept'),
    q: $('#b-q'),
    doctors: $('#b-doctors'),
    dates: $('#b-dates'),
    dateOther: $('#b-date-other'),
    slots: $('#b-slots'),
    confirm: $('#b-confirm'),
    done: $('#b-done'),
  };

  /* ---------- Step navigation ---------- */

  function goto(step) {
    state.step = step;
    $$('[data-panel]').forEach((p) => p.classList.toggle('hidden', Number(p.dataset.panel) !== step));
    $$('.stepper-item').forEach((s) => {
      const n = Number(s.dataset.step);
      s.classList.toggle('active', n === step);
      s.classList.toggle('done', n < step);
    });
    if (step === 2) renderDates();
    if (step === 3) renderConfirm();
    updateSummary();
    syncUrl();
    const top = $('.stepper').getBoundingClientRect().top + window.scrollY - 100;
    if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' });
  }

  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => goto(Number(b.dataset.goto))));

  function updateSummary() {
    const d = state.doctor;
    $('#s-doctor').textContent = d ? d.name : '—';
    $('#s-dept').textContent = d && d.department ? d.department.name : '—';
    $('#s-date').textContent = state.date ? fmtDate(state.date) : '—';
    $('#s-time').textContent = state.time ? fmtTime(state.time) : '—';
    $('#s-fee').textContent = d ? fmtMoney(d.consultationFee) : '—';
  }

  // Keep choices in the URL so they survive the login round-trip.
  function syncUrl() {
    const u = new URLSearchParams();
    if (rescheduling) u.set('reschedule', rescheduling.id);
    else if (state.doctor) u.set('doctor', state.doctor.id);
    if (state.date && state.step >= 2) u.set('date', state.date);
    if (state.time && state.step >= 3) u.set('time', state.time);
    history.replaceState(null, '', `book.html${u.toString() ? `?${u}` : ''}`);
  }

  /* ---------- Step 1: doctor ---------- */

  function renderDoctors() {
    const term = el.q.value.trim().toLowerCase();
    const shown = doctors.filter(
      (d) =>
        (!el.dept.value || (d.department && d.department.slug === el.dept.value)) &&
        (!term || d.name.toLowerCase().includes(term) || d.specialization.toLowerCase().includes(term))
    );
    el.doctors.innerHTML = shown.length
      ? shown
          .map(
            (d) => `
        <button type="button" class="doctor-option ${state.doctor && state.doctor.id === d.id ? 'selected' : ''}" data-id="${esc(d.id)}">
          ${avatar(d.name, '', d.photo)}
          <div><strong>${esc(d.name)}</strong><span>${esc(d.specialization)} · ${esc(fmtMoney(d.consultationFee))}${d.rating && d.rating.count ? ` · ★ ${esc(d.rating.average.toFixed(1))}` : ''}</span></div>
        </button>`
          )
          .join('')
      : emptyHtml('ri-user-search-line', 'No doctors found', 'Try another department or name.');
    $$('.doctor-option', el.doctors).forEach((btn) =>
      btn.addEventListener('click', () => {
        const picked = doctors.find((d) => d.id === btn.dataset.id);
        if (!state.doctor || state.doctor.id !== picked.id) {
          state.date = null;
          state.time = null;
        }
        state.doctor = picked;
        goto(2);
      })
    );
  }

  /* ---------- Step 2: date & time ---------- */

  /** Why the doctor can't be booked on a day ('' if they can). */
  function closedReason(dateStr) {
    if (holidays.has(dateStr)) return `Hospital closed: ${holidays.get(dateStr)}`;
    if ((state.doctor.leaves || []).some((l) => l.from <= dateStr && dateStr <= l.to)) return 'Doctor on leave';
    if (!state.doctor.schedule.some((s) => s.day === parseDate(dateStr).getDay())) return 'Doctor not available';
    return '';
  }

  function renderDates() {
    const today = todayStr();
    el.dateOther.min = today;
    el.dateOther.max = addDays(today, BOOKING_WINDOW_DAYS);
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
    if (!state.date) state.date = days.find((d) => !closedReason(d)) || null;

    el.dates.innerHTML = days
      .map((day) => {
        const d = parseDate(day);
        const reason = closedReason(day);
        return `<button type="button" class="date-pill ${day === state.date ? 'selected' : ''}" data-date="${day}" ${reason ? `disabled title="${esc(reason)}"` : ''} role="option" aria-selected="${day === state.date}">
          <small>${day === today ? 'Today' : d.toLocaleDateString('en-IN', { weekday: 'short' })}</small>
          <strong>${d.getDate()}</strong>
          <small>${d.toLocaleDateString('en-IN', { month: 'short' })}</small>
        </button>`;
      })
      .join('');
    $$('.date-pill', el.dates).forEach((b) =>
      b.addEventListener('click', () => {
        state.date = b.dataset.date;
        state.time = null;
        renderDates();
      })
    );
    el.dateOther.value = state.date || '';
    loadSlots();
    updateSummary();
    syncUrl();
  }

  el.dateOther.addEventListener('change', () => {
    if (!el.dateOther.value) return;
    state.date = el.dateOther.value;
    state.time = null;
    renderDates();
  });

  let slotRequest = 0;
  async function loadSlots() {
    if (!state.date) {
      el.slots.innerHTML = emptyHtml('ri-calendar-close-line', 'No consultation days in the next two weeks', 'Choose a later date above.');
      return;
    }
    const req = ++slotRequest;
    el.slots.innerHTML = loaderHtml();
    try {
      const res = await api(`/doctors/${state.doctor.id}/slots?date=${state.date}`, { auth: false });
      if (req !== slotRequest) return; // a newer date was picked meanwhile
      if (!res.slots.length) {
        el.slots.innerHTML = emptyHtml('ri-calendar-close-line', 'No slots on this day', res.message || 'Please choose another date.');
        return;
      }
      const current = rescheduling && rescheduling.date === state.date ? rescheduling.time : null;
      const groups = [
        ['Morning', (t) => t < '12:00'],
        ['Afternoon', (t) => t >= '12:00' && t < '16:00'],
        ['Evening', (t) => t >= '16:00'],
      ];
      const free = res.slots.filter((s) => s.available).length;
      el.slots.innerHTML =
        `<p class="muted small" style="margin-top:16px">${free ? `${free} slot${free > 1 ? 's' : ''} available on ${esc(fmtDate(state.date))}` : 'All slots on this day are booked. Please choose another date.'}</p>` +
        groups
          .map(([label, test]) => {
            const items = res.slots.filter((s) => test(s.time));
            if (!items.length) return '';
            return `<div class="slot-group"><h4>${label}</h4><div class="slot-grid">${items
              .map((s) =>
                s.time === current
                  ? `<button type="button" class="slot" disabled title="Your current time">${esc(fmtTime(s.time))} ✓</button>`
                  : `<button type="button" class="slot ${s.time === state.time ? 'selected' : ''}" data-time="${esc(s.time)}" ${s.available ? '' : 'disabled aria-label="Booked"'}>${esc(fmtTime(s.time))}</button>`
              )
              .join('')}</div></div>`;
          })
          .join('');
      $$('.slot[data-time]', el.slots).forEach((b) =>
        b.addEventListener('click', () => {
          state.time = b.dataset.time;
          goto(3);
        })
      );
    } catch (err) {
      el.slots.innerHTML = errorHtml(err);
    }
  }

  /* ---------- Step 3: confirm ---------- */

  function loginPrompt() {
    const back = encodeURIComponent(`book.html?doctor=${state.doctor.id}&date=${state.date}&time=${state.time}`);
    el.confirm.innerHTML = `
      <div class="alert alert-info"><i class="ri-user-line"></i><div>Please log in or create a free patient account to confirm. Your selected slot will be kept.</div></div>
      <div class="hero-actions" style="margin:20px 0 0">
        <a class="btn btn-primary" href="login.html?next=${back}"><i class="ri-login-box-line"></i>Log in</a>
        <a class="btn btn-outline" href="register.html?next=${back}"><i class="ri-user-add-line"></i>Create account</a>
      </div>`;
  }

  function renderConfirm() {
    const user = Session.token ? Session.user : null;
    if (!user) return loginPrompt();
    if (user.role !== 'patient') {
      el.confirm.innerHTML = `<div class="alert alert-warning"><i class="ri-information-line"></i><div>You are logged in as ${esc(user.role)}. Online booking is for patient accounts.${user.role === 'admin' ? ' To book for a patient at the front desk, use <a href="admin.html#appointments">Admin → Appointments → New appointment</a>.' : ''}</div></div>`;
      return;
    }
    if (rescheduling) return renderRescheduleConfirm();

    const people = [{ id: '', label: `Myself (${user.name})`, uhid: user.uhid }].concat(
      family.map((f) => ({ id: f.id, label: `${f.name} (${RELATION_LABELS[f.relation] || 'Family'})`, uhid: f.uhid }))
    );
    el.confirm.innerHTML = `
      <form id="confirm-form">
        <div class="field" style="margin-bottom:14px">
          <label for="b-person">Who is this appointment for?</label>
          <select id="b-person" name="patient">${people.map((p) => `<option value="${esc(p.id)}" ${p.id === state.patient ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
          ${user.guardian ? '' : '<span class="hint">Booking for a child or parent? <a href="portal.html#family">Add a family member</a> first.</span>'}
        </div>
        <ul class="summary-list">
          <li><span>UHID</span><span id="b-uhid">—</span></li>
          <li><span>Contact phone</span><span>${esc(user.phone || '—')}</span></li>
          <li><span>Doctor</span><span>${esc(state.doctor.name)}</span></li>
          <li><span>When</span><span>${esc(fmtDate(state.date))}, ${esc(fmtTime(state.time))}</span></li>
        </ul>
        <div class="field">
          <label for="reason">Reason for visit <span class="muted">(optional)</span></label>
          <textarea id="reason" name="reason" maxlength="500" placeholder="Briefly describe the symptoms or the purpose of the visit"></textarea>
        </div>
        <label class="checkbox" style="margin:14px 0 18px">
          <input type="checkbox" required>
          <span>I confirm the details above are correct and understand this is not an emergency service.</span>
        </label>
        <button class="btn btn-primary btn-lg btn-block" type="submit"><i class="ri-check-line"></i>Confirm appointment</button>
      </form>`;

    const form = $('#confirm-form');
    const showUhid = () => {
      state.patient = form.patient.value;
      $('#b-uhid').textContent = (people.find((p) => p.id === state.patient) || people[0]).uhid || '—';
    };
    form.patient.addEventListener('change', showUhid);
    showUhid();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', form);
      await withLoading(btn, async () => {
        try {
          const body = { doctor: state.doctor.id, date: state.date, time: state.time, reason: form.reason.value.trim() };
          if (form.patient.value) body.patient = form.patient.value;
          const appt = await api('/appointments', { method: 'POST', body });
          showDone(appt);
        } catch (err) {
          toast(err.message, 'error', 7000);
          if (err.status === 409 && /slot/i.test(err.message)) {
            state.time = null;
            goto(2);
          }
        }
      });
    });
  }

  function renderRescheduleConfirm() {
    const a = rescheduling;
    el.confirm.innerHTML = `
      <ul class="summary-list">
        <li><span>Patient</span><span>${esc(a.patient.name)}</span></li>
        <li><span>Doctor</span><span>${esc(a.doctor.name)}</span></li>
        <li><span>Current time</span><span style="text-decoration:line-through;color:var(--muted)">${esc(fmtDate(a.date))}, ${esc(fmtTime(a.time))}</span></li>
        <li><span>New time</span><span>${esc(fmtDate(state.date))}, ${esc(fmtTime(state.time))}</span></li>
      </ul>
      <p class="muted small">Your old slot will be released to other patients.</p>
      <button type="button" class="btn btn-primary btn-lg btn-block" id="confirm-reschedule"><i class="ri-calendar-check-line"></i>Confirm new time</button>`;
    $('#confirm-reschedule').addEventListener('click', async (e) => {
      await withLoading(e.currentTarget, async () => {
        try {
          const updated = await api(`/appointments/${a.id}/reschedule`, { method: 'PATCH', body: { date: state.date, time: state.time } });
          showDone(updated, true);
        } catch (err) {
          toast(err.message, 'error', 7000);
          if (err.status === 409) {
            state.time = null;
            goto(2);
          }
        }
      });
    });
  }

  /* ---------- Done ---------- */

  function showDone(a, moved = false) {
    state.step = 4;
    $$('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== '4'));
    $$('.stepper-item').forEach((s) => {
      s.classList.remove('active');
      s.classList.add('done');
    });
    history.replaceState(null, '', 'book.html');
    const email = Session.user && Session.user.email;
    el.done.innerHTML = `
      <div class="success-box">
        <div class="success-icon"><i class="ri-check-line"></i></div>
        <h2>${moved ? 'Appointment rescheduled' : 'Appointment confirmed'}</h2>
        <p class="muted mb-0">Your appointment number</p>
        <div class="appt-no">${esc(a.appointmentNo)}</div>
        <ul class="summary-list" style="text-align:left;max-width:440px;margin:0 auto 24px">
          <li><span>Patient</span><span>${esc(a.patient.name)}</span></li>
          <li><span>Doctor</span><span>${esc(a.doctor.name)}</span></li>
          <li><span>Department</span><span>${esc(a.department.name)}</span></li>
          <li><span>Date</span><span>${esc(fmtDate(a.date))}</span></li>
          <li><span>Time</span><span>${esc(fmtTime(a.time))}</span></li>
          <li><span>Fee (pay at hospital)</span><span>${esc(fmtMoney(a.fee))}</span></li>
        </ul>
        ${email ? `<p class="muted small">A confirmation has been sent to ${esc(email)}.</p>` : ''}
        <div class="hero-actions" style="justify-content:center;margin:0">
          <a class="btn btn-primary" href="slip.html?id=${encodeURIComponent(a.id)}"><i class="ri-printer-line"></i>Print slip</a>
          <a class="btn btn-outline" href="portal.html#appointments"><i class="ri-calendar-2-line"></i>My appointments</a>
          <a class="btn btn-ghost" href="book.html">Book another</a>
        </div>
      </div>`;
  }

  /* ---------- Start ---------- */

  el.doctors.innerHTML = loaderHtml();
  try {
    const user = Session.token ? Session.user : null;
    const [departments, list, hols, fam] = await Promise.all([
      api('/departments', { auth: false }),
      api('/doctors', { auth: false }),
      api('/holidays', { auth: false }).catch(() => []),
      user && user.role === 'patient' ? api('/family').catch(() => []) : Promise.resolve([]),
    ]);
    doctors = list;
    holidays = new Map(hols.map((h) => [h.date, h.name]));
    family = fam;
    // "Book for <family member>" link from the portal.
    if (family.some((f) => f.id === params.get('for'))) state.patient = params.get('for');
    el.dept.insertAdjacentHTML('beforeend', departments.map((d) => `<option value="${esc(d.slug)}">${esc(d.name)}</option>`).join(''));
  } catch (err) {
    el.doctors.innerHTML = errorHtml(err);
    goto(1);
    return;
  }

  if (rescheduleId) {
    // Rescheduling needs a patient login.
    let user;
    try {
      user = requireLogin('patient');
    } catch {
      return;
    }
    try {
      rescheduling = await api(`/appointments/${encodeURIComponent(rescheduleId)}`);
    } catch (err) {
      el.doctors.innerHTML = errorHtml(err);
      return;
    }
    const doctor = doctors.find((d) => d.id === rescheduling.doctor.id);
    if (rescheduling.status !== 'scheduled' || !doctor) {
      $('[data-panel="1"]').innerHTML = `<div class="alert alert-warning"><i class="ri-information-line"></i><div>This appointment can't be rescheduled online${rescheduling.status !== 'scheduled' ? ` because it is ${esc(rescheduling.status)}` : ' because the doctor is no longer available'}. <a href="portal.html#appointments">Back to my appointments</a></div></div>`;
      goto(1);
      return;
    }
    state.doctor = doctor;
    state.patient = user && String(rescheduling.patient.id) !== String(user.id) ? rescheduling.patient.id : '';
    $('h1').textContent = 'Reschedule Appointment';
    $('.stepper').insertAdjacentHTML(
      'beforebegin',
      `<div class="alert alert-info banner-reschedule"><i class="ri-calendar-event-line"></i><div>Rescheduling <strong>${esc(rescheduling.appointmentNo)}</strong> with ${esc(doctor.name)} for ${esc(rescheduling.patient.name)}. Currently <strong>${esc(fmtDate(rescheduling.date))}, ${esc(fmtTime(rescheduling.time))}</strong>. Choose a new date and time below.</div></div>`
    );
    $$('[data-goto="1"]').forEach((b) => b.classList.add('hidden'));
    const date = params.get('date');
    const time = params.get('time');
    if (date && date >= todayStr()) state.date = date;
    if (state.date && time && !isPastSlot(state.date, time)) {
      state.time = time;
      goto(3);
    } else {
      goto(2);
    }
    return;
  }

  el.dept.value = params.get('department') || '';
  el.dept.addEventListener('change', renderDoctors);
  el.q.addEventListener('input', debounce(renderDoctors, 150));
  renderDoctors();

  // Restore a selection from the URL (doctor profile link, or returning from login).
  const pre = doctors.find((d) => d.id === params.get('doctor'));
  if (pre) {
    state.doctor = pre;
    const date = params.get('date');
    const time = params.get('time');
    if (date && date >= todayStr()) state.date = date;
    if (state.date && time && !isPastSlot(state.date, time)) {
      state.time = time;
      goto(3);
    } else {
      goto(2);
    }
  } else {
    goto(1);
  }
});
