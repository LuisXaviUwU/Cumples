/**
 * YoCapi Birthday System — Client App Logic (Nick + PIN, Mobile-First)
 */

let currentAudio = null;
let currentPlayingFile = null;
let avatarFetchTimeout = null;
let currentUser = null;



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
  }, 4000);
}

function getAuthHeaders(extra = {}) {
  const token = localStorage.getItem('yocapi_token');
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// Llenar selector de días
function populateDaysSelect(selectDayEl, selectMonthEl, selectedDay = null) {
  const month = parseInt(selectMonthEl.value, 10);
  let maxDays = 31;
  if ([4, 6, 9, 11].includes(month)) maxDays = 30;
  if (month === 2) maxDays = 29;

  selectDayEl.innerHTML = '<option value="" disabled selected>Día...</option>';
  for (let i = 1; i <= maxDays; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = i;
    if (selectedDay && parseInt(selectedDay, 10) === i) {
      opt.selected = true;
    }
    selectDayEl.appendChild(opt);
  }
}

// Cargar sonidos
async function loadSoundCards(containerId, groupName, selectedSound = 'HBSilbato.mp3') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  try {
    const res = await fetch('/api/sounds');
    const sounds = await res.json();

    if (!sounds || sounds.length === 0) {
      container.innerHTML = '<p style="color:var(--text-dim);font-size:0.8rem;">No hay sonidos disponibles.</p>';
      return;
    }

    sounds.forEach((s) => {
      const isSelected = (s.file === selectedSound);
      const card = document.createElement('div');
      card.className = `sound-card ${isSelected ? 'selected' : ''}`;
      card.innerHTML = `
        <div class="sound-card-left">
          <input type="radio" name="${groupName}" value="${s.file}" id="${groupName}_${s.file}" class="sound-radio" ${isSelected ? 'checked' : ''}>
          <label for="${groupName}_${s.file}" class="sound-name" style="cursor:pointer;">${s.label}</label>
        </div>
        <button type="button" class="btn-preview-audio" data-sound="${s.file}" title="Escuchar">▶</button>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-preview-audio')) return;
        container.querySelectorAll('.sound-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        card.querySelector('input[type="radio"]').checked = true;
      });

      const playBtn = card.querySelector('.btn-preview-audio');
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleAudio(s.file, playBtn);
      });

      container.appendChild(card);
    });
  } catch (err) {
    console.error('Error cargando sonidos:', err);
  }
}

function toggleAudio(file, btn) {
  if (currentAudio && currentPlayingFile === file) {
    currentAudio.pause();
    currentAudio = null;
    currentPlayingFile = null;
    btn.textContent = '▶';
    btn.classList.remove('playing');
    return;
  }

  if (currentAudio) {
    currentAudio.pause();
    document.querySelectorAll('.btn-preview-audio').forEach(b => {
      b.textContent = '▶';
      b.classList.remove('playing');
    });
  }

  currentAudio = new Audio(`/music/${file}`);
  currentPlayingFile = file;
  btn.textContent = '⏸';
  btn.classList.add('playing');

  currentAudio.play().catch(() => {
    btn.textContent = '▶';
    btn.classList.remove('playing');
  });

  currentAudio.onended = () => {
    btn.textContent = '▶';
    btn.classList.remove('playing');
    currentAudio = null;
    currentPlayingFile = null;
  };
}

// Actualizar banner de estado de cumpleaños
function updateCelebrationBanner(status, user, alreadyCelebrated) {
  const box = document.getElementById('celebration-box');
  const tag = document.getElementById('status-tag');
  const title = document.getElementById('status-title');
  const desc = document.getElementById('status-desc');
  const launchBtn = document.getElementById('btn-launch-alert');

  // Si la fecha está desbloqueada por la streamer para corregirla, deshabilitar lanzamiento de alerta
  if (!user.is_date_locked) {
    box.className = 'celebration-box';
    launchBtn.style.display = 'none';
    tag.textContent = '🔓 Fecha Desbloqueada';
    title.textContent = 'Modifica y Confirma tu Fecha';
    desc.textContent = 'La streamer ha desbloqueado tu fecha para que puedas corregirla. Por favor selecciona tu fecha correcta abajo en "Configurar Mi Alerta" y guárdala para confirmarla.';
    return;
  }

  if (status.canCelebrate) {
    // Si ya lanzó su alerta este año, mostrar estado especial
    if (alreadyCelebrated) {
      box.className = 'celebration-box celebrated';
      launchBtn.style.display = 'none';
      if (status.isToday) {
        tag.textContent = '🎂 ¡Ya Celebraste Hoy!';
        title.textContent = '🥳 ¡Feliz Cumpleaños!';
        desc.textContent = '¡Ya lanzaste tu alerta de cumpleaños en el stream! Solo puedes hacerlo una vez por año. ¡Esperamos que haya sido genial! 🎉';
      } else {
        tag.textContent = '🎈 Celebración Completada';
        title.textContent = '¡Ya celebraste este año!';
        desc.textContent = `¡Tu alerta de cumpleaños ya fue lanzada en el stream! Hasta el próximo año. Te quedan ${status.daysRemainingInGrace} días de período de gracia pero ya no puedes lanzar otra alerta.`;
      }
      return;
    }

    box.className = 'celebration-box active';
    launchBtn.style.display = 'inline-flex';

    if (status.isToday) {
      tag.textContent = '🎂 ¡HOY ES TU DÍA!';
      title.textContent = '🎉 ¡Feliz Cumpleaños!';
      desc.textContent = '¡Tu alerta en vivo está lista! Presiona el botón para dispararla con sonido y confeti en la pantalla de yocapi_pr.';
    } else {
      tag.textContent = `🎈 Período de Gracia (${status.daysRemainingInGrace} días rest.)`;
      title.textContent = '¡Aún puedes festejar!';
      desc.textContent = 'El período de gracia te permite lanzar tu alerta en directo aunque hayan pasado unos días de tu cumpleaños.';
    }

    if (typeof confetti === 'function') {
      confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
    }
  } else {
    box.className = 'celebration-box';
    launchBtn.style.display = 'none';
    tag.textContent = '⏳ Cuenta Regresiva';
    title.textContent = `Faltan ${status.daysUntilBirthday} días`;
    desc.textContent = `Tu cumpleaños está programado para el día ${user.birth_day}. ¡El botón para lanzarlo en directo se activará automáticamente el día de tu cumpleaños!`;
  }
}

// Inicialización de la aplicación
document.addEventListener('DOMContentLoaded', async () => {
  const stateLoading = document.getElementById('state-loading');
  const stateGuest = document.getElementById('state-guest');
  const stateUser = document.getElementById('state-user');

  // Pestañas Registro / Login
  const tabBtnReg = document.getElementById('tab-btn-register');
  const tabBtnLog = document.getElementById('tab-btn-login');
  const formReg = document.getElementById('form-register');
  const formLog = document.getElementById('form-login');

  tabBtnReg.addEventListener('click', () => {
    tabBtnReg.classList.add('active');
    tabBtnLog.classList.remove('active');
    formReg.style.display = 'block';
    formLog.style.display = 'none';
  });

  tabBtnLog.addEventListener('click', () => {
    tabBtnLog.classList.add('active');
    tabBtnReg.classList.remove('active');
    formLog.style.display = 'block';
    formReg.style.display = 'none';
  });

  // Vista previa dinámica de avatar de Twitch
  const regUserInput = document.getElementById('reg-username');
  const regAvatarImg = document.getElementById('reg-avatar-preview');
  const regAvatarName = document.getElementById('reg-avatar-name');

  regAvatarImg.onerror = function() { this.src = '/img/yocapi.png'; };

  regUserInput.addEventListener('input', () => {
    const val = regUserInput.value.trim();
    regAvatarName.textContent = val ? `@${val}` : 'Tu Avatar de Twitch';

    clearTimeout(avatarFetchTimeout);
    if (val.length >= 2) {
      avatarFetchTimeout = setTimeout(async () => {
        try {
          const res = await fetch(`/api/avatar/${encodeURIComponent(val)}`);
          const data = await res.json();
          if (data.avatar && data.avatar.startsWith('http')) {
            regAvatarImg.src = data.avatar;
          } else {
            // Fallback directo a IVR
            const ivrRes = await fetch(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(val)}`);
            const ivrData = await ivrRes.json();
            const logo = ivrData && ivrData[0]?.logo;
            if (logo && logo.startsWith('http')) {
              regAvatarImg.src = logo;
            } else {
              regAvatarImg.src = '/img/yocapi.png';
            }
          }
        } catch {
          regAvatarImg.src = '/img/yocapi.png';
        }
      }, 350);
    } else {
      regAvatarImg.src = '/img/yocapi.png';
    }
  });

  // Selectores de días en registro
  const regMonth = document.getElementById('reg-month');
  const regDay = document.getElementById('reg-day');

  regMonth.addEventListener('change', () => {
    populateDaysSelect(regDay, regMonth, regDay.value);
  });

  // Inicializar días
  populateDaysSelect(regDay, regMonth);

  // Modal de confirmación de fecha de cumpleaños
  const modalConfirmBday = document.getElementById('modal-confirm-bday');
  const modalDateText = document.getElementById('modal-date-text');
  const btnModalCancel = document.getElementById('btn-modal-cancel');
  const btnModalConfirm = document.getElementById('btn-modal-confirm');

  const MONTH_NAMES_ES = [
    '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  let pendingRegistrationPayload = null;
  let pendingEditPayload = null;

  // Interceptar formulario de Registro con el Modal
  formReg.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = regUserInput.value.trim();
    const pin = document.getElementById('reg-pin').value.trim();
    const secret = document.getElementById('reg-secret').value.trim();
    const month = parseInt(regMonth.value, 10);
    const day = parseInt(regDay.value, 10);

    if (pin.length < 6 || pin.length > 15) {
      showToast('La contraseña debe tener entre 6 y 15 caracteres', 'error');
      return;
    }
    if (!secret || secret.length < 2) {
      showToast('Ingresa tu palabra secreta para poder recuperar tu cuenta si lo necesitas', 'error');
      return;
    }

    pendingRegistrationPayload = {
      username,
      pin,
      secret_word: secret,
      birth_month: month,
      birth_day: day
    };
    pendingEditPayload = null;

    // Actualizar datos del modal
    modalDateText.textContent = `${day} de ${MONTH_NAMES_ES[month] || ''}`;
    const subtitle = document.querySelector('.modal-subtitle');
    if (subtitle) subtitle.textContent = 'Confirma la fecha de tu cumpleaños antes de registrarte';
    modalConfirmBday.style.display = 'flex';
  });

  btnModalCancel.addEventListener('click', () => {
    modalConfirmBday.style.display = 'none';
    pendingRegistrationPayload = null;
    pendingEditPayload = null;
  });

  btnModalConfirm.addEventListener('click', async () => {
    if (pendingEditPayload) {
      modalConfirmBday.style.display = 'none';
      const payload = pendingEditPayload;
      pendingEditPayload = null;
      await executeSaveCelebration(payload);
      return;
    }

    if (!pendingRegistrationPayload) return;
    modalConfirmBday.style.display = 'none';

    const submitBtn = document.getElementById('btn-submit-register');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Registrando...';

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingRegistrationPayload)
      });
      const data = await res.json();
      if (data.success) {
        if (data.token) localStorage.setItem('yocapi_token', data.token);
        showToast('¡Registro completado con éxito!', 'success');
        checkUserSession();
      } else {
        showToast(data.error || 'Error al registrar', 'error');
      }
    } catch {
      showToast('Error conectando con el servidor', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '🎉 Registrar Mi Cumpleaños';
      pendingRegistrationPayload = null;
    }
  });

  // Submit Login
  formLog.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const pin = document.getElementById('login-pin').value.trim();

    const submitBtn = document.getElementById('btn-submit-login');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Entrando...';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, pin })
      });
      const data = await res.json();
      if (data.success) {
        if (data.token) localStorage.setItem('yocapi_token', data.token);
        showToast(`¡Bienvenido de vuelta, ${data.user.display_name}!`, 'success');
        checkUserSession();
      } else {
        showToast(data.error || 'Error al iniciar sesión', 'error');
      }
    } catch {
      showToast('Error conectando con el servidor', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '🔓 Iniciar Sesión';
    }
  });

  // Flujo de Olvido / Recuperación de PIN
  const formReset = document.getElementById('form-reset-pin');
  const linkForgotPin = document.getElementById('link-forgot-pin');
  const linkBackLogin = document.getElementById('link-back-login');

  if (linkForgotPin) {
    linkForgotPin.addEventListener('click', (e) => {
      e.preventDefault();
      formLog.style.display = 'none';
      formReg.style.display = 'none';
      formReset.style.display = 'block';
    });
  }

  if (linkBackLogin) {
    linkBackLogin.addEventListener('click', (e) => {
      e.preventDefault();
      formReset.style.display = 'none';
      formLog.style.display = 'block';
    });
  }

  if (formReset) {
    formReset.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('reset-username').value.trim();
      const secret_word = document.getElementById('reset-secret').value.trim();
      const new_pin = document.getElementById('reset-new-pin').value.trim();

      if (new_pin.length < 6 || new_pin.length > 15) {
        showToast('La nueva contraseña debe tener entre 6 y 15 caracteres', 'error');
        return;
      }

      const resetBtn = document.getElementById('btn-submit-reset');

      resetBtn.disabled = true;
      resetBtn.textContent = 'Verificando...';

      try {
        const res = await fetch('/api/auth/reset-pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, secret_word, new_pin })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message, 'success');
          formReset.style.display = 'none';
          formLog.style.display = 'block';
          document.getElementById('login-username').value = username;
          document.getElementById('login-pin').value = new_pin;
        } else {
          showToast(data.error || 'Error al restablecer contraseña', 'error');
        }
      } catch {
        showToast('Error de conexión con el servidor', 'error');
      } finally {
        resetBtn.disabled = false;
        resetBtn.textContent = '✅ Restablecer PIN y Entrar';
      }
    });
  }

  // Comprobar sesión activa
  async function checkUserSession() {
    try {
      const res = await fetch('/api/me', {
        headers: getAuthHeaders()
      });
      stateLoading.style.display = 'none';

      if (!res.ok) {
        currentUser = null;
        stateGuest.style.display = 'block';
        stateUser.style.display = 'none';
        return;
      }

      const data = await res.json();
      if (!data || !data.user) {
        currentUser = null;
        stateGuest.style.display = 'block';
        stateUser.style.display = 'none';
        return;
      }

      currentUser = data.user;
      stateGuest.style.display = 'none';
      stateUser.style.display = 'block';

      // Llenar datos de usuario logueado
      document.getElementById('user-name').textContent = data.user.display_name;
      const userAvatarImg = document.getElementById('user-avatar');
      userAvatarImg.onerror = function() { this.src = '/img/yocapi.png'; };
      if (data.user.profile_image && data.user.profile_image.startsWith('http')) {
        userAvatarImg.src = data.user.profile_image;
      } else {
        // Cargar avatar en vivo si aún no estaba en la base de datos
        fetch(`/api/avatar/${encodeURIComponent(data.user.username)}`)
          .then(r => r.json())
          .then(d => {
            if (d.avatar && d.avatar.startsWith('http')) userAvatarImg.src = d.avatar;
          })
          .catch(() => {});
      }

      // Banner de estado
      updateCelebrationBanner(data.status, data.user, data.alreadyCelebrated);

      // Formulario de edición
      const editMonth = document.getElementById('edit-month');
      const editDay = document.getElementById('edit-day');
      const editMsg = document.getElementById('edit-message');

      // Fecha bloqueada o editable
      const boxLocked = document.getElementById('box-date-locked');
      const boxEditable = document.getElementById('box-date-editable');
      const lockedDisplay = document.getElementById('locked-date-display');

      if (data.user.is_date_locked) {
        // Mostrar fecha bloqueada como texto estático
        if (boxLocked) boxLocked.style.display = 'flex';
        if (boxEditable) boxEditable.style.display = 'none';
        if (lockedDisplay) {
          lockedDisplay.textContent = `${data.user.birth_day} de ${MONTH_NAMES_ES[data.user.birth_month] || ''}`;
        }
        // Iniciar polling para detectar desbloqueo del streamer
        startUnlockPolling();
      } else {
        // Mostrar selectores editables
        if (boxLocked) boxLocked.style.display = 'none';
        if (boxEditable) boxEditable.style.display = 'block';
        const currentM = (data.user.birth_month && data.user.birth_month > 0) ? data.user.birth_month : (new Date().getMonth() + 1);
        const currentD = (data.user.birth_day && data.user.birth_day > 0) ? data.user.birth_day : new Date().getDate();
        if (editMonth) editMonth.value = currentM;
        populateDaysSelect(editDay, editMonth, currentD);
        editMonth.onchange = () => {
          populateDaysSelect(editDay, editMonth, editDay.value);
        };
      }

      editMsg.value = data.user.custom_message || '';
      const editCounter = document.getElementById('edit-char-counter');
      if (editCounter) {
        editCounter.textContent = `${(data.user.custom_message || '').length}/100`;
        editMsg.oninput = () => {
          editCounter.textContent = `${editMsg.value.length}/100`;
        };
      }

      await loadSoundCards('edit-sound-container', 'edit_sound', data.user.selected_sound);

      // Llenar campo de cambio de nombre
      const editDisplayName = document.getElementById('edit-display-name');
      if (editDisplayName) {
        editDisplayName.value = data.user.display_name || data.user.username;
      }

      // Actualizar tarjeta de vista previa en pestaña de Lanzar Alerta
      const launchName = document.getElementById('launch-card-name');
      if (launchName) launchName.textContent = data.user.display_name || data.user.username;
      const launchMsg = document.getElementById('launch-card-msg');
      if (launchMsg) launchMsg.textContent = data.user.custom_message ? `“${data.user.custom_message}”` : '“¡Un año más en el stream! 🥳”';
      const launchSound = document.getElementById('launch-card-sound');
      if (launchSound) launchSound.textContent = data.user.selected_sound || 'HBSilbato.mp3';
      const launchAvatar = document.getElementById('launch-card-avatar');
      if (launchAvatar && data.user.profile_image) launchAvatar.src = data.user.profile_image;

    } catch (err) {
      console.error('Error comprobando sesión:', err);
      currentUser = null;
      stateLoading.style.display = 'none';
      stateGuest.style.display = 'block';
    }
  }

  // Pestañas superiores de usuario (Sidebar Superior)
  const userSubnavBtns = document.querySelectorAll('.user-subnav-btn');
  const userTabPanes = document.querySelectorAll('.user-tab-pane');
  let communityLoaded = false;

  userSubnavBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      userSubnavBtns.forEach(b => b.classList.toggle('active', b === btn));
      userTabPanes.forEach(pane => {
        pane.style.display = pane.id === targetTab ? 'block' : 'none';
      });
      // Cargar comunidad al entrar al tab
      if (targetTab === 'tab-community' && !communityLoaded) {
        loadCommunitySection();
        communityLoaded = true;
      }
    });
  });

  // Polling de desbloqueo: cuando la fecha está bloqueada, verificar cada 5s
  let unlockPollInterval = null;
  function startUnlockPolling() {
    if (unlockPollInterval) return;
    unlockPollInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/me', { headers: getAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.user && !data.user.is_date_locked) {
          clearInterval(unlockPollInterval);
          unlockPollInterval = null;
          showToast('🔓 ¡La streamer desbloqueó tu fecha! Ya puedes modificarla.', 'success');
          checkUserSession();
        }
      } catch {}
    }, 5000);
  }

  // Cargar sección de comunidad (cumpleañeros de hoy + próximos 14 días)
  let musicLockPoller = null; // intervalo de polling del mutex de música

  function applyMusicLockUI(musicLock) {
    const allMusicBtns = document.querySelectorAll('.btn-felic-sound[data-sound="MBMusica.mp3"]');
    if (musicLock && musicLock.locked) {
      const secsLeft = Math.ceil(musicLock.remainingMs / 1000);
      allMusicBtns.forEach(b => {
        if (!b.disabled) { // no pisar cooldown ya activo
          b.disabled = true;
          b.classList.add('felic-cooldown');
          b.title = `🎵 Sonando (${secsLeft}s)`;
          b.textContent = `🎵⏳`;
        }
      });
    } else {
      allMusicBtns.forEach(b => {
        // Solo re-habilitar si no tiene otro cooldown propio activo
        if (b.dataset.cooldown !== 'personal') {
          b.disabled = false;
          b.classList.remove('felic-cooldown');
          b.title = 'Música de Fiesta';
          b.textContent = '🎵';
        }
      });
    }
  }

  function startMusicLockPolling() {
    if (musicLockPoller) clearInterval(musicLockPoller);
    musicLockPoller = setInterval(async () => {
      try {
        const r = await fetch('/api/birthday/music-status');
        const lock = await r.json();
        applyMusicLockUI(lock);
        if (!lock.locked && musicLockPoller) {
          // Cuando se libera, seguir sondeando pero a ritmo más lento (5s)
        }
      } catch {}
    }, 3000);
  }

  async function loadCommunitySection() {
    const container = document.getElementById('community-section');
    if (!container) return;
    container.innerHTML = '<p style="color:var(--text-dim);padding:16px;">Cargando...</p>';

    try {
      // Excluir al propio cumpleañero de la lista de "a felicitar" si está logueado
      const excludeParam = currentUser ? `?exclude=${encodeURIComponent(currentUser.username)}` : '';
      const res = await fetch(`/api/birthday/public-today${excludeParam}`);
      const data = await res.json();

      // Aplicar estado inicial del mutex de música
      if (data.music_lock) applyMusicLockUI(data.music_lock);
      // Iniciar polling en vivo del mutex de música cuando hay cumpleañeros
      if (data.today && data.today.length > 0) startMusicLockPolling();

      const MONTH_NAMES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

      let html = `
        <div class="glass-card" style="margin-bottom:16px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; background: linear-gradient(135deg, rgba(145,70,255,0.18), rgba(244,63,94,0.08)); border-color: rgba(145,70,255,0.35);">
          <div style="display:flex; align-items:center; gap:12px;">
            <span style="font-size:1.8rem;">📅</span>
            <div>
              <h4 style="font-family:var(--font-heading); font-size:1rem; font-weight:800; margin:0; color:#fff;">Calendario Interactivo de la Comunidad</h4>
              <p style="color:var(--text-dim); font-size:0.78rem; margin:2px 0 0 0;">Explora todos los meses y días de cumpleaños con fotos y sonidos</p>
            </div>
          </div>
          <a href="/calendario.html" target="_blank" rel="noopener noreferrer" class="btn-primary-pill" style="padding:8px 16px; font-size:0.82rem; font-weight:700; text-decoration:none;">
            Abrir Calendario ↗️
          </a>
        </div>
      `;

      // Cumpleañeros de HOY
      if (data.today && data.today.length > 0) {
        const isFelicEnabled = !!data.felicitations_enabled;
        html += `
          <div class="glass-card" style="margin-bottom:16px; border-color: rgba(244,63,94,0.3);">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px;flex-wrap:wrap;">
              <h3 style="font-family:var(--font-heading);font-size:1.1rem;font-weight:800;margin:0;">
                🎂 ¡Cumpleaños HOY!
              </h3>
              ${isFelicEnabled ? `
                <span style="font-size:0.75rem;padding:3px 10px;border-radius:12px;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);color:#10b981;font-weight:700;">
                  🟢 Felicitaciones Activas
                </span>
              ` : `
                <span style="font-size:0.75rem;padding:3px 10px;border-radius:12px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;font-weight:700;">
                  🔴 En Pausa por la Streamer
                </span>
              `}
            </div>
            <p style="color:var(--text-dim);font-size:0.82rem;margin-bottom:16px;">
              ${isFelicEnabled
                ? 'Manda un sonido de felicitación que aparecerá con efectos en el directo de yocapi_pr'
                : 'La streamer habilitará las felicitaciones durante el momento especial del directo.'}
            </p>
        `;

        data.today.forEach(u => {
          html += `
            <div class="felic-user-card" id="felic-card-${u.username}">
              <div class="felic-user-info">
                <img src="${u.profile_image || '/img/yocapi.png'}" onerror="this.src='/img/yocapi.png'" 
                  class="felic-user-avatar" alt="${u.display_name}">
                <div>
                  <strong style="font-size:0.95rem;">${u.display_name}</strong>
                  <p style="font-size:0.75rem;color:var(--text-dim);">🎂 ¡Cumpleaños Hoy!</p>
                </div>
              </div>
              <div class="felic-sound-btns" id="sound-btns-${u.username}">
                ${isFelicEnabled ? `
                  <span class="felic-cd-indicator" id="cd-badge-${u.username}" style="display:none;">⏳ 5s</span>
                  <button class="btn-felic-sound" data-target="${u.username}" data-sound="HBSilbato.mp3" title="Silbato Festivo">🎺</button>
                  <button class="btn-felic-sound" data-target="${u.username}" data-sound="HBVoz.mp3" title="Felicitación de Voz">🎤</button>
                  <button class="btn-felic-sound" data-target="${u.username}" data-sound="MBMusica.mp3" title="Música de Fiesta">🎵</button>
                ` : `
                  <div style="font-size:0.78rem;color:var(--text-dim);background:rgba(255,255,255,0.04);padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);">
                    🔒 En espera del directo
                  </div>
                `}
              </div>
            </div>
            ${isFelicEnabled ? `
              <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06);">
                <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px;">
                  <button type="button" class="btn-quick-chip" data-target="${u.username}" data-text="¡Feliz cumple capo! 🎂">¡Feliz cumple! 🎂</button>
                  <button type="button" class="btn-quick-chip" data-target="${u.username}" data-text="¡Un año más de fiesta! 🥳">¡Un año más! 🥳</button>
                  <button type="button" class="btn-quick-chip" data-target="${u.username}" data-text="¡GG por otro año de vida! 🎮">¡GG por otro año! 🎮</button>
                </div>
                <input type="text" id="felic-input-${u.username}" class="custom-input" placeholder="Escribe un mensaje corto (opcional)..." maxlength="60" style="padding: 6px 10px; font-size: 0.78rem;">
              </div>
            ` : ''}
          `;
        });
        html += `</div>`;
      }

      // Próximos cumpleaños (14 días)
      if (data.upcoming && data.upcoming.length > 0) {
        html += `
          <div class="glass-card" style="border-color: rgba(145,70,255,0.2);">
            <h3 style="font-family:var(--font-heading);font-size:1rem;font-weight:700;margin-bottom:14px;">
              📅 Próximos Cumpleaños (14 días)
            </h3>
        `;
        data.upcoming.forEach(u => {
          html += `
            <div class="felic-upcoming-row">
              <img src="${u.profile_image || '/img/yocapi.png'}" onerror="this.src='/img/yocapi.png'"
                style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid rgba(145,70,255,0.4);" alt="">
              <div style="flex:1;">
                <strong style="font-size:0.88rem;">${u.display_name}</strong>
                <p style="font-size:0.73rem;color:var(--text-dim);">
                  ${u.birth_day} de ${MONTH_NAMES[u.birth_month]} · en ${u.daysUntil} día${u.daysUntil === 1 ? '' : 's'}
                </p>
              </div>
              <span style="font-size:1.1rem;">🎈</span>
            </div>
          `;
        });
        html += `</div>`;
      }

      if (!html) {
        html = `
          <div class="glass-card" style="text-align:center;padding:36px;">
            <div style="font-size:2rem;margin-bottom:8px;">☕</div>
            <h4 style="font-size:1rem;font-weight:700;">Sin cumpleaños próximos</h4>
            <p style="color:var(--text-dim);font-size:0.82rem;margin-top:6px;">
              Nadie cumple años hoy ni en los próximos 14 días.
            </p>
          </div>
        `;
      }

      container.innerHTML = html;

      // Listeners de chips de texto rapido (rellenan el input de mensaje)
      container.querySelectorAll('.btn-quick-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const target = chip.dataset.target;
          const text = chip.dataset.text;
          const inputEl = document.getElementById('felic-input-' + target);
          if (inputEl) { inputEl.value = text; inputEl.focus(); }
        });
      });

      // Listeners de botones de felicitación
      container.querySelectorAll('.btn-felic-sound').forEach(btn => {
        btn.addEventListener('click', async () => {
          const target = btn.dataset.target;
          const sound = btn.dataset.sound;
          const card = document.getElementById(`felic-card-${target}`) || btn.closest('.felic-user-card');
          const allBtns = card ? card.querySelectorAll('.btn-felic-sound') : [btn];
          const cdBadge = document.getElementById(`cd-badge-${target}`);

          // Oscurecer y deshabilitar los 3 botones en cuestión
          allBtns.forEach(b => {
            b.disabled = true;
            b.classList.add('felic-cooldown');
            b.dataset.cooldown = 'personal'; // marca para que el poller no pise
          });
          if (cdBadge) {
            cdBadge.style.display = 'inline-flex';
            cdBadge.textContent = '⏳ ...';
          }

          // Mensaje personalizado opcional
          const inputEl = document.getElementById(`felic-input-${target}`);
          const felicMsg = inputEl ? inputEl.value.trim() : '';

          try {
            const res = await fetch('/api/birthday/send-felicitation', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify({ target_username: target, sound, message: felicMsg })
            });
            const result = await res.json();
            if (result.success) {
              showToast(result.message, 'success');

              // Si se activó el mutex de música, aplicar inmediatamente a toda la sección
              if (result.music_lock && result.music_lock.locked) {
                applyMusicLockUI(result.music_lock);
                // Asegurar que los botones del cooldown personal sigan bloqueados
                allBtns.forEach(b => { b.dataset.cooldown = 'personal'; });
              }

              // Cooldown visual de 5 segundos en los 3 botones de ESTA tarjeta
              let secs = 5;
              if (cdBadge) cdBadge.textContent = `⏳ ${secs}s`;
              allBtns.forEach(b => { b.textContent = `${secs}s`; });

              const countdown = setInterval(() => {
                secs--;
                if (cdBadge) cdBadge.textContent = `⏳ ${secs}s`;
                allBtns.forEach(b => { b.textContent = `${secs}s`; });

                if (secs <= 0) {
                  clearInterval(countdown);
                  if (cdBadge) cdBadge.style.display = 'none';
                  const icons = { 'HBSilbato.mp3': '🎺', 'HBVoz.mp3': '🎤', 'MBMusica.mp3': '🎵' };
                  allBtns.forEach(b => {
                    b.textContent = icons[b.dataset.sound] || '🎵';
                    delete b.dataset.cooldown; // liberar marca personal
                    // El poller de música decidirá si re-habilitar el botón 🎵
                    if (b.dataset.sound !== 'MBMusica.mp3') {
                      b.disabled = false;
                      b.classList.remove('felic-cooldown');
                    }
                  });
                  // Forzar una comprobación inmediata del estado de música
                  fetch('/api/birthday/music-status').then(r => r.json()).then(lock => applyMusicLockUI(lock)).catch(() => {});
                }
              }, 1000);
            } else {
              showToast(result.error || 'Error al enviar', 'error');
              if (cdBadge) cdBadge.style.display = 'none';
              const icons = { 'HBSilbato.mp3': '🎺', 'HBVoz.mp3': '🎤', 'MBMusica.mp3': '🎵' };
              allBtns.forEach(b => {
                b.textContent = icons[b.dataset.sound] || '🎵';
                b.disabled = false;
                b.classList.remove('felic-cooldown');
                delete b.dataset.cooldown;
              });
            }
          } catch {
            showToast('Error de conexión', 'error');
            if (cdBadge) cdBadge.style.display = 'none';
            const icons = { 'HBSilbato.mp3': '🎺', 'HBVoz.mp3': '🎤', 'MBMusica.mp3': '🎵' };
            allBtns.forEach(b => {
              b.textContent = icons[b.dataset.sound] || '🎵';
              b.disabled = false;
              b.classList.remove('felic-cooldown');
              delete b.dataset.cooldown;
            });
          }
        });
      });
    } catch (err) {
      container.innerHTML = '<p style="color:var(--accent-pink);padding:16px;">Error al cargar.</p>';
      if (musicLockPoller) { clearInterval(musicLockPoller); musicLockPoller = null; }
    }
  }

  // Función ejecutora de guardado de celebración
  async function executeSaveCelebration(payload) {
    const saveBtn = document.getElementById('btn-save-celebration');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Guardando...';
    }

    try {
      const res = await fetch('/api/birthday/update', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showToast('¡Configuración de cumpleaños guardada y confirmada por 1 año!', 'success');
        checkUserSession();
      } else {
        showToast(data.error || 'Error al guardar', 'error');
      }
    } catch {
      showToast('Error conectando con el servidor', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Guardar Configuración de Alerta';
      }
    }
  }

  // Guardar configuración de celebración
  const formCelebration = document.getElementById('form-edit-celebration');
  if (formCelebration) {
    formCelebration.addEventListener('submit', async (e) => {
      e.preventDefault();
      const message = document.getElementById('edit-message').value;
      const soundRadio = document.querySelector('input[name="edit_sound"]:checked');
      const sound = soundRadio ? soundRadio.value : 'HBSilbato.mp3';

      // Solo enviar fecha si está desbloqueada
      const boxEditable = document.getElementById('box-date-editable');
      const isEditable = boxEditable && boxEditable.style.display !== 'none';
      const month = isEditable ? document.getElementById('edit-month').value : undefined;
      const day = isEditable ? document.getElementById('edit-day').value : undefined;

      const payload = { custom_message: message, selected_sound: sound };
      if (isEditable && month && day) {
        const m = parseInt(month, 10);
        const d = parseInt(day, 10);
        payload.birth_month = m;
        payload.birth_day = d;

        // Pedir confirmación con el modal antes de fijar por 1 año
        pendingEditPayload = payload;
        pendingRegistrationPayload = null;
        modalDateText.textContent = `${d} de ${MONTH_NAMES_ES[m] || ''}`;
        const subtitle = document.querySelector('.modal-subtitle');
        if (subtitle) subtitle.textContent = 'Confirma tu fecha de cumpleaños antes de fijarla por 1 año';
        modalConfirmBday.style.display = 'flex';
        return;
      }

      await executeSaveCelebration(payload);
    });
  }

  // Guardar configuración de seguridad (Contraseña / Palabra Secreta)
  const formSecurity = document.getElementById('form-edit-security');
  if (formSecurity) {
    formSecurity.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = document.getElementById('edit-pin').value.trim();
      const secret = document.getElementById('edit-secret').value.trim();

      if (!pin && !secret) {
        showToast('Escribe una nueva contraseña o palabra secreta para actualizar', 'info');
        return;
      }
      if (pin && (pin.length < 6 || pin.length > 15)) {
        showToast('La nueva contraseña debe tener entre 6 y 15 caracteres', 'error');
        return;
      }
      if (secret && secret.length < 2) {
        showToast('La palabra secreta debe tener al menos 2 caracteres', 'error');
        return;
      }

      const saveBtn = document.getElementById('btn-save-security');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Actualizando...';

      try {
        const res = await fetch('/api/birthday/update', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            new_password: pin || null,
            new_secret: secret || null
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast('¡Contraseña y palabra secreta actualizadas con éxito!', 'success');
          document.getElementById('edit-pin').value = '';
          document.getElementById('edit-secret').value = '';
        } else {
          showToast(data.error || 'Error al actualizar seguridad', 'error');
        }
      } catch {
        showToast('Error conectando con el servidor', 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Actualizar Claves de Seguridad';
      }
    });
  }

  // Guardar Nuevo Nombre en la Aplicación (Display Name)
  const formEditName = document.getElementById('form-edit-name');
  if (formEditName) {
    formEditName.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newDisplayName = document.getElementById('edit-display-name').value.trim();
      if (!newDisplayName || newDisplayName.length < 2) {
        showToast('El nombre debe tener al menos 2 caracteres', 'error');
        return;
      }
      if (newDisplayName.length > 30) {
        showToast('El nombre no puede tener más de 30 caracteres', 'error');
        return;
      }

      const saveBtn = document.getElementById('btn-save-name');
      const originalText = saveBtn.textContent;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Guardando...';

      try {
        const res = await fetch('/api/user/change-name', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ display_name: newDisplayName })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message || '¡Nombre actualizado con éxito!', 'success');
          if (currentUser) currentUser.display_name = data.display_name;
          const uName = document.getElementById('user-name');
          if (uName) uName.textContent = data.display_name;
          const launchName = document.getElementById('launch-card-name');
          if (launchName) launchName.textContent = data.display_name;
          const prevName = document.getElementById('preview-card-name');
          if (prevName) prevName.textContent = data.display_name;
        } else {
          showToast(data.error || 'Error al actualizar nombre', 'error');
        }
      } catch (err) {
        showToast('Error de conexión al actualizar nombre', 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
      }
    });
  }

  // Botón Rápido de Previsualización en pestaña de Lanzar Alerta
  const btnQuickPreview = document.getElementById('btn-preview-alert-quick');
  if (btnQuickPreview) {
    btnQuickPreview.addEventListener('click', () => {
      const mainPreviewBtn = document.getElementById('btn-preview-alert');
      if (mainPreviewBtn) mainPreviewBtn.click();
    });
  }

  // Cerrar Sesión
  document.getElementById('btn-logout').addEventListener('click', async () => {
    localStorage.removeItem('yocapi_token');
    currentUser = null;
    await fetch('/api/auth/logout', { method: 'POST', headers: getAuthHeaders() });
    showToast('Sesión cerrada', 'info');
    checkUserSession();
  });

  // Botón Lanzar Alerta en Directo
  const launchAlertBtn = document.getElementById('btn-launch-alert');
  launchAlertBtn.addEventListener('click', async () => {
    launchAlertBtn.disabled = true;
    launchAlertBtn.textContent = '🚀 Enviando a OBS...';

    try {
      const alertRes = await fetch('/api/birthday/alert', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      const result = await alertRes.json();

      if (result.success) {
        showToast(result.message, 'success');
        if (typeof confetti === 'function') {
          confetti({ particleCount: 120, spread: 90, origin: { y: 0.5 } });
        }

        let seconds = 30;
        const cooldownText = document.getElementById('alert-cooldown-text');
        cooldownText.style.display = 'block';

        const interval = setInterval(() => {
          seconds--;
          launchAlertBtn.textContent = `⏳ Espera ${seconds}s`;
          cooldownText.textContent = `Podrás lanzar otra alerta en ${seconds}s.`;
          if (seconds <= 0) {
            clearInterval(interval);
            launchAlertBtn.disabled = false;
            launchAlertBtn.innerHTML = '<span>🎉</span> ¡LANZAR ALERTA EN DIRECTO! <span>🚀</span>';
            cooldownText.style.display = 'none';
          }
        }, 1000);
      } else {
        showToast(result.error || 'No se pudo enviar la alerta', 'error');
        launchAlertBtn.disabled = false;
        launchAlertBtn.innerHTML = '<span>🎉</span> ¡LANZAR ALERTA EN DIRECTO! <span>🚀</span>';
      }
    } catch {
      showToast('Error de comunicación con el servidor', 'error');
      launchAlertBtn.disabled = false;
      launchAlertBtn.innerHTML = '<span>🎉</span> ¡LANZAR ALERTA EN DIRECTO! <span>🚀</span>';
    }
  });

  // ─── Modal de Previsualización de Alerta ──────────────────────────────────
  const btnPreview = document.getElementById('btn-preview-alert');
  const modalPreview = document.getElementById('modal-preview-alert');
  const btnClosePreview = document.getElementById('btn-close-preview');
  const btnReplayPreview = document.getElementById('btn-replay-preview');
  let previewAudio = null;

  function runPreview() {
    if (!currentUser) return;
    const msg = (document.getElementById('edit-message')?.value || currentUser.custom_message || '').trim();
    const selSoundCard = document.querySelector('#edit-sound-container .sound-card.selected');
    const sound = selSoundCard?.dataset?.sound || currentUser.selected_sound || 'HBSilbato.mp3';

    const avatarEl = document.getElementById('preview-card-avatar');
    if (avatarEl) avatarEl.src = currentUser.profile_image || '/img/yocapi.png';
    const nameEl = document.getElementById('preview-card-name');
    if (nameEl) nameEl.textContent = currentUser.display_name || currentUser.username;
    const msgEl = document.getElementById('preview-card-msg');
    if (msgEl) msgEl.textContent = msg ? `“${msg}”` : '“¡Festejando en directo con la comunidad! 🎂✨”';
    const soundEl = document.getElementById('preview-card-sound');
    if (soundEl) soundEl.textContent = sound;

    if (modalPreview) modalPreview.style.display = 'flex';

    if (previewAudio) {
      try { previewAudio.pause(); previewAudio.currentTime = 0; } catch (e) {}
    }
    previewAudio = new Audio(`/music/${sound}`);
    previewAudio.volume = 0.85;
    previewAudio.play().catch(() => {});

    if (typeof confetti === 'function') {
      confetti({
        particleCount: 95,
        spread: 85,
        origin: { y: 0.65 },
        colors: ['#9146ff', '#f43f5e', '#fbbf24', '#10b981', '#38bdf8']
      });
    }
  }

  function closePreview() {
    if (previewAudio) {
      try { previewAudio.pause(); previewAudio.currentTime = 0; } catch (e) {}
      previewAudio = null;
    }
    if (modalPreview) modalPreview.style.display = 'none';
  }

  if (btnPreview) btnPreview.addEventListener('click', runPreview);
  if (btnReplayPreview) btnReplayPreview.addEventListener('click', runPreview);
  if (btnClosePreview) btnClosePreview.addEventListener('click', closePreview);
  if (modalPreview) {
    modalPreview.addEventListener('click', (e) => {
      if (e.target === modalPreview) closePreview();
    });
  }

  // ─── Switcher Público: Mi Cuenta vs Muro Comunitario ──────────────────────
  const btnShowAccount = document.getElementById('btn-show-account');
  const btnShowWall = document.getElementById('btn-show-community-wall');
  const stateWall = document.getElementById('state-community-wall');

  async function loadPublicWall() {
    const wallContent = document.getElementById('public-wall-content');
    if (!wallContent) return;
    wallContent.innerHTML = '<div style="text-align:center;padding:30px;"><div style="font-size:2rem;margin-bottom:8px;">⏳</div><p style="color:var(--text-dim);font-size:0.85rem;">Cargando muro de la comunidad...</p></div>';

    try {
      const res = await fetch('/api/birthday/public-today');
      const data = await res.json();
      let html = `
        <div class="glass-card" style="margin-bottom: 20px; border-color: rgba(145,70,255,0.45); background: linear-gradient(135deg, rgba(145,70,255,0.18), rgba(244,63,94,0.1)); text-align: center; padding: 24px 20px;">
          <div style="font-size: 2.2rem; margin-bottom: 8px;">📅</div>
          <h3 style="font-family: var(--font-heading); font-size: 1.25rem; font-weight: 800; margin: 0 0 6px 0; color: #fff;">
            ¡Nuevo Calendario Interactivo de la Comunidad!
          </h3>
          <p style="color: var(--text-muted); font-size: 0.85rem; max-width: 480px; margin: 0 auto 16px auto;">
            Explora todos los meses del año, busca amigos del chat y mira quién cumple años en cada día con sonido y tarjetas interactivas.
          </p>
          <a href="/calendario.html" target="_blank" rel="noopener noreferrer" class="btn-primary" 
             style="display: inline-flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; width: auto; padding: 12px 26px; margin: 0 auto; box-shadow: 0 8px 24px rgba(145,70,255,0.5);">
            <span>🚀</span> Abrir Calendario en Nueva Ventana <span>↗️</span>
          </a>
        </div>
      `;

      if (data.today && data.today.length > 0) {
        html += `
          <div class="glass-card" style="margin-bottom: 20px; border-color: rgba(244,63,94,0.4); background: linear-gradient(135deg, rgba(244,63,94,0.12), rgba(145,70,255,0.06));">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
              <span style="font-size:1.8rem;">🎂</span>
              <div>
                <h3 style="font-family:var(--font-heading);font-size:1.15rem;font-weight:800;margin:0;">¡Cumpleañeros de Hoy en Stream!</h3>
                <p style="color:var(--text-dim);font-size:0.8rem;margin:0;">Pásate por el directo a felicitarlos con sonido en pantalla</p>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;">
        `;
        data.today.forEach(u => {
          html += `
            <div class="felic-user-card" style="padding:12px 16px;">
              <div class="felic-user-info">
                <img src="${u.profile_image || '/img/yocapi.png'}" onerror="this.src='/img/yocapi.png'" class="felic-user-avatar" alt="${u.display_name}">
                <div>
                  <strong style="font-size:1rem;color:#fff;">${u.display_name}</strong>
                  <p style="font-size:0.75rem;color:#fbbf24;margin:2px 0 0 0;">✨ ¡De fiesta en el directo de yocapi_pr!</p>
                </div>
              </div>
            </div>
          `;
        });
        html += `</div></div>`;
      } else {
        html += `
          <div class="glass-card" style="text-align:center;padding:28px;margin-bottom:20px;">
            <div style="font-size:2rem;margin-bottom:6px;">☕</div>
            <h4 style="font-size:1rem;font-weight:700;">Hoy no hay cumpleaños en stream</h4>
            <p style="color:var(--text-dim);font-size:0.82rem;margin-top:4px;">¡Revisa los que vienen pronto o registra el tuyo!</p>
          </div>
        `;
      }

      if (data.upcoming && data.upcoming.length > 0) {
        html += `
          <div class="glass-card" style="border-color: rgba(145,70,255,0.3);">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
              <span style="font-size:1.5rem;">🎈</span>
              <h3 style="font-family:var(--font-heading);font-size:1.05rem;font-weight:800;margin:0;">Próximos en los siguientes 14 días</h3>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;">
        `;
        const mNames = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        data.upcoming.forEach(u => {
          const badge = u.daysUntil === 1 ? '¡Mañana!' : `En ${u.daysUntil} días`;
          html += `
            <div class="felic-upcoming-row" style="background:rgba(255,255,255,0.03);padding:10px 14px;border-radius:12px;display:flex;align-items:center;gap:12px;">
              <img src="${u.profile_image || '/img/yocapi.png'}" onerror="this.src='/img/yocapi.png'" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid rgba(145,70,255,0.4);" alt="">
              <div style="flex:1;">
                <strong style="font-size:0.9rem;color:#fff;">${u.display_name}</strong>
                <p style="font-size:0.75rem;color:var(--text-dim);margin:0;">${u.birth_day} de ${mNames[u.birth_month]}</p>
              </div>
              <span style="font-size:0.75rem;font-weight:800;padding:3px 10px;border-radius:12px;background:rgba(145,70,255,0.2);color:#c4b5fd;">${badge}</span>
            </div>
          `;
        });
        html += `</div></div>`;
      }

      wallContent.innerHTML = html;
    } catch {
      wallContent.innerHTML = '<p style="color:var(--c-pink);text-align:center;">Error al cargar el muro comunitario.</p>';
    }
  }

  if (btnShowAccount && btnShowWall) {
    btnShowAccount.addEventListener('click', () => {
      btnShowAccount.classList.add('active');
      btnShowWall.classList.remove('active');
      if (stateWall) stateWall.style.display = 'none';
      if (currentUser) {
        if (stateGuest) stateGuest.style.display = 'none';
        if (stateUser) stateUser.style.display = 'block';
      } else {
        if (stateUser) stateUser.style.display = 'none';
        if (stateGuest) stateGuest.style.display = 'block';
      }
    });

    btnShowWall.addEventListener('click', () => {
      btnShowWall.classList.add('active');
      btnShowAccount.classList.remove('active');
      if (stateGuest) stateGuest.style.display = 'none';
      if (stateUser) stateUser.style.display = 'none';
      if (stateWall) stateWall.style.display = 'block';
      loadPublicWall();
    });
  }

  // Listener delegado para los chips de mensajes rápidos de felicitación
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.btn-quick-chip');
    if (chip) {
      const target = chip.dataset.target;
      const text = chip.dataset.text;
      const input = document.getElementById(`felic-input-${target}`);
      if (input) input.value = text;
    }
  });

  // Verificar al cargar
  checkUserSession();
});
