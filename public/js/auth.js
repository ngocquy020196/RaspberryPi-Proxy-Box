/**
 * Login page — Frontend logic
 */

(function () {
  // Check if already authenticated
  fetch('/api/auth/check')
    .then(r => r.json())
    .then(data => {
      if (data.authenticated) {
        window.location.href = '/dashboard';
      }
    })
    .catch(() => {});

  const form = document.getElementById('loginForm');
  const passwordInput = document.getElementById('password');
  const loginBtn = document.getElementById('loginBtn');
  const errorEl = document.getElementById('loginError');
  const toggleBtn = document.getElementById('togglePassword');

  // Toggle password visibility
  toggleBtn.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    toggleBtn.innerHTML = isPassword
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  });

  // Login form submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const password = passwordInput.value.trim();
    if (!password) return;

    // Show loading
    loginBtn.disabled = true;
    loginBtn.querySelector('.btn-text').style.display = 'none';
    loginBtn.querySelector('.btn-loader').style.display = 'inline-flex';
    errorEl.style.display = 'none';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (data.success) {
        window.location.href = '/dashboard';
      } else {
        errorEl.textContent = data.error || 'Login failed';
        errorEl.style.display = 'block';
        passwordInput.focus();
      }
    } catch (error) {
      errorEl.textContent = 'Connection failed. Is the server running?';
      errorEl.style.display = 'block';
    } finally {
      loginBtn.disabled = false;
      loginBtn.querySelector('.btn-text').style.display = 'inline';
      loginBtn.querySelector('.btn-loader').style.display = 'none';
    }
  });

  // Focus on password field
  passwordInput.focus();
})();
