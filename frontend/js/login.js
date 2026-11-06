const form = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginMessage = document.getElementById('loginMsg');
const togglePassword = document.getElementById('togglePassword');

togglePassword.addEventListener('click', () => {
  passwordInput.type = passwordInput.type === 'password' ? 'text' : 'password';
  const visible = passwordInput.type === 'text';
  togglePassword.classList.toggle('is-visible', visible);
  togglePassword.setAttribute('aria-pressed', String(visible));
  togglePassword.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  togglePassword.title = visible ? 'Hide password' : 'Show password';
});

async function submitLogin(event) {
  event.preventDefault();
  loginMessage.textContent = '';
  if (!usernameInput.value.trim() || !passwordInput.value) {
    loginMessage.textContent = 'Please enter username and password.';
    return;
  }
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    const result = await iotApi.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: usernameInput.value.trim(), password: passwordInput.value })
    });
    sessionStorage.setItem('iotToken', result.token);
    sessionStorage.setItem('iotUser', JSON.stringify(result.user));
    window.location.replace('dashboard.html');
  } catch (err) {
    loginMessage.textContent = err.message;
  } finally {
    submit.disabled = false;
  }
}

form.addEventListener('submit', submitLogin);
