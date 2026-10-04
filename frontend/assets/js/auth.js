// Login and registration pages.

/** Only allow redirects to pages on this site (never to another domain). */
function safeNext() {
  const next = params.get('next') || '';
  return /^[a-z0-9-]+\.html(\?[^#]*)?$/i.test(next) ? next : '';
}

function afterLogin(user) {
  location.replace(safeNext() || homeFor(user.role));
}

document.addEventListener('DOMContentLoaded', () => {
  initPasswordToggles();
  initForgotAndReset();
  showDemoAccountsLocally();

  // Already logged in? Skip the login/register form.
  const page = document.body.dataset.page;
  if ((page === 'login' || page === 'register') && Session.token && Session.user) {
    afterLogin(Session.user);
    return;
  }

  // Carry ?next= across the login <-> register links.
  const next = safeNext();
  if (next) {
    const suffix = `?next=${encodeURIComponent(next)}`;
    const toRegister = $('#to-register');
    const toLogin = $('#to-login');
    if (toRegister) toRegister.href += suffix;
    if (toLogin) toLogin.href += suffix;
  }

  const loginForm = $('#login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validateForm(loginForm)) return;
      await withLoading($('button[type=submit]', loginForm), async () => {
        try {
          const session = await api('/auth/login', { method: 'POST', body: formData(loginForm), auth: false });
          Session.save(session);
          toast(`Welcome back, ${session.user.name}!`, 'success');
          afterLogin(session.user);
        } catch (err) {
          toast(err.message, 'error');
          loginForm.password.value = '';
          loginForm.password.focus();
        }
      });
    });
  }

  const registerForm = $('#register-form');
  if (registerForm) {
    registerForm.dateOfBirth.max = todayStr();
    const pw2 = registerForm.password2;
    const checkMatch = () => pw2.setCustomValidity(pw2.value && pw2.value !== registerForm.password.value ? 'Passwords do not match.' : '');
    pw2.addEventListener('input', checkMatch);
    registerForm.password.addEventListener('input', checkMatch);
    registerForm.password.addEventListener('invalid', () => {
      if (registerForm.password.validity.patternMismatch) {
        registerForm.password.setCustomValidity('Use at least 8 characters with at least one letter and one number.');
      }
    });
    registerForm.password.addEventListener('input', () => registerForm.password.setCustomValidity(''));

    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      checkMatch();
      if (!validateForm(registerForm)) return;
      const { password2, terms, ...body } = formData(registerForm);
      await withLoading($('button[type=submit]', registerForm), async () => {
        try {
          const session = await api('/auth/register', { method: 'POST', body, auth: false });
          Session.save(session);
          toast(`Welcome, ${session.user.name}! Your UHID is ${session.user.uhid}.`, 'success', 7000);
          afterLogin(session.user);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  }
});

// Forgot-password and reset-password pages.
function initForgotAndReset() {
  const forgot = $('#forgot-form');
  if (forgot) {
    forgot.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validateForm(forgot)) return;
      await withLoading($('button[type=submit]', forgot), async () => {
        try {
          const res = await api('/auth/forgot-password', { method: 'POST', body: formData(forgot), auth: false });
          $('#forgot-message').textContent = res.message;
          forgot.classList.add('hidden');
          $('#forgot-done').classList.remove('hidden');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  }

  const reset = $('#reset-form');
  if (reset) {
    const token = params.get('token') || '';
    if (!/^[a-f0-9]{64}$/.test(token)) {
      reset.classList.add('hidden');
      $('#reset-invalid').classList.remove('hidden');
      return;
    }
    // Remove the token from the address bar and browser history.
    history.replaceState(null, '', 'reset-password.html');
    const pw2 = reset.password2;
    pw2.addEventListener('input', () => pw2.setCustomValidity(''));
    reset.addEventListener('submit', async (e) => {
      e.preventDefault();
      pw2.setCustomValidity(pw2.value !== reset.password.value ? 'Passwords do not match.' : '');
      if (!validateForm(reset)) return;
      await withLoading($('button[type=submit]', reset), async () => {
        try {
          const res = await api('/auth/reset-password', { method: 'POST', body: { token, password: reset.password.value }, auth: false });
          Session.clear(); // any old session on this browser is now invalid
          toast(res.message, 'success', 6000);
          setTimeout(() => location.replace('login.html'), 1200);
        } catch (err) {
          toast(err.message, 'error', 7000);
        }
      });
    });
  }
}

// Demo logins help during development only. They are never part of the page on
// the live site (not even hidden), and the live database has no demo accounts.
function showDemoAccountsLocally() {
  const slot = $('#demo-slot');
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname) || location.protocol === 'file:';
  if (!slot || !local) return;
  slot.innerHTML = `
    <details class="demo-logins">
      <summary>Demo accounts (after running <code>npm run seed</code>)</summary>
      <p style="margin:10px 0 0">
        Patient: <code>patient@citycare.test</code> / <code>Patient@1234</code><br>
        Doctor: <code>arjun.mehta@citycare.test</code> / <code>Doctor@1234</code><br>
        Admin: <code>admin@citycare.test</code> / <code>Admin@1234</code>
      </p>
    </details>`;
}
