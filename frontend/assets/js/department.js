document.addEventListener('DOMContentLoaded', async () => {
  const body = $('#dept-body');
  const slug = params.get('slug');
  if (!slug) {
    location.replace('departments.html');
    return;
  }

  let d;
  try {
    d = await api(`/departments/${encodeURIComponent(slug)}`, { auth: false });
  } catch (err) {
    $('#dept-name').textContent = err.status === 404 ? 'Department not found' : 'Something went wrong';
    $('#crumb').textContent = 'Not found';
    body.innerHTML =
      err.status === 404
        ? emptyHtml('ri-hospital-line', 'We could not find that department', '', '<a class="btn btn-primary" href="departments.html">See all departments</a>')
        : errorHtml(err);
    return;
  }

  document.title = `${d.name} | CityCare Hospital`;
  $('#dept-name').textContent = d.name;
  $('#dept-summary').textContent = d.summary;
  $('#crumb').textContent = d.name;

  const services = (d.services || [])
    .map((s) => `<li><i class="ri-checkbox-circle-fill"></i><span>${esc(s)}</span></li>`)
    .join('');

  body.innerHTML = `
    <div class="detail-grid">
      <div>
        <div class="card">
          <span class="dept-icon"><i class="${esc(d.icon)}"></i></span>
          <h2>About ${esc(d.name)}</h2>
          <p class="muted">${esc(d.description || d.summary)}</p>
          ${services ? `<h3 style="margin-top:24px">Services &amp; procedures</h3><ul class="services-list">${services}</ul>` : ''}
        </div>

        <h2 style="margin-top:48px">Our ${esc(d.name)} specialists</h2>
        <div class="grid grid-2" style="margin-top:20px">
          ${d.doctors.length ? d.doctors.map(doctorCardHtml).join('') : emptyHtml('ri-user-heart-line', 'No doctors listed yet', 'Please call us to be connected with the department.')}
        </div>
      </div>

      <aside class="card sticky-card">
        <h3>Book a consultation</h3>
        <p class="muted small">Choose a ${esc(d.name)} specialist and a convenient time.</p>
        <a class="btn btn-primary btn-block" href="book.html?department=${encodeURIComponent(d.slug)}"><i class="ri-calendar-check-line"></i>Book appointment</a>
        <ul class="info-list" style="margin-top:18px">
          <li><i class="ri-time-line"></i><span><strong>OPD timings</strong><br><span class="muted small">${esc(SITE.opdHours)}</span></span></li>
          <li><i class="ri-phone-line"></i><span><strong>Appointments desk</strong><br><a href="tel:${esc(SITE.phone.replace(/\s/g, ''))}">${esc(SITE.phone)}</a></span></li>
          <li><i class="ri-alarm-warning-line"></i><span><strong>Emergency</strong><br><a href="tel:${esc(SITE.emergency)}">${esc(SITE.emergency)}</a> (24x7)</span></li>
        </ul>
      </aside>
    </div>`;
});
