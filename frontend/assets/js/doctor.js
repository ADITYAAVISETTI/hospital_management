document.addEventListener('DOMContentLoaded', async () => {
  const body = $('#doctor-body');
  const head = $('#profile-head');
  const id = params.get('id');
  if (!id) {
    location.replace('doctors.html');
    return;
  }

  let d;
  try {
    d = await api(`/doctors/${encodeURIComponent(id)}`, { auth: false });
  } catch (err) {
    head.innerHTML = `<h1>${err.status === 404 || err.status === 400 ? 'Doctor not found' : 'Something went wrong'}</h1>`;
    $('#crumb').textContent = 'Not found';
    body.innerHTML =
      err.status === 404 || err.status === 400
        ? emptyHtml('ri-user-search-line', 'This doctor profile is not available', '', '<a class="btn btn-primary" href="doctors.html">Browse doctors</a>')
        : errorHtml(err);
    return;
  }

  document.title = `${d.name}, ${d.specialization} | CityCare Hospital`;
  $('#crumb').textContent = d.name;
  head.innerHTML = `
    ${avatar(d.name, 'avatar-xl', d.photo)}
    <div>
      <h1 class="mb-0">${esc(d.name)}</h1>
      <p style="font-size:1.1rem">${esc(d.specialization)} · ${esc(d.department ? d.department.name : '')}</p>
      <p class="small mb-0">${esc(d.qualifications)}</p>
      ${d.rating.count ? `<p class="small" style="margin-top:6px">${starsHtml(d.rating.average)} <span style="color:#fff">${esc(d.rating.average.toFixed(1))} from ${esc(d.rating.count)} patient review${d.rating.count > 1 ? 's' : ''}</span></p>` : ''}
    </div>`;

  // Group schedule by weekday for the timetable.
  const byDay = new Map();
  (d.schedule || []).forEach((s) => {
    if (!byDay.has(s.day)) byDay.set(s.day, []);
    byDay.get(s.day).push(`${fmtTime(s.start)} – ${fmtTime(s.end)}`);
  });
  const order = [1, 2, 3, 4, 5, 6, 0];
  const timetable = order
    .map(
      (day) => `<tr><td>${DAYS[day]}</td><td>${
        byDay.has(day) ? esc(byDay.get(day).join(', ')) : '<span class="muted">Not available</span>'
      }</td></tr>`
    )
    .join('');

  const leaveNotice = (d.leaves || []).length
    ? `<div class="alert alert-warning" style="margin-top:12px"><i class="ri-calendar-close-line"></i><div><strong>On leave:</strong> ${d.leaves.map((l) => esc(l.from === l.to ? fmtDate(l.from) : `${fmtDate(l.from, { day: 'numeric', month: 'short' })} – ${fmtDate(l.to)}`)).join('; ')}</div></div>`
    : '';

  body.innerHTML = `
    <div class="detail-grid">
      <div>
        <div class="card">
          <h2>About</h2>
          <p class="muted">${esc(d.bio || `${d.name} is a ${d.specialization} at CityCare Hospital.`)}</p>
          <div class="grid grid-3" style="margin-top:20px">
            <div><div class="muted small">Experience</div><strong>${esc(d.experienceYears)}+ years</strong></div>
            <div><div class="muted small">Consultation fee</div><strong>${esc(fmtMoney(d.consultationFee))}</strong></div>
            <div><div class="muted small">Languages</div><strong>${esc((d.languages || []).join(', '))}</strong></div>
          </div>
        </div>

        <div class="card" style="margin-top:24px">
          <h2>OPD timings</h2>
          <div class="table-wrap"><table class="table schedule-table"><tbody>${timetable}</tbody></table></div>
          <p class="muted small" style="margin-top:12px">Each consultation slot is ${esc(d.slotMinutes)} minutes. Timings may change on public holidays.</p>
          ${leaveNotice}
        </div>

        <div class="card" style="margin-top:24px" id="reviews">
          <h2>Patient reviews</h2>
          <div id="review-list">${loaderHtml()}</div>
        </div>
      </div>

      <aside class="card sticky-card">
        <h3>Book with ${esc(d.name.replace(/^Dr\.?\s*/, 'Dr. '))}</h3>
        <p class="muted small">Pick a date and time. You'll get an appointment number immediately.</p>
        <ul class="summary-list">
          <li><span>Department</span><span>${esc(d.department ? d.department.name : '')}</span></li>
          <li><span>Fee</span><span>${esc(fmtMoney(d.consultationFee))}</span></li>
          <li><span>Days</span><span>${esc(order.filter((x) => byDay.has(x)).map((x) => DAYS[x].slice(0, 3)).join(', ') || '—')}</span></li>
        </ul>
        <a class="btn btn-primary btn-block" href="book.html?doctor=${encodeURIComponent(d.id)}"><i class="ri-calendar-check-line"></i>Book appointment</a>
        ${d.department ? `<a class="btn btn-ghost btn-block" style="margin-top:10px" href="department.html?slug=${encodeURIComponent(d.department.slug)}">About ${esc(d.department.name)}</a>` : ''}
      </aside>
    </div>`;

  loadReviews(d.id);
});

async function loadReviews(id) {
  const box = $('#review-list');
  try {
    const reviews = await api(`/doctors/${encodeURIComponent(id)}/reviews`, { auth: false });
    box.innerHTML = reviews.length
      ? reviews
          .map(
            (r) => `<div class="review"><div class="review-head"><strong>${esc(r.name)}</strong><span class="muted">${esc(new Date(r.date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }))}</span></div>${starsHtml(r.rating, { small: true })}<p class="mb-0" style="margin-top:6px">${esc(r.comment)}</p></div>`
          )
          .join('')
      : '<p class="muted mb-0">No written reviews yet. Patients can review a doctor after their consultation.</p>';
  } catch {
    box.innerHTML = '<p class="muted mb-0">Reviews could not be loaded.</p>';
  }
}
