document.addEventListener('DOMContentLoaded', async () => {
  const list = $('#dept-list');
  const search = $('#dept-search');
  list.innerHTML = loaderHtml();

  let departments = [];
  try {
    departments = await api('/departments', { auth: false });
  } catch (err) {
    list.innerHTML = errorHtml(err);
    return;
  }

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const shown = departments.filter(
      (d) =>
        !q ||
        d.name.toLowerCase().includes(q) ||
        d.summary.toLowerCase().includes(q) ||
        (d.services || []).some((s) => s.toLowerCase().includes(q))
    );
    list.innerHTML = shown.length
      ? shown.map(departmentCardHtml).join('')
      : emptyHtml('ri-search-eye-line', 'No matching departments', 'Try a different word, or call us and we will guide you.');
  };

  search.addEventListener('input', debounce(render, 150));
  render();
});
