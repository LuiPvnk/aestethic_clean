const message = document.querySelector('#account-message');
const loginForm = document.querySelector('#login-form');
const registerForm = document.querySelector('#register-form');
const registerButton = document.querySelector('#show-register');

async function submitForm(endpoint, form) {
  message.textContent = '';
  const data = Object.fromEntries(new FormData(form));
  let response;
  try {
    response = await fetch(`/api/auth/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor. Abre la aplicación desde el backend.');
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('El servidor devolvió una respuesta inválida.');
  }
  if (!response.ok) throw new Error(result.error || 'No se pudo completar la solicitud.');
  window.location.assign('dashboard.html');
}

for (const [form, endpoint] of [[loginForm, 'login'], [registerForm, 'register']]) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await submitForm(endpoint, form);
    } catch (error) {
      message.textContent = error.message;
      message.classList.add('form-message--error');
    } finally {
      button.disabled = false;
    }
  });
}

registerButton.addEventListener('click', () => {
  registerForm.hidden = !registerForm.hidden;
  registerButton.setAttribute('aria-expanded', String(!registerForm.hidden));
  registerForm.hidden
    ? registerButton.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    : registerForm.querySelector('input').focus();
});
