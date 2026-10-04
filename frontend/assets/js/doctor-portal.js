// Doctor dashboard.
let me;
try {
  me = requireLogin('doctor');
} catch {
  /* redirecting */
}

const dp = { all: [], day: todayStr(), profile: null };

function showTab(tab) {
  $$('.dash-nav [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('[data-view]').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== tab));
  window.scrollTo(0, 0);
}

function patientLine(p) {
  const bits = [p.isDependant && p.relation && `${RELATION_LABELS[p.relation] || 'Family'} of account holder`, p.uhid && `UHID ${p.uhid}`, p.dateOfBirth && `${age(p.dateOfBirth)} yrs`, p.gender && cap(p.gender), p.bloodGroup && `Blood ${p.bloodGroup}`];
  return bits.filter(Boolean).map(esc).join(' · ');
}

function tableHtml(rows, { showDate = false } = {}) {
  if (!rows.length) return '';
  return `
    <div class="table-wrap">
      <table class="table">
        <thead><tr>${showDate ? '<th>Date</th>' : ''}<th>Time</th><th>Patient</th><th>Reason</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${rows
            .map((a) => {
              const canConsult = a.status !== 'cancelled' && a.date <= todayStr();
              return `<tr>
                ${showDate ? `<td class="nowrap">${esc(fmtDate(a.date, { day: 'numeric', month: 'short', year: 'numeric' }))}</td>` : ''}
                <td class="nowrap"><strong>${esc(fmtTime(a.time))}</strong></td>
                <td><div class="cell-main">${esc(a.patient.name)}</div><div class="cell-sub">${patientLine(a.patient)}</div></td>
                <td class="small">${esc(a.reason || '—')}</td>
                <td>${statusBadge(a.status)}</td>
                <td><div class="actions">
                  ${canConsult ? `<button type="button" class="btn btn-primary btn-sm" data-consult="${esc(a.id)}">${a.status === 'scheduled' ? 'Consult' : 'Edit notes'}</button>` : ''}
                  ${a.status === 'scheduled' ? `<button type="button" class="btn btn-ghost btn-sm" data-cancel="${esc(a.id)}">Cancel</button>` : ''}
                  <button type="button" class="btn btn-ghost btn-sm" data-reports="${esc(a.patient.id)}" data-appt="${esc(a.id)}" title="Reports"><i class="ri-file-pdf-2-line"></i></button>
                  <a class="btn btn-ghost btn-sm" href="slip.html?id=${encodeURIComponent(a.id)}" title="Print"><i class="ri-printer-line"></i></a>
                </div></td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function bindRowActions(root) {
  $$('[data-consult]', root).forEach((b) => b.addEventListener('click', () => openConsult(b.dataset.consult)));
  $$('[data-cancel]', root).forEach((b) => b.addEventListener('click', () => cancelAppt(b.dataset.cancel)));
  $$('[data-reports]', root).forEach((b) =>
    b.addEventListener('click', () => patientReportsModal(dp.all.find((a) => a.id === b.dataset.appt).patient))
  );
}

function renderDay() {
  const day = dp.day;
  $('#day-picker').value = day;
  $('#day-title').textContent = day === todayStr() ? `Today · ${fmtDate(day, { day: 'numeric', month: 'long' })}` : fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const rows = dp.all.filter((a) => a.date === day).sort((a, b) => a.time.localeCompare(b.time));
  const count = (s) => rows.filter((a) => a.status === s).length;
  $('#day-stats').innerHTML = [
    ['ic-blue', 'ri-calendar-event-line', rows.filter((a) => a.status !== 'cancelled').length, 'Booked'],
    ['ic-amber', 'ri-hourglass-line', count('scheduled'), 'Waiting'],
    ['ic-green', 'ri-checkbox-circle-line', count('completed'), 'Completed'],
    ['ic-red', 'ri-close-circle-line', count('cancelled') + count('no-show'), 'Cancelled / no-show'],
  ]
    .map(([c, i, n, l]) => `<div class="card stat-card"><span class="ic ${c}"><i class="${i}"></i></span><div><strong>${n}</strong><span>${l}</span></div></div>`)
    .join('');

  const list = $('#day-list');
  if (rows.length) {
    list.innerHTML = tableHtml(rows);
  } else {
    // Don't leave the doctor looking at an empty page: show what is coming up next.
    const next = upcomingRows().filter((a) => a.date !== day);
    list.innerHTML = next.length
      ? `<div class="alert alert-info" style="margin-bottom:16px"><i class="ri-information-line"></i>
           <div>No appointments ${day === todayStr() ? 'today' : `on ${esc(fmtDate(day, { day: 'numeric', month: 'short' }))}`}.
           Your next appointment is on <strong>${esc(fmtDate(next[0].date))}</strong>.
           <button type="button" class="btn btn-primary btn-sm" data-goto-day="${esc(next[0].date)}" style="margin-left:8px">Open that day</button></div></div>
         <h3 style="font-size:1.05rem">Upcoming appointments (${next.length})</h3>
         ${tableHtml(next.slice(0, 10), { showDate: true })}
         ${next.length > 10 ? '<p class="muted small" style="margin-top:10px">See the Upcoming tab for the full list.</p>' : ''}`
      : emptyHtml('ri-calendar-line', 'No appointments on this day', 'You have no upcoming appointments booked.');
    $$('[data-goto-day]', list).forEach((b) =>
      b.addEventListener('click', () => {
        dp.day = b.dataset.gotoDay;
        renderDay();
      })
    );
  }
  bindRowActions(list);
}

/** Scheduled appointments from today onwards, soonest first. */
function upcomingRows() {
  const today = todayStr();
  return dp.all
    .filter((a) => a.date >= today && a.status === 'scheduled')
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

function renderUpcoming() {
  const rows = upcomingRows();
  const badge = $('#upcoming-count');
  badge.textContent = rows.length;
  badge.classList.toggle('hidden', rows.length === 0);
  const list = $('#upcoming-list');
  list.innerHTML = rows.length ? tableHtml(rows, { showDate: true }) : emptyHtml('ri-calendar-line', 'No upcoming appointments');
  bindRowActions(list);
}

function renderHistory() {
  const q = $('#history-q').value.trim().toLowerCase();
  const rows = dp.all
    .filter((a) => a.date <= todayStr() && a.status !== 'scheduled')
    .filter((a) => !q || a.patient.name.toLowerCase().includes(q) || (a.patient.uhid || '').toLowerCase().includes(q))
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const list = $('#history-list');
  list.innerHTML = rows.length ? tableHtml(rows, { showDate: true }) : emptyHtml('ri-history-line', q ? 'No matching patients' : 'No past consultations yet');
  bindRowActions(list);
}

function renderProfile() {
  const d = dp.profile;
  const box = $('#profile-box');
  if (!d) {
    box.innerHTML = loaderHtml();
    return;
  }
  const byDay = [1, 2, 3, 4, 5, 6, 0]
    .map((day) => {
      const blocks = d.schedule.filter((s) => s.day === day).map((s) => `${fmtTime(s.start)} – ${fmtTime(s.end)}`);
      return `<tr><td>${DAYS[day]}</td><td>${blocks.length ? esc(blocks.join(', ')) : '<span class="muted">Off</span>'}</td></tr>`;
    })
    .join('');
  box.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="profile-head" style="margin-bottom:16px">${avatar(d.name, 'avatar-lg', d.photo)}<div><h2 class="mb-0">${esc(d.name)}</h2><div class="muted">${esc(d.specialization)}</div></div></div>
        <ul class="summary-list">
          <li><span>Department</span><span>${esc(d.department.name)}</span></li>
          <li><span>Qualifications</span><span>${esc(d.qualifications || '—')}</span></li>
          <li><span>Experience</span><span>${esc(d.experienceYears)} years</span></li>
          <li><span>Consultation fee</span><span>${esc(fmtMoney(d.consultationFee))}</span></li>
          <li><span>Slot length</span><span>${esc(d.slotMinutes)} minutes</span></li>
        </ul>
        <p class="muted small mb-0">To change these details or your timings, contact the hospital administrator.</p>
      </div>
      <div class="card">
        <h3>Weekly OPD timings</h3>
        <div class="table-wrap"><table class="table schedule-table"><tbody>${byDay}</tbody></table></div>
        <p style="margin-top:16px"><a href="doctor.html?id=${encodeURIComponent(d.id)}">View my public profile <i class="ri-external-link-line"></i></a></p>
      </div>
    </div>
    <div class="card" style="margin-top:24px">
      <div class="dash-title" style="margin-bottom:8px"><h3 class="mb-0">My leave</h3></div>
      <p class="muted small">Patients can't book you on these days. Adding leave cancels any appointments already booked in that period, and the patients are emailed.</p>
      <ul class="info-list leave-list">${(d.leaves || []).length ? d.leaves.map((l) => `<li><span><strong>${esc(l.from === l.to ? fmtDate(l.from) : `${fmtDate(l.from)} – ${fmtDate(l.to)}`)}</strong>${l.reason ? ` <span class="muted">· ${esc(l.reason)}</span>` : ''}</span><button type="button" class="btn btn-ghost btn-sm" data-remove-leave="${esc(l.id)}">Remove</button></li>`).join('') : '<li class="muted">No upcoming leave.</li>'}</ul>
      <form id="leave-form" class="form-grid" style="margin-top:16px" novalidate>
        <div class="field"><label for="lv-from">From</label><input id="lv-from" name="from" type="date" required min="${todayStr()}"></div>
        <div class="field"><label for="lv-to">To</label><input id="lv-to" name="to" type="date" required min="${todayStr()}"></div>
        <div class="field full"><label for="lv-reason">Reason <span class="muted">(only staff see this)</span></label><input id="lv-reason" name="reason" maxlength="120" placeholder="e.g. Conference, personal leave"></div>
        <div class="full"><button class="btn btn-primary" type="submit"><i class="ri-calendar-close-line"></i>Add leave</button></div>
      </form>
    </div>`;
  bindLeaveControls(d);
}

function bindLeaveControls(d) {
  const form = $('#leave-form');
  form.from.addEventListener('change', () => { if (!form.to.value || form.to.value < form.from.value) form.to.value = form.from.value; form.to.min = form.from.value; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(form)) return;
    const body = formData(form);
    const btn = $('button[type=submit]', form);
    await withLoading(btn, async () => {
      try {
        const { count } = await api(`/doctors/${d.id}/leaves/impact?from=${body.from}&to=${body.to}`);
        if (count && !(await confirmDialog(`${count} booked appointment${count > 1 ? 's' : ''} in this period will be cancelled and the patients emailed. Continue?`, { title: 'Add leave', confirmText: 'Add leave', danger: true }))) return;
        const res = await api(`/doctors/${d.id}/leaves`, { method: 'POST', body });
        toast(res.cancelledAppointments ? `Leave added. ${res.cancelledAppointments} appointment(s) cancelled.` : 'Leave added.', 'success', 6000);
        await reloadProfile();
        load({ quiet: true });
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
  $$('[data-remove-leave]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!(await confirmDialog('Remove this leave? Those days will open for booking again.', { confirmText: 'Remove leave' }))) return;
      try {
        await api(`/doctors/${d.id}/leaves/${b.dataset.removeLeave}`, { method: 'DELETE' });
        toast('Leave removed.', 'success');
        reloadProfile();
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
}

async function reloadProfile() {
  try {
    dp.profile = await api(`/doctors/${me.doctorId}`);
    renderProfile();
  } catch (err) {
    $('#profile-box').innerHTML = errorHtml(err);
  }
}

function renderAll() {
  renderDay();
  renderUpcoming();
  renderHistory();
}

/** Loads the doctor's appointments. `quiet` = background refresh (no spinner, no error box). */
async function load({ quiet = false } = {}) {
  if (!quiet) $('#day-list').innerHTML = loaderHtml();
  try {
    dp.all = await api('/appointments/for-doctor');
    renderAll();
    $('#last-updated').textContent = `Updated ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
  } catch (err) {
    if (!quiet) $('#day-list').innerHTML = errorHtml(err);
  }
}

function replaceAppt(updated) {
  dp.all = dp.all.map((a) => (a.id === updated.id ? updated : a));
  renderAll();
}

function openConsult(id) {
  const a = dp.all.find((x) => x.id === id);
  const previous = dp.all
    .filter((x) => x.patient.id === a.patient.id && x.id !== a.id && x.status === 'completed')
    .sort((x, y) => (y.date + y.time).localeCompare(x.date + x.time));

  const m = openModal({
    title: `Consultation · ${a.patient.name}`,
    size: 'modal-lg',
    body: `
      <div class="alert alert-info" style="margin-bottom:16px"><i class="ri-user-line"></i><div><strong>${esc(a.patient.name)}</strong> · ${patientLine(a.patient)}<br>
        ${esc(fmtDate(a.date))}, ${esc(fmtTime(a.time))} · ${esc(a.appointmentNo)}${a.reason ? `<br>Reason: ${esc(a.reason)}` : ''}</div></div>
      ${previous.length ? `<details style="margin-bottom:16px"><summary><strong>Previous visits with you (${previous.length})</strong></summary>
        ${previous.slice(0, 5).map((p) => `<div class="small" style="padding:8px 0;border-bottom:1px dashed var(--border)"><strong>${esc(fmtDate(p.date))}</strong>: ${esc(p.diagnosis || 'No diagnosis recorded')}${p.prescription ? `<br><span class="muted">Rx: ${esc(p.prescription)}</span>` : ''}</div>`).join('')}
      </details>` : ''}
      <form id="consult-form" class="form-grid">
        <div class="field full"><label for="c-diagnosis">Diagnosis</label><textarea id="c-diagnosis" name="diagnosis" maxlength="2000" rows="3">${esc(a.diagnosis)}</textarea></div>
        <div class="field full"><label for="c-rx">Prescription</label><textarea id="c-rx" name="prescription" maxlength="4000" rows="5" placeholder="e.g.&#10;1. Tab. Paracetamol 500 mg, 1-0-1 after food, 3 days&#10;2. Review after 1 week">${esc(a.prescription)}</textarea><span class="hint">Visible to the patient and printed on their slip.</span></div>
        <div class="field full"><label for="c-notes">Private notes</label><textarea id="c-notes" name="doctorNotes" maxlength="4000" rows="2">${esc(a.doctorNotes)}</textarea><span class="hint">Only visible to doctors and hospital staff.</span></div>
      </form>`,
    // A visit the patient has rated must stay completed (the server enforces this too).
    footer: `
      ${a.feedback ? '' : '<button type="button" class="btn btn-ghost" data-status="no-show">Mark no-show</button>'}
      <button type="button" class="btn btn-primary" data-status="completed"><i class="ri-check-line"></i>Save &amp; complete</button>`,
  });

  $$('[data-status]', m.el).forEach((btn) =>
    btn.addEventListener('click', async () => {
      const form = $('#consult-form', m.el);
      await withLoading(btn, async () => {
        try {
          const updated = await api(`/appointments/${a.id}/consult`, {
            method: 'PATCH',
            body: { status: btn.dataset.status, ...formData(form) },
          });
          replaceAppt(updated);
          m.close();
          toast(btn.dataset.status === 'completed' ? 'Consultation saved.' : 'Marked as no-show.', 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    })
  );
}

function cancelAppt(id) {
  const a = dp.all.find((x) => x.id === id);
  const m = openModal({
    title: 'Cancel appointment',
    body: `<p>Cancel ${esc(a.patient.name)}'s appointment on ${esc(fmtDate(a.date))} at ${esc(fmtTime(a.time))}? The patient will see the reason in their portal.</p>
      <div class="field"><label for="cancel-reason">Reason</label><input id="cancel-reason" maxlength="300" value="Doctor unavailable. Please rebook."></div>`,
    footer: `<button type="button" class="btn btn-ghost" data-close>Go back</button><button type="button" class="btn btn-danger" data-ok>Cancel appointment</button>`,
  });
  $('[data-close]', m.el).addEventListener('click', m.close);
  $('[data-ok]', m.el).addEventListener('click', async (e) => {
    await withLoading(e.currentTarget, async () => {
      try {
        const updated = await api(`/appointments/${a.id}/cancel`, { method: 'PATCH', body: { reason: $('#cancel-reason', m.el).value.trim() } });
        replaceAppt(updated);
        m.close();
        toast('Appointment cancelled.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!me) return;
  $('#dash-user').innerHTML = `${avatar(me.name)}<div><strong>${esc(me.name)}</strong><small>Doctor</small></div>`;
  $$('.dash-nav [data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  const setDay = (d) => {
    dp.day = d;
    renderDay();
  };
  $('#day-picker').addEventListener('change', (e) => e.target.value && setDay(e.target.value));
  $('#day-prev').addEventListener('click', () => setDay(addDays(dp.day, -1)));
  $('#day-next').addEventListener('click', () => setDay(addDays(dp.day, 1)));
  $('#day-today').addEventListener('click', () => setDay(todayStr()));
  $('#history-q').addEventListener('input', debounce(renderHistory, 150));

  renderProfile();
  if (me.doctorId) {
    reloadProfile();
  }
  $('#refresh-appts').addEventListener('click', (e) => withLoading(e.currentTarget, () => load({ quiet: true })));
  await load();

  // New bookings arrive while the doctor has the page open: refresh every minute,
  // but not while a consultation form is open (it would be re-rendered underneath).
  setInterval(() => {
    if (!document.hidden && !$('.modal-backdrop')) load({ quiet: true });
  }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !$('.modal-backdrop')) load({ quiet: true });
  });
});
