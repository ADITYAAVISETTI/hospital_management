document.addEventListener('DOMContentLoaded', async () => {
  const deptGrid = $('#dept-grid');
  const doctorGrid = $('#doctor-grid');
  const deptSelect = $('#qs-dept');
  deptGrid.innerHTML = loaderHtml();
  doctorGrid.innerHTML = loaderHtml();

  $('#quick-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = new URLSearchParams();
    if (deptSelect.value) q.set('department', deptSelect.value);
    if ($('#qs-q').value.trim()) q.set('q', $('#qs-q').value.trim());
    location.href = `doctors.html${q.toString() ? `?${q}` : ''}`;
  });

  try {
    const [departments, doctors] = await Promise.all([
      api('/departments', { auth: false }),
      api('/doctors', { auth: false }),
    ]);

    deptGrid.innerHTML = departments.length
      ? departments.slice(0, 8).map(departmentCardHtml).join('')
      : emptyHtml('ri-hospital-line', 'Departments coming soon');
    deptSelect.insertAdjacentHTML(
      'beforeend',
      departments.map((d) => `<option value="${esc(d.slug)}">${esc(d.name)}</option>`).join('')
    );

    // Most experienced doctor from each department first.
    const featured = [];
    const seen = new Set();
    [...doctors]
      .sort((a, b) => b.experienceYears - a.experienceYears)
      .forEach((d) => {
        const key = d.department && d.department.slug;
        if (!seen.has(key) && featured.length < 4) {
          seen.add(key);
          featured.push(d);
        }
      });
    doctorGrid.innerHTML = featured.length
      ? featured.map(doctorCardHtml).join('')
      : emptyHtml('ri-user-heart-line', 'Our doctors will be listed here soon');

    $('#stat-doctors').textContent = doctors.length ? `${doctors.length}` : '—';
    $('#stat-depts').textContent = departments.length || '—';
  } catch (err) {
    deptGrid.innerHTML = errorHtml(err);
    doctorGrid.innerHTML = '';
  }
});
