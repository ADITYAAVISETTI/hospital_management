document.addEventListener('DOMContentLoaded', async () => {
  const list = $('#doctor-list');
  const q = $('#f-q');
  const dept = $('#f-dept');
  const lang = $('#f-lang');
  const sort = $('#f-sort');
  const count = $('#result-count');
  list.innerHTML = loaderHtml();

  let doctors = [];
  try {
    const [departments, all] = await Promise.all([
      api('/departments', { auth: false }),
      api('/doctors', { auth: false }),
    ]);
    doctors = all;
    dept.insertAdjacentHTML('beforeend', departments.map((d) => `<option value="${esc(d.slug)}">${esc(d.name)}</option>`).join(''));
    const languages = [...new Set(all.flatMap((d) => d.languages || []))].sort();
    lang.insertAdjacentHTML('beforeend', languages.map((l) => `<option>${esc(l)}</option>`).join(''));
  } catch (err) {
    list.innerHTML = errorHtml(err);
    return;
  }

  // Pre-fill from the URL (links from the home page search).
  q.value = params.get('q') || '';
  dept.value = params.get('department') || '';

  const render = () => {
    const term = q.value.trim().toLowerCase();
    let shown = doctors.filter((d) => {
      if (dept.value && (!d.department || d.department.slug !== dept.value)) return false;
      if (lang.value && !(d.languages || []).includes(lang.value)) return false;
      if (!term) return true;
      return [d.name, d.specialization, d.qualifications, d.department && d.department.name]
        .filter(Boolean)
        .some((f) => f.toLowerCase().includes(term));
    });
    const sorters = {
      name: (a, b) => a.name.localeCompare(b.name),
      exp: (a, b) => b.experienceYears - a.experienceYears,
      fee: (a, b) => a.consultationFee - b.consultationFee,
    };
    shown = shown.sort(sorters[sort.value]);

    count.textContent = `${shown.length} doctor${shown.length === 1 ? '' : 's'} found`;
    list.innerHTML = shown.length
      ? shown.map(doctorCardHtml).join('')
      : emptyHtml('ri-user-search-line', 'No doctors match your search', 'Try removing a filter or searching for a department.');

    // Keep the URL shareable.
    const url = new URLSearchParams();
    if (q.value.trim()) url.set('q', q.value.trim());
    if (dept.value) url.set('department', dept.value);
    history.replaceState(null, '', `doctors.html${url.toString() ? `?${url}` : ''}`);
  };

  $('#doctor-filter').addEventListener('submit', (e) => e.preventDefault());
  q.addEventListener('input', debounce(render, 150));
  [dept, lang, sort].forEach((el) => el.addEventListener('change', render));
  render();
});
