/**
 * YoCapi Birthday System — Client App Logic (Nick + PIN, Mobile-First)
 */

let currentAudio = null;
let currentPlayingFile = null;
let avatarFetchTimeout = null;

// Cálculo de Signo Zodiacal
function getZodiac(month, day) {
  const zodiacs = [
    { name: '♑ Capricornio', m: 1, d: 19 },
    { name: '♒ Acuario', m: 2, d: 18 },
    { name: '♓ Piscis', m: 3, d: 20 },
    { name: '♈ Aries', m: 4, d: 19 },
    { name: '♉ Tauro', m: 5, d: 20 },
    { name: '♊ Géminis', m: 6, d: 20 },
    { name: '♋ Cáncer', m: 7, d: 22 },
    { name: '♌ Leo', m: 8, d: 22 },
    { name: '♍ Virgo', m: 9, d: 22 },
    { name: '♎ Libra', m: 10, d: 22 },
    { name: '♏ Escorpio', m: 11, d: 21 },
    { name: '♐ Sagitario', m: 12, d: 21 },
    { name: '♑ Capricornio', m: 12, d: 31 }
  ];
  for (const z of zodiacs) {
    if (month < z.m || (month === z.m && day <= z.d)) {
      return z.name;
    }
  }
  return '♑ Capricornio';
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
function updateCelebrationBanner(status, user) {
  const box = document.getElementById('celebration-box');
  const tag = document.getElementById('status-tag');
  const title = document.getElementById('status-title');
  const desc = document.getElementById('status-desc');
  const launchBtn = document.getElementById('btn-launch-alert');

  if (status.canCelebrate) {
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

  // Selectores de días y zodiaco en registro
  const regMonth = document.getElementById('reg-month');
  const regDay = document.getElementById('reg-day');
  const regZodiac = document.getElementById('reg-zodiac');


  function updateRegZodiac() {
    const m = parseInt(regMonth.value, 10);
    const d = parseInt(regDay.value, 10);
    if (m && d) {
      regZodiac.textContent = `✨ Signo: ${getZodiac(m, d)}`;
      regZodiac.style.display = 'block';
    } else {
      regZodiac.style.display = 'none';
    }
  }

  regMonth.addEventListener('change', () => {
    populateDaysSelect(regDay, regMonth, regDay.value);
    updateRegZodiac();
  });
  regDay.addEventListener('change', updateRegZodiac);

  // Inicializar días
  populateDaysSelect(regDay, regMonth);

  // Modal de confirmación de fecha de cumpleaños
  const modalConfirmBday = document.getElementById('modal-confirm-bday');
  const modalDateText = document.getElementById('modal-date-text');
  const modalZodiacText = document.getElementById('modal-zodiac-text');
  const btnModalCancel = document.getElementById('btn-modal-cancel');
  const btnModalConfirm = document.getElementById('btn-modal-confirm');

  const MONTH_NAMES_ES = [
    '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  let pendingRegistrationPayload = null;

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

    // Actualizar datos del modal
    modalDateText.textContent = `${day} de ${MONTH_NAMES_ES[month] || ''}`;
    modalZodiacText.textContent = `✨ Signo: ${getZodiac(month, day)}`;
    modalConfirmBday.style.display = 'flex';
  });

  btnModalCancel.addEventListener('click', () => {
    modalConfirmBday.style.display = 'none';
    pendingRegistrationPayload = null;
  });

  btnModalConfirm.addEventListener('click', async () => {
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
        stateGuest.style.display = 'block';
        stateUser.style.display = 'none';
        return;
      }

      const data = await res.json();
      if (!data || !data.user) {
        stateGuest.style.display = 'block';
        stateUser.style.display = 'none';
        return;
      }

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
      updateCelebrationBanner(data.status, data.user);

      // Formulario de edición
      const editMonth = document.getElementById('edit-month');
      const editDay = document.getElementById('edit-day');
      const editMsg = document.getElementById('edit-message');
      const editZodiac = document.getElementById('user-zodiac-badge');

      editMonth.value = data.user.birth_month;
      populateDaysSelect(editDay, editMonth, data.user.birth_day);
      editMsg.value = data.user.custom_message || '';
      const editCounter = document.getElementById('edit-char-counter');
      if (editCounter) {
        editCounter.textContent = `${(data.user.custom_message || '').length}/100`;
        editMsg.oninput = () => {
          editCounter.textContent = `${editMsg.value.length}/100`;
        };
      }
      editZodiac.textContent = getZodiac(data.user.birth_month, data.user.birth_day);

      editMonth.onchange = () => {
        populateDaysSelect(editDay, editMonth, editDay.value);
        editZodiac.textContent = getZodiac(parseInt(editMonth.value, 10), parseInt(editDay.value, 10));
      };
      editDay.onchange = () => {
        editZodiac.textContent = getZodiac(parseInt(editMonth.value, 10), parseInt(editDay.value, 10));
      };

      await loadSoundCards('edit-sound-container', 'edit_sound', data.user.selected_sound);

    } catch (err) {
      console.error('Error comprobando sesión:', err);
      stateLoading.style.display = 'none';
      stateGuest.style.display = 'block';
    }
  }

  // Pestañas superiores de usuario (Sidebar Superior)
  const userSubnavBtns = document.querySelectorAll('.user-subnav-btn');
  const userTabPanes = document.querySelectorAll('.user-tab-pane');

  userSubnavBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      userSubnavBtns.forEach(b => b.classList.toggle('active', b === btn));
      userTabPanes.forEach(pane => {
        pane.style.display = pane.id === targetTab ? 'block' : 'none';
      });
    });
  });

  // Guardar configuración de celebración
  const formCelebration = document.getElementById('form-edit-celebration');
  if (formCelebration) {
    formCelebration.addEventListener('submit', async (e) => {
      e.preventDefault();
      const month = document.getElementById('edit-month').value;
      const day = document.getElementById('edit-day').value;
      const message = document.getElementById('edit-message').value;
      const soundRadio = document.querySelector('input[name="edit_sound"]:checked');
      const sound = soundRadio ? soundRadio.value : 'HBSilbato.mp3';

      const saveBtn = document.getElementById('btn-save-celebration');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Guardando...';

      try {
        const res = await fetch('/api/birthday/update', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            birth_month: month,
            birth_day: day,
            custom_message: message,
            selected_sound: sound
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast('¡Configuración de cumpleaños guardada!', 'success');
          checkUserSession();
        } else {
          showToast(data.error || 'Error al guardar', 'error');
        }
      } catch {
        showToast('Error conectando con el servidor', 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Guardar Configuración de Alerta';
      }
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
        saveBtn.textContent = '💾 Actualizar Seguridad';
      }
    });
  }

  // Cerrar Sesión
  document.getElementById('btn-logout').addEventListener('click', async () => {
    localStorage.removeItem('yocapi_token');
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

  // Verificar al cargar
  checkUserSession();
});
