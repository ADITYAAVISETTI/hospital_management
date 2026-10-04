// Small behaviours for the privacy and FAQ pages.
document.addEventListener('DOMContentLoaded', () => {
  const addr = $('#p-address');
  if (addr) addr.textContent = SITE.address;

  const search = $('#faq-search');
  if (search) {
    const items = $$('.faq details');
    search.addEventListener(
      'input',
      debounce(() => {
        const q = search.value.trim().toLowerCase();
        let shown = 0;
        items.forEach((d) => {
          const match = !q || d.textContent.toLowerCase().includes(q);
          d.classList.toggle('hidden', !match);
          d.open = Boolean(q) && match;
          if (match) shown += 1;
        });
        $$('.faq-group').forEach((g) => g.classList.toggle('hidden', !$$('details:not(.hidden)', g).length));
        $('#faq-empty').classList.toggle('hidden', shown > 0);
      }, 150)
    );
  }
});
