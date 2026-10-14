const form = document.getElementById('loginForm');
const user = document.getElementById('username');
const pass = document.getElementById('password');
const msg = document.getElementById('loginMsg');
const togglePassword = document.getElementById('togglePassword');

togglePassword.addEventListener('click', () => {
  pass.type = pass.type === 'password' ? 'text' : 'password';
  const visible = pass.type === 'text';
  togglePassword.classList.toggle('is-visible', visible);
  togglePassword.setAttribute('aria-pressed', String(visible));
  togglePassword.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  togglePassword.title = visible ? 'Hide password' : 'Show password';
});
form.addEventListener('submit', async e => {
  e.preventDefault();
  msg.textContent = '';
  if (!user.value.trim() || !pass.value) { msg.textContent = 'Please enter username and password.'; return; }
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    const result = await iotApi.request('/api/auth/login', {
      method:'POST', body:JSON.stringify({username:user.value.trim(), password:pass.value})
    });
    sessionStorage.setItem('iotToken', result.token);
    sessionStorage.setItem('iotUser', JSON.stringify(result.user));
    window.location.replace('dashboard.html');
  } catch(err) { msg.textContent = err.message; }
  finally { submit.disabled = false; }
});
