/**
 * YoCapi Birthday System — OBS Overlay Controller 3.0 (Super Festive & Reliable)
 */

const params = new URLSearchParams(window.location.search);
const token = params.get('token');
const isDebug = params.get('debug') === '1';

if (isDebug) {
  document.body.classList.add('debug');
}

const alertWrapper = document.getElementById('alert-wrapper');
const alertAvatar = document.getElementById('alert-avatar');
const alertUsername = document.getElementById('alert-username');
const alertTaglineText = document.getElementById('alert-tagline-text');
const alertQuote = document.getElementById('alert-quote');
const alertQueueTag = document.getElementById('alert-queue-tag');
const debugStatus = document.getElementById('debug-status');

// Fallback de imagen en caso de error 404 o fallo de red
alertAvatar.onerror = function () {
  this.onerror = null;
  this.src = '/img/yocapi.png';
};

// Paleta de temas festivos
const THEMES = {
  purple: {
    solid: '#9146ff',
    glow: 'rgba(145, 70, 255, 0.55)',
    ring: 'conic-gradient(from 0deg, #9146ff, #f43f5e, #fbbf24, #06b6d4, #a855f7, #9146ff)'
  },
  pink: {
    solid: '#f43f5e',
    glow: 'rgba(244, 63, 94, 0.6)',
    ring: 'conic-gradient(from 0deg, #f43f5e, #ec4899, #fbbf24, #9146ff, #f43f5e)'
  },
  gold: {
    solid: '#fbbf24',
    glow: 'rgba(251, 191, 36, 0.6)',
    ring: 'conic-gradient(from 0deg, #fbbf24, #f59e0b, #f43f5e, #a855f7, #fbbf24)'
  },
  cyan: {
    solid: '#06b6d4',
    glow: 'rgba(6, 182, 212, 0.6)',
    ring: 'conic-gradient(from 0deg, #06b6d4, #3b82f6, #9146ff, #ec4899, #06b6d4)'
  }
};

function applyTheme(name = 'purple') {
  const t = THEMES[name] || THEMES.purple;
  document.documentElement.style.setProperty('--theme-solid', t.solid);
  document.documentElement.style.setProperty('--theme-glow', t.glow);
  document.documentElement.style.setProperty('--theme-ring', t.ring);
}

// Resolución inteligente de avatar con auto-recuperación de Twitch
async function resolveAvatar(username, initialAvatar) {
  if (initialAvatar && initialAvatar.startsWith('http') && !initialAvatar.includes('default')) {
    alertAvatar.src = initialAvatar;
    return;
  }

  // Si no vino avatar o vino el default, intentar rescate en vivo con IVR Twitch API
  alertAvatar.src = '/img/yocapi.png';
  try {
    const clean = (username || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!clean) return;
    const res = await fetch(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(clean)}`);
    const data = await res.json();
    const logo = data && data[0]?.logo;
    if (logo && logo.startsWith('http')) {
      alertAvatar.src = logo;
    }
  } catch (e) {
    // Si falla, se queda /img/yocapi.png
  }
}

// ─── Espectáculo de Confeti y Fuegos Artificiales ──────────────────────────
function triggerBirthdayConfetti() {
  if (typeof confetti !== 'function') return;

  // Ola 1: Disparo central masivo con estrellas y círculos
  confetti({
    particleCount: 110,
    spread: 95,
    origin: { y: 0.8 },
    shapes: ['star', 'circle'],
    colors: ['#9146ff', '#f43f5e', '#fbbf24', '#06b6d4', '#ffffff']
  });

  // Ola 2: Cañones laterales cruzados (a los 350ms)
  setTimeout(() => {
    confetti({
      particleCount: 65,
      angle: 60,
      spread: 60,
      origin: { x: 0.05, y: 0.85 },
      colors: ['#fbbf24', '#f43f5e', '#9146ff', '#ec4899']
    });
    confetti({
      particleCount: 65,
      angle: 120,
      spread: 60,
      origin: { x: 0.95, y: 0.85 },
      colors: ['#06b6d4', '#9146ff', '#fbbf24', '#10b981']
    });
  }, 350);

  // Ola 3: Lluvia dorada celestial suave (a los 1200ms)
  setTimeout(() => {
    confetti({
      particleCount: 80,
      spread: 120,
      origin: { y: 0.15 },
      gravity: 0.75,
      ticks: 240,
      shapes: ['star'],
      colors: ['#ffd700', '#ff69b4', '#00ffff', '#ffffff']
    });
  }, 1200);

  // Ola 4: Explosión secundaria de destellos (a los 2500ms)
  setTimeout(() => {
    confetti({
      particleCount: 50,
      spread: 75,
      origin: { y: 0.75 },
      colors: ['#f43f5e', '#fbbf24', '#9146ff']
    });
  }, 2500);
}

// ─── Cola de Alertas ───────────────────────────────────────────────────────
const alertQueue = [];
let isPlaying = false;
const ALERT_DURATION_MS = 9500;

function enqueue(alertData) {
  alertQueue.push(alertData);
  if (!isPlaying) {
    playNext();
  } else {
    updateQueueTag();
  }
}

function updateQueueTag() {
  if (alertQueue.length > 0) {
    alertQueueTag.textContent = `+${alertQueue.length} en espera 🎉`;
    alertQueueTag.style.display = 'block';
  } else {
    alertQueueTag.style.display = 'none';
  }
}

function playNext() {
  if (alertQueue.length === 0) {
    isPlaying = false;
    alertWrapper.classList.remove('active');
    return;
  }

  isPlaying = true;
  const current = alertQueue.shift();
  updateQueueTag();

  // Configurar contenido
  alertUsername.textContent = current.user || 'Cumpleañero';

  // Carga inteligente del avatar con rescate en vivo
  resolveAvatar(current.user, current.avatar);

  if (current.isGrace) {
    alertTaglineText.textContent = '¡Celebrando su Cumpleaños! (Período de Gracia)';
  } else {
    alertTaglineText.textContent = '¡Hoy es su Cumpleaños!';
  }

  if (current.message && current.message.trim().length > 0) {
    alertQuote.textContent = `“${current.message.trim()}”`;
    alertQuote.style.display = 'block';
  } else {
    alertQuote.style.display = 'none';
  }

  applyTheme(current.theme || 'purple');

  // Reproducir audio seleccionado
  if (current.sound) {
    const audio = new Audio(`/music/${current.sound}`);
    audio.play().catch(e => console.warn('Audio play error:', e));
  }

  // Activar confeti y fuegos artificiales
  triggerBirthdayConfetti();

  // Mostrar alerta con animación
  alertWrapper.classList.add('active');

  // Programar fin de alerta
  setTimeout(() => {
    alertWrapper.classList.remove('active');
    setTimeout(() => {
      playNext();
    }, 700); // Pausa entre alertas
  }, ALERT_DURATION_MS);
}

// ─── Conexión SSE con Reconexión Automática ────────────────────────────────
function connectSSE() {
  if (!token) {
    debugStatus.textContent = 'ERROR: Falta el parámetro ?token= en la URL de OBS.';
    return;
  }

  debugStatus.textContent = 'Conectando a stream SSE...';
  const evtSource = new EventSource(`/api/overlay/stream?token=${encodeURIComponent(token)}`);

  evtSource.onopen = () => {
    debugStatus.textContent = 'OBS Conectado a YoCapi Cumpleaños 🟢';
    console.log('[OBS Overlay] Conexión SSE establecida con éxito.');
  };

  evtSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'ping') {
        // Heartbeat recibido
        return;
      }
      if (data.type === 'alert') {
        enqueue(data);
      }
      if (data.type === 'felicitation') {
        showFelicitation(data);
      }
    } catch (e) {
      console.error('Error parseando evento SSE:', e);
    }
  };

  evtSource.onerror = () => {
    debugStatus.textContent = 'Desconectado 🔴 Reconectando en 5s...';
    evtSource.close();
    setTimeout(connectSSE, 5000);
  };
}

// ─── Felicitaciones Flotantes de la Comunidad ─────────────────────────────
const FELIC_ICONS = ['🎂', '🎉', '🎈', '🎁', '✨', '🥳', '💖', '🌟', '🎊', '🍰'];
const FELIC_SOUNDS = {
  'HBSilbato.mp3': '🎺',
  'HBVoz.mp3': '🎤',
  'MBMusica.mp3': '🎵'
};

function showFelicitation(data) {
  // Reproducir el sonido
  if (data.sound) {
    const audio = new Audio(`/music/${data.sound}`);
    audio.volume = 0.55;
    audio.play().catch(() => {});
  }

  // Crear mini confetti pequeño
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 25,
      spread: 50,
      origin: { x: Math.random(), y: 0.6 + Math.random() * 0.3 },
      colors: ['#9146ff', '#f43f5e', '#fbbf24', '#10b981'],
      scalar: 0.7,
      ticks: 120
    });
  }

  // Crear card flotante en posición aleatoria (evitando centro, que es la alerta principal)
  const card = document.createElement('div');
  card.className = 'felic-card';

  const randomIcon = FELIC_ICONS[Math.floor(Math.random() * FELIC_ICONS.length)];
  const soundIcon = FELIC_SOUNDS[data.sound] || '🎵';

  const avatarSrc = (data.fromAvatar && data.fromAvatar.startsWith('http'))
    ? data.fromAvatar : '/img/yocapi.png';

  card.innerHTML = `
    <img class="felic-avatar" src="${avatarSrc}" onerror="this.src='/img/yocapi.png'" alt="">
    <div class="felic-body">
      <span class="felic-from">${data.from || 'Alguien'}</span>
      <span class="felic-text">${randomIcon} ¡Feliz Cumpleaños! ${soundIcon}</span>
    </div>
  `;

  // Posición aleatoria en zonas perimetrales (evitando el centro ±35%)
  let x, y;
  const zone = Math.floor(Math.random() * 4); // 0=top, 1=bottom, 2=left, 3=right
  switch (zone) {
    case 0: x = 5 + Math.random() * 90; y = 3 + Math.random() * 18; break;
    case 1: x = 5 + Math.random() * 90; y = 75 + Math.random() * 20; break;
    case 2: x = 1 + Math.random() * 18; y = 20 + Math.random() * 55; break;
    default: x = 76 + Math.random() * 20; y = 20 + Math.random() * 55; break;
  }

  card.style.left = `${x}%`;
  card.style.top = `${y}%`;
  card.style.setProperty('--felic-dx', `${(Math.random() - 0.5) * 120}px`);
  card.style.setProperty('--felic-dy', `${-60 - Math.random() * 80}px`);

  document.body.appendChild(card);

  // Animar entrada
  requestAnimationFrame(() => {
    card.classList.add('felic-visible');
  });

  // Remover tras 4.5s
  setTimeout(() => {
    card.classList.add('felic-exit');
    setTimeout(() => card.remove(), 700);
  }, 4500);
}

connectSSE();
