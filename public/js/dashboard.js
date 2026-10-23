/**
 * Yocapi Birthday System — Streamer Dashboard Controller
 */

let dashboardKey = '';
let currentTab = 'overview';

// Constantes globales accesibles en todo el script
const MONTH_NAMES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function updateNightbotHost() {
  const origin = window.location.origin;
  document.querySelectorAll('.nb-host-url').forEach(el => {
    el.textContent = origin;
  });
  const label = document.getElementById('nightbot-host-label');
  if (label) label.textContent = origin;
}

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
  if (tabId === 'nightbot') {
    titleEl.innerHTML = '<span>🤖</span> Bots de Twitch & Automatización';
    updateNightbotHost();
    if (typeof window._loadTwitchBotStatus === 'function') window._loadTwitchBotStatus();
  }
  if (tabId === 'logs') {
    titleEl.innerHTML = '<span>📜</span> Historial de Alertas en Stream';
    loadLogs();
  }
}

let baseObsToken = '';

// La URL de OBS solo lleva el token — tamaño, posición y animación
// se configuran desde el Simulador Visual y se aplican via SSE en tiempo real.
function updateObsUrlDisplay() {
  if (!baseObsToken) return;
  const obsUrl = `${window.location.origin}/overlay?token=${encodeURIComponent(baseObsToken)}`;
  const input = document.getElementById('obs-url-display');
  if (input) input.value = obsUrl;
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

    // URL OBS (solo token, sin parámetros de posición/escala)
    baseObsToken = data.overlayToken;
    updateObsUrlDisplay();

    // Estado de felicitaciones
    loadFelicitationStatus();
  } catch (err) {
    console.error('Error cargando estadísticas:', err);
  }
}

// Cargar y gestionar estado de felicitaciones en directo
async function loadFelicitationStatus() {
  try {
    const res = await authFetch('/api/dashboard/felicitations-status');
    const data = await res.json();
    updateFelicitationUI(data.enabled);
  } catch (err) {
    console.error('Error cargando estado de felicitaciones:', err);
  }
}

function updateFelicitationUI(enabled) {
  const badge = document.getElementById('felic-status-badge');
  const btn = document.getElementById('btn-toggle-felic');
  if (!badge || !btn) return;

  if (enabled) {
    badge.textContent = '🟢 Activas';
    badge.style.background = 'rgba(16, 185, 129, 0.2)';
    badge.style.color = '#10b981';
    badge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    btn.textContent = '🛑 Desactivar Felicitaciones';
    btn.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
    btn.style.boxShadow = '0 4px 15px rgba(239, 68, 68, 0.3)';
  } else {
    badge.textContent = '🔴 Desactivadas';
    badge.style.background = 'rgba(239, 68, 68, 0.2)';
    badge.style.color = '#f87171';
    badge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
    btn.textContent = '🎊 Activar Felicitaciones';
    btn.style.background = 'linear-gradient(135deg, var(--c-purple), var(--c-pink))';
    btn.style.boxShadow = '0 4px 15px rgba(145, 70, 255, 0.3)';
  }
}

// Cargar Cumpleañeros de Hoy & Próximos
async function loadTodayCelebrants() {
  const container = document.getElementById('today-celebrants-list');
  const upContainer = document.getElementById('upcoming-celebrants-list');
  if (container) container.innerHTML = '<p style="color:#94a3b8; padding: 12px 0;">Cargando cumpleañeros...</p>';
  if (upContainer) upContainer.innerHTML = '<p style="color:#94a3b8; padding: 12px 0;">Cargando próximos cumpleaños...</p>';

  // 1. Celebrantes Activos (Hoy y Período de Gracia)
  try {
    const res = await authFetch('/api/dashboard/today');
    const list = await res.json();

    if (!list || list.length === 0) {
      if (container) {
        container.innerHTML = `
          <div class="glass-card" style="text-align:center; padding: 32px 20px;">
            <div style="font-size:2rem; margin-bottom:8px;">☕</div>
            <h4 style="font-size:1.1rem; font-weight:700;">No hay cumpleaños para hoy</h4>
            <p style="color:#94a3b8; font-size:0.85rem; margin-top:4px;">Ningún seguidor cumple años hoy ni está dentro del período de gracia de 14 días.</p>
          </div>
        `;
      }
    } else {
      if (container) {
        container.innerHTML = '';
        list.forEach(c => {
          const card = document.createElement('div');
          card.className = 'today-item-card';

          const tagText = c.status.isToday ? '🎂 ¡CUMPLEAÑOS HOY!' : `🎈 Período de Gracia (${c.status.daysRemainingInGrace} días rest.)`;
          const tagColor = c.status.isToday ? 'var(--c-pink)' : 'var(--c-gold)';

          const currentCelebrationYear = c.status?.celebrationYear || new Date().getFullYear();
          const hasCelebrated = (parseInt(c.last_celebrated_year, 10) || 0) >= currentCelebrationYear;
          const celebBadge = hasCelebrated
            ? '<span style="font-size:0.72rem; color:#f87171; background:rgba(239,68,68,0.18); border:1px solid rgba(239,68,68,0.35); padding:2px 8px; border-radius:6px; font-weight:700;">✅ Ya lanzó este año</span>'
            : '<span style="font-size:0.72rem; color:#34d399; background:rgba(16,185,129,0.18); border:1px solid rgba(16,185,129,0.35); padding:2px 8px; border-radius:6px; font-weight:700;">⏳ Listo para lanzar</span>';

          card.innerHTML = `
            <div class="today-item-left">
              <img src="${c.profile_image || '/img/yocapi.png'}" onerror="this.src='/img/yocapi.png'" alt="${c.display_name}" class="today-avatar">
              <div class="today-info">
                <h4>
                  ${c.display_name} 
                  <span style="font-size:0.75rem; font-weight:700; color:${tagColor}; margin-left:8px;">${tagText}</span>
                  ${celebBadge}
                </h4>
                <p>${c.custom_message ? `"${c.custom_message}"` : 'Sin mensaje personalizado'} &bull; Sonido: <strong>${c.selected_sound || 'HBSilbato.mp3'}</strong></p>
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
              <button class="btn-copy btn-quick-reset-celebration" data-username="${c.username}" style="padding:6px 10px; font-size:0.78rem; background:rgba(16,185,129,0.2); border-color:rgba(16,185,129,0.4); color:#34d399; font-weight:700;" title="Permite que este usuario pueda volver a lanzar su alerta con !hoyesmicumple o desde la web">
                🔄 Permitir Relanzar
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

          card.querySelector('.btn-quick-reset-celebration')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = 'Reseteando...';
            try {
              const rRes = await authFetch(`/api/dashboard/users/${c.username}/reset-celebration`, { method: 'POST' });
              const rData = await rRes.json();
              if (rData.success) {
                showToast(rData.message, 'success');
                loadToday();
                loadBirthdays();
              } else {
                showToast(rData.error || 'Error al resetear', 'error');
              }
            } catch {
              showToast('Error de conexión', 'error');
            } finally {
              btn.disabled = false;
              btn.textContent = '🔄 Permitir Relanzar';
            }
          });

          container.appendChild(card);
        });
      }
    }
  } catch (err) {
    if (container) container.innerHTML = '<p style="color:var(--c-pink);">Error al obtener celebrantes.</p>';
  }

  // 2. Próximos Celebrantes (siguientes 14 días) — Carga SIEMPRE
  if (upContainer) {
    try {
      const pubRes = await fetch('/api/birthday/public-today');
      const pubData = await pubRes.json();
      if (!pubData.upcoming || pubData.upcoming.length === 0) {
        upContainer.innerHTML = `
          <div class="glass-card" style="text-align:center; padding: 24px;">
            <p style="color:#94a3b8; font-size:0.85rem; margin: 0;">🎈 No hay cumpleaños registrados en los próximos 14 días.</p>
          </div>
        `;
      } else {
        upContainer.innerHTML = '';
        const monthShortNames = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        pubData.upcoming.forEach(u => {
          const card = document.createElement('div');
          card.className = 'today-item-card';
          const daysBadge = u.daysUntil === 1 ? '¡Mañana!' : `En ${u.daysUntil} días`;
          card.innerHTML = `
            <div class="today-item-left">
              <img src="${u.profile_image || '/img/yocapi.png'}" onerror="this.src='/img/yocapi.png'" alt="${u.display_name}" class="today-avatar">
              <div class="today-info">
                <h4>
                  ${u.display_name} 
                  <span style="font-size:0.75rem; font-weight:800; background:rgba(168, 85, 247, 0.25); color:#c084fc; border:1px solid rgba(168, 85, 247, 0.45); padding:3px 10px; border-radius:12px; margin-left:8px;">
                    ${daysBadge} (${u.birth_day} de ${monthShortNames[u.birth_month]})
                  </span>
                </h4>
                <p style="color:#94a3b8; font-size:0.82rem; margin-top:2px;">
                  Fecha: <strong>${u.birth_day} de ${MONTH_NAMES[u.birth_month]}</strong> &bull; Sonido: <strong>${u.selected_sound || 'HBSilbato.mp3'}</strong>
                </p>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <button type="button" class="btn-copy btn-launch-upcoming" style="background:rgba(145,70,255,0.2); border-color:rgba(145,70,255,0.4); color:#bf94ff; font-size:0.8rem; padding:8px 14px; font-weight:700; display:inline-flex; align-items:center; gap:6px;">
                <span>🚀</span>
                <span>Lanzar a OBS</span>
              </button>
            </div>
          `;

          card.querySelector('.btn-launch-upcoming')?.addEventListener('click', () => {
            showLaunchAlertModal(u.username, u.display_name, u.profile_image, `¡Festejando por adelantado con @${u.display_name}! 🎂🎉`, u.selected_sound || 'HBSilbato.mp3');
          });

          upContainer.appendChild(card);
        });
      }
    } catch {
      upContainer.innerHTML = '<p style="color:#94a3b8;">No se pudieron cargar próximos cumpleaños.</p>';
    }
  }
}

// Cargar Base de Datos de Cumpleaños
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
        <td class="col-user">
          <div class="user-cell">
            <div style="position:relative;display:inline-block;">
              <img src="${b.profile_image || '/img/yocapi.png'}" alt="${b.display_name}" class="user-avatar-sm" onerror="this.src='/img/yocapi.png'">
              <button type="button" class="btn-quick-refresh-avatar" data-username="${b.username}" title="Actualizar foto desde Twitch" style="position:absolute;bottom:-3px;right:-3px;background:#9146ff;border:none;border-radius:50%;width:18px;height:18px;color:#fff;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;box-shadow:0 2px 6px rgba(0,0,0,0.5);">🔄</button>
            </div>
            <div class="user-meta">
              <strong>${b.display_name}</strong>
              <small>@${b.username}</small>
            </div>
          </div>
        </td>
        <td class="col-bday">
          <strong>${b.birth_day} de ${MONTH_NAMES[b.birth_month]}</strong>
          ${isLocked ? '<span title="Fecha bloqueada por 1 año" class="lock-indicator locked">🔒</span>' : '<span title="Fecha libre para editar" class="lock-indicator unlocked">🔓</span>'}
        </td>
        <td class="col-msg" title="${b.custom_message || ''}">${b.custom_message || '—'}</td>
        <td class="col-sound"><span class="sound-badge">${b.selected_sound || 'HBSilbato.mp3'}</span></td>
        <td class="col-reg">${regDate}</td>
        <td class="col-actions">
          <div class="actions-group">
            <button class="btn-act btn-act-launch" title="Lanzar alerta en directo a OBS" data-launch-alert="${b.username}">
              🚀 Lanzar
            </button>
            <button class="btn-act btn-act-reset" title="Permitir volver a lanzar alerta este año (resetea celebración)" data-reset-celebration="${b.username}">
              🔄 Relanzar
            </button>
            <button class="btn-act ${isLocked ? 'btn-act-unlock' : 'btn-act-free'}" title="${isLocked ? 'Desbloquear fecha de este usuario' : 'Fecha ya desbloqueada'}" data-unlock="${b.username}">
              ${isLocked ? '🔓 Abrir' : '✅ Libre'}
            </button>
            <button class="btn-act btn-act-name" title="Modificar nombre y foto de perfil" data-change-name="${b.username}">
              ✏️ Nombre
            </button>
            <button class="btn-act btn-act-date" title="Modificar fecha de cumpleaños" data-change-date="${b.username}">
              📅 Fecha
            </button>
            <button class="btn-act btn-act-del btn-del" title="Eliminar registro" data-id="${b.username}">
              🗑️
            </button>
          </div>
        </td>
      `;

      // Refrescar Avatar individual desde Twitch
      tr.querySelector('.btn-quick-refresh-avatar')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = '⏳';
        try {
          const res = await authFetch(`/api/dashboard/users/${b.username}/refresh-avatar`, { method: 'POST' });
          const data = await res.json();
          if (data.success) {
            showToast(data.message, 'success');
            loadBirthdays();
          } else {
            showToast(data.message || 'No se pudo actualizar foto', 'info');
          }
        } catch {
          showToast('Error conectando con el servidor', 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = '🔄';
        }
      });

      // Resetear celebración (permitir relanzar)
      tr.querySelector('[data-reset-celebration]')?.addEventListener('click', async () => {
        try {
          const res = await authFetch(`/api/dashboard/users/${b.username}/reset-celebration`, { method: 'POST' });
          const data = await res.json();
          if (data.success) {
            showToast(data.message, 'success');
            loadBirthdays();
            loadToday();
          } else {
            showToast(data.error || 'Error al resetear celebración', 'error');
          }
        } catch {
          showToast('Error de conexión', 'error');
        }
      });

      // Desbloquear fecha
      tr.querySelector('[data-unlock]')?.addEventListener('click', async () => {
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
      tr.querySelector('[data-change-date]')?.addEventListener('click', () => {
        showChangeDateModal(b.username, b.display_name, b.birth_month, b.birth_day);
      });

      // Cambiar Nombre y Foto del seguidor
      tr.querySelector('[data-change-name]')?.addEventListener('click', () => {
        showChangeNameModal(b.username, b.display_name, b.profile_image);
      });

      // Lanzar alerta con selección de audio
      tr.querySelector('[data-launch-alert]')?.addEventListener('click', () => {
        showLaunchAlertModal(b.username, b.display_name, b.profile_image, b.custom_message, b.selected_sound);
      });

      // Eliminar seguidor
      tr.querySelector('.btn-act-del, .btn-del, [data-id]')?.addEventListener('click', async () => {
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
    console.error('Error al cargar base de datos de cumpleaños:', err);
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--c-pink);padding:24px;">⚠️ Error al cargar datos: ${err.message || 'Revisa la conexión'}</td></tr>`;
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
    <label style="display:flex;align-items:center;gap:8px;margin-top:4px;margin-bottom:16px;cursor:pointer;font-size:0.83rem;color:#cbd5e1;">
      <input type="checkbox" id="modal-change-reset-celebration" checked style="accent-color:#9146ff;width:16px;height:16px;">
      <span>Permitir volver a lanzar alerta este año (Resetear celebración previa)</span>
    </label>
    <div style="display:flex;gap:10px;">
      <button id="modal-change-cancel" style="flex:1;padding:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;border-radius:12px;cursor:pointer;font-weight:600;">Cancelar</button>
      <button id="modal-change-confirm" style="flex:2;padding:12px;background:linear-gradient(135deg,#9146ff,#7c3aed);border:none;color:white;border-radius:12px;cursor:pointer;font-weight:700;">✅ Guardar Fecha</button>
    </div>
  `);

  box.querySelector('#modal-change-cancel').onclick = () => backdrop.remove();
  box.querySelector('#modal-change-confirm').onclick = async () => {
    const m = parseInt(box.querySelector('#modal-change-month').value, 10);
    const d = parseInt(box.querySelector('#modal-change-day').value, 10);
    const resetCelebration = box.querySelector('#modal-change-reset-celebration')?.checked ?? true;
    if (isNaN(m) || isNaN(d) || d < 1 || d > 31) {
      showToast('Mes o día inválido', 'error');
      return;
    }
    try {
      const res = await authFetch(`/api/dashboard/users/${username}/change-date`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ birth_month: m, birth_day: d, reset_celebration: resetCelebration })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        backdrop.remove();
        loadBirthdays();
        loadToday();
      } else {
        showToast(data.error || 'Error al cambiar fecha', 'error');
      }
    } catch {
      showToast('Error de conexión', 'error');
    }
  };
}

function showChangeNameModal(username, currentDisplayName, currentAvatar) {
  let pendingAvatar = currentAvatar || '/img/yocapi.png';

  const { backdrop, box } = createDashboardModal(`
    <h3 style="font-size:1.2rem;font-weight:800;margin-bottom:8px;display:flex;align-items:center;gap:8px;">
      <span>✏️</span> <span>Editar Usuario y Foto: @${username}</span>
    </h3>
    <p style="color:#94a3b8;font-size:0.85rem;margin-bottom:18px;">
      Corrige faltas de ortografía en el Nick de Twitch, ajusta su nombre visible o actualiza su foto de perfil.
    </p>

    <!-- Vista previa de Foto / Avatar -->
    <div style="display:flex;align-items:center;gap:16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px 16px;margin-bottom:16px;">
      <img id="modal-edit-avatar-preview" src="${pendingAvatar}" onerror="this.src='/img/yocapi.png'" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid #9146ff;box-shadow:0 0 12px rgba(145,70,255,0.4);">
      <div style="flex:1;">
        <div style="font-size:0.8rem;font-weight:700;color:#e2e8f0;margin-bottom:4px;">Foto de Perfil</div>
        <div style="font-size:0.75rem;color:#94a3b8;margin-bottom:8px;" id="modal-edit-avatar-status">Sincronizada con Twitch</div>
        <button type="button" id="modal-btn-fetch-twitch-avatar" style="padding:6px 12px;font-size:0.75rem;font-weight:700;background:rgba(145,70,255,0.2);border:1px solid rgba(145,70,255,0.5);color:#c084fc;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">
          <span>🔄</span> <span>Obtener Foto de Twitch</span>
        </button>
      </div>
    </div>

    <!-- Campo: Nick de Twitch -->
    <div style="margin-bottom:14px;">
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:0.75rem;color:#94a3b8;margin-bottom:6px;font-weight:700;">
        <span>NICK DE TWITCH (CUENTA)</span>
        <span style="font-size:0.7rem;color:#64748b;">(Modifícalo si el usuario escribió mal su nick)</span>
      </label>
      <input type="text" id="modal-change-username-input" maxlength="25" value="${username}" style="width:100%;background:#120e1e;border:1px solid rgba(145,70,255,0.4);color:#e2e8f0;border-radius:10px;padding:10px 14px;font-size:0.92rem;box-sizing:border-box;">
    </div>

    <!-- Campo: Nombre Visible -->
    <div style="margin-bottom:14px;">
      <label style="display:block;font-size:0.75rem;color:#94a3b8;margin-bottom:6px;font-weight:700;">NOMBRE PARA MOSTRAR EN STREAM</label>
      <input type="text" id="modal-change-name-input" maxlength="30" value="${currentDisplayName || username}" style="width:100%;background:#120e1e;border:1px solid rgba(145,70,255,0.4);color:#e2e8f0;border-radius:10px;padding:10px 14px;font-size:0.92rem;box-sizing:border-box;">
    </div>

    <!-- Campo: URL Personalizada (Opcional) -->
    <div style="margin-bottom:20px;">
      <label style="display:block;font-size:0.75rem;color:#94a3b8;margin-bottom:6px;font-weight:700;">URL DE FOTO PERSONALIZADA (OPCIONAL)</label>
      <input type="url" id="modal-change-avatar-input" placeholder="https://ejemplo.com/foto.jpg (o déjalo vacío para usar Twitch)" value="${pendingAvatar.startsWith('http') && !pendingAvatar.includes('static-cdn.jtvnw.net') ? pendingAvatar : ''}" style="width:100%;background:#120e1e;border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;border-radius:10px;padding:9px 12px;font-size:0.82rem;box-sizing:border-box;">
    </div>

    <div style="display:flex;gap:10px;">
      <button id="modal-name-cancel" style="flex:1;padding:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;border-radius:12px;cursor:pointer;font-weight:600;">Cancelar</button>
      <button id="modal-name-confirm" style="flex:2;padding:12px;background:linear-gradient(135deg,#06b6d4,#9146ff);border:none;color:white;border-radius:12px;cursor:pointer;font-weight:700;">💾 Guardar Cambios</button>
    </div>
  `);

  const previewImg = box.querySelector('#modal-edit-avatar-preview');
  const avatarStatus = box.querySelector('#modal-edit-avatar-status');
  const usernameInput = box.querySelector('#modal-change-username-input');
  const nameInput = box.querySelector('#modal-change-name-input');
  const customAvatarInput = box.querySelector('#modal-change-avatar-input');
  const btnFetchAvatar = box.querySelector('#modal-btn-fetch-twitch-avatar');

  // Preview de URL personalizada
  customAvatarInput.addEventListener('input', () => {
    const val = customAvatarInput.value.trim();
    if (val && val.startsWith('http')) {
      previewImg.src = val;
      pendingAvatar = val;
      avatarStatus.textContent = 'Usando URL personalizada';
    }
  });

  // Botón para consultar foto de Twitch al instante
  btnFetchAvatar.addEventListener('click', async () => {
    const targetNick = (usernameInput.value || '').trim().replace(/^@/, '');
    if (!targetNick) {
      showToast('Escribe un Nick de Twitch primero', 'info');
      return;
    }
    btnFetchAvatar.disabled = true;
    btnFetchAvatar.innerHTML = '<span>⏳</span> <span>Buscando...</span>';
    avatarStatus.textContent = `Consultando Twitch para @${targetNick}...`;

    try {
      const res = await fetch(`/api/avatar/${encodeURIComponent(targetNick)}`);
      const data = await res.json();
      if (data.avatar && data.avatar.startsWith('http')) {
        previewImg.src = data.avatar;
        pendingAvatar = data.avatar;
        customAvatarInput.value = '';
        avatarStatus.textContent = '✅ Foto encontrada en Twitch';
        showToast('Foto de Twitch obtenida', 'success');
      } else {
        avatarStatus.textContent = '⚠️ Twitch no tiene foto personalizada para este nick';
        showToast('No se encontró foto personalizada en Twitch', 'info');
      }
    } catch {
      avatarStatus.textContent = '❌ Error de red';
    } finally {
      btnFetchAvatar.disabled = false;
      btnFetchAvatar.innerHTML = '<span>🔄</span> <span>Obtener Foto de Twitch</span>';
    }
  });

  box.querySelector('#modal-name-cancel').onclick = () => backdrop.remove();
  box.querySelector('#modal-name-confirm').onclick = async () => {
    const newUsername = usernameInput.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const newName = nameInput.value.trim();
    const customAvatar = customAvatarInput.value.trim();

    if (!newUsername || newUsername.length < 2) {
      showToast('El Nick de Twitch debe tener al menos 2 caracteres', 'error');
      return;
    }
    if (!newName || newName.length < 2) {
      showToast('El nombre visible debe tener al menos 2 caracteres', 'error');
      return;
    }

    const confirmBtn = box.querySelector('#modal-name-confirm');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Guardando...';

    try {
      const res = await authFetch(`/api/dashboard/users/${username}/change-name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          new_username: newUsername,
          display_name: newName,
          avatar_url: customAvatar || (pendingAvatar.startsWith('http') ? pendingAvatar : ''),
          refresh_avatar: true
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        backdrop.remove();
        loadBirthdays();
      } else {
        showToast(data.error || 'Error al guardar cambios', 'error');
        confirmBtn.disabled = false;
        confirmBtn.textContent = '💾 Guardar Cambios';
      }
    } catch {
      showToast('Error de conexión', 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = '💾 Guardar Cambios';
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

  // Botón directo para lanzar alerta de prueba a OBS
  const btnTestObsDirect = document.getElementById('btn-test-obs-direct');
  if (btnTestObsDirect) {
    btnTestObsDirect.addEventListener('click', async () => {
      btnTestObsDirect.disabled = true;
      btnTestObsDirect.innerHTML = '<span>📡</span><span>Enviando...</span>';
      try {
        const res = await authFetch('/api/dashboard/trigger-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isTest: true,
            user: 'capiluisxavi',
            message: '¡Prueba en vivo de la tarjeta en OBS! 🎂✨',
            sound: 'HBSilbato.mp3'
          })
        });
        const data = await res.json();
        if (data.success) {
          if (data.activeOverlayConnections > 0) {
            showToast(`🎉 ¡Alerta de prueba lanzada a OBS! (${data.activeOverlayConnections} conectado)`, 'success');
          } else {
            showToast('⚠️ Prueba enviada, pero no hay ninguna fuente de OBS abierta en este momento', 'warning');
          }
        } else {
          showToast(data.error || 'Error al lanzar prueba', 'error');
        }
      } catch (err) {
        showToast('Error conectando con el servidor', 'error');
      } finally {
        btnTestObsDirect.disabled = false;
        btnTestObsDirect.innerHTML = '<span>🚀</span><span>Probar en OBS</span>';
      }
    });
  }

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

  // Toggle Felicitaciones en Directo
  const btnToggleFelic = document.getElementById('btn-toggle-felic');
  if (btnToggleFelic) {
    btnToggleFelic.addEventListener('click', async () => {
      btnToggleFelic.disabled = true;
      try {
        const res = await authFetch('/api/dashboard/felicitations-toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.success) {
          updateFelicitationUI(data.enabled);
          showToast(data.message, data.enabled ? 'success' : 'info');
        } else {
          showToast('Error al cambiar estado de felicitaciones', 'error');
        }
      } catch {
        showToast('Error conectando con el servidor', 'error');
      } finally {
        btnToggleFelic.disabled = false;
      }
    });
  }

  // ─── Botón de Pánico: Detener Alerta de Emergencia en OBS ────────────────
  const btnPanic = document.getElementById('btn-panic-stop');
  if (btnPanic) {
    btnPanic.addEventListener('click', async () => {
      btnPanic.disabled = true;
      try {
        const res = await authFetch('/api/dashboard/stop-alert', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('🛑 Alerta detenida y silenciada en OBS de emergencia', 'success');
        }
      } catch {
        showToast('Error conectando con el servidor', 'error');
      } finally {
        btnPanic.disabled = false;
      }
    });
  }

  // ─── Pausar / Reanudar Alertas Entrantes (Modo Partida) ────────────────────
  const btnPause = document.getElementById('btn-pause-alerts');
  const pauseLabel = document.getElementById('pause-alerts-label');

  function updatePauseUI(isPaused) {
    if (!btnPause || !pauseLabel) return;
    const iconSpan = btnPause.querySelector('span:first-child');
    if (isPaused) {
      if (iconSpan) iconSpan.textContent = '▶️';
      pauseLabel.textContent = 'Reanudar';
      btnPause.style.background = 'rgba(239, 68, 68, 0.25)';
      btnPause.style.borderColor = 'rgba(239, 68, 68, 0.6)';
      btnPause.style.color = '#fca5a5';
      btnPause.title = 'Reanudar la aparición de alertas en directo';
    } else {
      if (iconSpan) iconSpan.textContent = '⏸️';
      pauseLabel.textContent = 'Pausar';
      btnPause.style.background = 'rgba(245, 158, 11, 0.15)';
      btnPause.style.borderColor = 'rgba(245, 158, 11, 0.4)';
      btnPause.style.color = '#fcd34d';
      btnPause.title = 'Pausar la aparición de alertas en stream (se guardarán en cola)';
    }
  }

  async function loadPausedQueue() {
    try {
      const res = await authFetch('/api/dashboard/paused-queue');
      const data = await res.json();
      updatePauseUI(data.alerts_paused);
      const banner = document.getElementById('paused-queue-banner');
      const countEl = document.getElementById('paused-queue-count');
      const itemsEl = document.getElementById('paused-queue-items');
      if (!banner) return;

      if (data.queue && data.queue.length > 0) {
        banner.style.display = 'block';
        if (countEl) countEl.textContent = data.queue.length;
        if (itemsEl) {
          itemsEl.innerHTML = '';
          data.queue.forEach(item => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;background:rgba(0,0,0,0.3);padding:8px 12px;border-radius:8px;font-size:0.82rem;gap:10px;flex-wrap:wrap;';
            row.innerHTML = `
              <div style="flex:1;">
                <strong style="color:#fff;">${item.user}</strong> <span style="color:#94a3b8;font-size:0.75rem;">(${item.time})</span>: 
                <span style="color:#fde047;">"${item.message || 'Sin mensaje'}"</span>
              </div>
              <button type="button" class="btn-copy btn-release-single" data-id="${item.id}" style="padding:4px 10px;font-size:0.75rem;background:rgba(16,185,129,0.2);color:#34d399;border-color:rgba(16,185,129,0.4);cursor:pointer;">
                ▶️ Soltar a OBS
              </button>
            `;
            row.querySelector('.btn-release-single').addEventListener('click', async () => {
              await authFetch('/api/dashboard/release-paused-alert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: item.id })
              });
              showToast(`Alerta de ${item.user} enviada a OBS`, 'success');
              loadPausedQueue();
            });
            itemsEl.appendChild(row);
          });
        }
      } else {
        banner.style.display = 'none';
      }
    } catch (e) {
      console.warn('Error cargando cola de alertas:', e);
    }
  }

  if (btnPause) {
    btnPause.addEventListener('click', async () => {
      btnPause.disabled = true;
      try {
        const res = await authFetch('/api/dashboard/toggle-pause-alerts', { method: 'POST' });
        const data = await res.json();
        updatePauseUI(data.alerts_paused);
        showToast(data.message, data.alerts_paused ? 'warning' : 'success');
        loadPausedQueue();
      } catch {
        showToast('Error cambiando estado de pausa', 'error');
      } finally {
        btnPause.disabled = false;
      }
    });
  }

  const btnReleaseAll = document.getElementById('btn-release-all-alerts');
  if (btnReleaseAll) {
    btnReleaseAll.addEventListener('click', async () => {
      const res = await authFetch('/api/dashboard/release-paused-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ releaseAll: true })
      });
      const data = await res.json();
      showToast(data.message || 'Alertas liberadas a OBS', 'success');
      loadPausedQueue();
    });
  }

  const btnReleaseNext = document.getElementById('btn-release-next-alert');
  if (btnReleaseNext) {
    btnReleaseNext.addEventListener('click', async () => {
      const qRes = await authFetch('/api/dashboard/paused-queue');
      const qData = await qRes.json();
      if (qData.queue && qData.queue.length > 0) {
        const first = qData.queue[0];
        await authFetch('/api/dashboard/release-paused-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: first.id })
        });
        showToast(`Alerta de ${first.user} enviada a OBS`, 'success');
        loadPausedQueue();
      } else {
        showToast('No hay alertas en cola', 'info');
      }
    });
  }

  // ─── Exportar Base de Datos a CSV (Excel) ─────────────────────────────────
  const btnExportCsv = document.getElementById('btn-export-csv');
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', () => {
      window.location.href = '/api/dashboard/export-csv';
      showToast('📥 Descargando archivo CSV de cumpleaños...', 'info');
    });
  }

  // ─── Pestaña y Funcionalidades de Nightbot & StreamElements ─────────────
  const btnGotoNightbot = document.getElementById('btn-goto-nightbot');
  if (btnGotoNightbot) {
    btnGotoNightbot.addEventListener('click', () => switchTab('nightbot'));
  }

  let currentBotPlatform = 'nightbot';

  function renderBotCommands(platform) {
    currentBotPlatform = platform;
    const origin = window.location.origin;

    // Actualizar botones de selector
    document.querySelectorAll('.btn-bot-platform').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.platform === platform);
    });

    // Actualizar líneas de código
    document.querySelectorAll('.nightbot-code-line').forEach(codeEl => {
      const template = platform === 'streamelements' ? codeEl.dataset.se : codeEl.dataset.nb;
      if (template) {
        const rendered = template.replace(/{HOST}/g, origin);
        codeEl.textContent = rendered;
      }
    });

    // Actualizar labels según la plataforma
    const upper = platform === 'streamelements' ? 'STREAMELEMENTS' : 'NIGHTBOT';
    const checkLbl = document.getElementById('label-code-check');
    if (checkLbl) checkLbl.textContent = `COMANDO DE TWITCH (${upper}):`;

    const timerLbl = document.getElementById('label-code-timer');
    if (timerLbl) timerLbl.textContent = `TEXTO PARA EL TIMER (${upper}):`;

    const nextLbl = document.getElementById('label-code-next');
    if (nextLbl) nextLbl.textContent = `COMANDO DE TWITCH (${upper}):`;

    const monthLbl = document.getElementById('label-code-month');
    if (monthLbl) monthLbl.textContent = `COMANDO DE TWITCH (${upper}):`;

    // Actualizar botón de copia de pack completo
    const copyPackLabel = document.getElementById('btn-copy-all-label');
    if (copyPackLabel) {
      copyPackLabel.textContent = platform === 'streamelements'
        ? 'Copiar Pack de Comandos (StreamElements)'
        : 'Copiar Pack de Comandos (Nightbot)';
    }

    // Actualizar banner de guía
    const banner = document.getElementById('bot-guide-banner');
    const guideText = document.getElementById('bot-guide-text');
    if (platform === 'streamelements') {
      if (banner) {
        banner.style.borderLeftColor = '#ef4444';
        banner.style.background = 'rgba(239, 68, 68, 0.08)';
      }
      if (guideText) {
        guideText.innerHTML = `<strong>Instalación con StreamElements:</strong> <span style="color: #cbd5e1;">(1) Asegúrate que StreamElements sea moderador escribiendo <code>/mod streamelements</code> en Twitch. (2) Copia cualquiera de los comandos <code>!cmd add</code> de abajo y pégalo directamente en tu chat de Twitch, o agrégalo desde el panel de StreamElements &gt; Bot &gt; Chat Commands. (3) Para el <strong>Timer de avisos automáticos</strong>, ve a StreamElements Dashboard &gt; Chat Bot &gt; Timers &gt; Add New Timer y pega el texto del Timer en el mensaje. ¡Listo!</span>`;
      }
    } else {
      if (banner) {
        banner.style.borderLeftColor = '#9146ff';
        banner.style.background = 'rgba(145, 70, 255, 0.06)';
      }
      if (guideText) {
        guideText.innerHTML = `<strong>Instalación con Nightbot:</strong> <span style="color: #cbd5e1;">(1) Asegúrate que Nightbot sea moderador en tu chat escribiendo <code>/mod nightbot</code> en Twitch. (2) Copia cualquiera de los comandos <code>!addcom</code> de abajo y pégalo en tu chat de Twitch. (3) Para el <strong>Timer de avisos automáticos</strong>, ve a Nightbot Dashboard &gt; Timers &gt; Add Timer y pega el texto del Timer en el campo Message. ¡Listo!</span>`;
      }
    }
  }

  // Event listeners para tabs de plataforma
  document.querySelectorAll('.btn-bot-platform').forEach(btn => {
    btn.addEventListener('click', () => {
      renderBotCommands(btn.dataset.platform);
    });
  });

  // Inicializar host y comandos
  updateNightbotHost();
  renderBotCommands('nightbot');

  // Copiar Comandos (botón individual)
  document.querySelectorAll('.btn-copy-cmd').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const codeEl = document.getElementById(targetId);
      if (codeEl) {
        const text = codeEl.textContent.replace(/\s+/g, ' ').trim();
        navigator.clipboard.writeText(text).then(() => {
          showToast('📋 ¡Comando copiado! Pégalo en tu chat de Twitch', 'success');
        }).catch(() => {
          showToast('Selecciona y copia el comando manualmente', 'info');
        });
      }
    });
  });

  // Copiar URL directa del API
  document.querySelectorAll('.btn-copy-url').forEach(btn => {
    btn.addEventListener('click', () => {
      const endpoint = btn.dataset.url || '';
      const fullUrl = `${window.location.origin}${endpoint}`;
      navigator.clipboard.writeText(fullUrl).then(() => {
        showToast('🔗 ¡URL del API copiada al portapapeles!', 'success');
      }).catch(() => {
        showToast('No se pudo copiar la URL', 'error');
      });
    });
  });

  // Probar Respuesta en Vivo del API
  document.querySelectorAll('.btn-test-nb').forEach(btn => {
    btn.addEventListener('click', async () => {
      const endpoint = btn.dataset.endpoint;
      const previewId = btn.dataset.preview;
      const previewEl = document.getElementById(previewId);
      if (!previewEl || !endpoint) return;

      const originalBtnText = btn.innerHTML;
      btn.innerHTML = '⏳ Consultando...';
      btn.disabled = true;
      previewEl.textContent = 'Consultando al servidor en vivo...';

      try {
        const res = await fetch(endpoint);
        const text = await res.text();
        previewEl.textContent = text;
        showToast('✅ Respuesta obtenida en vivo', 'success');
      } catch (err) {
        previewEl.textContent = '❌ Error al consultar endpoint: ' + err.message;
        showToast('Error al probar endpoint', 'error');
      } finally {
        btn.innerHTML = originalBtnText;
        btn.disabled = false;
      }
    });
  });

  // Probar usuario personalizado para !cumple [usuario]
  const btnTestCustom = document.getElementById('btn-test-check-custom');
  const inputTestUser = document.getElementById('input-test-user');
  const previewCheck = document.getElementById('preview-check');

  async function testCustomUserCheck() {
    const rawNick = (inputTestUser?.value || '').trim().replace(/^@/, '');
    const isSelfSim = !rawNick;
    const testSender = 'capiluisxavi';

    if (previewCheck) {
      previewCheck.textContent = isSelfSim
        ? `Simulando !cumple propio de @${testSender}...`
        : `Consultando cumpleaños de @${rawNick}...`;
    }
    if (btnTestCustom) {
      btnTestCustom.disabled = true;
      btnTestCustom.textContent = '⏳ Probando...';
    }

    try {
      const q = isSelfSim
        ? `/api/bot/check?user=&sender=${encodeURIComponent(testSender)}`
        : `/api/bot/check?user=${encodeURIComponent(rawNick)}&sender=${encodeURIComponent(testSender)}`;
      const res = await fetch(q);
      const text = await res.text();
      if (previewCheck) previewCheck.textContent = text;
    } catch (err) {
      if (previewCheck) previewCheck.textContent = '❌ Error: ' + err.message;
    } finally {
      if (btnTestCustom) {
        btnTestCustom.disabled = false;
        btnTestCustom.textContent = '▶️ Probar Nick';
      }
    }
  }

  if (btnTestCustom) {
    btnTestCustom.addEventListener('click', testCustomUserCheck);
  }
  if (inputTestUser) {
    inputTestUser.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        testCustomUserCheck();
      }
    });
  }

  // Copiar Pack Completo de Comandos (Texto multi-línea)
  const btnCopyAll = document.getElementById('btn-copy-all-commands');
  if (btnCopyAll) {
    btnCopyAll.addEventListener('click', () => {
      const origin = window.location.origin;
      const isSE = currentBotPlatform === 'streamelements';

      let allText = '';
      if (isSE) {
        allText = [
          `# ==============================================================`,
          `# COMANDOS DE CUMPLEAÑOS PARA STREAMELEMENTS — ${origin}`,
          `# ==============================================================`,
          ``,
          `# 1. Comando Dinámico !cumple (consulta tu fecha o la de otro usuario !cumple @amigo):`,
          `!cmd add !cumple \${customapi ${origin}/api/bot/check?user=\${query}&sender=\${user.name}}`,
          ``,
          `# 2. Timer de Avisos Automáticos (Avisa en stream si hay cumpleaños hoy o en 1 a 3 días):`,
          `# Ve a StreamElements > Bot > Timers > Add New Timer y en "Message" pega:`,
          `\${customapi ${origin}/api/bot/timer}`,
          ``,
          `# 3. Próximos cumpleaños en 15 días:`,
          `!cmd add !proximos \${customapi ${origin}/api/bot/next}`,
          ``,
          `# 4. Cumpleaños de todo el mes actual:`,
          `!cmd add !cumplemes \${customapi ${origin}/api/bot/month}`,
          ``,
          `# 5. Enlace para registrarse en la plataforma:`,
          `!cmd add !regcumple ¡Registra tu cumpleaños para que te festejemos con alerta en directo en tu día especial! 🎂 Entra gratis aquí 👉 ${origin} 🎈`,
          ``,
          `# 6. Felicitar en pantalla con sonido y confeti:`,
          `!cmd add !felicitar 🎊 ¡Mándale una felicitación en directo al cumpleañero con música y tarjetas en pantalla entrando a: ${origin} 🎉`,
          ``,
          `# 7. Resumen de comandos de ayuda:`,
          `!cmd add !cumpleinfo 🎂 Comandos: !cumple [usuario] · !proximos · !cumplemes · !regcumple · !felicitar`
        ].join('\n');
      } else {
        allText = [
          `# ==============================================================`,
          `# COMANDOS DE CUMPLEAÑOS PARA NIGHTBOT — ${origin}`,
          `# ==============================================================`,
          ``,
          `# 1. Comando Dinámico !cumple (consulta tu fecha o la de otro usuario !cumple @amigo):`,
          `!addcom !cumple $(urlfetch ${origin}/api/bot/check?user=$(query)&sender=$(user))`,
          ``,
          `# 2. Timer de Avisos Automáticos (Avisa en stream si hay cumpleaños hoy o en 1 a 3 días):`,
          `# Ve a Nightbot > Timers > Add Timer y en "Message" pega:`,
          `$(urlfetch ${origin}/api/bot/timer)`,
          ``,
          `# 3. Próximos cumpleaños en 15 días:`,
          `!addcom !proximos $(urlfetch ${origin}/api/bot/next)`,
          ``,
          `# 4. Cumpleaños de todo el mes actual:`,
          `!addcom !cumplemes $(urlfetch ${origin}/api/bot/month)`,
          ``,
          `# 5. Enlace para registrarse en la plataforma:`,
          `!addcom !regcumple ¡Registra tu cumpleaños para que te festejemos con alerta en directo en tu día especial! 🎂 Entra gratis aquí 👉 ${origin} 🎈`,
          ``,
          `# 6. Felicitar en pantalla con sonido y confeti:`,
          `!addcom !felicitar 🎊 ¡Mándale una felicitación en directo al cumpleañero con música y tarjetas en pantalla entrando a: ${origin} 🎉`,
          ``,
          `# 7. Resumen de comandos de ayuda:`,
          `!addcom !cumpleinfo 🎂 Comandos: !cumple [usuario] · !proximos · !cumplemes · !regcumple · !felicitar`
        ].join('\n');
      }

      navigator.clipboard.writeText(allText).then(() => {
        showToast(`📋 ¡Pack de comandos (${isSE ? 'StreamElements' : 'Nightbot'}) copiado!`, 'success');
      }).catch(() => {
        showToast('No se pudo copiar el pack completo', 'error');
      });
    });
  }

  // ─── Control del Bot Oficial de Twitch (Conexión Directa IRC) ──────────────
  const badgeBotStatus = document.getElementById('twitch-bot-status-badge');
  const btnToggleBotConnect = document.getElementById('btn-bot-toggle-connect');
  const btnBotToggleLabel = document.getElementById('btn-bot-toggle-label');
  const btnBotTestMsg = document.getElementById('btn-bot-test-msg');
  const btnBotTriggerTimer = document.getElementById('btn-bot-trigger-timer');
  const btnSaveBotConfig = document.getElementById('btn-save-bot-config');
  const btnToggleTokenVis = document.getElementById('btn-toggle-token-vis');

  const inputBotUser = document.getElementById('bot-input-username');
  const inputBotToken = document.getElementById('bot-input-token');
  const inputBotChannel = document.getElementById('bot-input-channel');
  const selectBotInterval = document.getElementById('bot-select-interval');
  const checkBotTimer = document.getElementById('bot-check-timer-enabled');

  let twitchBotIsConnected = false;

  // ─── loadTwitchBotStatus: expuesta globalmente para que switchTab la pueda llamar ──
  async function loadTwitchBotStatus() {
    if (!badgeBotStatus) return;
    try {
      const res = await authFetch('/api/dashboard/bot/status');
      const data = await res.json();
      twitchBotIsConnected = !!data.connected;

      if (data.connected) {
        badgeBotStatus.textContent = `🟢 Conectado (#${data.config.channel || 'yocapi_pr'})`;
        badgeBotStatus.style.background = 'rgba(16, 185, 129, 0.2)';
        badgeBotStatus.style.color = '#34d399';
        badgeBotStatus.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        if (btnBotToggleLabel) btnBotToggleLabel.textContent = 'Desconectar Bot';
        if (btnToggleBotConnect) btnToggleBotConnect.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
      } else if (data.status === 'connecting') {
        badgeBotStatus.textContent = '🟡 Conectando...';
        badgeBotStatus.style.background = 'rgba(245, 158, 11, 0.2)';
        badgeBotStatus.style.color = '#fcd34d';
        badgeBotStatus.style.borderColor = 'rgba(245, 158, 11, 0.4)';
        if (btnBotToggleLabel) btnBotToggleLabel.textContent = 'Conectando...';
      } else if (data.status === 'error') {
        badgeBotStatus.textContent = `⚠️ Error: ${data.last_error || 'Error de conexión'}`;
        badgeBotStatus.style.background = 'rgba(239, 68, 68, 0.2)';
        badgeBotStatus.style.color = '#f87171';
        badgeBotStatus.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        if (btnBotToggleLabel) btnBotToggleLabel.textContent = 'Reintentar Conexión';
        if (btnToggleBotConnect) btnToggleBotConnect.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      } else {
        badgeBotStatus.textContent = '🔴 Desconectado';
        badgeBotStatus.style.background = 'rgba(239, 68, 68, 0.2)';
        badgeBotStatus.style.color = '#f87171';
        badgeBotStatus.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        if (btnBotToggleLabel) btnBotToggleLabel.textContent = 'Conectar Bot';
        if (btnToggleBotConnect) btnToggleBotConnect.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      }

      if (data.config) {
        if (inputBotUser && !inputBotUser.value) inputBotUser.value = data.config.bot_username || '';
        if (inputBotChannel && !inputBotChannel.value) inputBotChannel.value = data.config.channel || 'yocapi_pr';
        if (selectBotInterval) {
          selectBotInterval.value = String(data.config.timer_minutes || 60);
          if (timerIntervalDisplay) {
            const val = parseInt(selectBotInterval.value, 10);
            if (val === 60) timerIntervalDisplay.textContent = '1 hora';
            else if (val === 90) timerIntervalDisplay.textContent = '1 hora y media';
            else if (val === 120) timerIntervalDisplay.textContent = '2 horas';
            else timerIntervalDisplay.textContent = `${val} minutos`;
          }
        }
        if (checkBotTimer) checkBotTimer.checked = !!data.config.timer_enabled;
        if (data.config.has_token && inputBotToken && !inputBotToken.value) {
          inputBotToken.placeholder = 'oauth:•••••••••••••••••••• (Guardado)';
        }
      }
    } catch (e) {
      console.warn('Error al consultar estado del bot de Twitch:', e);
    }
  }

  // Exponer globalmente para que switchTab (scope global) pueda llamarla
  window._loadTwitchBotStatus = loadTwitchBotStatus;

  // Auto-refresh del estado del bot cada 15 segundos (actualiza el badge automáticamente)
  setInterval(() => {
    if (document.visibilityState === 'visible') loadTwitchBotStatus();
  }, 15000);

  // Toggle visibilidad del token
  if (btnToggleTokenVis && inputBotToken) {
    btnToggleTokenVis.addEventListener('click', () => {
      inputBotToken.type = inputBotToken.type === 'password' ? 'text' : 'password';
      btnToggleTokenVis.textContent = inputBotToken.type === 'password' ? '👁️' : '🙈';
    });
  }

  // Guardar configuración del Bot
  if (btnSaveBotConfig) {
    btnSaveBotConfig.addEventListener('click', async () => {
      const bot_username = (inputBotUser?.value || '').trim();
      const oauth_token = (inputBotToken?.value || '').trim();
      const channel = (inputBotChannel?.value || '').trim();
      const timer_minutes = parseInt(selectBotInterval?.value, 10) || 60;
      const timer_enabled = !!checkBotTimer?.checked;

      btnSaveBotConfig.disabled = true;
      btnSaveBotConfig.textContent = 'Guardando...';

      try {
        const payload = { bot_username, channel, timer_minutes, timer_enabled };
        if (oauth_token && !oauth_token.includes('•')) {
          payload.oauth_token = oauth_token;
        }

        const res = await authFetch('/api/dashboard/bot/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showToast('Configuración del Bot guardada con éxito', 'success');
          loadTwitchBotStatus();
        } else {
          showToast(data.error || 'Error al guardar configuración', 'error');
        }
      } catch {
        showToast('Error de conexión', 'error');
      } finally {
        btnSaveBotConfig.disabled = false;
        btnSaveBotConfig.textContent = '💾 Guardar Configuración';
      }
    });
  }

  // Conectar / Desconectar Bot
  if (btnToggleBotConnect) {
    btnToggleBotConnect.addEventListener('click', async () => {
      btnToggleBotConnect.disabled = true;

      try {
        if (twitchBotIsConnected) {
          btnToggleBotConnect.textContent = 'Desconectando...';
          const res = await authFetch('/api/dashboard/bot/disconnect', { method: 'POST' });
          const data = await res.json();
          showToast(data.message || 'Bot desconectado', 'info');
        } else {
          btnToggleBotConnect.textContent = 'Conectando...';
          const bot_username = (inputBotUser?.value || '').trim();
          const oauth_token = (inputBotToken?.value || '').trim();
          const channel = (inputBotChannel?.value || '').trim();
          const timer_minutes = parseInt(selectBotInterval?.value, 10) || 60;
          const timer_enabled = !!checkBotTimer?.checked;

          const payload = { bot_username, channel, timer_minutes, timer_enabled, enabled: true };
          if (oauth_token && !oauth_token.includes('•')) {
            payload.oauth_token = oauth_token;
          }

          const res = await authFetch('/api/dashboard/bot/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (data.success) {
            showToast('✅ ' + data.message, 'success');
          } else {
            showToast('❌ ' + (data.error || 'No se pudo conectar'), 'error');
          }
        }
      } catch {
        showToast('Error conectando con el servidor', 'error');
      } finally {
        btnToggleBotConnect.disabled = false;
        loadTwitchBotStatus();
      }
    });
  }

  // Enviar mensaje de prueba al chat
  if (btnBotTestMsg) {
    btnBotTestMsg.addEventListener('click', async () => {
      btnBotTestMsg.disabled = true;
      btnBotTestMsg.textContent = '⏳ Enviando...';

      try {
        const res = await authFetch('/api/dashboard/bot/test-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.success) {
          showToast('🎉 ¡Mensaje enviado a tu chat de Twitch!', 'success');
        } else {
          showToast('❌ ' + (data.error || 'Error al enviar mensaje'), 'error');
        }
      } catch {
        showToast('Error conectando con el servidor', 'error');
      } finally {
        btnBotTestMsg.disabled = false;
        btnBotTestMsg.textContent = '🧪 Probar en Chat';
      }
    });
  }

  // Avisar ahora (disparar timer manualmente)
  if (btnBotTriggerTimer) {
    btnBotTriggerTimer.addEventListener('click', async () => {
      btnBotTriggerTimer.disabled = true;
      btnBotTriggerTimer.textContent = '⏰ Enviando...';

      try {
        const res = await authFetch('/api/dashboard/bot/trigger-timer', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('🎂 ¡Recordatorio de cumpleaños enviado al chat de Twitch!', 'success');
        } else {
          showToast('❌ ' + (data.error || 'Error al ejecutar recordatorio'), 'error');
        }
      } catch {
        showToast('Error conectando con el servidor', 'error');
      } finally {
        btnBotTriggerTimer.disabled = false;
        btnBotTriggerTimer.textContent = '⏰ Avisar Ahora';
      }
    });
  }

  // ─── Botón duplicado "Disparar Ahora" en la card del Timer ──────────────────
  const btnBotTriggerTimer2 = document.getElementById('btn-bot-trigger-timer-2');
  if (btnBotTriggerTimer2) {
    btnBotTriggerTimer2.addEventListener('click', async () => {
      btnBotTriggerTimer2.disabled = true;
      btnBotTriggerTimer2.textContent = '⏰ Enviando...';
      try {
        const res = await authFetch('/api/dashboard/bot/trigger-timer', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('🎂 ¡Recordatorio enviado al chat de Twitch!', 'success');
        } else {
          showToast('❌ ' + (data.error || 'Error al ejecutar recordatorio'), 'error');
        }
      } catch {
        showToast('Error conectando con el servidor', 'error');
      } finally {
        btnBotTriggerTimer2.disabled = false;
        btnBotTriggerTimer2.textContent = '⏰ Disparar Ahora';
      }
    });
  }

  // ─── Sincronizar display del intervalo del timer ──────────────────────────
  const timerIntervalDisplay = document.getElementById('timer-interval-display');
  if (selectBotInterval && timerIntervalDisplay) {
    const updateTimerDisplay = () => {
      const val = parseInt(selectBotInterval.value, 10) || 60;
      if (val === 60) timerIntervalDisplay.textContent = '1 hora';
      else if (val === 90) timerIntervalDisplay.textContent = '1 hora y media';
      else if (val === 120) timerIntervalDisplay.textContent = '2 horas';
      else timerIntervalDisplay.textContent = `${val} minutos`;
    };
    selectBotInterval.addEventListener('change', updateTimerDisplay);
    updateTimerDisplay();
  }

  // ─── Guardar respuestas editables de comandos (cmd-response-*) ────────────
  async function saveCmdResponse(cmdName, responseText) {
    try {
      const res = await authFetch('/api/dashboard/bot/cmd-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: cmdName, response: responseText })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✅ Respuesta de !${cmdName} guardada`, 'success');
      } else {
        showToast(data.error || 'Error al guardar respuesta', 'error');
      }
    } catch {
      showToast('Error conectando con el servidor', 'error');
    }
  }

  // Cargar respuestas guardadas al iniciar
  async function loadCmdResponses() {
    try {
      const res = await authFetch('/api/dashboard/bot/cmd-responses');
      if (!res.ok) return;
      const data = await res.json();
      if (data.responses) {
        for (const [cmd, text] of Object.entries(data.responses)) {
          const ta = document.getElementById(`cmd-response-${cmd}`);
          if (ta && text) ta.value = text;
        }
      }
    } catch (e) {
      console.warn('No se pudieron cargar respuestas de comandos:', e);
    }
  }
  loadCmdResponses();

  // Listeners para botones "💾 Guardar" de cada comando
  document.querySelectorAll('.btn-save-cmd-response').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cmd = btn.dataset.cmd;
      const ta = document.getElementById(`cmd-response-${cmd}`);
      if (!ta) return;
      btn.disabled = true;
      btn.textContent = '⏳ Guardando...';
      await saveCmdResponse(cmd, ta.value.trim());
      btn.disabled = false;
      btn.textContent = '💾 Guardar';
    });
  });

  // ─── Control del Menú Lateral Móvil (Drawer) ──────────────────────────────
  const mobileToggle = document.getElementById('btn-mobile-sidebar-toggle');
  const sidebar = document.querySelector('.dash-sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const btnCloseSidebar = document.getElementById('btn-close-sidebar-mobile');

  function openMobileSidebar() {
    if (sidebar) sidebar.classList.add('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.add('active');
    document.body.classList.add('mobile-nav-open');
  }

  function closeMobileSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.remove('active');
    document.body.classList.remove('mobile-nav-open');
  }

  if (mobileToggle) mobileToggle.addEventListener('click', openMobileSidebar);
  if (btnCloseSidebar) btnCloseSidebar.addEventListener('click', closeMobileSidebar);
  if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeMobileSidebar);

  // Cerrar el drawer en móvil al seleccionar cualquier pestaña
  document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 900) closeMobileSidebar();
    });
  });

  // Cargar estado inicial
  loadStats();
  loadPausedQueue();
  loadTwitchBotStatus(); // carga inicial del estado del bot
});

// =============================================================================
// SIMULADOR Y DISEÑADOR VISUAL DE OBS (1920x1080)
// =============================================================================
(function initSimModal() {
  const modal       = document.getElementById('obs-sim-modal');
  const btnOpen     = document.getElementById('btn-open-sim-modal');
  const btnClose    = document.getElementById('btn-close-sim-modal');
  const canvas      = document.getElementById('sim-canvas');
  const cardWrapper = document.getElementById('sim-card-wrapper');
  const coordsBadge = document.getElementById('sim-coords-badge');
  const cardPosText = document.getElementById('sim-card-pos-text');
  const scaleSlider = document.getElementById('sim-scale-slider');
  const scaleVal    = document.getElementById('sim-scale-val');
  const animHint    = document.getElementById('sim-anim-hint');
  const webcamToggle= document.getElementById('sim-toggle-webcam');
  const webcamBox   = document.getElementById('sim-webcam-box');

  if (!modal || !btnOpen) return;

  // State
  let simState = { posX: 50, posY: 85, scale: 0.85, animation: 'slide-up', volume: 0.85 };
  const volSlider   = document.getElementById('sim-vol-slider');
  const volVal      = document.getElementById('sim-vol-val');

  // ─── Animación Dinámica de la Tarjeta ──────────────────────────────────────
  function updateCardScale(val) {
    const factor = Math.round(val * 100) / 100;
    cardWrapper.style.transform = `translate(-50%, -50%) scale(${factor})`;
  }

  function moveCardTo(pctX, pctY) {
    simState.posX = Math.round(Math.max(5, Math.min(95, pctX)) * 10) / 10;
    simState.posY = Math.round(Math.max(5, Math.min(95, pctY)) * 10) / 10;
    cardWrapper.style.left = `${simState.posX}%`;
    cardWrapper.style.top  = `${simState.posY}%`;
    const coordText = `X: ${simState.posX}% | Y: ${simState.posY}%`;
    if (coordsBadge) coordsBadge.textContent = coordText;
    if (cardPosText) cardPosText.textContent  = `${simState.posX}%, ${simState.posY}%`;
    // Actualizar botón "snap" activo
    document.querySelectorAll('.btn-snap').forEach(b => {
      const bx = parseFloat(b.dataset.x);
      const by = parseFloat(b.dataset.y);
      b.classList.toggle('active', Math.abs(bx - simState.posX) < 3 && Math.abs(by - simState.posY) < 3);
    });
  }

  function refreshAnimHint() {
    const hints = {
      'slide-up':    '⬆️  La tarjeta entrará subiendo desde abajo',
      'slide-down':  '⬇️  La tarjeta entrará bajando desde arriba',
      'slide-right': '➡️  La tarjeta entrará desde la izquierda',
      'slide-left':  '⬅️  La tarjeta entrará desde la derecha',
      'pop-zoom':    '💥 La tarjeta aparecerá con zoom en el centro',
      'bounce-drop': '🎪 La tarjeta caerá con rebote elástico festivo',
      'fade-glow':   '✨ La tarjeta se fundirá con resplandor suave',
    };
    if (animHint) animHint.textContent = hints[simState.animation] || '';
  }

  // ─── Carga configuración guardada del servidor ─────────────────────────────
  async function loadServerConfig() {
    try {
      const res = await authFetch('/api/dashboard/overlay-config');
      const cfg = await res.json();
      if (cfg && typeof cfg.posX === 'number') {
        simState = { ...simState, ...cfg };
        moveCardTo(simState.posX, simState.posY);
        const sliderPct = Math.round(simState.scale * 100);
        scaleSlider.value = sliderPct;
        scaleVal.textContent = `${sliderPct}%`;
        updateCardScale(simState.scale);
        if (typeof cfg.volume === 'number' && volSlider && volVal) {
          const volPct = Math.round(cfg.volume * 100);
          volSlider.value = volPct;
          volVal.textContent = `${volPct}%`;
          simState.volume = cfg.volume;
        }
        // Activar botón de animación correcta
        document.querySelectorAll('.btn-anim-choice').forEach(b => {
          b.classList.toggle('active', b.dataset.anim === simState.animation);
        });
        refreshAnimHint();
      }
    } catch (e) {
      console.warn('No se pudo cargar configuración del overlay:', e);
    }
  }

  // ─── Abrir / Cerrar Modal ──────────────────────────────────────────────────
  btnOpen.addEventListener('click', () => {
    modal.style.display = 'flex';
    setTimeout(() => {
      moveCardTo(simState.posX, simState.posY);
      refreshAnimHint();
    }, 80);
    loadServerConfig();
  });

  function closeModal() {
    modal.style.animation = 'none';
    modal.style.opacity = '0';
    modal.style.transition = 'opacity 0.2s ease';
    setTimeout(() => {
      modal.style.display = 'none';
      modal.style.opacity = '';
      modal.style.animation = '';
      modal.style.transition = '';
    }, 200);
  }

  if (btnClose) btnClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.style.display !== 'none') closeModal(); });

  // ─── Drag & Drop de la Tarjeta en el Canvas ────────────────────────────────
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;
  let dragStartPctX = 0, dragStartPctY = 0;

  function getCanvasRect() { return canvas.getBoundingClientRect(); }

  function onDragStart(e) {
    e.preventDefault();
    isDragging = true;
    cardWrapper.classList.add('dragging');
    const pt = e.touches ? e.touches[0] : e;
    dragStartX = pt.clientX;
    dragStartY = pt.clientY;
    dragStartPctX = simState.posX;
    dragStartPctY = simState.posY;
  }

  function onDragMove(e) {
    if (!isDragging) return;
    const pt = e.touches ? e.touches[0] : e;
    const rect = getCanvasRect();
    const dx = ((pt.clientX - dragStartX) / rect.width)  * 100;
    const dy = ((pt.clientY - dragStartY) / rect.height) * 100;
    moveCardTo(dragStartPctX + dx, dragStartPctY + dy);
  }

  function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    cardWrapper.classList.remove('dragging');
  }

  // Mouse
  cardWrapper.addEventListener('mousedown', onDragStart);
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);

  // Touch
  cardWrapper.addEventListener('touchstart', onDragStart, { passive: false });
  window.addEventListener('touchmove', onDragMove, { passive: false });
  window.addEventListener('touchend', onDragEnd);

  // ─── Botones de Anclaje Rápido ─────────────────────────────────────────────
  document.querySelectorAll('.btn-snap').forEach(btn => {
    btn.addEventListener('click', () => {
      const x = parseFloat(btn.dataset.x);
      const y = parseFloat(btn.dataset.y);
      moveCardTo(x, y);
      // Animación de "bounce" visual en la tarjeta al hacer snap
      cardWrapper.style.transition = 'left 0.4s cubic-bezier(0.175,0.885,0.32,1.275), top 0.4s cubic-bezier(0.175,0.885,0.32,1.275)';
      setTimeout(() => { cardWrapper.style.transition = ''; }, 500);
    });
  });

  // ─── Slider de Escala ──────────────────────────────────────────────────────
  scaleSlider.addEventListener('input', () => {
    const pct = parseInt(scaleSlider.value);
    simState.scale = pct / 100;
    scaleVal.textContent = `${pct}%`;
    updateCardScale(simState.scale);
    // Desactivar quick-buttons
    document.querySelectorAll('#obs-sim-modal .btn-scale-quick').forEach(b => b.classList.remove('active'));
  });

  document.querySelectorAll('#obs-sim-modal .btn-scale-quick').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseFloat(btn.dataset.scale);
      simState.scale = val;
      const pct = Math.round(val * 100);
      scaleSlider.value = pct;
      scaleVal.textContent = `${pct}%`;
      updateCardScale(val);
      document.querySelectorAll('#obs-sim-modal .btn-scale-quick').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ─── Slider de Volumen ────────────────────────────────────────────────────
  if (volSlider && volVal) {
    volSlider.addEventListener('input', () => {
      const pct = parseInt(volSlider.value);
      simState.volume = pct / 100;
      volVal.textContent = `${pct}%`;
    });
  }

  // ─── Selección de Animación ────────────────────────────────────────────────
  document.querySelectorAll('.btn-anim-choice').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-anim-choice').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      simState.animation = btn.dataset.anim;
      refreshAnimHint();
    });
  });

  // ─── Probar Animación en el Simulador ─────────────────────────────────────
  const btnTestAnim = document.getElementById('btn-sim-test-anim');
  if (btnTestAnim) {
    btnTestAnim.addEventListener('click', () => {
      // Ocultar la tarjeta momentáneamente y "reproducir" la entrada
      cardWrapper.style.transition = 'none';
      cardWrapper.style.opacity = '0';

      const directionOffsets = {
        'slide-up':    { x: 0, y: 60 },
        'slide-down':  { x: 0, y: -60 },
        'slide-right': { x: -80, y: 0 },
        'slide-left':  { x: 80,  y: 0 },
        'pop-zoom':    { x: 0, y: 0 },
        'bounce-drop': { x: 0, y: -80 },
        'fade-glow':   { x: 0, y: 0 },
      };

      const offset = directionOffsets[simState.animation] || { x: 0, y: 0 };
      const origLeft = `${simState.posX}%`;
      const origTop  = `${simState.posY}%`;

      // Inicializar en posición fuera de pantalla
      const rect = getCanvasRect();
      const offX = (offset.x / rect.width)  * 100;
      const offY = (offset.y / rect.height) * 100;
      cardWrapper.style.left = `${simState.posX + offX}%`;
      cardWrapper.style.top  = `${simState.posY + offY}%`;

      const isZoom = simState.animation === 'pop-zoom' || simState.animation === 'fade-glow';
      if (isZoom) {
        const startScale = simState.animation === 'pop-zoom' ? 0.1 : simState.scale * 0.9;
        cardWrapper.style.transform = `translate(-50%, -50%) scale(${startScale})`;
      }

      requestAnimationFrame(() => {
        // Aplicar la transición y mostrar en posición final
        const easing = simState.animation === 'bounce-drop'
          ? 'cubic-bezier(0.34, 1.56, 0.64, 1)'
          : 'cubic-bezier(0.175, 0.885, 0.32, 1.275)';

        cardWrapper.style.transition = `left 0.75s ${easing}, top 0.75s ${easing}, transform 0.75s ${easing}, opacity 0.45s ease`;
        cardWrapper.style.opacity = '1';
        cardWrapper.style.left = origLeft;
        cardWrapper.style.top  = origTop;
        cardWrapper.style.transform = `translate(-50%, -50%) scale(${simState.scale})`;

        // Limpiar transition después
        setTimeout(() => { cardWrapper.style.transition = ''; }, 850);
      });
    });
  }

  // ─── Toggle de Marco de Cámara ─────────────────────────────────────────────
  if (webcamToggle && webcamBox) {
    webcamToggle.addEventListener('change', () => {
      webcamBox.style.display = webcamToggle.checked ? 'flex' : 'none';
    });
  }

  // ─── Lanzar Prueba a OBS Studio desde el Simulador ──────────────────────────
  const btnTestObs = document.getElementById('btn-sim-test-obs');
  if (btnTestObs) {
    btnTestObs.addEventListener('click', async () => {
      btnTestObs.disabled = true;
      btnTestObs.innerHTML = '<span>📡 Enviando...</span>';
      try {
        // 1. Sincronizar en tiempo real la posición/escala/animación actual al overlay de OBS
        await authFetch('/api/dashboard/overlay-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            posX: simState.posX,
            posY: simState.posY,
            scale: simState.scale,
            animation: simState.animation
          })
        });

        // 2. Disparar alerta de prueba con confeti y sonido
        const res = await authFetch('/api/dashboard/trigger-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isTest: true,
            user: 'capiluisxavi',
            message: '¡Prueba en vivo con tu diseño y animación! 🎂✨',
            sound: 'HBSilbato.mp3'
          })
        });
        const data = await res.json();
        if (data.success) {
          if (data.activeOverlayConnections > 0) {
            showToast(`🎉 ¡Prueba lanzada a OBS! (${data.activeOverlayConnections} conectado)`, 'success');
          } else {
            showToast('⚠️ Prueba enviada a OBS, pero no hay ninguna fuente de OBS abierta en este momento', 'warning');
          }
        } else {
          showToast(data.error || 'Error al lanzar prueba a OBS', 'error');
        }
      } catch (err) {
        showToast('Error conectando con el servidor', 'error');
      } finally {
        btnTestObs.disabled = false;
        btnTestObs.innerHTML = '🚀 Lanzar a OBS';
      }
    });
  }

  // ─── Guardar y Aplicar en OBS en Tiempo Real ──────────────────────────────
  const btnSave = document.getElementById('btn-sim-save');
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      btnSave.disabled = true;
      btnSave.textContent = '⏳ Guardando y aplicando en OBS...';
      try {
        const res = await authFetch('/api/dashboard/overlay-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            posX: simState.posX,
            posY: simState.posY,
            scale: simState.scale,
            animation: simState.animation,
            volume: simState.volume
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast('🎯 ¡Configuración guardada y aplicada en OBS en tiempo real!', 'success');
          setTimeout(() => closeModal(), 1200);
        } else {
          showToast(data.error || 'Error al guardar', 'error');
        }
      } catch {
        showToast('Error conectando con el servidor', 'error');
      } finally {
        btnSave.disabled = false;
        btnSave.innerHTML = '💾 Guardar y Aplicar en OBS en Tiempo Real';
      }
    });
  }

  // ─── Reset a posición inicial ──────────────────────────────────────────────
  const btnReset = document.getElementById('btn-sim-reset');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      simState = { posX: 50, posY: 85, scale: 0.85, animation: 'slide-up' };
      moveCardTo(50, 85);
      scaleSlider.value = 85;
      scaleVal.textContent = '85%';
      updateCardScale(0.85);
      document.querySelectorAll('.btn-anim-choice').forEach(b => b.classList.toggle('active', b.dataset.anim === 'slide-up'));
      document.querySelectorAll('#obs-sim-modal .btn-scale-quick').forEach(b => b.classList.toggle('active', b.dataset.scale === '0.85'));
      refreshAnimHint();
      showToast('Configuración restablecida a los valores por defecto', 'info');
    });
  }

  // Inicializar escala visual al cargar
  updateCardScale(simState.scale);
  refreshAnimHint();
})();
