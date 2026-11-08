const message = document.querySelector('#dashboard-message');
const roleLabels = { admin: 'Administrador', collaborator: 'Colaborador', client: 'Cliente' };

function showMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle('form-message--error', isError);
}

async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor. Abre la aplicación desde el backend.');
  }
  if (response.status === 204) return null;
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('El servidor devolvió una respuesta inválida.');
  }
  if (!response.ok) {
    const error = new Error(result.error || 'No se pudo completar la solicitud.');
    error.status = response.status;
    throw error;
  }
  return result;
}

function addText(parent, tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatMoney(value) {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(Number(value));
}

function statusLabel(status) {
  return {
    received: 'Recibida',
    in_progress: 'En proceso',
    resolved: 'Resuelta',
    closed: 'Cerrada',
  }[status] || status;
}

async function loadRequests(user) {
  const { requests } = await api('/api/requests');
  const list = document.querySelector('#requests-list');
  list.replaceChildren();
  if (!requests.length) {
    addText(list, 'p', 'Todavía no hay solicitudes registradas.', 'empty-state');
    return;
  }

  for (const request of requests) {
    const card = document.createElement('article');
    card.className = 'request-card';
    const top = document.createElement('div');
    top.className = 'request-card__top';
    addText(top, 'h3', `${request.service} · #${request.id}`);
    addText(top, 'span', statusLabel(request.status), `status-badge status-badge--${request.status}`);
    card.append(top);
    if (user.role !== 'client') addText(card, 'p', `Cliente: ${request.clientName} (${request.clientEmail})`, 'request-meta');
    addText(card, 'p', request.description);
    addText(card, 'p', `Registrada: ${formatDate(request.createdAt)}`, 'request-meta');

    if (request.hasPhoto) {
      const photo = document.createElement('img');
      photo.className = 'request-photo';
      photo.src = `/api/requests/${request.id}/photo`;
      photo.alt = `Foto de la solicitud ${request.id}`;
      photo.loading = 'lazy';
      card.append(photo);
    }
    if (request.resolutionNote) addText(card, 'p', `Nota de resolución: ${request.resolutionNote}`, 'resolution-note');

    if (['admin', 'collaborator'].includes(user.role)) {
      const updateForm = document.createElement('form');
      updateForm.className = 'status-form';
      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Actualizar estado');
      const availableStatuses = user.role === 'admin'
        ? ['received', 'in_progress', 'resolved', 'closed']
        : ['in_progress', 'resolved'];
      for (const status of availableStatuses) {
        const option = document.createElement('option');
        option.value = status;
        option.textContent = statusLabel(status);
        option.selected = status === request.status;
        select.append(option);
      }
      const note = document.createElement('input');
      note.type = 'text';
      note.maxLength = 1000;
      note.placeholder = 'Nota de resolución (opcional)';
      note.setAttribute('aria-label', 'Nota de resolución');
      note.value = request.resolutionNote || '';
      const save = document.createElement('button');
      save.className = 'outline-button';
      save.type = 'submit';
      save.textContent = 'Actualizar';
      updateForm.append(select, note, save);
      updateForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        save.disabled = true;
        try {
          await api(`/api/requests/${request.id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: select.value, resolutionNote: note.value }),
          });
          showMessage(`La solicitud #${request.id} fue actualizada.`);
          await loadRequests(user);
        } catch (error) {
          showMessage(error.message, true);
        } finally {
          save.disabled = false;
        }
      });
      card.append(updateForm);
    }
    list.append(card);
  }
}

async function loadReports(date = '') {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  const { entries, totals } = await api(`/api/reports${query}`);
  const totalsContainer = document.querySelector('#report-totals');
  totalsContainer.replaceChildren();
  addText(totalsContainer, 'p', `Ingresos: ${formatMoney(totals.income)}`);
  addText(totalsContainer, 'p', `Gastos: ${formatMoney(totals.expenses)}`);
  addText(totalsContainer, 'p', `Balance: ${formatMoney(Number(totals.income) - Number(totals.expenses))}`);
  const list = document.querySelector('#reports-list');
  list.replaceChildren();
  if (!entries.length) addText(list, 'p', 'Todavía no hay registros financieros.', 'empty-state');
  for (const entry of entries) {
    const card = document.createElement('article');
    card.className = 'request-card';
    addText(card, 'h3', `${entry.kind === 'income' ? 'Ingreso' : 'Gasto'} · ${formatMoney(entry.amount)}`);
    addText(card, 'p', `${entry.category}${entry.service ? ` · ${entry.service}` : ''}`);
    addText(card, 'p', entry.description);
    addText(card, 'p', `${entry.entry_date} · Registrado por ${entry.created_by}`, 'request-meta');
    list.append(card);
  }
}

async function loadUsers() {
  const { users } = await api('/api/users');
  const list = document.querySelector('#users-list');
  list.replaceChildren();
  if (!users.length) addText(list, 'p', 'No hay cuentas de personal.', 'empty-state');
  for (const user of users) {
    const card = document.createElement('article');
    card.className = 'request-card';
    addText(card, 'h3', user.name);
    addText(card, 'p', `${user.email} · ${roleLabels[user.role]}`);
    list.append(card);
  }
}

function readPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return reject(new Error('La foto debe ser JPG, PNG o WebP.'));
    }
    if (file.size > 5 * 1024 * 1024) return reject(new Error('La foto no puede superar los 5 MB.'));
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(new Error('No se pudo leer la foto.')));
    reader.readAsDataURL(file);
  });
}

async function initialize() {
  let user;
  try {
    ({ user } = await api('/api/auth/me'));
  } catch (error) {
    if (error.status === 401) {
      window.location.replace('login.html');
      return;
    }
    showMessage(error.message, true);
    return;
  }

  document.querySelector('#user-name').textContent = user.name;
  document.querySelector('#user-role').textContent = roleLabels[user.role];
  document.querySelector('#dashboard-title').textContent = `Hola, ${user.name}`;

  const clientSection = document.querySelector('#client-section');
  const reportSection = document.querySelector('#admin-reports');
  const usersSection = document.querySelector('#admin-users');
  clientSection.hidden = user.role !== 'client';
  reportSection.hidden = user.role !== 'admin';
  usersSection.hidden = user.role !== 'admin';
  document.querySelector('#requests-heading').textContent =
    user.role === 'client' ? 'Mis solicitudes' : 'Solicitudes de servicio';

  document.querySelector('#refresh-requests').addEventListener('click', () => {
    loadRequests(user).catch((error) => showMessage(error.message, true));
  });
  document.querySelector('#logout-button').addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
      window.location.replace('login.html');
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  if (user.role === 'client') {
    document.querySelector('#request-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const photo = await readPhoto(form.elements.photo.files[0]);
        await api('/api/requests', {
          method: 'POST',
          body: JSON.stringify({
            service: form.elements.service.value,
            description: form.elements.description.value,
            photo,
          }),
        });
        form.reset();
        showMessage('Tu solicitud fue enviada correctamente.');
        await loadRequests(user);
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  }

  if (user.role === 'admin') {
    const kind = document.querySelector('#entry-kind');
    const service = document.querySelector('#entry-service');
    const category = document.querySelector('#entry-category');
    const updateEntryFields = () => {
      const isExpense = kind.value === 'expense';
      service.disabled = isExpense;
      service.required = !isExpense;
      if (isExpense && category.value === 'Servicio') category.value = 'Equipos';
      if (!isExpense && category.value !== 'Servicio') category.value = 'Servicio';
      for (const option of category.options) {
        option.hidden = isExpense ? option.value === 'Servicio' : option.value !== 'Servicio';
      }
    };
    kind.addEventListener('change', updateEntryFields);
    updateEntryFields();
    const reportDate = document.querySelector('#reports-date');
    const localDate = new Date();
    localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
    reportDate.value = localDate.toISOString().slice(0, 10);
    document.querySelector('#entry-date').value = reportDate.value;
    document.querySelector('#filter-reports').addEventListener('click', () => {
      loadReports(reportDate.value).catch((error) => showMessage(error.message, true));
    });
    document.querySelector('#all-reports').addEventListener('click', () => {
      reportDate.value = '';
      loadReports().catch((error) => showMessage(error.message, true));
    });
    document.querySelector('#report-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await api('/api/reports', {
          method: 'POST',
          body: JSON.stringify(Object.fromEntries(new FormData(form))),
        });
        reportDate.value = form.elements.date.value;
        form.elements.amount.value = '';
        form.elements.description.value = '';
        showMessage('El registro diario fue guardado.');
        await loadReports(reportDate.value);
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
    document.querySelector('#user-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await api('/api/users', {
          method: 'POST',
          body: JSON.stringify(Object.fromEntries(new FormData(form))),
        });
        form.reset();
        showMessage('La cuenta de personal fue creada.');
        await loadUsers();
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  }

  try {
    await loadRequests(user);
    if (user.role === 'admin') {
      await Promise.all([loadReports(document.querySelector('#reports-date').value), loadUsers()]);
    }
  } catch (error) {
    showMessage(error.message, true);
  }
}

initialize();
