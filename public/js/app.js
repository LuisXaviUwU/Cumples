/**
 * YoCapi Birthday System — Frontend App Logic
 */

let currentAudio = null;
let currentPlayingFile = null;

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

// Inicialización de Días
function populateDays(selectedDay = null) {
  const selectDay = document.getElementById('select-day');
  const selectMonth = document.getElementById('select-month');
  const month = parseInt(selectMonth.value, 10);

  let maxDays = 31;
  if ([4, 6, 9, 11].includes(month)) maxDays = 30;
  if (month === 2) maxDays = 29;

  selectDay.innerHTML = '<option value="" disabled selected>Selecciona tu día...</option>';
  for (let i = 1; i <= maxDays; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = i;
    if (selectedDay && parseInt(selectedDay, 10) === i) {
      opt.selected = true;
    }
    selectDay.appendChild(opt);
  }
}

// Cargar sonidos
async function loadSounds(selectedSound = 'HBSilbato.mp3') {
  const container = document.getElementById('sound-options-container');
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
          <input type="radio" name="selected_sound" value="${s.file}" id="sound_${s.file}" class="sound-radio" ${isSelected ? 'checked' : ''}>
          <label for="sound_${s.file}" class="sound-name" style="cursor:pointer;">${s.label}</label>
        </div>
        <button type="button" class="btn-preview-audio" data-sound="${s.file}" title="Escuchar">▶</button>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-preview-audio')) return;
        document.querySelectorAll('.sound-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        card.querySelector('input[type="radio"]').checked = true;
      });

      const playBtn = card.querySelector('.btn-preview-audio');
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleAudioPreview(s.file, playBtn);
      });

      container.appendChild(card);
    });
  } catch (err) {
    console.error('Error cargando sonidos:', err);
  }
}

function toggleAudioPreview(file, btn) {
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

  currentAudio.play().catch(e => {
    console.warn('Auto-play prevent:', e);
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

// Actualizar banner de estado
function updateCelebrationBanner(status, birthday) {
  const box = document.getElementById('celebration-box');
  const tag = document.getElementById('status-tag');
  const title = document.getElementById('status-title');
  const desc = document.getElementById('status-desc');
  const launchBtn = document.getElementById('btn-launch-alert');

  if (!birthday) {
    box.className = 'celebration-box waiting';
    tag.textContent = '🗓️ Sin Registro';
    title.textContent = 'Registra tu fecha especial';
    desc.textContent = 'Elige tu mes y día en el formulario para activar tu alerta en stream.';
    launchBtn.style.display = 'none';
    return;
  }

  if (status.canCelebrate) {
    box.className = 'celebration-box active';
    launchBtn.style.display = 'inline-flex';

    if (status.isToday) {
      tag.textContent = '🎂 ¡ES HOY! ¡ES HOY!';
      title.textContent = '🎉 ¡Feliz Cumpleaños!';
      desc.textContent = '¡Hoy es tu día especial! Haz clic en el botón para enviar tu alerta en vivo a la pantalla de yocapi_pr.';
    } else {
      tag.textContent = `🎈 Período de Gracia (${status.daysRemainingInGrace} días restantes)`;
      title.textContent = '¡Aún estás a tiempo de celebrar!';
      desc.textContent = 'Tu cumpleaños fue hace poco, pero el período de gracia te permite lanzar tu felicitación en directo.';
    }

    // Pequeño confeti de bienvenida si puede celebrar
    if (typeof confetti === 'function') {
      confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.7 }
      });
    }
  } else {
    box.className = 'celebration-box waiting';
    launchBtn.style.display = 'none';
    tag.textContent = '⏳ Cuenta Regresiva';
    title.textContent = `Faltan ${status.daysUntilBirthday} días`;
    desc.textContent = `Tu cumpleaños está guardado para el ${birthday.birth_day} de este mes. ¡El botón de alerta en vivo se activará automáticamente el día de tu cumpleaños y durará 14 días!`;
  }
}

// Iniciar aplicación
document.addEventListener('DOMContentLoaded', async () => {
  const selectMonth = document.getElementById('select-month');
  const selectDay = document.getElementById('select-day');
  const inputMessage = document.getElementById('input-message');
  const charCounter = document.getElementById('char-counter');
  const zodiacBadge = document.getElementById('zodiac-badge');
  const launchAlertBtn = document.getElementById('btn-launch-alert');
  const bdayForm = document.getElementById('bday-form');

  populateDays();

  // Escuchar mensaje y actualizar contador
  inputMessage.addEventListener('input', () => {
    charCounter.textContent = `${inputMessage.value.length}/100`;
  });

  // Actualizar días y zodiaco al cambiar mes o día
  function updateZodiac() {
    const m = parseInt(selectMonth.value, 10);
    const d = parseInt(selectDay.value, 10);
    if (m && d) {
      zodiacBadge.textContent = getZodiac(m, d);
      zodiacBadge.style.display = 'inline-block';
    } else {
      zodiacBadge.style.display = 'none';
    }
  }

  selectMonth.addEventListener('change', () => {
    populateDays(selectDay.value);
    updateZodiac();
  });
  selectDay.addEventListener('change', updateZodiac);

  // Cargar usuario
  try {
    const res = await fetch('/api/me');
    document.getElementById('state-loading').style.display = 'none';

    if (res.status === 401) {
      document.getElementById('state-guest').style.display = 'block';
      return;
    }

    const data = await res.json();
    document.getElementById('state-user').style.display = 'block';

    // Perfil
    document.getElementById('user-name').textContent = data.user.display_name;
    document.getElementById('user-login').textContent = `@${data.user.login}`;
    if (data.user.profile_image) {
      document.getElementById('user-avatar').src = data.user.profile_image;
    }

    // Datos de cumpleaños previos
    let selectedSound = 'HBSilbato.mp3';
    if (data.birthday) {
      selectMonth.value = data.birthday.birth_month;
      populateDays(data.birthday.birth_day);
      inputMessage.value = data.birthday.custom_message || '';
      charCounter.textContent = `${inputMessage.value.length}/100`;
      selectedSound = data.birthday.selected_sound || 'HBSilbato.mp3';
      updateZodiac();
    }

    await loadSounds(selectedSound);

    if (data.status) {
      updateCelebrationBanner(data.status, data.birthday);
    }

    // Guardar cumpleaños
    bdayForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const month = selectMonth.value;
      const day = selectDay.value;
      const message = inputMessage.value;
      const soundInput = document.querySelector('input[name="selected_sound"]:checked');
      const sound = soundInput ? soundInput.value : 'HBSilbato.mp3';

      const saveBtn = document.getElementById('btn-save-bday');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Guardando...';

      try {
        const postRes = await fetch('/api/birthday/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            birth_month: month,
            birth_day: day,
            custom_message: message,
            selected_sound: sound
          })
        });
        const result = await postRes.json();
        if (result.success) {
          showToast('¡Cumpleaños guardado exitosamente!', 'success');
          updateCelebrationBanner(result.status, result.birthday);
        } else {
          showToast(result.error || 'Error al guardar', 'error');
        }
      } catch {
        showToast('Error de conexión con el servidor', 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Guardar Cumpleaños';
      }
    });

    // Lanzar alerta en directo
    launchAlertBtn.addEventListener('click', async () => {
      launchAlertBtn.disabled = true;
      launchAlertBtn.textContent = '🚀 Enviando a OBS...';

      try {
        const alertRes = await fetch('/api/birthday/alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const result = await alertRes.json();

        if (result.success) {
          showToast(result.message, 'success');
          if (typeof confetti === 'function') {
            confetti({
              particleCount: 150,
              spread: 100,
              origin: { y: 0.5 }
            });
          }

          // Cooldown visual de 30s
          let seconds = 30;
          const cooldownText = document.getElementById('alert-cooldown-text');
          cooldownText.style.display = 'block';

          const interval = setInterval(() => {
            seconds--;
            launchAlertBtn.textContent = `⏳ Espera ${seconds}s`;
            cooldownText.textContent = `Podrás lanzar otra alerta en ${seconds} segundos.`;
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

  } catch (err) {
    console.error('Error inicializando:', err);
    document.getElementById('state-loading').innerHTML = `
      <p style="color: var(--accent-pink);">No se pudo conectar con el servidor.</p>
    `;
  }
});
