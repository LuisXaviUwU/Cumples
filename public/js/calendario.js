/**
 * YoCapi Birthday System — Interactive Community Calendar Logic
 */

let allCelebrants = [];
let felicitationsEnabled = false;
let currentMonth = new Date().getMonth() + 1; // 1-12
let currentYear = new Date().getFullYear();
let currentView = 'grid'; // 'grid' | 'list'
let previewAudio = null;

const MONTH_NAMES = [
  '',
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const MONTH_EMOJIS = [
  '',
  '❄️', '💘', '🍀', '🌸', '💐', '☀️',
  '🏖️', '🍉', '🍂', '🎃', '🍁', '🎄'
];

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast';
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  t.innerHTML = `<span>${icon}</span> <span>${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateY(10px)';
    setTimeout(() => t.remove(), 300);
  }, 4000);
}

function getAuthHeaders(extra = {}) {
  const token = localStorage.getItem('yocapi_token');
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// Inicializar la aplicación
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadCalendarData();
});

function setupEventListeners() {
  const monthSelect = document.getElementById('month-select');
  const prevBtn = document.getElementById('btn-prev-month');
  const nextBtn = document.getElementById('btn-next-month');
  const todayBtn = document.getElementById('btn-jump-today');
  const searchInput = document.getElementById('cal-search');
  const gridViewBtn = document.getElementById('btn-view-grid');
  const listViewBtn = document.getElementById('btn-view-list');
  const modalClose = document.getElementById('btn-modal-close');
  const modal = document.getElementById('day-modal');

  if (monthSelect) {
    monthSelect.value = currentMonth;
    monthSelect.addEventListener('change', (e) => {
      currentMonth = parseInt(e.target.value, 10);
      updateCalendarView();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      currentMonth = currentMonth === 1 ? 12 : currentMonth - 1;
      monthSelect.value = currentMonth;
      updateCalendarView();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      currentMonth = currentMonth === 12 ? 1 : currentMonth + 1;
      monthSelect.value = currentMonth;
      updateCalendarView();
    });
  }

  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      const realToday = new Date();
      currentMonth = realToday.getMonth() + 1;
      monthSelect.value = currentMonth;
      updateCalendarView();

      // Trigger confetti on jump to today
      if (typeof confetti === 'function') {
        confetti({ particleCount: 60, spread: 70, origin: { y: 0.7 } });
      }

      // Scroll to today if needed
      setTimeout(() => {
        const todayCell = document.querySelector('.cal-day.is-today');
        if (todayCell) {
          todayCell.scrollIntoView({ behavior: 'smooth', block: 'center' });
          todayCell.classList.add('search-highlight');
          setTimeout(() => todayCell.classList.remove('search-highlight'), 1500);
        }
      }, 100);
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      handleSearch(e.target.value.trim().toLowerCase());
    });
  }

  if (gridViewBtn && listViewBtn) {
    gridViewBtn.addEventListener('click', () => {
      currentView = 'grid';
      gridViewBtn.classList.add('active');
      listViewBtn.classList.remove('active');
      document.getElementById('cal-grid-view').style.display = 'grid';
      document.getElementById('cal-weekdays-view').style.display = 'grid';
      document.getElementById('cal-list-view').style.display = 'none';
      renderGrid();
    });

    listViewBtn.addEventListener('click', () => {
      currentView = 'list';
      listViewBtn.classList.add('active');
      gridViewBtn.classList.remove('active');
      document.getElementById('cal-grid-view').style.display = 'none';
      document.getElementById('cal-weekdays-view').style.display = 'none';
      document.getElementById('cal-list-view').style.display = 'flex';
      renderList();
    });
  }

  if (modalClose && modal) {
    modalClose.addEventListener('click', closeDayModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeDayModal();
    });
  }

  // Atajos de teclado
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDayModal();
    if (e.key === 'ArrowLeft' && !document.activeElement.matches('input, select')) {
      if (prevBtn) prevBtn.click();
    }
    if (e.key === 'ArrowRight' && !document.activeElement.matches('input, select')) {
      if (nextBtn) nextBtn.click();
    }
  });
}

// Cargar datos de cumpleañeros desde el servidor
async function loadCalendarData() {
  const loading = document.getElementById('cal-loading');
  if (loading) loading.style.display = 'block';

  try {
    const res = await fetch('/api/birthday/calendar');
    const data = await res.json();
    if (data.success) {
      allCelebrants = data.users || [];
      felicitationsEnabled = !!data.felicitations_enabled;
      renderStats();
      updateCalendarView();
      renderHighlights();
    } else {
      showToast('Error cargando el calendario', 'error');
    }
  } catch (err) {
    console.error('Error fetching calendar data:', err);
    showToast('Error de conexión con el servidor', 'error');
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

// Actualizar vista (Grid o Lista)
function updateCalendarView() {
  const titleMonth = document.getElementById('display-month-name');
  if (titleMonth) {
    titleMonth.textContent = `${MONTH_EMOJIS[currentMonth]} ${MONTH_NAMES[currentMonth]}`;
  }

  if (currentView === 'grid') {
    renderGrid();
  } else {
    renderList();
  }
}

// Renderizar Cuadrícula del Calendario
function renderGrid() {
  const grid = document.getElementById('cal-grid-view');
  if (!grid) return;
  grid.innerHTML = '';

  const realToday = new Date();
  const isCurrentRealMonth = (realToday.getMonth() + 1 === currentMonth);
  const realTodayDay = realToday.getDate();

  // Días en el mes seleccionado
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

  // Día de la semana que inicia el mes (Lunes = 0, Domingo = 6)
  const firstDayIndex = (new Date(currentYear, currentMonth - 1, 1).getDay() + 6) % 7;

  // Días del mes anterior para rellenar
  const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const prevMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;
  const daysInPrevMonth = new Date(prevMonthYear, prevMonth, 0).getDate();

  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const dayNum = daysInPrevMonth - i;
    const cell = document.createElement('div');
    cell.className = 'cal-day other-month';
    cell.innerHTML = `
      <div class="cal-day-top">
        <span class="cal-day-num">${dayNum}</span>
      </div>
    `;
    grid.appendChild(cell);
  }

  // Días del mes actual
  for (let day = 1; day <= daysInMonth; day++) {
    const isToday = isCurrentRealMonth && (day === realTodayDay);
    const dayUsers = allCelebrants.filter(u => u.birth_month === currentMonth && u.birth_day === day);
    const hasBday = dayUsers.length > 0;

    const cell = document.createElement('div');
    cell.className = `cal-day ${isToday ? 'is-today' : ''} ${hasBday ? 'has-bday' : ''}`;
    cell.dataset.day = day;
    cell.dataset.month = currentMonth;

    let bdayContent = '';
    if (hasBday) {
      // Stack de avatares
      const avatarsHtml = dayUsers.slice(0, 3).map(u => `
        <img src="${u.profile_image || '/img/yocapi.png'}" 
             onerror="this.src='/img/yocapi.png'" 
             class="bday-cell-avatar" 
             title="${u.display_name}" 
             alt="${u.display_name}">
      `).join('');

      // Nombres de cumpleañeros
      const namesHtml = dayUsers.slice(0, 2).map(u => `
        <div class="bday-cell-pill ${isToday ? 'today-pill' : ''}">
          <span>🎂</span> <span>${u.display_name}</span>
        </div>
      `).join('');

      const moreText = dayUsers.length > 2 ? `<div class="bday-cell-more">+${dayUsers.length - 2} más</div>` : '';

      bdayContent = `
        <div class="bday-cell-mobile-dot">
          <span>🎂</span>${dayUsers.length > 1 ? `<span class="mobile-bday-count">${dayUsers.length}</span>` : ''}
        </div>
        <div class="bday-cell-stack">
          ${avatarsHtml}
        </div>
        ${namesHtml}
        ${moreText}
      `;
    }

    cell.innerHTML = `
      <div class="cal-day-top">
        <span class="cal-day-num">${day}</span>
        ${isToday ? '<span class="badge-today-label">✨ HOY</span>' : ''}
      </div>
      ${bdayContent}
    `;

    cell.addEventListener('click', () => {
      openDayModal(day, dayUsers, isToday);
    });

    grid.appendChild(cell);
  }

  // Rellenar días del próximo mes para completar la cuadrícula (múltiplo de 7)
  const totalCells = firstDayIndex + daysInMonth;
  const nextDays = (7 - (totalCells % 7)) % 7;
  for (let day = 1; day <= nextDays; day++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day other-month';
    cell.innerHTML = `
      <div class="cal-day-top">
        <span class="cal-day-num">${day}</span>
      </div>
    `;
    grid.appendChild(cell);
  }
}

// Renderizar Vista de Lista / Agenda del Mes
function renderList() {
  const list = document.getElementById('cal-list-view');
  if (!list) return;
  list.innerHTML = '';

  const monthUsers = allCelebrants.filter(u => u.birth_month === currentMonth);
  const realToday = new Date();
  const isCurrentRealMonth = (realToday.getMonth() + 1 === currentMonth);
  const realTodayDay = realToday.getDate();

  if (monthUsers.length === 0) {
    list.innerHTML = `
      <div style="text-align:center;padding:48px 20px;background:rgba(255,255,255,0.02);border-radius:var(--radius-md);border:1px dashed var(--border-subtle);">
        <div style="font-size:2.5rem;margin-bottom:10px;">☕</div>
        <h4 style="font-size:1.1rem;font-weight:700;">No hay cumpleaños registrados en ${MONTH_NAMES[currentMonth]}</h4>
        <p style="color:var(--text-dim);font-size:0.85rem;margin-top:6px;">¡Sé el primero en registrarte si naciste este mes!</p>
      </div>
    `;
    return;
  }

  monthUsers.forEach(u => {
    const isToday = isCurrentRealMonth && (u.birth_day === realTodayDay);
    const card = document.createElement('div');
    card.className = `agenda-card ${isToday ? 'is-today' : ''}`;
    card.innerHTML = `
      <div class="agenda-date-box">
        <span class="agenda-date-num">${u.birth_day}</span>
        <span class="agenda-date-month">${MONTH_NAMES[u.birth_month].slice(0, 3)}</span>
      </div>
      <div class="agenda-user-info">
        <img src="${u.profile_image || '/img/yocapi.png'}" onerror="this.src='/img/yocapi.png'" class="agenda-avatar" alt="">
        <div class="agenda-details">
          <h4>
            <span>${u.display_name}</span>
            ${isToday ? '<span class="badge-today-label">✨ ¡HOY!</span>' : ''}
          </h4>
          <p>${u.custom_message ? `“${u.custom_message}”` : 'Celebrando con la comunidad'}</p>
        </div>
      </div>
      <div>
        <button class="btn-ghost" style="padding:6px 14px;font-size:0.8rem;" onclick="openCelebrantModal('${u.username}')">
          Ver Ficha 🎂
        </button>
      </div>
    `;
    list.appendChild(card);
  });
}

// Modal Interactivo de Día
function openDayModal(day, celebrants, isToday) {
  const modal = document.getElementById('day-modal');
  const title = document.getElementById('modal-day-title');
  const badge = document.getElementById('modal-day-badge');
  const list = document.getElementById('modal-celebrants-list');
  if (!modal || !list) return;

  title.textContent = `🎂 ${day} de ${MONTH_NAMES[currentMonth]}`;
  badge.textContent = isToday ? '✨ ¡ES HOY EN STREAM!' : `${celebrants.length} Cumpleañero${celebrants.length === 1 ? '' : 's'}`;

  if (isToday && typeof confetti === 'function') {
    confetti({
      particleCount: 80,
      spread: 80,
      origin: { y: 0.6 },
      colors: ['#9146ff', '#f43f5e', '#fbbf24', '#10b981']
    });
  }

  if (celebrants.length === 0) {
    list.innerHTML = `
      <div style="text-align:center;padding:30px 10px;">
        <div style="font-size:2.2rem;margin-bottom:8px;">🎈</div>
        <h4 style="font-size:1.05rem;font-weight:700;">Día sin cumpleaños registrados</h4>
        <p style="color:var(--text-dim);font-size:0.85rem;margin-top:6px;">Nadie de la comunidad ha registrado su cumpleaños el ${day} de ${MONTH_NAMES[currentMonth]}.</p>
      </div>
    `;
  } else {
    list.innerHTML = celebrants.map(u => {
      const isUserToday = isToday || u.isToday;
      return `
        <div class="modal-user-card ${isUserToday ? 'is-today' : ''}">
          <div class="modal-user-header">
            <img src="${u.profile_image || '/img/yocapi.png'}" onerror="this.src='/img/yocapi.png'" class="modal-user-avatar" alt="">
            <div class="modal-user-names">
              <h4>${u.display_name}</h4>
              <p>@${u.username} • ${day} de ${MONTH_NAMES[currentMonth]}</p>
            </div>
          </div>

          ${u.custom_message ? `<div class="modal-user-quote">“${u.custom_message}”</div>` : ''}

          <div class="modal-user-actions">
            <button class="btn-sound-preview" onclick="playCelebrationSound('${u.selected_sound || 'HBSilbato.mp3'}', this)">
              <span>▶</span> Escuchar sonido (${u.selected_sound || 'HBSilbato.mp3'})
            </button>

            ${isUserToday && felicitationsEnabled ? `
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:0.75rem;color:var(--accent-gold);font-weight:700;">Felicitar en stream:</span>
                <button class="btn-ghost" style="padding:4px 8px;" title="Silbato" onclick="sendFelicitation('${u.username}', 'HBSilbato.mp3')">🎺</button>
                <button class="btn-ghost" style="padding:4px 8px;" title="Voz" onclick="sendFelicitation('${u.username}', 'HBVoz.mp3')">🎤</button>
                <button class="btn-ghost" style="padding:4px 8px;" title="Música" onclick="sendFelicitation('${u.username}', 'MBMusica.mp3')">🎵</button>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  modal.style.display = 'flex';
}

function closeDayModal() {
  const modal = document.getElementById('day-modal');
  if (modal) modal.style.display = 'none';
  if (previewAudio) {
    try { previewAudio.pause(); } catch (_) {}
    previewAudio = null;
  }
}

// Abrir ficha directamente desde búsqueda o lista
window.openCelebrantModal = function(username) {
  const user = allCelebrants.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return;
  currentMonth = user.birth_month;
  document.getElementById('month-select').value = currentMonth;
  updateCalendarView();
  openDayModal(user.birth_day, [user], user.isToday);
};

// Reproducir sonido favorito
window.playCelebrationSound = function(soundFile, btn) {
  if (previewAudio) {
    try { previewAudio.pause(); previewAudio.currentTime = 0; } catch (_) {}
  }
  document.querySelectorAll('.btn-sound-preview').forEach(b => b.classList.remove('playing'));

  if (btn) btn.classList.add('playing');
  previewAudio = new Audio(`/music/${soundFile}`);
  previewAudio.volume = 0.85;
  previewAudio.play().catch(() => {});
  previewAudio.onended = () => {
    if (btn) btn.classList.remove('playing');
  };
};

// Enviar felicitación en vivo a OBS
window.sendFelicitation = async function(targetUsername, sound) {
  const token = localStorage.getItem('yocapi_token');
  if (!token) {
    showToast('Inicia sesión en Mi Portal para poder enviar felicitaciones en vivo al stream', 'error');
    return;
  }

  try {
    const res = await fetch('/api/birthday/send-felicitation', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ target_username: targetUsername, sound })
    });
    const data = await res.json();
    if (data.success) {
      showToast('🎉 ¡Felicitación enviada al directo con éxito!', 'success');
      if (typeof confetti === 'function') {
        confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
      }
    } else {
      showToast(data.error || 'Error al enviar felicitación', 'error');
    }
  } catch (err) {
    showToast('Error conectando con el servidor', 'error');
  }
};

// Búsqueda en tiempo real
function handleSearch(query) {
  const feedback = document.getElementById('search-feedback');
  if (!query) {
    if (feedback) feedback.style.display = 'none';
    document.querySelectorAll('.cal-day').forEach(c => c.classList.remove('search-highlight'));
    return;
  }

  const matches = allCelebrants.filter(u =>
    u.display_name.toLowerCase().includes(query) ||
    u.username.toLowerCase().includes(query)
  );

  if (feedback) {
    feedback.style.display = 'flex';
    if (matches.length === 0) {
      feedback.innerHTML = `<span>🔍 No se encontraron cumpleañeros con "<strong>${query}</strong>"</span>`;
    } else {
      const matchPills = matches.slice(0, 4).map(u => `
        <button class="btn-ghost" style="padding:3px 10px;font-size:0.75rem;margin-left:6px;" onclick="jumpToCelebrant('${u.username}')">
          ${u.display_name} (${u.birth_day} ${MONTH_NAMES[u.birth_month].slice(0,3)})
        </button>
      `).join('');

      feedback.innerHTML = `
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
          <span>🎯 Encontrados ${matches.length}:</span>
          ${matchPills}
          ${matches.length > 4 ? `<span style="font-size:0.75rem;color:var(--text-dim);">+${matches.length - 4} más</span>` : ''}
        </div>
      `;
    }
  }

  // Si hay al menos un match en el mes actual, iluminar sus celdas
  document.querySelectorAll('.cal-day').forEach(c => c.classList.remove('search-highlight'));
  matches.forEach(m => {
    if (m.birth_month === currentMonth) {
      const cell = document.querySelector(`.cal-day[data-day="${m.birth_day}"][data-month="${currentMonth}"]`);
      if (cell) cell.classList.add('search-highlight');
    }
  });
}

// Saltar directamente a un cumpleañero desde la búsqueda
window.jumpToCelebrant = function(username) {
  const user = allCelebrants.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return;
  currentMonth = user.birth_month;
  document.getElementById('month-select').value = currentMonth;
  updateCalendarView();

  setTimeout(() => {
    const cell = document.querySelector(`.cal-day[data-day="${user.birth_day}"][data-month="${currentMonth}"]`);
    if (cell) {
      cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
      cell.classList.add('search-highlight');
      setTimeout(() => cell.classList.remove('search-highlight'), 2000);
    }
  }, 100);
};

// Renderizar estadísticas de la comunidad
function renderStats() {
  const totalEl = document.getElementById('stat-total');
  const monthEl = document.getElementById('stat-top-month');
  const todayEl = document.getElementById('stat-today');

  if (totalEl) totalEl.textContent = allCelebrants.length;

  const todayCount = allCelebrants.filter(u => u.isToday).length;
  if (todayEl) todayEl.textContent = todayCount > 0 ? `${todayCount} hoy 🎂` : '0 hoy';

  // Encontrar mes con más cumpleañeros
  const monthCounts = {};
  allCelebrants.forEach(u => {
    monthCounts[u.birth_month] = (monthCounts[u.birth_month] || 0) + 1;
  });
  let maxMonth = 1;
  let maxCount = 0;
  for (const m in monthCounts) {
    if (monthCounts[m] > maxCount) {
      maxCount = monthCounts[m];
      maxMonth = parseInt(m, 10);
    }
  }
  if (monthEl) monthEl.textContent = maxCount > 0 ? `${MONTH_NAMES[maxMonth]} (${maxCount})` : '—';
}

// Renderizar sección inferior de destacados (Hoy y Próximos 14 días)
function renderHighlights() {
  const containerToday = document.getElementById('highlight-today-list');
  const containerUpcoming = document.getElementById('highlight-upcoming-list');

  const todayCelebrants = allCelebrants.filter(u => u.isToday);
  if (containerToday) {
    if (todayCelebrants.length === 0) {
      containerToday.innerHTML = `
        <div style="text-align:center;padding:24px 10px;color:var(--text-dim);font-size:0.85rem;">
          <div style="font-size:1.8rem;margin-bottom:6px;">☕</div>
          Hoy no hay cumpleañeros en stream. ¡Revisa los próximos!
        </div>
      `;
    } else {
      containerToday.innerHTML = todayCelebrants.map(u => `
        <div class="celebrant-card-mini" style="border-color:rgba(251,191,36,0.4);background:rgba(251,191,36,0.06);">
          <div class="celebrant-mini-info">
            <img src="${u.profile_image || '/img/yocapi.png'}" onerror="this.src='/img/yocapi.png'" class="celebrant-mini-avatar" alt="">
            <div>
              <strong style="color:#fff;font-size:0.95rem;">${u.display_name}</strong>
              <p style="color:var(--accent-gold);font-size:0.75rem;margin:0;">✨ ¡De fiesta hoy en directo!</p>
            </div>
          </div>
          <button class="btn-primary-pill" style="padding:5px 12px;font-size:0.78rem;" onclick="openCelebrantModal('${u.username}')">
            Festejar 🎉
          </button>
        </div>
      `).join('');
    }
  }

  // Próximos en 14 días
  const upcomingCelebrants = allCelebrants.filter(u => u.daysUntilBirthday > 0 && u.daysUntilBirthday <= 14)
    .sort((a, b) => a.daysUntilBirthday - b.daysUntilBirthday);

  if (containerUpcoming) {
    if (upcomingCelebrants.length === 0) {
      containerUpcoming.innerHTML = `
        <div style="text-align:center;padding:24px 10px;color:var(--text-dim);font-size:0.85rem;">
          <div style="font-size:1.8rem;margin-bottom:6px;">🎈</div>
          No hay cumpleaños programados en los próximos 14 días.
        </div>
      `;
    } else {
      containerUpcoming.innerHTML = upcomingCelebrants.map(u => {
        const badge = u.daysUntilBirthday === 1 ? '¡Mañana!' : `En ${u.daysUntilBirthday} días`;
        return `
          <div class="celebrant-card-mini">
            <div class="celebrant-mini-info">
              <img src="${u.profile_image || '/img/yocapi.png'}" onerror="this.src='/img/yocapi.png'" class="celebrant-mini-avatar" alt="">
              <div>
                <strong style="color:#fff;font-size:0.9rem;">${u.display_name}</strong>
                <p style="color:var(--text-dim);font-size:0.75rem;margin:0;">${u.birth_day} de ${MONTH_NAMES[u.birth_month]}</p>
              </div>
            </div>
            <span style="font-size:0.75rem;font-weight:800;padding:3px 10px;border-radius:12px;background:rgba(145,70,255,0.2);color:#c4b5fd;">
              ${badge}
            </span>
          </div>
        `;
      }).join('');
    }
  }
}
