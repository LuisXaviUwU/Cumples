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
          <img src="${c.profile_image || '/img/yocapi.png'}" onerror="this.src='/img/yocapi.png'" alt="${c.display_name}" class="today-avatar">
          <div class="today-info">
            <h4>${c.display_name} <span style="font-size:0.75rem; font-weight:700; color:${tagColor}; margin-left:8px;">${tagText}</span></h4>
            <p>${c.custom_message ? `"${c.custom_message}"` : 'Sin mensaje personalizado'} &bull; Sonido registrado: <strong>${c.selected_sound}</strong></p>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <select class="today-sound-select" style="background:#1e1537;border:1px solid rgba(145,70,255,0.3);color:#e2e8f0;border-radius:8px;padding:6px 10px;font-size:0.8rem;cursor:pointer;">
            <option value="HBSilbato.mp3" ${c.selected_sound === 'HBSilbato.mp3' ? 'selected' : ''}>🎺 Silbato Festivo</option>
            <option value="HBVoz.mp3" ${c.selected_sound === 'HBVoz.mp3' ? 'selected' : ''}>🎤 Felicitación de Voz</option>
            <option value="MBMusica.mp3" ${c.selected_sound === 'MBMusica.mp3' ? 'selected' : ''}>🎵 Música de Fiesta</option>
          </select>
          <button class="btn-alert-direct" data-user="${c.display_name}" data-avatar="${c.profile_image}" data-sound="${c.selected_sound}" data-msg="${c.custom_message || ''}">
            🎉 Lanzar a OBS
          </button>
        </div>
      `;

      const soundSel = card.querySelector('.today-sound-select');

      card.querySelector('.btn-alert-direct').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const selectedSound = soundSel.value;
        btn.disabled = true;
        btn.textContent = 'Enviando...';

        try {
          const postRes = await authFetch('/api/dashboard/trigger-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user: btn.dataset.user,
              avatar: btn.dataset.avatar,
              sound: selectedSound,
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
      const isLocked = b.birthday_unlocked !== true && b.birth_month && b.birth_day;

      tr.innerHTML = `
        <td style="display:flex;align-items:center;gap:10px;">
          <img src="${b.profile_image || '/img/yocapi.png'}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">
          <div>
            <strong>${b.display_name}</strong>
            <div style="font-size:0.75rem;color:#64748b;">@${b.username}</div>
          </div>
        </td>
        <td>
          <strong>${b.birth_day} de ${MONTH_NAMES[b.birth_month]}</strong>
          ${isLocked ? '<span title="Fecha bloqueada 1 año" style="margin-left:6px;font-size:0.7rem;color:#94a3b8;">🔒</span>' : '<span title="Fecha desbloquada" style="margin-left:6px;font-size:0.7rem;color:#10b981;">🔓</span>'}
        </td>
        <td style="color:#cbd5e1;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${b.custom_message || '-'}</td>
        <td><span style="font-size:0.75rem;background:rgba(255,255,255,0.06);padding:3px 8px;border-radius:6px;">${b.selected_sound || 'HBSilbato.mp3'}</span></td>
        <td style="color:#64748b;font-size:0.8rem;">${regDate}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="btn-copy" style="padding:5px 8px;font-size:0.72rem;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.35);color:#10b981;margin-right:4px;display:inline-flex;" data-unlock="${b.username}">${isLocked ? '🔓 Desbloquear' : '✅ Desbloqueado'}</button>
          <button class="btn-copy" style="padding:5px 8px;font-size:0.72rem;background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3);color:#fbbf24;margin-right:4px;display:inline-flex;" data-change-date="${b.username}">📅 Cambiar Fecha</button>
          <button class="btn-copy" style="padding:5px 8px;font-size:0.72rem;background:rgba(145,70,255,0.2);border:1px solid rgba(145,70,255,0.4);color:#bf94ff;margin-right:4px;display:inline-flex;" data-launch-alert="${b.username}" data-avatar="${b.profile_image}" data-msg="${b.custom_message || ''}">🚀 Lanzar Alerta</button>
          <button class="btn-del" data-id="${b.username}">Eliminar</button>
        </td>
      `;

      // Desbloquear fecha
      tr.querySelector('[data-unlock]').addEventListener('click', async () => {
        try {
          const res = await authFetch(`/api/dashboard/users/${b.username}/unlock-date`, { method: 'POST' });
          const data = await res.json();
          if (data.success) {
            showToast(data.message, 'success');
            loadBirthdays();
          } else {
            showToast(data.error || 'Error al desbloquear', 'error');
          }
        } catch {
          showToast('Error de conexión', 'error');
        }
      });

      // Cambiar Fecha directamente
      tr.querySelector('[data-change-date]').addEventListener('click', () => {
        showChangeDateModal(b.username, b.display_name, b.birth_month, b.birth_day);
      });

      // Lanzar alerta con selección de audio
      tr.querySelector('[data-launch-alert]').addEventListener('click', () => {
        showLaunchAlertModal(b.username, b.display_name, b.profile_image, b.custom_message, b.selected_sound);
      });

      // Reset PIN desde modal custom (sin usar prompt nativo)
      // Nota: El botón Reset Clave fue eliminado del HTML de la tabla; el acceso
      // al reset de clave ahora se hace desde la sección de Seguridad del usuario.

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

// ─── Modales del Dashboard ───────────────────────────────────────────────────

function createDashboardModal(html) {
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px);';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1a1035;border:1px solid rgba(145,70,255,0.3);border-radius:20px;padding:32px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.6);';
  box.innerHTML = html;
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  return { backdrop, box };
}

const MONTH_NAMES_ES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function showChangeDateModal(username, displayName, currentMonth, currentDay) {
  const { backdrop, box } = createDashboardModal(`
    <h3 style="font-size:1.2rem;font-weight:800;margin-bottom:8px;">📅 Cambiar Fecha de @${displayName}</h3>
    <p style="color:#94a3b8;font-size:0.85rem;margin-bottom:20px;">La nueva fecha quedará fijada por 1 año nuevamente.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div>
        <label style="display:block;font-size:0.75rem;color:#94a3b8;margin-bottom:6px;">MES</label>
        <select id="modal-change-month" style="width:100%;background:#120e1e;border:1px solid rgba(145,70,255,0.3);color:#e2e8f0;border-radius:10px;padding:10px 12px;font-size:0.9rem;">
          ${MONTH_NAMES_ES.slice(1).map((m, i) => `<option value="${i+1}" ${(i+1) === currentMonth ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="display:block;font-size:0.75rem;color:#94a3b8;margin-bottom:6px;">DÍA</label>
        <input type="number" id="modal-change-day" min="1" max="31" value="${currentDay}" style="width:100%;background:#120e1e;border:1px solid rgba(145,70,255,0.3);color:#e2e8f0;border-radius:10px;padding:10px 12px;font-size:0.9rem;box-sizing:border-box;">
      </div>
    </div>
    <div style="display:flex;gap:10px;">
      <button id="modal-change-cancel" style="flex:1;padding:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;border-radius:12px;cursor:pointer;font-weight:600;">Cancelar</button>
      <button id="modal-change-confirm" style="flex:2;padding:12px;background:linear-gradient(135deg,#9146ff,#7c3aed);border:none;color:white;border-radius:12px;cursor:pointer;font-weight:700;">✅ Guardar Fecha</button>
    </div>
  `);

  box.querySelector('#modal-change-cancel').onclick = () => backdrop.remove();
  box.querySelector('#modal-change-confirm').onclick = async () => {
    const m = parseInt(box.querySelector('#modal-change-month').value, 10);
    const d = parseInt(box.querySelector('#modal-change-day').value, 10);
    if (isNaN(m) || isNaN(d) || d < 1 || d > 31) {
      showToast('Mes o día inválido', 'error');
      return;
    }
    try {
      const res = await authFetch(`/api/dashboard/users/${username}/change-date`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ birth_month: m, birth_day: d })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        backdrop.remove();
        loadBirthdays();
      } else {
        showToast(data.error || 'Error al cambiar fecha', 'error');
      }
    } catch {
      showToast('Error de conexión', 'error');
    }
  };
}

function showLaunchAlertModal(username, displayName, avatar, message, defaultSound) {
  const { backdrop, box } = createDashboardModal(`
    <h3 style="font-size:1.2rem;font-weight:800;margin-bottom:8px;">🚀 Lanzar Alerta de @${displayName}</h3>
    <p style="color:#94a3b8;font-size:0.85rem;margin-bottom:20px;">Elige el audio con el que se lanzará la alerta en OBS.</p>
    <div style="margin-bottom:16px;">
      <label style="display:block;font-size:0.75rem;color:#94a3b8;margin-bottom:8px;">EFECTO DE SONIDO</label>
      <div id="modal-sound-options" style="display:flex;flex-direction:column;gap:8px;">
        <label style="display:flex;align-items:center;gap:10px;background:rgba(145,70,255,0.08);border:1px solid rgba(145,70,255,0.2);border-radius:10px;padding:12px;cursor:pointer;">
          <input type="radio" name="modal-launch-sound" value="HBSilbato.mp3" ${defaultSound === 'HBSilbato.mp3' ? 'checked' : ''}> <span>🎺 Silbato Festivo</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;background:rgba(145,70,255,0.08);border:1px solid rgba(145,70,255,0.2);border-radius:10px;padding:12px;cursor:pointer;">
          <input type="radio" name="modal-launch-sound" value="HBVoz.mp3" ${defaultSound === 'HBVoz.mp3' ? 'checked' : ''}> <span>🎤 Felicitación de Voz</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;background:rgba(145,70,255,0.08);border:1px solid rgba(145,70,255,0.2);border-radius:10px;padding:12px;cursor:pointer;">
          <input type="radio" name="modal-launch-sound" value="MBMusica.mp3" ${defaultSound === 'MBMusica.mp3' ? 'checked' : ''}> <span>🎵 Música de Fiesta</span>
        </label>
      </div>
    </div>
    <div style="display:flex;gap:10px;">
      <button id="modal-launch-cancel" style="flex:1;padding:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;border-radius:12px;cursor:pointer;font-weight:600;">Cancelar</button>
      <button id="modal-launch-confirm" style="flex:2;padding:12px;background:linear-gradient(135deg,#f43f5e,#e11d48);border:none;color:white;border-radius:12px;cursor:pointer;font-weight:700;">🎉 Lanzar Ahora</button>
    </div>
  `);

  box.querySelector('#modal-launch-cancel').onclick = () => backdrop.remove();
  box.querySelector('#modal-launch-confirm').onclick = async () => {
    const soundRadio = box.querySelector('input[name="modal-launch-sound"]:checked');
    const sound = soundRadio ? soundRadio.value : 'HBSilbato.mp3';
    const btn = box.querySelector('#modal-launch-confirm');
    btn.disabled = true;
    btn.textContent = 'Enviando...';
    try {
      const res = await authFetch('/api/dashboard/trigger-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: displayName, avatar, sound, message: message || '¡Felicidades en tu día especial!' })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`¡Alerta de ${displayName} enviada a OBS!`, 'success');
        backdrop.remove();
        loadStats();
      } else {
        showToast(data.error || 'Error al lanzar alerta', 'error');
        btn.disabled = false;
        btn.textContent = '🎉 Lanzar Ahora';
      }
    } catch {
      showToast('Error de conexión', 'error');
      btn.disabled = false;
      btn.textContent = '🎉 Lanzar Ahora';
    }
  };
}

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
        body: JSON.stringify({ user, message, sound, theme })
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
