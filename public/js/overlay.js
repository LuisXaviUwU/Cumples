/**
 * Yocapi Birthday System — OBS Overlay Controller 3.0 (Super Festive & Reliable)
 */

const params = new URLSearchParams(window.location.search);
const token = params.get('token');

const alertWrapper = document.getElementById('alert-wrapper');
const alertAvatar = document.getElementById('alert-avatar');
const alertUsername = document.getElementById('alert-username');
const alertTaglineText = document.getElementById('alert-tagline-text');
const alertQuote = document.getElementById('alert-quote');
const alertQueueTag = document.getElementById('alert-queue-tag');
const debugStatus = document.getElementById('debug-status');

// ─── Configuración Visual Dinámica (Posición, Escala, Animación) ───────────
// La configuración viene SIEMPRE del servidor (guardada por el Simulador Visual).
// No se leen parámetros de URL para escala/posición — la URL solo lleva ?token=

let currentAudio = null;
let currentOverlayVolume = 0.85;

// Fade-out suave de audio para evitar cortes abruptos en el stream
function fadeOutAudio(audio, durationMs = 1000) {
  if (!audio) return;
  const startVol = audio.volume;
  if (startVol <= 0) {
    try { audio.pause(); } catch (_) {}
    return;
  }
  const steps = 12;
  const stepTime = durationMs / steps;
  let currentStep = 0;
  const interval = setInterval(() => {
    currentStep++;
    const factor = Math.max(0, 1 - (currentStep / steps));
    try {
      audio.volume = Math.max(0, startVol * factor);
    } catch (_) {}
    if (currentStep >= steps) {
      clearInterval(interval);
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (_) {}
    }
  }, stepTime);
}

function applyOverlayConfig(cfg) {
  if (!cfg) return;

  if (cfg.posX !== undefined && cfg.posX !== null) {
    document.documentElement.style.setProperty('--pos-x', `${cfg.posX}%`);
  }
  if (cfg.posY !== undefined && cfg.posY !== null) {
    document.documentElement.style.setProperty('--pos-y', `${cfg.posY}%`);
  }
  if (cfg.scale !== undefined && cfg.scale !== null) {
    const parsedScale = parseFloat(cfg.scale);
    if (!isNaN(parsedScale) && parsedScale > 0) {
      const finalScale = parsedScale > 2 ? parsedScale / 100 : parsedScale;
      document.documentElement.style.setProperty('--alert-scale', finalScale);
    }
  }
  if (cfg.volume !== undefined && cfg.volume !== null) {
    const parsedVol = parseFloat(cfg.volume);
    if (!isNaN(parsedVol) && parsedVol >= 0) {
      currentOverlayVolume = Math.max(0, Math.min(1, parsedVol));
      if (currentAudio) currentAudio.volume = currentOverlayVolume;
    }
  }
  if (cfg.animation) {
    const animName = cfg.animation.replace(/^anim-/, '');
    const validAnims = ['slide-up', 'slide-down', 'slide-left', 'slide-right', 'pop-zoom', 'bounce-drop', 'fade-glow'];
    if (validAnims.includes(animName)) {
      // Limpiar clases de animación anteriores
      alertWrapper.className = alertWrapper.className
        .split(' ')
        .filter(c => !c.startsWith('anim-') && !c.startsWith('pos-'))
        .join(' ');
      alertWrapper.classList.add(`anim-${animName}`);
    }
  }

  // 🪅 Configuración de la Piñata de Capibara (Posición y Escala)
  if (cfg.pinata) {
    if (cfg.pinata.posX !== undefined && cfg.pinata.posX !== null) {
      document.documentElement.style.setProperty('--pinata-pos-x', `${cfg.pinata.posX}%`);
    }
    if (cfg.pinata.posY !== undefined && cfg.pinata.posY !== null) {
      document.documentElement.style.setProperty('--pinata-pos-y', `${cfg.pinata.posY}%`);
    }
    if (cfg.pinata.scale !== undefined && cfg.pinata.scale !== null) {
      const parsedPinataScale = parseFloat(cfg.pinata.scale);
      if (!isNaN(parsedPinataScale) && parsedPinataScale > 0) {
        const finalPinataScale = parsedPinataScale > 2 ? parsedPinataScale / 100 : parsedPinataScale;
        document.documentElement.style.setProperty('--pinata-scale', finalPinataScale);
      }
    }
  }
}

// Cargar configuración del servidor al iniciar (REST fallback)
fetch('/api/overlay/config')
  .then(res => res.json())
  .then(cfg => applyOverlayConfig(cfg))
  .catch(() => {
    // Si falla, usar animación por defecto
    alertWrapper.classList.add('anim-slide-up');
  });

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

  // Reproducir audio seleccionado con control de volumen
  if (current.sound) {
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      } catch (e) {}
    }
    currentAudio = new Audio(`/music/${current.sound}`);
    currentAudio.volume = currentOverlayVolume;
    currentAudio.play().catch(e => console.warn('Audio play error:', e));
  }

  // Activar confeti y fuegos artificiales
  triggerBirthdayConfetti();

  // Mostrar alerta con animación
  alertWrapper.classList.add('active');

  // Programar fin de alerta y fade-out suave del audio
  const fadeStartMs = Math.max(0, ALERT_DURATION_MS - 1200);
  setTimeout(() => {
    if (currentAudio) fadeOutAudio(currentAudio, 1200);
  }, fadeStartMs);

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
    if (debugStatus) debugStatus.textContent = 'ERROR: Falta el parámetro ?token= en la URL de OBS.';
    return;
  }

  if (debugStatus) debugStatus.textContent = 'Conectando a stream SSE...';
  const evtSource = new EventSource(`/api/overlay/stream?token=${encodeURIComponent(token)}`);

  evtSource.onopen = () => {
    if (debugStatus) debugStatus.textContent = 'OBS Conectado a Yocapi Cumpleaños 🟢';
    console.log('[OBS Overlay] Conexión SSE establecida con éxito.');
  };

  evtSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'ping') {
        // Heartbeat recibido
        return;
      }
      if (data.type === 'connected') {
        // Aplicar configuración enviada en el momento de conexión (puede sobreescribir el REST inicial)
        if (data.config) applyOverlayConfig(data.config);
        return;
      }
      if (data.type === 'overlay_config' && data.config) {
        console.log('[OBS Overlay] Configuración actualizada en vivo desde el Dashboard:', data.config);
        applyOverlayConfig(data.config);
        return;
      }
      if (data.type === 'stop_alert') {
        console.log('[OBS Overlay] 🛑 Alerta detenida por la streamer.');
        if (currentAudio) {
          try {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            currentAudio = null;
          } catch (e) {}
        }
        alertWrapper.classList.remove('active');
        isPlaying = false;
        alertQueue.length = 0;
        updateQueueTag();
        return;
      }
      if (data.type === 'alert') {
        enqueue(data);
      }
      if (data.type === 'felicitation') {
        showFelicitation(data);
      }
      // Minijuego: Piñata de Capibara
      if (data.type === 'pinata_start') {
        startPinataUI(data);
      }
      if (data.type === 'pinata_hit') {
        hitPinataUI(data);
      }
      if (data.type === 'pinata_frenzy_start') {
        frenzyPinataUI(data);
      }
      if (data.type === 'pinata_extra_time') {
        extraTimePinataUI(data);
      }
      if (data.type === 'pinata_broken') {
        brokenPinataUI(data);
      }
      if (data.type === 'pinata_timeout') {
        timeoutPinataUI(data);
      }
      if (data.type === 'pinata_cancel') {
        cancelPinataUI();
      }
      // Audio silencioso sin visual (e.g., easter eggs como 'bang')
      if (data.type === 'play_audio' && data.sound) {
        try {
          const silentAudio = new Audio(`/music/${data.sound}`);
          silentAudio.volume = currentOverlayVolume;
          silentAudio.play().catch(e => console.warn('[Overlay] play_audio error:', e));
        } catch (e) {
          console.warn('[Overlay] play_audio excepción:', e);
        }
      }
    } catch (e) {
      console.error('Error parseando evento SSE:', e);
    }
  };

  evtSource.onerror = () => {
    if (debugStatus) debugStatus.textContent = 'Desconectado 🔴 Reconectando en 5s...';
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
      <span class="felic-text">${randomIcon} ¡Feliz Cumpleaños, ${data.to || 'Cumpleañero'}! ${soundIcon}</span>
      ${data.message ? `<span style="display:block; font-size: 0.8rem; color: #fde047; margin-top: 3px; font-weight: 700; word-break: break-word;">“${data.message}”</span>` : ''}
    </div>
  `;

  // Posición aleatoria segura en zonas perimetrales (sin salirse de la pantalla)
  const winW = window.innerWidth || 1920;
  const winH = window.innerHeight || 1080;
  const cardW = 480; // ancho estimado de la tarjeta grande
  const cardH = 80;  // alto estimado de la tarjeta
  const pad = 40;    // margen de seguridad respecto a los bordes de la pantalla

  const maxSafeX = Math.max(pad, winW - cardW - pad);
  const maxSafeY = Math.max(pad, winH - cardH - pad);

  // Zonas perimetrales para no tapar la alerta central:
  // 0: Franja superior
  // 1: Franja inferior
  // 2: Franja lateral izquierda
  // 3: Franja lateral derecha
  const zone = Math.floor(Math.random() * 4);
  let posX = pad;
  let posY = pad;

  if (zone === 0) {
    // Franja Superior
    posX = pad + Math.random() * (maxSafeX - pad);
    posY = pad + Math.random() * Math.max(10, (winH * 0.18) - pad);
  } else if (zone === 1) {
    // Franja Inferior
    const minY = winH * 0.76;
    posX = pad + Math.random() * (maxSafeX - pad);
    posY = minY + Math.random() * Math.max(10, maxSafeY - minY);
  } else if (zone === 2) {
    // Lateral Izquierdo
    const maxX = Math.min(maxSafeX, winW * 0.22);
    const minY = winH * 0.18;
    const maxY = Math.min(maxSafeY, winH * 0.74);
    posX = pad + Math.random() * Math.max(10, maxX - pad);
    posY = minY + Math.random() * Math.max(10, maxY - minY);
  } else {
    // Lateral Derecho
    const minX = Math.max(pad, winW * 0.70);
    const minY = winH * 0.18;
    const maxY = Math.min(maxSafeY, winH * 0.74);
    posX = minX + Math.random() * Math.max(10, maxSafeX - minX);
    posY = minY + Math.random() * Math.max(10, maxY - minY);
  }

  // Clamping estricto: nunca sale de [pad, maxSafeX] ni [pad, maxSafeY]
  posX = Math.max(pad, Math.min(posX, maxSafeX));
  posY = Math.max(pad, Math.min(posY, maxSafeY));

  card.style.left = `${Math.round(posX)}px`;
  card.style.top = `${Math.round(posY)}px`;
  card.style.setProperty('--felic-dx', `${(Math.random() - 0.5) * 40}px`);
  card.style.setProperty('--felic-dy', `${-35 - Math.random() * 30}px`);

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

// ─── MINIJUEGO: PIÑATA COMUNITARIA DE CAPIBARA (CONTROLLER) ───────────────

const pinataWrapper = document.getElementById('pinata-wrapper');
const pinataTargetName = document.getElementById('pinata-target-name');
const pinataHpFill = document.getElementById('pinata-hp-fill');
const pinataHpText = document.getElementById('pinata-hp-text');
const pinataTimer = document.getElementById('pinata-timer');
const pinataBody = document.getElementById('pinata-body-container');
const pinataBat = document.getElementById('pinata-bat');
const pinataImpactStar = document.getElementById('pinata-impact-star');
const pinataHitsFeed = document.getElementById('pinata-hits-feed');
const pinataResultCard = document.getElementById('pinata-result-card');
const pinataTimeoutCard = document.getElementById('pinata-timeout-card');
const pinataImg = document.getElementById('pinata-img');

let pinataTimerInterval = null;
let pinataAudioCtx = null;
let pinataSecondsLeft = 0;
let pinataFrenzyTimeout = null;

function getPinataAudioContext() {
  if (!pinataAudioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) pinataAudioCtx = new AudioCtx();
  }
  if (pinataAudioCtx && pinataAudioCtx.state === 'suspended') {
    pinataAudioCtx.resume().catch(() => {});
  }
  return pinataAudioCtx;
}

// Síntesis de Sonido Web Audio API (Cero dependencias de archivos externos)
function playPinataSound(type) {
  try {
    const ctx = getPinataAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(currentOverlayVolume * 0.9, now);
    masterGain.connect(ctx.destination);

    if (type === 'hit') {
      // Impacto de palo de madera festivo (Oscilador con bajada de tono rápida + pop)
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.12);

      oscGain.gain.setValueAtTime(1, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(oscGain);
      oscGain.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.16);

      // Mini chasquido de crujido
      const clickOsc = ctx.createOscillator();
      const clickGain = ctx.createGain();
      clickOsc.type = 'square';
      clickOsc.frequency.setValueAtTime(800, now);
      clickOsc.frequency.exponentialRampToValueAtTime(80, now + 0.04);
      clickGain.gain.setValueAtTime(0.4, now);
      clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      clickOsc.connect(clickGain);
      clickGain.connect(masterGain);
      clickOsc.start(now);
      clickOsc.stop(now + 0.06);

    } else if (type === 'crit') {
      // Golpe crítico: pegada resonante y doble tono agudo de impacto contundente
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.18);
      oscGain.gain.setValueAtTime(1.15, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(oscGain);
      oscGain.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.22);

      const chime = ctx.createOscillator();
      const chimeGain = ctx.createGain();
      chime.type = 'sine';
      chime.frequency.setValueAtTime(620, now);
      chime.frequency.exponentialRampToValueAtTime(940, now + 0.12);
      chimeGain.gain.setValueAtTime(0.55, now);
      chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      chime.connect(chimeGain);
      chimeGain.connect(masterGain);
      chime.start(now);
      chime.stop(now + 0.18);

    } else if (type === 'mega') {
      // Super Crítico o Bate de Oro del Cumpleañero: golpe sísmico + fanfarria estelar
      const bass = ctx.createOscillator();
      const bassGain = ctx.createGain();
      bass.type = 'triangle';
      bass.frequency.setValueAtTime(220, now);
      bass.frequency.exponentialRampToValueAtTime(32, now + 0.26);
      bassGain.gain.setValueAtTime(1.3, now);
      bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      bass.connect(bassGain);
      bassGain.connect(masterGain);
      bass.start(now);
      bass.stop(now + 0.3);

      [523.25, 783.99, 1046.5].forEach((freq, idx) => {
        const chordOsc = ctx.createOscillator();
        const chordGain = ctx.createGain();
        chordOsc.type = 'triangle';
        chordOsc.frequency.setValueAtTime(freq, now + idx * 0.03);
        chordGain.gain.setValueAtTime(0.35, now + idx * 0.03);
        chordGain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.03 + 0.32);
        chordOsc.connect(chordGain);
        chordGain.connect(masterGain);
        chordOsc.start(now + idx * 0.03);
        chordOsc.stop(now + idx * 0.03 + 0.35);
      });

    } else if (type === 'frenzy') {
      // Sonido de ignición / modo frenesí
      const sweep = ctx.createOscillator();
      const sweepGain = ctx.createGain();
      sweep.type = 'sawtooth';
      sweep.frequency.setValueAtTime(240, now);
      sweep.frequency.exponentialRampToValueAtTime(880, now + 0.32);
      sweepGain.gain.setValueAtTime(0.45, now);
      sweepGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      sweep.connect(sweepGain);
      sweepGain.connect(masterGain);
      sweep.start(now);
      sweep.stop(now + 0.42);

    } else if (type === 'broken') {
      // Fanfarria triunfal de fiesta: C5 - E5 - G5 - C6
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.11);
        g.gain.setValueAtTime(0, now + idx * 0.11);
        g.gain.linearRampToValueAtTime(0.8, now + idx * 0.11 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.11 + 0.45);

        osc.connect(g);
        g.connect(masterGain);
        osc.start(now + idx * 0.11);
        osc.stop(now + idx * 0.11 + 0.5);
      });

    } else if (type === 'timeout') {
      // Silbato cómico deslizante hacia abajo
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.6);
      g.gain.setValueAtTime(0.7, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

      osc.connect(g);
      g.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.7);
    }
  } catch (e) {
    console.warn('[Overlay Audio] Error en síntesis:', e);
  }
}

// Fallback de imagen para la piñata
if (pinataImg) {
  pinataImg.onerror = function() {
    this.onerror = null;
    this.src = 'img/pinata_capi.png';
  };
}

function startPinataUI(data) {
  if (!pinataWrapper) return;

  if (pinataTimerInterval) {
    clearInterval(pinataTimerInterval);
    pinataTimerInterval = null;
  }
  if (pinataFrenzyTimeout) {
    clearTimeout(pinataFrenzyTimeout);
    pinataFrenzyTimeout = null;
  }

  // Ocultar banners y tarjetas de fin de juego anteriores
  const frenzyBanner = document.getElementById('pinata-frenzy-banner');
  if (frenzyBanner) frenzyBanner.style.display = 'none';
  pinataWrapper.classList.remove('frenzy-mode');

  if (pinataTimer) pinataTimer.classList.remove('extra-time-pulse');
  if (pinataResultCard) pinataResultCard.style.display = 'none';
  if (pinataTimeoutCard) pinataTimeoutCard.style.display = 'none';
  if (pinataBody) pinataBody.style.opacity = '1';
  if (pinataHitsFeed) pinataHitsFeed.innerHTML = '';

  const target = data.targetUser || 'la Comunidad';
  if (pinataTargetName) pinataTargetName.textContent = `Cumpleaños de @${target}`;

  // Reset barra HP
  if (pinataHpFill) {
    pinataHpFill.style.width = '100%';
    pinataHpFill.style.background = 'linear-gradient(90deg, #10b981 0%, #fbbf24 60%, #f43f5e 100%)';
  }
  if (pinataHpText) pinataHpText.textContent = `${data.maxHp} / ${data.maxHp} HP`;

  // Timer regresivo
  pinataSecondsLeft = data.durationSec || 35;
  if (pinataTimer) pinataTimer.textContent = `⏳ ${pinataSecondsLeft}s`;

  pinataTimerInterval = setInterval(() => {
    pinataSecondsLeft--;
    if (pinataSecondsLeft < 0) {
      clearInterval(pinataTimerInterval);
      pinataTimerInterval = null;
    } else {
      if (pinataTimer) pinataTimer.textContent = `⏳ ${pinataSecondsLeft}s`;
    }
  }, 1000);

  // Desplegar piñata en pantalla
  pinataWrapper.classList.add('active');

  // Mini disparo de confeti inicial de bienvenida
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 50,
      spread: 80,
      origin: { y: 0.35 },
      colors: ['#fbbf24', '#f43f5e', '#06b6d4', '#10b981']
    });
  }
}

function hitPinataUI(data) {
  const isSuper = data.hitType === 'super_crit' || data.hitType === 'birthday';
  const isCrit = data.hitType === 'crit';
  const soundType = isSuper ? 'mega' : (isCrit ? 'crit' : 'hit');
  playPinataSound(soundType);

  // Actualizar Barra de HP
  const pct = Math.max(0, data.percentage !== undefined ? data.percentage : 100);
  if (pinataHpFill) {
    pinataHpFill.style.width = `${pct}%`;
    if (pct < 30) {
      pinataHpFill.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
    } else if (pct < 60) {
      pinataHpFill.style.background = 'linear-gradient(90deg, #f59e0b, #ea580c)';
    }
  }
  if (pinataHpText) pinataHpText.textContent = `${data.currentHp} / ${data.maxHp} HP`;

  // Animación del palo/bate
  if (pinataBat) {
    pinataBat.classList.remove('is-swinging');
    void pinataBat.offsetWidth;
    pinataBat.classList.add('is-swinging');
  }

  // Animación de estrella de impacto
  if (pinataImpactStar) {
    pinataImpactStar.classList.remove('is-popping');
    void pinataImpactStar.offsetWidth;
    pinataImpactStar.classList.add('is-popping');
  }

  // Sacudida de la piñata (impacto regular vs impacto crítico pesado)
  if (pinataBody) {
    pinataBody.classList.remove('is-hit', 'is-crit-hit');
    void pinataBody.offsetWidth;
    if (isCrit || isSuper) {
      pinataBody.classList.add('is-crit-hit');
    } else {
      pinataBody.classList.add('is-hit');
    }
  }

  // Salto de animación en las capibaras porristas
  document.querySelectorAll('.pinata-cheerleader').forEach(el => {
    el.classList.remove('is-cheering');
    void el.offsetWidth;
    el.classList.add('is-cheering');
  });

  // Chispas de confeti desde el impacto
  if (typeof confetti === 'function') {
    const particleCount = isSuper ? 35 : (isCrit ? 25 : 14);
    const colors = isSuper
      ? ['#ffd700', '#f43f5e', '#ffffff', '#a855f7']
      : (isCrit ? ['#fbbf24', '#f59e0b', '#38bdf8'] : ['#fbbf24', '#f43f5e', '#06b6d4']);
    confetti({
      particleCount,
      spread: isCrit || isSuper ? 60 : 45,
      origin: { x: 0.52 + (Math.random() - 0.5) * 0.05, y: 0.45 + (Math.random() - 0.5) * 0.05 },
      colors,
      scalar: isSuper ? 1.0 : 0.8,
      ticks: 70
    });
  }

  // Número de daño flotante (-1, -2, -3, -4, etc.)
  if (pinataHitsFeed) {
    const dmgPop = document.createElement('div');
    const popType = isSuper ? (data.hitType === 'birthday' ? 'birthday' : 'super_crit') : (isCrit ? 'crit' : '');
    dmgPop.className = `pinata-damage-pop ${popType}`.trim();
    dmgPop.textContent = `-${data.damage || 1}`;

    const rndX = 160 + (Math.random() - 0.5) * 70;
    const rndY = 120 + (Math.random() - 0.5) * 40;
    dmgPop.style.left = `${rndX}px`;
    dmgPop.style.top = `${rndY}px`;

    pinataHitsFeed.appendChild(dmgPop);
    setTimeout(() => dmgPop.remove(), 1100);
  }

  // Badge flotante del bateador con estilo visual según el tipo de golpe
  if (pinataHitsFeed) {
    const badge = document.createElement('div');
    badge.className = `pinata-hit-badge ${isSuper ? 'is-mega' : (isCrit ? 'is-crit' : '')}`.trim();
    const avatarSrc = (data.avatar && data.avatar.startsWith('http')) ? data.avatar : 'img/yocapi.png';
    const badgeText = data.hitText || `+${data.damage || 1} @${data.user || 'Amigo'}`;
    badge.innerHTML = `<img src="${avatarSrc}" onerror="this.src='img/yocapi.png'" alt=""> <span>${badgeText}</span>`;

    const rndX = 130 + Math.random() * 80;
    const rndY = 160 + (Math.random() - 0.5) * 60;
    badge.style.left = `${rndX}px`;
    badge.style.top = `${rndY}px`;

    pinataHitsFeed.appendChild(badge);
    setTimeout(() => badge.remove(), 1400);
  }
}

function frenzyPinataUI(data) {
  playPinataSound('frenzy');
  const banner = document.getElementById('pinata-frenzy-banner');
  if (banner) {
    banner.style.display = 'block';
  }
  if (pinataWrapper) {
    pinataWrapper.classList.add('frenzy-mode');
  }

  if (typeof confetti === 'function') {
    confetti({
      particleCount: 50,
      spread: 90,
      origin: { y: 0.4 },
      colors: ['#ff4500', '#ff8c00', '#ffd700', '#f43f5e']
    });
  }

  if (pinataFrenzyTimeout) clearTimeout(pinataFrenzyTimeout);
  pinataFrenzyTimeout = setTimeout(() => {
    if (banner) banner.style.display = 'none';
    if (pinataWrapper) pinataWrapper.classList.remove('frenzy-mode');
    pinataFrenzyTimeout = null;
  }, data.durationMs || 7000);
}

function extraTimePinataUI(data) {
  const extra = data.extraSec || 10;
  pinataSecondsLeft += extra;
  if (pinataTimer) {
    pinataTimer.textContent = `⏳ ${pinataSecondsLeft}s`;
    pinataTimer.classList.remove('extra-time-pulse');
    void pinataTimer.offsetWidth;
    pinataTimer.classList.add('extra-time-pulse');
    setTimeout(() => {
      if (pinataTimer) pinataTimer.classList.remove('extra-time-pulse');
    }, 2000);
  }

  if (typeof confetti === 'function') {
    confetti({
      particleCount: 30,
      spread: 60,
      origin: { y: 0.3 },
      colors: ['#38ef7d', '#11998e', '#ffffff']
    });
  }
}

function brokenPinataUI(data) {
  if (pinataTimerInterval) {
    clearInterval(pinataTimerInterval);
    pinataTimerInterval = null;
  }
  if (pinataFrenzyTimeout) {
    clearTimeout(pinataFrenzyTimeout);
    pinataFrenzyTimeout = null;
  }
  const frenzyBanner = document.getElementById('pinata-frenzy-banner');
  if (frenzyBanner) frenzyBanner.style.display = 'none';
  if (pinataWrapper) pinataWrapper.classList.remove('frenzy-mode');

  playPinataSound('broken');

  // Ocultar cuerpo de piñata para dar paso a la explosión
  if (pinataBody) pinataBody.style.opacity = '0';
  if (pinataHpFill) pinataHpFill.style.width = '0%';
  if (pinataHpText) pinataHpText.textContent = '0 / ' + (data.totalHits || 30) + ' HP (¡ROTA!)';

  // Mega Explosión de Confeti y Dulces
  if (typeof confetti === 'function') {
    // Ola 1: Disparo central masivo
    confetti({
      particleCount: 150,
      spread: 120,
      origin: { y: 0.45 },
      shapes: ['star', 'circle'],
      colors: ['#fbbf24', '#f43f5e', '#06b6d4', '#10b981', '#ec4899', '#ffffff']
    });

    // Ola 2: Cañones cruzados
    setTimeout(() => {
      confetti({
        particleCount: 80,
        angle: 60,
        spread: 70,
        origin: { x: 0.1, y: 0.5 },
        colors: ['#ffd700', '#ff69b4', '#00ffff']
      });
      confetti({
        particleCount: 80,
        angle: 120,
        spread: 70,
        origin: { x: 0.9, y: 0.5 },
        colors: ['#ffd700', '#ff69b4', '#00ffff']
      });
    }, 250);
  }

  // Mostrar tarjeta de victoria con podio
  if (pinataResultCard) {
    const titleEl = document.getElementById('result-celebration-title');
    const lastEl = document.getElementById('result-last-hitter');
    const topEl = document.getElementById('result-top-hitter');

    if (titleEl) titleEl.textContent = `¡Felicidades @${data.targetUser || 'Comunidad'}! 🎂`;
    if (lastEl) lastEl.textContent = `@${data.lastHitter || 'Alguien'}`;

    if (topEl) {
      if (data.topHitters && data.topHitters.length > 0) {
        const top1 = data.topHitters[0];
        topEl.textContent = `@${top1.displayName} (${top1.count} golpes)`;
      } else {
        topEl.textContent = `@${data.lastHitter || 'El Chat'}`;
      }
    }

    pinataResultCard.style.display = 'block';
  }

  // Mantener en pantalla para el festejo y luego retirar con gracia tras 9.5s
  setTimeout(() => {
    if (pinataWrapper) pinataWrapper.classList.remove('active');
    setTimeout(() => {
      if (pinataResultCard) pinataResultCard.style.display = 'none';
      if (pinataBody) pinataBody.style.opacity = '1';
    }, 900);
  }, 9500);
}

function timeoutPinataUI(data) {
  if (pinataTimerInterval) {
    clearInterval(pinataTimerInterval);
    pinataTimerInterval = null;
  }
  if (pinataFrenzyTimeout) {
    clearTimeout(pinataFrenzyTimeout);
    pinataFrenzyTimeout = null;
  }
  const frenzyBanner = document.getElementById('pinata-frenzy-banner');
  if (frenzyBanner) frenzyBanner.style.display = 'none';
  if (pinataWrapper) pinataWrapper.classList.remove('frenzy-mode');

  playPinataSound('timeout');

  if (pinataTimeoutCard) {
    const hpLeftEl = document.getElementById('timeout-hp-left');
    if (hpLeftEl) {
      hpLeftEl.textContent = `Le quedaron ${data.remainingHp || 0} de vida. ¡Estuvo muy cerca, chat!`;
    }
    pinataTimeoutCard.style.display = 'block';
  }

  setTimeout(() => {
    if (pinataWrapper) pinataWrapper.classList.remove('active');
    setTimeout(() => {
      if (pinataTimeoutCard) pinataTimeoutCard.style.display = 'none';
    }, 900);
  }, 6500);
}

function cancelPinataUI() {
  if (pinataTimerInterval) {
    clearInterval(pinataTimerInterval);
    pinataTimerInterval = null;
  }
  if (pinataFrenzyTimeout) {
    clearTimeout(pinataFrenzyTimeout);
    pinataFrenzyTimeout = null;
  }
  const frenzyBanner = document.getElementById('pinata-frenzy-banner');
  if (frenzyBanner) frenzyBanner.style.display = 'none';
  if (pinataWrapper) pinataWrapper.classList.remove('active', 'frenzy-mode');
  if (pinataResultCard) pinataResultCard.style.display = 'none';
  if (pinataTimeoutCard) pinataTimeoutCard.style.display = 'none';
}

connectSSE();

