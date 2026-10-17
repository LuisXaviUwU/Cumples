/**
 * YoCapi Birthday System — Streamer Dashboard Controller
 */

let dashboardKey = '';
let currentTab = 'overview';

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';

  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

async function authFetch(url, options = {}) {
  return fetch(url, options);
}

// Cambiar de Pestaña
function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.tab === tabId);
  });
  document.querySelectorAll('.dash-tab-content').forEach(content => {
    content.style.display = 'none';
  });

  const activeContent = document.getElementById(`tab-${tabId}`);
  if (activeContent) activeContent.style.display = 'block';

  // Título
  const titleEl = document.getElementById('page-title');
  if (tabId === 'overview') titleEl.innerHTML = '<span>📊</span> Resumen del Sistema';
  if (tabId === 'today') {
    titleEl.innerHTML = '<span>🎉</span> Cumpleañeros de Hoy & Período de Gracia';
    loadTodayCelebrants();
  }
  if (tabId === 'birthdays') {
    titleEl.innerHTML = '<span>👥</span> Registro Completo de Cumpleaños';
    loadBirthdays();
  }
  if (tabId === 'overlay-test') titleEl.innerHTML = '<span>🚀</span> Lanzador y Pruebas de Overlay';
  if (tabId === 'logs') {
    titleEl.innerHTML = '<span>📜</span> Historial de Alertas en Stream';
    loadLogs();
  }
}

// Cargar Estadísticas y OBS URL
async function loadStats() {
  try {
    const res = await authFetch('/api/dashboard/stats');
    const data = await res.json();

    document.getElementById('stat-total').textContent = data.totalRegistered;
    document.getElementById('stat-today').textContent = data.todayCount;
    document.getElementById('stat-grace').textContent = data.graceCount;
    document.getElementById('stat-alerts').textContent = data.totalAlertsSent;

    // Estado OBS
    const obsDot = document.getElementById('obs-dot');
    const obsText = document.getElementById('obs-status-text');
    if (data.activeOverlayConnections > 0) {
      obsDot.style.background = '#10b981';
      obsDot.style.boxShadow = '0 0 8px #10b981';
      obsText.textContent = `OBS: Conectado (${data.activeOverlayConnections})`;
      obsText.style.color = '#10b981';
    } else {
      obsDot.style.background = '#64748b';
      obsDot.style.boxShadow = 'none';
      obsText.textContent = 'OBS: Desconectado';
      obsText.style.color = '#94a3b8';
    }

    // URL OBS
    const obsUrl = `${window.location.origin}/overlay?token=${encodeURIComponent(data.overlayToken)}`;
    document.getElementById('obs-url-display').value = obsUrl;
  } catch (err) {
    console.error('Error cargando estadísticas:', err);
  }
}

// Cargar Cumpleañeros de Hoy
async function loadTodayCelebrants() {
  const container = document.getElementById('today-celebrants-list');
  container.innerHTML = '<p style="color:#94a3b8;">Cargando cumpleañeros...</p>';

  try {
    const res = await authFetch('/api/dashboard/today');
    const list = await res.json();

    if (!list || list.length === 0) {
      container.innerHTML = `
        <div class="glass-card" style="text-align:center; padding: 36px;">
          <div style="font-size:2rem; margin-bottom:8px;">☕</div>
          <h4 style="font-size:1.1rem; font-weight:700;">No hay cumpleaños para hoy</h4>
          <p style="color:#94a3b8; font-size:0.85rem; margin-top:4px;">Ningún seguidor cumple años hoy ni está dentro del período de gracia de 14 días.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    list.forEach(c => {
      const card = document.createElement('div');
      card.className = 'today-item-card';

      const tagText = c.status.isToday ? '🎂 ¡CUMPLEAÑOS HOY!' : `🎈 Período de Gracia (${c.status.daysRemainingInGrace} días rest.)`;
      const tagColor = c.status.isToday ? 'var(--c-pink)' : 'var(--c-gold)';

      card.innerHTML = `
        <div class="today-item-left">
          <img src="${c.profile_image || '/img/yocapi.png'}" alt="${c.display_name}" class="today-avatar">
          <div class="today-info">
            <h4>${c.display_name} <span style="font-size:0.75rem; font-weight:700; color:${tagColor}; margin-left:8px;">${tagText}</span></h4>
            <p>${c.custom_message ? `"${c.custom_message}"` : 'Sin mensaje personalizado'} • Sonido: <strong>${c.selected_sound}</strong></p>
          </div>
        </div>
        <div>
          <button class="btn-alert-direct" data-user="${c.display_name}" data-avatar="${c.profile_image}" data-sound="${c.selected_sound}" data-msg="${c.custom_message || ''}">
            🎉 Lanzar a OBS
          </button>
        </div>
      `;

      card.querySelector('.btn-alert-direct').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Enviando...';

        try {
          const postRes = await authFetch('/api/dashboard/trigger-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user: btn.dataset.user,
              avatar: btn.dataset.avatar,
              sound: btn.dataset.sound,
              message: btn.dataset.msg
            })
          });
          const resData = await postRes.json();
          if (resData.success) {
            showToast(`¡Alerta de ${btn.dataset.user} enviada a OBS!`, 'success');
          } else {
            showToast(resData.error || 'Error al enviar', 'error');
          }
        } catch {
          showToast('Error conectando con el servidor', 'error');
        } finally {
          btn.disabled = false;
          btn.innerHTML = '🎉 Lanzar a OBS';
        }
      });

      container.appendChild(card);
    });

  } catch (err) {
    container.innerHTML = '<p style="color:var(--c-pink);">Error al obtener celebrantes.</p>';
  }
}

// Cargar Base de Datos de Cumpleaños
const MONTH_NAMES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

async function loadBirthdays() {
  const tbody = document.getElementById('bday-table-body');
  const search = document.getElementById('filter-search').value;
  const month = document.getElementById('filter-month').value;

  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:24px;">Cargando registros...</td></tr>';

  try {
    const query = new URLSearchParams();
    if (search) query.set('search', search);
    if (month) query.set('month', month);

    const res = await authFetch(`/api/dashboard/birthdays?${query.toString()}`);
    const list = await res.json();

    if (!list || list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:24px;">No se encontraron registros.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    list.forEach(b => {
      const tr = document.createElement('tr');
      const regDate = b.registered_at ? new Date(b.registered_at).toLocaleDateString() : '-';

      tr.innerHTML = `
        <td style="display:flex;align-items:center;gap:10px;">
          <img src="${b.profile_image || '/img/yocapi.png'}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">
          <div>
            <strong>${b.display_name}</strong>
            <div style="font-size:0.75rem;color:#64748b;">@${b.username}</div>
          </div>
        </td>
        <td><strong>${b.birth_day} de ${MONTH_NAMES[b.birth_month]}</strong></td>
        <td style="color:#cbd5e1;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${b.custom_message || '-'}</td>
        <td><span style="font-size:0.75rem;background:rgba(255,255,255,0.06);padding:3px 8px;border-radius:6px;">${b.selected_sound || 'HBSilbato.mp3'}</span></td>
        <td style="color:#64748b;font-size:0.8rem;">${regDate}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="btn-copy" style="padding: 5px 10px; font-size: 0.75rem; background: rgba(145, 70, 255, 0.2); border: 1px solid rgba(145, 70, 255, 0.4); color: #bf94ff; margin-right: 6px; display:inline-flex;" data-reset="${b.username}">🔑 Reset Clave</button>
          <button class="btn-del" data-id="${b.username}">Eliminar</button>
        </td>
      `;

      tr.querySelector('[data-reset]').addEventListener('click', async () => {
        const newPin = prompt(`Ingresa la nueva contraseña (6 a 15 caracteres) para @${b.username}:`, 'yocapi123');
        if (newPin === null) return;
        if (newPin.trim().length < 6 || newPin.trim().length > 15) {
          showToast('La contraseña debe tener entre 6 y 15 caracteres', 'error');
          return;
        }

        try {
          const res = await authFetch(`/api/dashboard/users/${b.username}/reset-pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_password: newPin.trim() })
          });
          const data = await res.json();
          if (data.success) {
            showToast(data.message, 'success');
          } else {
            showToast(data.error || 'Error al cambiar contraseña', 'error');
          }
        } catch {
          showToast('Error de conexión', 'error');
        }
      });

      tr.querySelector('.btn-del').addEventListener('click', async () => {
        if (!confirm(`¿Eliminar el registro de ${b.display_name}?`)) return;
        try {
          const delRes = await authFetch(`/api/dashboard/birthdays/${b.username}`, { method: 'DELETE' });
          if (delRes.ok) {
            showToast('Registro eliminado', 'success');
            loadBirthdays();
            loadStats();
          }
        } catch {
          showToast('Error eliminando registro', 'error');
        }
      });

      tbody.appendChild(tr);
    });

  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--c-pink);padding:24px;">Error al cargar datos.</td></tr>';
  }
}

// Cargar Historial
async function loadLogs() {
  const tbody = document.getElementById('logs-table-body');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:24px;">Cargando historial...</td></tr>';

  try {
    const res = await authFetch('/api/dashboard/logs');
    const logs = await res.json();

    if (!logs || logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:24px;">Aún no se han registrado alertas en stream.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    logs.forEach(l => {
      const tr = document.createElement('tr');
      const time = new Date(l.launched_at).toLocaleString();
      tr.innerHTML = `
        <td><strong>${l.display_name}</strong></td>
        <td><span style="font-size:0.75rem;background:rgba(255,255,255,0.06);padding:3px 8px;border-radius:6px;">${l.sound_file}</span></td>
        <td style="color:#cbd5e1;">${l.message || '-'}</td>
        <td style="color:#64748b;font-size:0.8rem;">${time}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--c-pink);padding:24px;">Error cargando logs.</td></tr>';
  }
}



// Inicialización
document.addEventListener('DOMContentLoaded', () => {
  // Manejo de tabs
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Copiar URL de OBS
  document.getElementById('btn-copy-obs').addEventListener('click', () => {
    const urlInput = document.getElementById('obs-url-display');
    urlInput.select();
    navigator.clipboard.writeText(urlInput.value).then(() => {
      showToast('¡URL de OBS copiada al portapapeles!', 'success');
    }).catch(() => {
      showToast('Selecciona y copia la URL manualmente', 'info');
    });
  });

  // Botón refrescar
  document.getElementById('btn-refresh').addEventListener('click', () => {
    loadStats();
    if (currentTab === 'today') loadTodayCelebrants();
    if (currentTab === 'birthdays') loadBirthdays();
    if (currentTab === 'logs') loadLogs();
    showToast('Datos actualizados', 'info');
  });

  // Filtros de tabla
  document.getElementById('filter-search').addEventListener('input', () => loadBirthdays());
  document.getElementById('filter-month').addEventListener('change', () => loadBirthdays());

  // Formulario de prueba
  document.getElementById('test-alert-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('test-user').value;
    const message = document.getElementById('test-message').value;
    const sound = document.getElementById('test-sound').value;
    const theme = document.getElementById('test-theme').value;

    try {
      const res = await authFetch('/api/dashboard/trigger-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, message, sound, theme, avatar: '/img/yocapi.png' })
      });
      const data = await res.json();
      if (data.success) {
        showToast('¡Alerta de prueba enviada a OBS!', 'success');
        loadStats();
      } else {
        showToast(data.error || 'Error al enviar alerta', 'error');
      }
    } catch {
      showToast('Error conectando con el servidor', 'error');
    }
  });

  // Cargar estado inicial
  loadStats();
});
