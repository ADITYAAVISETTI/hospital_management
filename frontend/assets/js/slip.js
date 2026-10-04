document.addEventListener('DOMContentLoaded', async () => {
  let user;
  try {
    user = requireLogin();
  } catch {
    return; // redirecting to login
  }
  const box = $('#slip');
  $('#back-btn').href = homeFor(user.role);
  $('#print-btn').addEventListener('click', () => window.print());

  const id = params.get('id');
  if (!id) {
    box.innerHTML = errorHtml('No appointment selected.');
    return;
  }

  let a;
  try {
    a = await api(`/appointments/${encodeURIComponent(id)}`);
  } catch (err) {
    box.innerHTML = errorHtml(err);
    return;
  }

  const p = a.patient || {};
  const hasConsult = a.status === 'completed' && (a.diagnosis || a.prescription);
  document.title = `${a.appointmentNo} | CityCare Hospital`;

  box.innerHTML = `
    <article class="slip">
      <header class="slip-head">
        <div>
          <div class="brand"><span class="brand-mark"><i class="ri-hospital-fill"></i></span>
            <span class="brand-name">${esc(SITE.name)}<small>${esc(SITE.tagline)}</small></span></div>
          <p class="small muted" style="margin:10px 0 0">${esc(SITE.address)}<br>${esc(SITE.phone)} · ${esc(SITE.email)}</p>
        </div>
        <div style="text-align:right">
          <div class="muted small">${hasConsult ? 'Consultation summary' : 'Appointment slip'}</div>
          <div style="font:800 1.4rem var(--font-head)">${esc(a.appointmentNo)}</div>
          ${statusBadge(a.status)}
        </div>
      </header>

      <div class="slip-grid">
        <div><span>Patient</span><strong>${esc(p.name)}</strong></div>
        <div><span>UHID</span><strong>${esc(p.uhid || '—')}</strong></div>
        <div><span>Age / Gender</span>${esc(p.dateOfBirth ? `${age(p.dateOfBirth)} yrs` : '—')} / ${esc(cap(p.gender) || '—')}</div>
        <div><span>Phone</span>${esc(p.phone || '—')}</div>
        <div><span>Doctor</span><strong>${esc(a.doctor.name)}</strong></div>
        <div><span>Department</span>${esc(a.department.name)}</div>
        <div><span>Date</span><strong>${esc(fmtDate(a.date))}</strong></div>
        <div><span>Time</span><strong>${esc(fmtTime(a.time))}</strong></div>
        <div><span>Fee</span>${esc(fmtMoney(a.fee))}</div>
        <div><span>Booked on</span>${esc(new Date(a.createdAt).toLocaleDateString('en-IN'))}</div>
      </div>

      ${a.reason ? `<div class="slip-section"><strong>Reason for visit</strong><p class="mb-0">${esc(a.reason)}</p></div>` : ''}
      ${a.status === 'cancelled' ? `<div class="alert alert-danger" style="margin-top:14px"><i class="ri-close-circle-line"></i><div>This appointment was cancelled${a.cancelledBy ? ` by the ${esc(a.cancelledBy)}` : ''}.${a.cancelReason ? ` Reason: ${esc(a.cancelReason)}` : ''}</div></div>` : ''}
      ${a.diagnosis ? `<div class="slip-section"><strong>Diagnosis</strong><pre>${esc(a.diagnosis)}</pre></div>` : ''}
      ${a.prescription ? `<div class="slip-section"><strong><i class="ri-capsule-line"></i> Prescription (Rx)</strong><pre>${esc(a.prescription)}</pre></div>` : ''}

      ${a.status === 'scheduled' ? `
        <div class="slip-section small">
          <strong>Before your visit</strong>
          <ul class="mb-0">
            <li>Please arrive 15 minutes before your appointment time.</li>
            <li>Bring a photo ID, this slip and any previous reports or prescriptions.</li>
            <li>The consultation fee is payable at the registration desk.</li>
          </ul>
        </div>` : ''}

      <footer class="slip-foot">
        <span>Printed ${esc(new Date().toLocaleString('en-IN'))}</span>
        <span>${hasConsult ? `Electronically recorded by ${esc(a.doctor.name)}` : 'This is a computer-generated slip.'}</span>
      </footer>
    </article>`;
});
