// Public list of health check-up packages, with booking for logged-in patients.
document.addEventListener('DOMContentLoaded', async () => {
  const list = $('#package-list');
  list.innerHTML = loaderHtml();
  let packages = [];
  try {
    packages = await api('/packages', { auth: false });
  } catch (err) {
    list.innerHTML = errorHtml(err);
    return;
  }
  if (!packages.length) {
    list.innerHTML = emptyHtml('ri-heart-add-line', 'Packages coming soon', 'Please call us to arrange a health check-up.');
    return;
  }

  // Highlight the middle-priced package as "most popular".
  const featuredId = packages.length > 2 ? packages[1]._id : null;
  list.innerHTML = packages
    .map((p) => {
      const save = p.originalPrice && p.originalPrice > p.price ? Math.round((1 - p.price / p.originalPrice) * 100) : 0;
      return `
      <article class="card package-card ${p._id === featuredId ? 'featured' : ''}">
        <h3>${esc(p.name)}</h3>
        <p class="muted small mb-0">${esc(p.summary)}</p>
        ${p.recommendedFor ? `<p class="small" style="margin:8px 0 0"><i class="ri-user-heart-line"></i> ${esc(p.recommendedFor)}</p>` : ''}
        <div style="margin-top:14px"><span class="price">${esc(fmtMoney(p.price))}</span>${save ? `<s>${esc(fmtMoney(p.originalPrice))}</s><span class="save">Save ${save}%</span>` : ''}</div>
        <ul>${(p.tests || []).map((t) => `<li><i class="ri-check-line"></i><span>${esc(t)}</span></li>`).join('')}</ul>
        ${p.preparation ? `<p class="small muted"><i class="ri-information-line"></i> ${esc(p.preparation)}</p>` : ''}
        <button type="button" class="btn ${p._id === featuredId ? 'btn-primary' : 'btn-outline'} btn-block" data-book="${esc(p._id)}">Book this package</button>
      </article>`;
    })
    .join('');

  $$('[data-book]', list).forEach((b) => b.addEventListener('click', () => bookPackage(packages.find((p) => p._id === b.dataset.book))));
});

async function bookPackage(pkg) {
  const user = Session.token ? Session.user : null;
  if (!user) {
    const next = encodeURIComponent('packages.html');
    openModal({
      title: `Book: ${pkg.name}`,
      body: `<p>Please log in or create a free patient account to book a health check-up.</p>`,
      footer: `<a class="btn btn-outline" href="register.html?next=${next}">Create account</a><a class="btn btn-primary" href="login.html?next=${next}">Log in</a>`,
    });
    return;
  }
  if (user.role !== 'patient') {
    toast('Health check-ups are booked from a patient account.', 'info');
    return;
  }

  let family = [];
  try {
    family = await api('/family');
  } catch { /* booking for self still works */ }

  const tomorrow = addDays(todayStr(), 1);
  const m = openModal({
    title: `Book: ${pkg.name}`,
    body: `
      <ul class="summary-list"><li><span>Package</span><span>${esc(pkg.name)}</span></li><li><span>Price</span><span>${esc(fmtMoney(pkg.price))}</span></li></ul>
      <form id="pkg-form" class="form-grid" novalidate>
        <div class="field full"><label for="pk-person">Who is it for?</label>
          <select id="pk-person" name="patient">
            <option value="">Myself (${esc(user.name)})</option>
            ${family.map((f) => `<option value="${esc(f.id)}">${esc(f.name)} (${esc(RELATION_LABELS[f.relation] || 'Family')})</option>`).join('')}
          </select>
          ${user.guardian ? '' : '<span class="hint"><a href="portal.html#family">Add a family member</a></span>'}
        </div>
        <div class="field full"><label for="pk-date">Preferred date <span class="req">*</span></label>
          <input id="pk-date" name="date" type="date" required min="${tomorrow}" max="${addDays(todayStr(), 60)}">
          <span class="hint">Monday to Saturday. We'll call you to confirm the time (usually 8:00 AM).</span></div>
        <div class="field full"><label for="pk-notes">Anything we should know? <span class="muted">(optional)</span></label>
          <textarea id="pk-notes" name="notes" rows="2" maxlength="500" placeholder="e.g. diabetic, pregnant, need wheelchair"></textarea></div>
      </form>`,
    footer: `<button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="button" class="btn btn-primary" data-save>Request booking</button>`,
  });
  const form = $('#pkg-form', m.el);
  form.date.addEventListener('input', () => {
    const sunday = form.date.value && parseDate(form.date.value).getDay() === 0;
    form.date.setCustomValidity(sunday ? 'Health check-ups are not done on Sundays.' : '');
  });
  $('[data-close]', m.el).addEventListener('click', m.close);
  $('[data-save]', m.el).addEventListener('click', async (e) => {
    if (!validateForm(form)) return;
    const body = formData(form);
    if (!body.patient) delete body.patient;
    await withLoading(e.currentTarget, async () => {
      try {
        const b = await api(`/packages/${pkg._id}/book`, { method: 'POST', body });
        m.close();
        openModal({
          title: 'Request received',
          body: `<div class="success-box"><div class="success-icon"><i class="ri-check-line"></i></div>
            <p class="mb-0">Booking number</p><div class="appt-no">${esc(b.bookingNo)}</div>
            <p>${esc(b.package.name)} for <strong>${esc(b.patient.name)}</strong> on <strong>${esc(fmtDate(b.date))}</strong>.</p>
            <p class="muted small">Our team will call you to confirm the time. You can see this booking in your portal.</p></div>`,
          footer: `<a class="btn btn-primary" href="portal.html#checkups">Go to my portal</a>`,
        });
      } catch (err) {
        toast(err.message, 'error', 6000);
      }
    });
  });
}
