document.addEventListener('DOMContentLoaded', () => {
  const setLink = (id, text, href) => {
    const a = $(id);
    a.textContent = text;
    a.href = href;
  };
  setLink('#c-emergency', SITE.emergencyDesk, `tel:${SITE.emergencyDesk.replace(/\s/g, '')}`);
  setLink('#c-phone', SITE.phone, `tel:${SITE.phone.replace(/\s/g, '')}`);
  setLink('#c-email', SITE.email, `mailto:${SITE.email}`);
  $('#c-address').textContent = SITE.address;
  $('#c-map-address').textContent = SITE.address;
  const q = encodeURIComponent(`${SITE.fullName}, ${SITE.address}`);
  $('#c-map').src = `https://www.google.com/maps?q=${q}&output=embed`;
  $('#c-directions').href = `https://www.google.com/maps/dir/?api=1&destination=${q}`;

  // Pre-fill for logged-in users.
  const user = Session.token ? Session.user : null;
  const form = $('#enquiry-form');
  if (user) {
    form.name.value = user.name || '';
    form.email.value = user.email || '';
    form.phone.value = user.phone || '';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(form)) return;
    const btn = $('button[type=submit]', form);
    await withLoading(btn, async () => {
      try {
        const res = await api('/enquiries', { method: 'POST', body: formData(form), auth: false });
        form.reset();
        toast(res.message, 'success', 7000);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
});
