/**
 * Yocapi Birthday System — Bot de Twitch Integrado (tmi.js)
 * Conexión nativa a IRC de Twitch, comandos dinámicos y recordatorios automáticos en directo
 */

const tmi = require('tmi.js');

let client = null;
let timerHandle = null;
let status = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'error'
let lastError = null;
let connectedAt = null;
let lastAnnouncementTime = null;

let botConfig = {
    bot_username: '',
    oauth_token: '',
    channel: 'yocapi_pr',
    enabled: false,
    timer_enabled: false, // Desactivado: sin recordatorios periódicos en chat, solo aviso único al prender
    timer_minutes: 60,
    silent_mode: false // Modo pruebas: no manda mensajes al chat de Twitch
};

// ─── ESTADO Y CONFIGURACIÓN DE STREAM / DETECCIÓN DE STREAMELEMENTS ─────────
let streamState = {
    is_live: false,
    last_live_detected: null,
    last_detected_message: null,
    detected_by: null,
    detector_bot: 'streamelements', // Usuario de Twitch que emite el mensaje de directo
    keywords: [
        'ya está en directo',
        'está en directo',
        'ya está en vivo',
        'está en vivo',
        'acaba de prender',
        'is now live',
        'went live'
    ],
    stream_live_only: true, // El recordatorio de cumpleaños solo aparece cuando detecta que yocapi prende
    announce_on_stream_start: true // Al prender, manda el recordatorio de cumpleaños en directo (una sola vez)
};

// Control de sesión para evitar múltiples avisos en el mismo directo
let streamAnnouncedThisSession = false;
let streamWatchdogInterval = null;

// Caché en memoria de comandos personalizados estilo StreamElements
const customCommandsCache = new Map();
const customCmdCooldowns = new Map();

// Registro de los últimos mensajes emitidos por el bot (para visualizarlos en Dashboard en modo pruebas)
const recentBotMessages = [];
function recordBotMessageLog(message) {
    if (!message) return;
    recentBotMessages.push({
        text: message,
        timestamp: new Date().toLocaleTimeString(),
        silent: !!botConfig.silent_mode
    });
    if (recentBotMessages.length > 50) {
        recentBotMessages.shift();
    }
}
function getRecentBotMessages() {
    return [...recentBotMessages];
}

// Protección contra respuestas dobles y spam en chat
const processedMsgIds = new Set();
function isDuplicateMessage(msgId) {
    if (!msgId) return false;
    if (processedMsgIds.has(msgId)) return true;
    processedMsgIds.add(msgId);
    if (processedMsgIds.size > 300) {
        const oldest = processedMsgIds.values().next().value;
        processedMsgIds.delete(oldest);
    }
    return false;
}

const lastUserCmdTime = new Map();
function isCommandRateLimited(user, command) {
    const key = `${(user || '').toLowerCase()}:${command}`;
    const now = Date.now();
    const last = lastUserCmdTime.get(key) || 0;
    if (now - last < 3000) return true; // Cooldown de 3s por usuario y comando para evitar doble envío
    lastUserCmdTime.set(key, now);
    if (lastUserCmdTime.size > 150) {
        const oldestKey = lastUserCmdTime.keys().next().value;
        lastUserCmdTime.delete(oldestKey);
    }
    return false;
}

let dbRef = null;
let getBirthdayStatusRef = null;
let isUserCelebratedThisYearRef = null;
let appUrlRef = 'http://localhost:3001';
let saveSettingsCallback = null;
let broadcastToOverlayRef = null;
let getAppSettingsRef = null;
let acquireMusicLockRef = null;
let getMusicLockStatusRef = null;
let pausedAlertsQueueRef = null;
let pinataManagerRef = null;

function isUserCelebratedThisYear(user, status) {
    if (isUserCelebratedThisYearRef) {
        return isUserCelebratedThisYearRef(user, status);
    }
    if (!user) return false;
    const celebrationYear = status?.celebrationYear || new Date().getFullYear();
    const lastCelebratedYear = parseInt(user.last_celebrated_year, 10) || 0;
    if (lastCelebratedYear >= celebrationYear) return true;

    const yearStr = String(celebrationYear);
    if (user.last_played_date && String(user.last_played_date).startsWith(yearStr)) return true;
    if (user.last_activated && String(user.last_activated).startsWith(yearStr)) return true;
    return false;
}

// Respuestas personalizables para comandos estáticos
let customCmdResponses = {
    regcumple: null,
    felicitar: null
};

function updateCmdResponse(cmd, text) {
    if (cmd in customCmdResponses) {
        customCmdResponses[cmd] = text || null;
    }
}

const MONTH_NAMES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const SPANISH_MONTHS = {
    enero: 1, en: 1, ene: 1,
    febrero: 2, feb: 2,
    marzo: 3, mar: 3,
    abril: 4, abr: 4,
    mayo: 5, may: 5,
    junio: 6, jun: 6,
    julio: 7, jul: 7,
    agosto: 8, ago: 8,
    septiembre: 9, setiembre: 9, sep: 9, set: 9,
    octubre: 10, oct: 10,
    noviembre: 11, nov: 11,
    diciembre: 12, dic: 12
};

function parseSmartDate(str) {
    if (!str) return null;
    const clean = str.trim().toLowerCase();

    // 1. Formato numérico DD-MM, DD/MM, DD.MM
    const numMatch = clean.match(/^(\d{1,2})[-\/.](\d{1,2})$/);
    if (numMatch) {
        return { day: parseInt(numMatch[1], 10), month: parseInt(numMatch[2], 10) };
    }

    // 2. Formato "15 de mayo" o "15 mayo"
    const textMatch = clean.match(/^(\d{1,2})(?:\s+de)?\s+([a-záéíóúñ]+)$/i);
    if (textMatch) {
        const d = parseInt(textMatch[1], 10);
        const mKey = textMatch[2].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const m = SPANISH_MONTHS[mKey];
        if (m) return { day: d, month: m };
    }

    // 3. Formato inverso "mayo 15"
    const revMatch = clean.match(/^([a-záéíóúñ]+)\s+(\d{1,2})$/i);
    if (revMatch) {
        const mKey = revMatch[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const m = SPANISH_MONTHS[mKey];
        const d = parseInt(revMatch[2], 10);
        if (m) return { day: d, month: m };
    }

    return null;
}

function formatChannelName(ch) {
    if (!ch) return '#yocapi_pr';
    const clean = ch.toLowerCase().trim();
    return clean.startsWith('#') ? clean : `#${clean}`;
}

function formatOauthToken(token) {
    if (!token) return '';
    const clean = token.trim();
    return clean.startsWith('oauth:') ? clean : `oauth:${clean}`;
}

// ─── VERIFICADOR DE PERMISOS: STREAMER (@yocapi_pr), CREADOR O MODERADOR DE TWITCH ──────
function isStreamer(tags, channel) {
    if (!tags) return false;
    const username = (tags.username || '').toLowerCase().trim();
    const cleanChannel = (channel || botConfig.channel || 'yocapi_pr').replace(/^#/, '').toLowerCase().trim();
    if (username === 'capiluisxavihdx' || username === 'capiluisxavi') return true;
    if (username === cleanChannel || username === 'yocapi_pr') return true;
    if (tags.badges) {
        if (tags.badges.broadcaster) return true;
        if (typeof tags.badges === 'string' && tags.badges.includes('broadcaster')) return true;
    }
    if (tags['badges-raw'] && typeof tags['badges-raw'] === 'string' && tags['badges-raw'].includes('broadcaster')) {
        return true;
    }
    return false;
}

function isMod(tags, channel) {
    if (isStreamer(tags, channel)) return true;
    if (!tags) return false;
    if (tags.mod === true || tags.mod === '1' || tags.mod === 1) return true;
    if (tags.badges) {
        if (tags.badges.moderator) return true;
        if (typeof tags.badges === 'string' && tags.badges.includes('moderator')) return true;
    }
    if (tags['badges-raw'] && typeof tags['badges-raw'] === 'string' && tags['badges-raw'].includes('moderator')) {
        return true;
    }
    return false;
}

function isStreamerOrMod(tags, channel) {
    return isMod(tags, channel);
}

function checkUserPermission(requiredLevel, tags, channel) {
    if (!requiredLevel || requiredLevel === 'everyone') return true;
    if (requiredLevel === 'moderator') return isMod(tags, channel);
    if (requiredLevel === 'streamer') return isStreamer(tags, channel);
    return true;
}

function parseCommandResponse(template, context) {
    if (!template) return '';
    let res = String(template);
    const user = context.user || 'amigo';
    const touser = context.touser ? String(context.touser).replace(/^@/, '') : user;
    const channel = context.channel || botConfig.channel || 'yocapi_pr';
    const count = context.count || 1;
    const query = context.query || '';

    res = res.replace(/\{user\}|\$\{user\}/gi, `@${user}`);
    res = res.replace(/\{touser\}|\$\{touser\}|\$\{1\}|\{1\}/gi, `@${touser}`);
    res = res.replace(/\{channel\}|\$\{channel\}/gi, channel);
    res = res.replace(/\{count\}|\$\{count\}/gi, String(count));
    res = res.replace(/\{query\}|\$\{query\}/gi, query);

    // Variable aleatoria: {random} o {random X-Y}
    res = res.replace(/\{random\s*(\d+)?(?:-(\d+))?\}|\$\{random\s*(\d+)?(?:-(\d+))?\}/gi, (_, min, max) => {
        const minimum = parseInt(min, 10) || 1;
        const maximum = parseInt(max, 10) || 100;
        return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
    });

    return res;
}

// ─── CONTROL Y DETECCIÓN DE STREAM ONLINE (STREAMELEMENTS) ───────────────────
// Patrones de exclusión: Timers rutinarios, enlaces y comandos de puntos de StreamElements que NO son aviso de directo
const SE_NON_LIVE_PATTERNS = [
    /https?:\/\//i,
    /www\./i,
    /linktr\.ee/i,
    /discord/i,
    /github\.io/i,
    /twitch\.tv/i,
    /tiktok\.com/i,
    /twitter\.com|x\.com/i,
    /instagram\.com/i,
    /puntos|points/i,
    /leaderboard/i,
    /ruleta|gamble|slots/i,
    /registra tu cumple/i,
    /redes sociales/i,
    /tienda|merch/i,
    /uptime|tiempo/i,
    /canción|song/i
];

// Consulta en tiempo real a la API de Twitch (DecAPI Uptime) para confirmar si el canal está verdaderamente ONLINE
async function verifyChannelLiveOnTwitch(channelName = 'yocapi_pr') {
    try {
        const cleanChan = (channelName || botConfig.channel || 'yocapi_pr').toLowerCase().replace(/^#/, '');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4500);

        const res = await fetch(`https://decapi.me/twitch/uptime/${cleanChan}`, {
            signal: controller.signal,
            headers: { 'User-Agent': 'YocapiLiveDetector/2.0' }
        });
        clearTimeout(timeout);

        if (!res.ok) return null;
        const text = (await res.text()).trim().toLowerCase();

        // DecAPI responde "{channel} is offline" cuando el directo no está activo
        if (text.includes('offline') || text.includes('not found') || text.includes('user not found')) {
            return false;
        }

        // Si responde un tiempo de uptime (ej: "25 minutes, 10 seconds"), está 100% ONLINE
        return true;
    } catch (_) {
        return null;
    }
}

// Dispara el aviso festivo de bienvenida al directo UNA SOLA VEZ por stream
async function triggerStreamStartAnnouncement() {
    if (streamAnnouncedThisSession) {
        console.log('[TwitchBot] Aviso festivo de inicio de stream ya fue enviado en esta sesión. Omitiendo.');
        return;
    }
    streamAnnouncedThisSession = true;

    if (!streamState.announce_on_stream_start) return;

    setTimeout(async () => {
        if (!streamState.is_live || status !== 'connected') return;
        try {
            const msg = await buildAnnouncementMessage();
            if (msg) {
                await sendChat(`🎂 ¡Yocapi prendió stream! ${msg}`);
                console.log('[TwitchBot] ✅ Recordatorio único de directo emitido exitosamente.');
            }
        } catch (err) {
            console.warn('[TwitchBot] Error enviando recordatorio post-StreamElements:', err.message);
        }
    }, 12000); // 12 segundos de cortesía tras iniciar directo
}

// Watchdog silencioso que revisa cada 3 minutos si Yocapi apagó o prendió stream
function startStreamWatchdog() {
    if (streamWatchdogInterval) clearInterval(streamWatchdogInterval);
    streamWatchdogInterval = setInterval(async () => {
        try {
            const chan = botConfig.channel || 'yocapi_pr';
            const isLive = await verifyChannelLiveOnTwitch(chan);

            if (isLive === false) {
                // Si el sistema lo tenía marcado en vivo y Twitch confirma que apagó:
                if (streamState.is_live) {
                    console.log(`[StreamWatchdog] ⚪ Yocapi apagó stream (confirmado offline por Twitch). Transición a OFFLINE.`);
                    setStreamLive(false, 'Stream apagado confirmado por Twitch API', 'watchdog');
                    streamAnnouncedThisSession = false; // Listo para la próxima sesión
                }
            } else if (isLive === true) {
                // Si Twitch confirma que prendió y el bot no lo tenía registrado
                if (!streamState.is_live) {
                    console.log(`[StreamWatchdog] 🔴 Yocapi prendió stream (detectado por Watchdog). Transición a EN VIVO.`);
                    setStreamLive(true, 'Directo detectado por Twitch API', 'watchdog');
                    triggerStreamStartAnnouncement();
                }
            }
        } catch (_) {}
    }, 3 * 60 * 1000);
}

function getStreamStatus() {
    return {
        is_live: !!streamState.is_live,
        last_live_detected: streamState.last_live_detected,
        last_detected_message: streamState.last_detected_message,
        detected_by: streamState.detected_by,
        detector_bot: streamState.detector_bot || 'streamelements',
        keywords: streamState.keywords || [
            'ya está en directo',
            'está en directo',
            'ya está en vivo',
            'está en vivo',
            'acaba de prender',
            'is now live',
            'went live'
        ],
        stream_live_only: streamState.stream_live_only !== false,
        announce_on_stream_start: streamState.announce_on_stream_start !== false,
        announced_this_session: streamAnnouncedThisSession
    };
}

function setStreamLive(isLive, messageOrReason = '', triggeredBy = 'sistema') {
    streamState.is_live = !!isLive;
    if (isLive) {
        streamState.last_live_detected = new Date().toISOString();
        if (messageOrReason) streamState.last_detected_message = messageOrReason;
        streamState.detected_by = triggeredBy;
    } else {
        streamAnnouncedThisSession = false; // Resetear bandera al apagar directo
    }
    console.log(`[TwitchBot] Estado de stream: ${streamState.is_live ? '🔴 EN VIVO' : '⚪ OFFLINE'} (Por: ${triggeredBy})`);

    if (broadcastToOverlayRef) {
        broadcastToOverlayRef({
            type: 'stream_status',
            stream_state: getStreamStatus()
        });
    }

    if (saveSettingsCallback) {
        saveSettingsCallback({ stream_state: getStreamStatus() });
    }
    return getStreamStatus();
}

function updateStreamConfig(newConf) {
    if (!newConf || typeof newConf !== 'object') return getStreamStatus();
    if (typeof newConf.stream_live_only === 'boolean') streamState.stream_live_only = newConf.stream_live_only;
    if (typeof newConf.announce_on_stream_start === 'boolean') streamState.announce_on_stream_start = newConf.announce_on_stream_start;
    if (typeof newConf.detector_bot === 'string' && newConf.detector_bot.trim()) {
        streamState.detector_bot = newConf.detector_bot.trim().replace(/^@/, '').toLowerCase();
    }
    if (Array.isArray(newConf.keywords)) {
        streamState.keywords = newConf.keywords.map(k => String(k).trim()).filter(Boolean);
    }
    if (typeof newConf.is_live === 'boolean') {
        setStreamLive(newConf.is_live, 'Ajustado manualmente desde configuración', 'dashboard');
    }
    return getStreamStatus();
}

async function checkStreamElementsLiveDetection(tags, text, channel) {
    if (!text) return;
    const senderLogin = (tags?.username || '').toLowerCase().trim();
    const detector = (streamState.detector_bot || 'streamelements').toLowerCase().trim();

    // Solo escuchar mensajes de StreamElements
    if (senderLogin !== detector && senderLogin !== 'streamelements') {
        return;
    }

    const lowerText = text.toLowerCase();

    // 1. Descartar de inmediato si contiene enlaces, timers de puntos, redes, discord, etc.
    if (SE_NON_LIVE_PATTERNS.some(pat => pat.test(lowerText))) {
        return;
    }

    // 2. Verificar que contenga frase explícita de transmisión iniciada
    const keywords = Array.isArray(streamState.keywords) && streamState.keywords.length > 0
        ? streamState.keywords
        : ['ya está en directo', 'está en directo', 'ya está en vivo', 'está en vivo', 'acaba de prender', 'is now live', 'went live'];

    const hasLivePhrase = keywords.some(kw => lowerText.includes(kw.toLowerCase()));
    if (!hasLivePhrase) {
        return;
    }

    console.log(`[TwitchBot] 🔍 StreamElements mencionó inicio de directo: "${text}". Verificando con Twitch API...`);

    // 3. Confirmar que el canal está realmente en vivo en Twitch antes de anunciar
    const isLiveOnTwitch = await verifyChannelLiveOnTwitch(channel || botConfig.channel || 'yocapi_pr');
    if (isLiveOnTwitch === false) {
        console.log(`[TwitchBot] 🛑 Falso positivo bloqueado: StreamElements envió un mensaje pero Twitch confirma que el canal está OFFLINE.`);
        return;
    }

    if (streamAnnouncedThisSession) {
        console.log(`[TwitchBot] Stream ya marcado activo para esta sesión. No duplicar aviso.`);
        return;
    }

    console.log(`[TwitchBot] 🔴 DETECCIÓN DE STREAM CONFIRMADA: StreamElements anunció directo y Twitch está LIVE.`);
    setStreamLive(true, text, tags['display-name'] || tags.username);
    triggerStreamStartAnnouncement();
}

async function simulateStreamOnline(msgText = '¡@yocapi_pr ya está en directo jugando Just Chatting! 🎉', sender = 'StreamElements') {
    const channel = formatChannelName(botConfig.channel);
    setStreamLive(true, msgText, sender);
    streamAnnouncedThisSession = false; // Permitir que la simulación emita el recordatorio de prueba
    triggerStreamStartAnnouncement();
    return {
        success: true,
        is_live: streamState.is_live,
        detected_message: msgText,
        detected_by: sender,
        stream_state: getStreamStatus()
    };
}

// ─── GESTIÓN DE CACHÉ DE COMANDOS PERSONALIZADOS ────────────────────────────
async function loadCustomCommandsCache() {
    if (!dbRef || !dbRef.getAllCustomCommands) return;
    try {
        const list = await dbRef.getAllCustomCommands();
        customCommandsCache.clear();
        for (const cmd of list) {
            customCommandsCache.set(cmd.name.toLowerCase(), cmd);
        }
        console.log(`[TwitchBot] ✅ ${customCommandsCache.size} comandos personalizados cargados en caché de memoria.`);
    } catch (e) {
        console.error('[TwitchBot] Error cargando custom_commands en caché:', e.message);
    }
}

function findCustomCommand(name) {
    if (!name) return null;
    const clean = name.toLowerCase().trim();
    if (customCommandsCache.has(clean)) return customCommandsCache.get(clean);

    for (const cmd of customCommandsCache.values()) {
        if (!cmd.aliases) continue;
        const aliases = cmd.aliases.split(',').map(a => a.trim().toLowerCase());
        if (aliases.includes(clean) || aliases.includes(clean.replace(/^!/, '')) || aliases.includes('!' + clean)) {
            return cmd;
        }
    }
    return null;
}

function getCustomCommandsList() {
    return Array.from(customCommandsCache.values());
}

async function saveCustomCommandCached(cmdData) {
    if (!dbRef || !dbRef.saveCustomCommand) return false;
    const saved = await dbRef.saveCustomCommand(cmdData);
    if (saved) {
        customCommandsCache.set(saved.name.toLowerCase(), saved);
    }
    return saved;
}

async function deleteCustomCommandCached(rawName) {
    if (!dbRef || !dbRef.deleteCustomCommand) return false;
    let clean = rawName.trim().toLowerCase();
    if (!clean.startsWith('!')) clean = '!' + clean;
    const ok = await dbRef.deleteCustomCommand(clean);
    if (ok) {
        customCommandsCache.delete(clean);
    }
    return ok;
}

async function sendChat(message) {
    const ch = formatChannelName(botConfig.channel);
    recordBotMessageLog(message);

    // MODO PRUEBAS / SILENCIOSO: no enviar a IRC de Twitch para evitar spam a la streamer
    if (botConfig.silent_mode) {
        console.log(`[TwitchBot - MODO PRUEBAS / SILENCIOSO] 🤫 (Mensaje no enviado a ${ch}): ${message}`);
        if (broadcastToOverlayRef) {
            broadcastToOverlayRef({
                type: 'bot_chat_silent_log',
                channel: ch,
                message: message,
                timestamp: Date.now()
            });
        }
        return true;
    }

    if (!client || status !== 'connected') {
        throw new Error('El bot de Twitch no está conectado al chat');
    }
    await client.say(ch, message);
    return true;
}

// ─── LÓGICA DE RECORDATORIO AUTOMÁTICO (TIMERS) ──────────────────────────────
async function buildAnnouncementMessage() {
    if (!dbRef || !getBirthdayStatusRef) return null;
    try {
        const users = await dbRef.getAllUsers();
        const todayBirthdays = [];
        const graceBirthdays = [];
        const upcomingVerySoon = []; // 1 a 3 días

        for (const u of users) {
            if (!u.birth_month || !u.birth_day || u.birthday_unlocked) continue;
            const bStatus = getBirthdayStatusRef(u.birth_month, u.birth_day);
            const name = u.display_name || u.username;

            if (bStatus.canCelebrate) {
                const alreadyCelebrated = isUserCelebratedThisYear(u, bStatus);

                if (bStatus.isToday) {
                    todayBirthdays.push({ name, alreadyCelebrated });
                } else if (!alreadyCelebrated) {
                    graceBirthdays.push({ name, daysLeft: bStatus.daysRemainingInGrace });
                }
            } else if (bStatus.daysUntilBirthday > 0 && bStatus.daysUntilBirthday <= 3) {
                upcomingVerySoon.push({
                    name,
                    day: u.birth_day,
                    month: MONTH_NAMES[u.birth_month] || u.birth_month,
                    days: bStatus.daysUntilBirthday
                });
            }
        }

        // 1. Prioridad: Cumpleaños de HOY
        const todayPending = todayBirthdays.filter(b => !b.alreadyCelebrated);
        const todayCelebrated = todayBirthdays.filter(b => b.alreadyCelebrated);

        if (todayPending.length > 0) {
            const list = todayPending.map(b => `@${b.name}`).join(', ');
            return `🎂 Cumple hoy: ${list} | !cumplehoy 🎉`;
        }

        if (todayCelebrated.length > 0) {
            const list = todayCelebrated.map(b => `@${b.name}`).join(', ');
            return `🎂 ¡Feliz cumple a ${list}! 💖`;
        }

        // 2. Prioridad: Cumpleaños en Período de Gracia (que aún no han lanzado)
        if (graceBirthdays.length > 0) {
            const list = graceBirthdays.map(b => `@${b.name}`).join(', ');
            return `🎈 Festejo activo: ${list} | !cumplehoy 🎂`;
        }

        // 3. Prioridad: Cumpleaños muy cercanos (1 a 3 días)
        if (upcomingVerySoon.length > 0) {
            upcomingVerySoon.sort((a, b) => a.days - b.days);
            const list = upcomingVerySoon.map(u => {
                const when = u.days === 1 ? 'mañana' : `${u.days}d`;
                return `@${u.name} (${when})`;
            }).join(', ');
            return `⏳ Próximos: ${list} 🎂`;
        }

        // 4. Mensajes rotativos de invitación a la comunidad (cortos y directos)
        const communityInvites = [
            `🎂 Anota tu cumple con !reg DD-MM ✨`,
            `📜 Comandos de cumple: !cumplecmds 🪅`
        ];
        return communityInvites[Math.floor(Math.random() * communityInvites.length)];
    } catch (e) {
        console.error('[TwitchBot] Error construyendo recordatorio:', e);
        return null;
    }
}

async function runTimerTick() {
    if (!botConfig.timer_enabled || status !== 'connected') return;

    // Solo enviar el recordatorio de cumpleaños cuando Yocapi está en vivo ("prende")
    if (streamState.stream_live_only && !streamState.is_live) {
        console.log('[TwitchBot Timer] ⏸️ Recordatorio en espera: Yocapi no está en vivo (esperando detección de StreamElements).');
        return;
    }

    const msg = await buildAnnouncementMessage();
    if (msg) {
        try {
            await sendChat(msg);
            lastAnnouncementTime = new Date().toISOString();
            console.log('[TwitchBot] Anuncio enviado automáticamente al chat');
        } catch (e) {
            console.error('[TwitchBot] Error enviando anuncio en timer:', e.message);
        }
    }
}

function startTimer() {
    stopTimer();
    if (!botConfig.timer_enabled) return;
    const minutes = Math.max(5, parseInt(botConfig.timer_minutes, 10) || 60);
    const ms = minutes * 60 * 1000;
    timerHandle = setInterval(runTimerTick, ms);
    console.log(`[TwitchBot] Timer de recordatorios programado cada ${minutes} minutos.`);
}

function stopTimer() {
    if (timerHandle) {
        clearInterval(timerHandle);
        timerHandle = null;
    }
}

// ─── MANEJADOR DE COMANDOS DE CHAT EN VIVO ──────────────────────────────────
async function handleChatMessage(channel, tags, message, self) {
    if (self) return; // Ignorar mensajes del propio bot
    const text = (message || '').trim();

    // ─── EASTER EGG: "bang" exclusivo de capiluisxavihdx ─────────────────────────
    // Solo para el usuario capiluisxavihdx (o capiluisxavi), sin respuesta en chat y sin visual en overlay.
    const senderLogin = (tags.username || '').toLowerCase();
    if (text.toLowerCase() === 'bang' && (senderLogin === 'capiluisxavihdx' || senderLogin === 'capiluisxavi')) {
        if (broadcastToOverlayRef) {
            broadcastToOverlayRef({ type: 'play_audio', sound: 'bang.mp3' });
        }
        return; // Silencio total: no responde en chat
    }

    // ─── DETECCIÓN PASIVA DE CAMBIO DE NOMBRE DE TWITCH ───────────────────────
    // Twitch envía `user-id` en cada mensaje — es permanente aunque el nombre cambie.
    // Si el user-id está en la BD con otro username, renombramos o fusionamos automáticamente en segundo plano.
    if (dbRef && tags['user-id'] && senderLogin) {
        (async () => {
            try {
                const twitchId = String(tags['user-id']).trim();
                const registeredByLogin = await dbRef.getUser(senderLogin);

                if (dbRef.getUserByTwitchId) {
                    const oldRecord = await dbRef.getUserByTwitchId(twitchId);
                    if (oldRecord && oldRecord.username !== senderLogin) {
                        if (registeredByLogin) {
                            // Ambos registros existen en la BD (duplicado tras cambio de nick).
                            console.log(`[TwitchBot] 🔄 Fusión de duplicados detectada: @${oldRecord.username} y @${senderLogin}. Eliminando obsoleto...`);
                            if (!registeredByLogin.custom_message && oldRecord.custom_message) {
                                registeredByLogin.custom_message = oldRecord.custom_message;
                            }
                            if (oldRecord.selected_sound && registeredByLogin.selected_sound === 'HBSilbato.mp3') {
                                registeredByLogin.selected_sound = oldRecord.selected_sound;
                            }
                            registeredByLogin.twitch_id = twitchId;
                            await dbRef.saveUser(registeredByLogin);
                            await dbRef.deleteUser(oldRecord.username);
                            console.log(`[TwitchBot] ✅ Fusión completada: @${oldRecord.username} absorbido en @${senderLogin}`);
                        } else {
                            // Solo existía el nombre anterior, migrar completamente
                            console.log(`[TwitchBot] 🔄 Cambio de nombre detectado: @${oldRecord.username} → @${senderLogin}. Migrando...`);
                            await dbRef.migrateUser(oldRecord.username, senderLogin, {
                                display_name: tags['display-name'] || senderLogin,
                                twitch_id: twitchId
                            });
                            console.log(`[TwitchBot] ✅ Migración completada: @${oldRecord.username} → @${senderLogin}`);
                        }
                        return;
                    }
                }

                if (registeredByLogin) {
                    // El usuario existe y no hay colisión; asegurar su twitch_id guardado
                    if (!registeredByLogin.twitch_id || registeredByLogin.twitch_id !== twitchId) {
                        registeredByLogin.twitch_id = twitchId;
                        await dbRef.saveUser(registeredByLogin);
                        console.log(`[TwitchBot] ✅ twitch_id guardado para @${senderLogin} → ${twitchId}`);
                    }
                }
            } catch (e) {
                // Nunca interrumpir el flujo principal por un error de sincronización de nombre
                console.warn('[TwitchBot] Error en detección de cambio de nombre:', e.message);
            }
        })();
    }

    // ─── DETECCIÓN DE STREAM ONLINE ("YOCAPI PRENDE") POR STREAMELEMENTS ──────
    checkStreamElementsLiveDetection(tags, text, channel);

    if (!text.startsWith('!')) return;

    // 1. DEDUPLICACIÓN DE MENSAJES (Evita que el mismo mensaje se procese dos veces)
    if (tags && tags.id && isDuplicateMessage(tags.id)) {
        return;
    }

    const parts = text.split(/\s+/);
    const command = parts[0].toLowerCase();
    const arg = (parts[1] || '').trim().replace(/^@/, '');
    const sender = tags['display-name'] || tags.username || 'amigo';

    // ─── CONTROL Y ESTADO DE STREAM EN VIVO (!stream / !live) ─────────────────
    if (command === '!stream' || command === '!live') {
        const sub = (parts[1] || '').toLowerCase();
        if (sub === 'on' || sub === 'prende' || sub === 'start' || sub === 'vivo') {
            if (!isStreamerOrMod(tags, channel)) {
                return sendChat(`⛔ @${sender}, comando exclusivo de mods 🛡️`);
            }
            setStreamLive(true, `Activado manualmente en chat por @${sender}`, sender);
            return sendChat(`🔴 [Modo En Vivo] ¡Directo activado! Los recordatorios de cumpleaños están ahora activos ✨`);
        }
        if (sub === 'off' || sub === 'apaga' || sub === 'stop' || sub === 'offline') {
            if (!isStreamerOrMod(tags, channel)) {
                return sendChat(`⛔ @${sender}, comando exclusivo de mods 🛡️`);
            }
            setStreamLive(false, `Desactivado manualmente en chat por @${sender}`, sender);
            return sendChat(`⚪ [Modo En Vivo] Directo desactivado. Recordatorios de cumpleaños en pausa 💤`);
        }
        const st = streamState.is_live ? '🔴 EN VIVO' : '⚪ OFFLINE';
        return sendChat(`📺 Estado de stream: ${st} | Detector: @${streamState.detector_bot} | Recordatorios solo en directo: ${streamState.stream_live_only ? 'SÍ' : 'NO'}`);
    }

    // ─── GESTIÓN DE COMANDOS DESDE EL CHAT ESTILO STREAMELEMENTS (!cmd / !addcmd) ─
    if (command === '!cmd' || command === '!command' || command === '!addcmd' || command === '!editcmd' || command === '!delcmd') {
        if (!isStreamerOrMod(tags, channel)) {
            return sendChat(`⛔ @${sender}, la gestión de comandos es exclusiva de mods y streamer 🛡️`);
        }
        
        let action = (parts[1] || '').toLowerCase();
        let cmdName = parts[2] || '';
        let restIndex = 3;

        if (command === '!addcmd') {
            action = 'add';
            cmdName = parts[1] || '';
            restIndex = 2;
        } else if (command === '!editcmd') {
            action = 'edit';
            cmdName = parts[1] || '';
            restIndex = 2;
        } else if (command === '!delcmd') {
            action = 'del';
            cmdName = parts[1] || '';
            restIndex = 2;
        }

        if (action === 'add' || action === 'crear' || action === 'nuevo') {
            if (!cmdName) return sendChat(`⚠️ Uso: !cmd add !nombre [everyone|mod|streamer] <respuesta>`);
            if (!cmdName.startsWith('!')) cmdName = '!' + cmdName;

            let userLevel = 'everyone';
            let responseText = parts.slice(restIndex).join(' ').trim();
            const possibleLevel = (parts[restIndex] || '').toLowerCase();
            if (['everyone', 'mod', 'moderator', 'streamer'].includes(possibleLevel)) {
                userLevel = possibleLevel === 'mod' ? 'moderator' : possibleLevel;
                responseText = parts.slice(restIndex + 1).join(' ').trim();
            }

            if (!responseText) return sendChat(`⚠️ @${sender}, debes escribir la respuesta del comando.`);
            await saveCustomCommandCached({
                name: cmdName,
                response: responseText,
                user_level: userLevel,
                cooldown: 5,
                enabled: true
            });
            return sendChat(`✅ Comando ${cmdName} creado con éxito [Nivel: ${userLevel}].`);
        }

        if (action === 'edit' || action === 'editar') {
            if (!cmdName) return sendChat(`⚠️ Uso: !cmd edit !nombre <nueva_respuesta>`);
            if (!cmdName.startsWith('!')) cmdName = '!' + cmdName;
            const existing = findCustomCommand(cmdName);
            if (!existing) return sendChat(`⚠️ @${sender}, el comando ${cmdName} no existe.`);

            const responseText = parts.slice(restIndex).join(' ').trim();
            if (!responseText) return sendChat(`⚠️ @${sender}, ingresa la nueva respuesta.`);
            existing.response = responseText;
            await saveCustomCommandCached(existing);
            return sendChat(`✏️ Comando ${cmdName} actualizado correctamente.`);
        }

        if (action === 'del' || action === 'delete' || action === 'borrar' || action === 'eliminar') {
            if (!cmdName) return sendChat(`⚠️ Uso: !cmd del !nombre`);
            if (!cmdName.startsWith('!')) cmdName = '!' + cmdName;
            const ok = await deleteCustomCommandCached(cmdName);
            return ok ? sendChat(`🗑️ Comando ${cmdName} eliminado.`) : sendChat(`⚠️ El comando ${cmdName} no existía.`);
        }

        if (action === 'perm' || action === 'permiso' || action === 'nivel') {
            if (!cmdName) return sendChat(`⚠️ Uso: !cmd perm !nombre <everyone|mod|streamer>`);
            if (!cmdName.startsWith('!')) cmdName = '!' + cmdName;
            const newLvl = (parts[3] || '').toLowerCase();
            const normalizedLvl = newLvl === 'mod' ? 'moderator' : newLvl;
            if (!['everyone', 'moderator', 'streamer'].includes(normalizedLvl)) {
                return sendChat(`⚠️ Nivel inválido. Opciones: everyone, mod, streamer`);
            }
            const existing = findCustomCommand(cmdName);
            if (!existing) return sendChat(`⚠️ El comando ${cmdName} no existe.`);
            existing.user_level = normalizedLvl;
            await saveCustomCommandCached(existing);
            return sendChat(`🛡️ Permiso de ${cmdName} actualizado a: ${normalizedLvl}`);
        }

        if (action === 'list' || action === 'lista') {
            const list = getCustomCommandsList();
            if (list.length === 0) return sendChat(`📜 No hay comandos personalizados activos aún.`);
            const names = list.map(c => `${c.name} (${c.user_level})`).join(', ');
            return sendChat(`📜 Comandos configurados: ${names}`);
        }

        return sendChat(`ℹ️ Opciones de !cmd: add, edit, del, perm, list | Ej: !cmd add !redes Sígueme en...`);
    }

const BUILT_IN_COMMAND_NAMES = [
    '!cumplehoy', '!alerta', '!fiesta', '!festejo', '!hoyesmicumple', '!hoyesmicum', '!mialerta', '!lanzarmicumple', '!micumplealerta', '!lanzarcumple', '!cumplealerta',
    '!reg', '!registro', '!regcumple', '!registrarme', '!registrar', '!anotarme', '!cumpleregistro',
    '!cumple', '!micumple', '!cumpleaños', '!cumpleanos', '!mifecha', '!fechacumple', '!cuandocumplo',
    '!prox', '!proximos', '!siguientes', '!cumples',
    '!mes', '!cumplemes', '!cumplesmes', '!mescumple',
    '!frase', '!hbcambio', '!hbfrase', '!micumplefrase', '!cambiarfrase', '!mifrase',
    '!sonido', '!audio', '!hbsonido', '!misonido',
    '!piñata', '!pinata', '!pata', '!pstop', '!piñatastop', '!pinatastop', '!piñatita', '!pinatita',
    '!dale', '!pegar', '!hit', '!palo', '!golpe', '!batear', '!darle', '!pega', '!romper', '!golpear',
    '!feliz', '!hb', '!felicidades', '!felicidades1', '!felicidades2', '!felicidades3', '!felicitar', '!felicitar1', '!felicitar2', '!felicitar3', '!felicitaciones', '!felicitacion', '!festejar',
    '!cumplecmds', '!ccmds', '!cumpleayuda', '!cumpleguia', '!cumpleinfo', '!cumplecomandos', '!bday',
    '!hbmod', '!cumplemod', '!hbadmin', '!hbestado',
    '!listo', '!hecho', '!yacelebro', '!hbyacelebro', '!hbcelebrado', '!hblisto',
    '!relanzar', '!reinicio', '!hbrelanzar', '!hbreiniciar',
    '!libre', '!abrir', '!hblibre', '!hbdesbloquear', '!desbloquear', '!desbloquearfecha',
    '!alertas', '!hbalertas', '!cumplealertas',
    '!rec', '!grabar', '!hbgrabacion', '!hbmodovideo',
    '!silencio', '!hbpruebas', '!hbsilencio', '!hbsilent', '!hbmodoprueba',
    '!stream', '!live'
];

    // ─── EJECUCIÓN DE COMANDOS PERSONALIZADOS ESTILO STREAMELEMENTS ──────────
    const customCmd = findCustomCommand(command);
    if (customCmd) {
        // 1. Verificación de si está habilitado en el gestor
        if (customCmd.enabled === false) {
            return sendChat(`⛔ @${sender}, el comando ${customCmd.name} está temporalmente desactivado por la streamer.`);
        }

        // 2. Verificación de permisos según user_level configurado en el gestor
        if (!checkUserPermission(customCmd.user_level, tags, channel)) {
            if (customCmd.user_level === 'streamer') {
                return sendChat(`⛔ @${sender}, el comando ${customCmd.name} está configurado como exclusivo de la streamer @yocapi_pr 👑`);
            }
            if (customCmd.user_level === 'moderator') {
                return sendChat(`⛔ @${sender}, el comando ${customCmd.name} está configurado como exclusivo de moderadores 🛡️`);
            }
            return;
        }

        // 3. Cooldown anti-spam configurado en el gestor
        const now = Date.now();
        const lastRun = customCmdCooldowns.get(customCmd.name.toLowerCase()) || 0;
        const cdMs = (customCmd.cooldown || 5) * 1000;
        if (now - lastRun < cdMs) {
            return; // En cooldown silencioso (estilo StreamElements)
        }
        customCmdCooldowns.set(customCmd.name.toLowerCase(), now);

        // 4. Conteo de ejecuciones
        customCmd.execution_count = (customCmd.execution_count || 0) + 1;
        if (dbRef && dbRef.incrementCommandCount) {
            dbRef.incrementCommandCount(customCmd.name);
        }

        // 5. Si es un comando puramente de texto libre (no un comando con lógica interna de piñata/alerta/sistema)
        const isSystemCommand = BUILT_IN_COMMAND_NAMES.includes(command);
        if (!isSystemCommand) {
            const fullQuery = parts.slice(1).join(' ').trim();
            const parsedResponse = parseCommandResponse(customCmd.response, {
                user: sender,
                touser: arg,
                channel: botConfig.channel || 'yocapi_pr',
                count: customCmd.execution_count,
                query: fullQuery
            });
            await sendChat(parsedResponse);
            return;
        }
        // Si es un comando de sistema (piñata, dale, cumplehoy, reg, sonido, frase, feliz, etc.), continúa hacia abajo ejecutando la lógica nativa del minijuego o alerta
    }

    // ─── MINIJUEGO: GOLPES A LA PIÑATA DE CAPIBARA (!dale, !pegar, !hit, etc.) ─
    const PINATA_HIT_COMMANDS = ['!dale', '!pegar', '!hit', '!palo', '!golpe', '!batear', '!darle', '!pega', '!romper', '!golpear'];
    if (PINATA_HIT_COMMANDS.includes(command)) {
        if (pinataManagerRef) {
            const pinataStatus = pinataManagerRef.getStatus();
            if (pinataStatus.active) {
                let hitterAvatar = '/img/yocapi.png';
                const senderLogin = (tags.username || '').toLowerCase();
                if (dbRef) {
                    dbRef.getUser(senderLogin).then(u => {
                        if (u && u.profile_image) hitterAvatar = u.profile_image;
                        pinataManagerRef.hit({
                            username: senderLogin,
                            displayName: sender,
                            avatar: hitterAvatar
                        });
                    }).catch(() => {
                        pinataManagerRef.hit({
                            username: senderLogin,
                            displayName: sender,
                            avatar: hitterAvatar
                        });
                    });
                } else {
                    pinataManagerRef.hit({
                        username: senderLogin,
                        displayName: sender,
                        avatar: hitterAvatar
                    });
                }
            }
        }
        return;
    }

    // 2. COOLDOWN ANTI-SPAM (Comandos exclusivos de cumpleaños sin colisión con StreamElements)
    const KNOWN_COMMANDS = [
        // Registro
        '!reg', '!registro', '!regcumple', '!registrarme', '!registrar', '!anotarme', '!cumpleregistro',
        // Consulta
        '!cumple', '!micumple', '!cumpleaños', '!cumpleanos', '!mifecha', '!fechacumple', '!cuandocumplo',
        '!prox', '!proximos', '!siguientes', '!cumples', '!mes', '!cumplemes', '!cumplesmes', '!mescumple',
        // Información & Ayuda (específicos de cumple para NO chocar con StreamElements !cmds / !help)
        '!cumplecmds', '!ccmds', '!cumpleayuda', '!cumpleguia', '!cumpleinfo', '!cumplecomandos', '!bday',
        // Alerta de Cumpleaños
        '!cumplehoy', '!alerta', '!mialerta', '!fiesta', '!festejo', '!hoyesmicumple', '!hoyesmicum', '!lanzarmicumple', '!micumplealerta', '!lanzarcumple', '!cumplealerta',
        // Felicitaciones & Confeti (sin !gg para no chocar con partidas)
        '!feliz', '!hb', '!felicidades', '!felicidades1', '!felicidades2', '!felicidades3',
        '!felicitar', '!felicitar1', '!felicitar2', '!felicitar3',
        '!felicitaciones', '!felicitacion', '!festejar',
        // Piñata Minijuego (sin !stop genérico)
        '!piñata', '!pinata', '!pata', '!pstop', '!piñatastop', '!pinatastop', '!piñatita', '!pinatita',
        // Personalización de Alerta
        '!frase', '!hbcambio', '!hbfrase', '!micumplefrase', '!cambiarfrase', '!mifrase',
        '!sonido', '!audio', '!hbsonido', '!cambiarsonido', '!misonido', '!cambiarmusica',
        // Control & Moderación
        '!alertas', '!hbalertas', '!cumplealertas', '!alertascumple',
        '!hbfelicitar', '!hbfelicitaciones',
        '!rec', '!grabar', '!hbgrabacion', '!hbmodovideo', '!hbcine', '!hbpausa',
        '!hbmod', '!cumplemod', '!hbadmin', '!hbestado', '!modcumple',
        '!libre', '!abrir', '!hblibre', '!hbdesbloquear', '!hbabrir',
        '!listo', '!hecho', '!yacelebro', '!hbyacelebro', '!hbcelebrado', '!hblisto', '!hbyafestejo',
        '!relanzar', '!reinicio', '!hbrelanzar', '!hbreiniciar', '!hbreset',
        '!silencio', '!hbpruebas', '!hbsilencio', '!hbsilent', '!hbmodoprueba'
    ];
    if (KNOWN_COMMANDS.includes(command)) {
        if (isCommandRateLimited(sender, command)) {
            return;
        }
    }

    // ─── COMANDO 0: !registro DD-MM [usuario] (Registrarse o registrar a un compañero) ─────────
    if (command === '!reg' || command === '!registro' || command === '!regcumple' || command === '!registrarme' || command === '!registrar' || command === '!anotarme' || command === '!cumpleregistro') {
        if (!dbRef) return;

        const argText = parts.slice(1).join(' ').trim();
        if (!argText) {
            return sendChat(`🎂 @${sender}, usa: !reg DD-MM (ej: !reg 11-06) o entra a ${appUrlRef} ✨`);
        }

        let targetPart = '';
        let datePart = argText;

        const atMatch = argText.match(/@([a-z0-9_]+)/i);
        if (atMatch) {
            targetPart = atMatch[1];
            datePart = argText.replace(atMatch[0], '').trim();
        } else {
            const tokens = argText.split(/\s+/);
            if (tokens.length >= 2) {
                if (parseSmartDate(tokens[0])) {
                    datePart = tokens[0];
                    targetPart = tokens.slice(1).join('_');
                } else if (parseSmartDate(tokens.slice(0, 2).join(' '))) {
                    datePart = tokens.slice(0, 2).join(' ');
                    targetPart = tokens.slice(2).join('_');
                } else if (parseSmartDate(tokens.slice(0, 3).join(' '))) {
                    datePart = tokens.slice(0, 3).join(' ');
                    targetPart = tokens.slice(3).join('_');
                } else if (parseSmartDate(tokens[tokens.length - 1])) {
                    datePart = tokens[tokens.length - 1];
                    targetPart = tokens.slice(0, -1).join('_');
                } else if (parseSmartDate(tokens.slice(-2).join(' '))) {
                    datePart = tokens.slice(-2).join(' ');
                    targetPart = tokens.slice(0, -2).join('_');
                } else if (parseSmartDate(tokens.slice(-3).join(' '))) {
                    datePart = tokens.slice(-3).join(' ');
                    targetPart = tokens.slice(0, -3).join('_');
                }
            }
        }

        const parsed = parseSmartDate(datePart);
        if (!parsed) {
            return sendChat(`⚠️ @${sender}, fecha inválida. Usa: !reg DD-MM (ej: !reg 11-06) o entra a ${appUrlRef} 📅`);
        }

        const regDay = parsed.day;
        const regMonth = parsed.month;

        if (regMonth < 1 || regMonth > 12) {
            return sendChat(`⚠️ @${sender}, mes inválido (1 al 12) 📅`);
        }
        if (regDay < 1 || regDay > 31) {
            return sendChat(`⚠️ @${sender}, día inválido (1 al 31) 📅`);
        }

        const monthName = MONTH_NAMES[regMonth] || regMonth;
        const maxDay = (regMonth === 2) ? 29 : ([4, 6, 9, 11].includes(regMonth) ? 30 : 31);
        if (regDay > maxDay) {
            return sendChat(`⚠️ @${sender}, ${monthName} solo tiene ${maxDay} días 📅`);
        }

        const senderLoginReg = (tags.username || sender).toLowerCase().replace(/[^a-z0-9_]/g, '');

        const cleanTarget = targetPart.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]/g, '');
        const isSelf = !cleanTarget || cleanTarget === senderLoginReg;
        const targetLogin = isSelf ? senderLoginReg : cleanTarget;
        const targetDisplay = isSelf ? (tags['display-name'] || senderLoginReg) : targetPart.replace(/^@/, '');
        const twitchId = isSelf && tags['user-id'] ? String(tags['user-id']).trim() : '';

        try {
            let existing = await dbRef.getUser(targetLogin);

            // Detección de cambio de nick en Twitch: si no existe por nombre pero viene su Twitch ID permanente
            if (!existing && twitchId) {
                const oldByTwitchId = await dbRef.getUserByTwitchId(twitchId);
                if (oldByTwitchId && oldByTwitchId.username !== targetLogin) {
                    console.log(`[TwitchBot !registro] 🔄 Cambio de nombre detectado por Twitch ID: @${oldByTwitchId.username} -> @${targetLogin}. Migrando registro...`);
                    await dbRef.migrateUser(oldByTwitchId.username, targetLogin, {
                        display_name: targetDisplay,
                        twitch_id: twitchId
                    });
                    existing = await dbRef.getUser(targetLogin);
                }
            }

            if (existing) {
                // Si la cuenta está marcada como desbloqueada (por dashboard o !hblibre) y el usuario
                // viene a cambiar su fecha desde el chat, permitirlo directamente.
                const isUnlocked = existing.birthday_unlocked === true || existing.birthday_unlocked === 1;

                if (!isUnlocked) {
                    // Comprobar bloqueo de 1 año para cambio de fecha
                    const lockedSince = existing.birthday_locked_at || existing.created_at || existing.registered_at || null;
                    const isLocked = lockedSince
                        ? (Date.now() - new Date(lockedSince).getTime()) < 365 * 24 * 3600 * 1000
                        : false;

                    if (isLocked && (existing.birth_month !== regMonth || existing.birth_day !== regDay)) {
                        const mText = MONTH_NAMES[existing.birth_month] || existing.birth_month;
                        if (isSelf) {
                            return sendChat(`🔒 @${sender}, tu fecha ya es el ${existing.birth_day} de ${mText}. Pide ayuda a un mod con !libre si hubo error 🎂`);
                        } else {
                            return sendChat(`🔒 @${sender}, @${targetLogin} ya tiene fecha (${existing.birth_day} de ${mText}) 🎂`);
                        }
                    }
                }

                // Misma fecha — confirmar que ya está registrado
                if (existing.birth_month === regMonth && existing.birth_day === regDay && !isUnlocked) {
                    if (isSelf) {
                        return sendChat(`✅ @${sender}, ya tienes el ${regDay} de ${monthName} registrado 🎂 ¡Lanza tu alerta ese día con !cumplehoy!`);
                    } else {
                        return sendChat(`✅ @${sender}, @${targetLogin} ya tiene registrado el ${regDay} de ${monthName} 🎂`);
                    }
                }

                // Actualizar fecha (permitido: desbloqueado por mod, o fecha diferente y sin lock)
                const nowIso = new Date().toISOString();
                existing.birth_month = regMonth;
                existing.birth_day = regDay;
                existing.birthday_locked_at = nowIso;
                existing.birthday_unlocked = false;
                if (twitchId && !existing.twitch_id) existing.twitch_id = twitchId;
                await dbRef.saveUser(existing);

                if (isSelf) {
                    return sendChat(`✅ @${sender}, fecha actualizada al ${regDay} de ${monthName} 🎂`);
                } else {
                    return sendChat(`✅ @${sender}, fecha de @${targetLogin} actualizada al ${regDay} de ${monthName} 🎂`);
                }
            }

            // ── Registro NUEVO desde chat ──
            const nowIso = new Date().toISOString();
            await dbRef.saveUser({
                username: targetLogin,
                display_name: targetDisplay,
                pin_hash: '',
                recovery_hash: '',
                profile_image: '/img/yocapi.png',
                birth_month: regMonth,
                birth_day: regDay,
                custom_message: '',
                selected_sound: 'HBSilbato.mp3',
                birthday_unlocked: false,
                birthday_locked_at: nowIso,
                created_at: nowIso,
                registered_at: nowIso,
                twitch_id: twitchId
            });

            dbRef.deduplicateUsers().catch(() => { });

            if (isSelf) {
                return sendChat(`🎉 @${sender}, fecha guardada: ${regDay} de ${monthName} 🎂`);
            } else {
                return sendChat(`🎉 @${sender} registró a @${targetLogin} (${regDay} de ${monthName}) 🎂`);
            }

        } catch (e) {
            console.error('[TwitchBot] Error en !registro:', e);
            return sendChat(`❌ @${sender}, error al guardar. Reintenta en un momento.`);
        }
    }

    // ─── COMANDO 1: !cumple [usuario] o !micumple ─────────────────────────────
    if (command === '!cumple' || command === '!micumple' || command === '!cumpleaños' || command === '!cumpleanos' || command === '!mifecha' || command === '!fechacumple' || command === '!cuandocumplo') {

        const isSelf = !arg || arg.toLowerCase() === sender.toLowerCase();
        const targetLogin = (arg || sender).toLowerCase().replace(/[^a-z0-9_]/g, '');

        if (!dbRef || !getBirthdayStatusRef) return;
        const user = await dbRef.getUser(targetLogin);

        if (!user || !user.birth_month || !user.birth_day || user.birthday_unlocked) {
            if (isSelf) {
                return sendChat(`⚠️ @${sender}, aún no te registras. Usa !reg DD-MM o entra a ${appUrlRef} 🎂`);
            } else {
                return sendChat(`⚠️ @${arg} no está registrado en el sistema 🎂`);
            }
        }

        const bStatus = getBirthdayStatusRef(user.birth_month, user.birth_day);
        const monthText = MONTH_NAMES[user.birth_month] || user.birth_month;
        const displayName = user.display_name || user.username;

        if (bStatus.canCelebrate) {
            const alreadyCelebrated = isUserCelebratedThisYear(user, bStatus);

            if (bStatus.isToday) {
                if (isSelf) {
                    if (alreadyCelebrated) {
                        return sendChat(`🎂 @${displayName}, ¡ya festejaste este año! 💖`);
                    } else {
                        return sendChat(`🎂 ¡HOY es tu cumple @${displayName}! Usa !cumplehoy 🎉`);
                    }
                } else {
                    if (alreadyCelebrated) {
                        return sendChat(`🎂 ¡Hoy cumple @${displayName} (ya festejó)! 💖`);
                    } else {
                        return sendChat(`🎂 ¡Hoy es el cumple de @${displayName}! Dile que use !cumplehoy 🎉`);
                    }
                }
            } else {
                // Período de gracia
                const daysLeft = bStatus.daysRemainingInGrace;
                const daysLeftText = daysLeft === 1 ? '1 día' : `${daysLeft} días`;

                if (isSelf) {
                    if (alreadyCelebrated) {
                        return sendChat(`🎂 @${displayName}, ya festejaste este año 💖`);
                    } else {
                        return sendChat(`⏰ @${displayName}, te quedan ${daysLeftText} de gracia. ¡Usa !cumplehoy! 🎂`);
                    }
                } else {
                    if (alreadyCelebrated) {
                        return sendChat(`🎈 @${displayName} cumplió el ${user.birth_day} de ${monthText} y ya celebró 🎂`);
                    } else {
                        return sendChat(`🎈 @${displayName} cumplió el ${user.birth_day} de ${monthText} (${daysLeftText} de gracia) 🎂`);
                    }
                }
            }
        }

        const days = bStatus.daysUntilBirthday;
        if (days === 1) {
            return sendChat(`🎉 ¡Mañana cumple @${displayName}! (${user.birth_day} de ${monthText}) 🎂`);
        } else {
            return sendChat(`🗓️ @${displayName}: ${user.birth_day} de ${monthText} (faltan ${days}d) 🎂`);
        }
    }

    // ─── COMANDO 2: !proximos o !prox ─────────────────────────────────────────
    if (command === '!prox' || command === '!proximos' || command === '!siguientes' || command === '!cumples') {
        if (!dbRef || !getBirthdayStatusRef) return;
        const users = await dbRef.getAllUsers();
        const upcoming = [];

        for (const u of users) {
            if (!u.birth_month || !u.birth_day || u.birthday_unlocked) continue;
            const bStatus = getBirthdayStatusRef(u.birth_month, u.birth_day);
            if (bStatus.daysUntilBirthday > 0 && bStatus.daysUntilBirthday <= 15) {
                upcoming.push({
                    name: u.display_name || u.username,
                    day: u.birth_day,
                    month: MONTH_NAMES[u.birth_month] || u.birth_month,
                    days: bStatus.daysUntilBirthday
                });
            }
        }

        if (upcoming.length === 0) {
            return sendChat(`🎈 Sin cumples en los próximos 15 días. ¡Regístrate con !reg DD-MM en ${appUrlRef}! 🎂`);
        }

        upcoming.sort((a, b) => a.days - b.days);
        const list = upcoming.slice(0, 5).map(u => `@${u.name} (${u.day}/${u.month}, ${u.days}d)`).join(' · ');
        return sendChat(`📅 Próximos cumples: ${list} 🎂`);
    }

    // ─── COMANDO 3: !cumplemes o !mes ─────────────────────────────────────────
    if (command === '!mes' || command === '!cumplemes' || command === '!cumplesmes' || command === '!mescumple') {
        if (!dbRef) return;
        const currentMonth = new Date().getMonth() + 1;
        const users = await dbRef.getAllUsers();
        const monthCelebrants = users.filter(u => u.birth_month === currentMonth && !u.birthday_unlocked);

        const currentMonthName = MONTH_NAMES[currentMonth] || 'este mes';
        if (monthCelebrants.length === 0) {
            return sendChat(`🗓️ Sin cumpleañeros registrados en ${currentMonthName}. ¡Anótate con !reg DD-MM! 🎂`);
        }

        monthCelebrants.sort((a, b) => a.birth_day - b.birth_day);
        const list = monthCelebrants.slice(0, 7).map(u => `@${u.display_name || u.username} (${u.birth_day})`).join(', ');
        return sendChat(`🗓️ Cumples de ${currentMonthName} (${monthCelebrants.length}): ${list} 🎂`);
    }

    // ─── COMANDO 4: !regcumple ────────────────────────────────────────────────
    if (command === '!regcumple') {
        const msg = customCmdResponses.regcumple
            ? customCmdResponses.regcumple.replace(/\{URL\}/gi, appUrlRef)
            : `🎂 Regístrate gratis con !reg DD-MM o en ${appUrlRef} para sonar en stream 🎉`;
        return sendChat(msg);
    }

    // ─── COMANDO 5: !cumplehoy / !hoyesmicumple (Lanzar alerta del cumpleañero) ─
    if (command === '!cumplehoy' || command === '!alerta' || command === '!fiesta' || command === '!festejo' || command === '!hoyesmicumple' || command === '!hoyesmicum' || command === '!mialerta' || command === '!lanzarmicumple' || command === '!micumplealerta' || command === '!lanzarcumple' || command === '!cumplealerta') {
        if (!dbRef || !getBirthdayStatusRef) return;
        const appSettings = getAppSettingsRef ? getAppSettingsRef() : {};

        // 1. SEGURIDAD: ¿Alertas del cumpleañero permitidas por la streamer / mods?
        if (appSettings.birthday_alerts_enabled === false) {
            return sendChat(`🎬 @${sender}, alertas de cumple pausadas temporalmente por Yocapi 🤫`);
        }

        const senderLogin = sender.toLowerCase().replace(/[^a-z0-9_]/g, '');
        const user = await dbRef.getUser(senderLogin);

        if (!user || !user.birth_month || !user.birth_day || user.birthday_unlocked) {
            return sendChat(`⚠️ @${sender}, no estás registrado. Usa !reg DD-MM o entra a ${appUrlRef} 🎂`);
        }

        const bStatus = getBirthdayStatusRef(user.birth_month, user.birth_day);
        const monthText = MONTH_NAMES[user.birth_month] || user.birth_month;
        const displayName = user.display_name || user.username;

        if (!bStatus.canCelebrate) {
            const days = bStatus.daysUntilBirthday;
            return sendChat(`🗓️ @${displayName}, tu cumple es el ${user.birth_day} de ${monthText} (faltan ${days} días) 🎂`);
        }

        const alreadyCelebrated = isUserCelebratedThisYear(user, bStatus);

        if (alreadyCelebrated) {
            return sendChat(`👑 @${displayName}, ¡ya lanzaste tu alerta de cumpleaños este año! 🥳🎂`);
        }

        const sound = user.selected_sound || 'HBSilbato.mp3';

        // Si el usuario configuró la canción completa de cumpleaños, verificar mutex de música
        if (sound === 'MBMusica.mp3' && acquireMusicLockRef) {
            const lockAcquired = acquireMusicLockRef(user.username);
            if (!lockAcquired) {
                const lockStatus = getMusicLockStatusRef ? getMusicLockStatusRef() : { remainingMs: 15000 };
                const sec = Math.max(1, Math.ceil((lockStatus.remainingMs || 15000) / 1000));
                return sendChat(`🎶 @${displayName}, canción sonando en directo. Espera ${sec}s y reintenta 🎂`);
            }
        }

        // Marcar celebración en la base de datos para no duplicar
        user.last_activated = new Date().toISOString();
        user.last_played_date = new Date().toISOString().split('T')[0];
        user.last_celebrated_year = bStatus.celebrationYear;
        await dbRef.saveUser(user);

        const messageText = user.custom_message || '¡Hoy es mi cumpleaños!';

        await dbRef.logAlert({
            username: user.username,
            display_name: displayName,
            sound_file: sound,
            message: messageText
        });

        const alertPayload = {
            type: 'alert',
            user: displayName,
            avatar: user.profile_image || '/img/yocapi.png',
            sound: sound,
            message: messageText,
            isToday: bStatus.isToday,
            isGrace: bStatus.isGracePeriod,
            theme: 'purple',
            timestamp: Date.now()
        };

        if (appSettings.alerts_paused && pausedAlertsQueueRef) {
            pausedAlertsQueueRef.push({
                id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                user: displayName,
                avatar: user.profile_image || '/img/yocapi.png',
                message: messageText,
                sound: sound,
                time: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
                payload: alertPayload
            });
            return sendChat(`🎂 @${displayName}, alerta guardada en cola (alertas pausadas en vivo). Saldrá al reanudar 🎈`);
        }

        if (broadcastToOverlayRef) {
            broadcastToOverlayRef(alertPayload);
        }

        return sendChat(`🎂 ¡Feliz cumpleaños @${displayName}! Alerta sonando en pantalla 🥳🎉`);
    }

// ─── COMANDO 6: !feliz / !felicidades / !hb [mensaje] ─────────────────────
const felicitationCommands = [
    '!feliz', '!hb',
    '!feliz1', '!feliz2', '!feliz3',
    '!hb1', '!hb2', '!hb3',
    '!felicidades', '!felicidades1', '!felicidades2', '!felicidades3',
    '!felicitar', '!felicitar1', '!felicitar2', '!felicitar3',
    '!felicitaciones', '!felicitacion', '!festejar'
];

if (felicitationCommands.includes(command)) {
    if (!dbRef || !getBirthdayStatusRef) return;
    const appSettings = getAppSettingsRef ? getAppSettingsRef() : {};

    // Si es !feliz on/off, dejarlo pasar al bloque de control de mods
    if ((command === '!feliz' || command === '!felicitar' || command === '!felicitaciones') && (arg === 'on' || arg === 'off')) {
        // No procesar aquí, el bloque de mods más abajo lo manejará
    } else {

        // Si es comando a secas sin mensaje y sin que haya felicitaciones activas, mostrar info
        if ((command === '!felicitar' || command === '!feliz' || command === '!hb') && !arg && !appSettings.felicitations_enabled) {
            const msg = customCmdResponses.felicitar
                ? customCmdResponses.felicitar.replace(/\{URL\}/gi, appUrlRef)
                : `💌 Felicita en vivo a los cumpleañeros con !feliz <mensaje> o entra a ${appUrlRef} 🎉`;
            return sendChat(msg);
        }

        // 1. Verificar si las felicitaciones están permitidas por la streamer
        if (!appSettings.felicitations_enabled) {
            return sendChat(`⚠️ @${sender}, felicitaciones en pantalla pausadas por ahora 📺`);
        }

        // 2. Verificar que el que felicita esté registrado en la BD
        const senderLogin = sender.toLowerCase().replace(/[^a-z0-9_]/g, '');
        const senderUser = await dbRef.getUser(senderLogin);

        if (!senderUser || !senderUser.birth_month || !senderUser.birth_day || senderUser.birthday_unlocked) {
            return sendChat(`⚠️ @${sender}, regístrate con !reg DD-MM para poder felicitar en pantalla 🎈`);
        }

        // 3. Determinar el cumpleañero objetivo
        let targetUser = null;
        let customMsg = '';

        if (arg) {
            const potentialTarget = await dbRef.getUser(arg.toLowerCase());
            if (potentialTarget && potentialTarget.birth_month && potentialTarget.birth_day) {
                const tStatus = getBirthdayStatusRef(potentialTarget.birth_month, potentialTarget.birth_day);
                if (tStatus.canCelebrate) {
                    targetUser = potentialTarget;
                    customMsg = parts.slice(2).join(' ').trim();
                }
            }
        }

        if (!targetUser) {
            const allUsers = await dbRef.getAllUsers();
            const activeCelebrants = [];
            for (const u of allUsers) {
                if (!u.birth_month || !u.birth_day || u.birthday_unlocked) continue;
                const s = getBirthdayStatusRef(u.birth_month, u.birth_day);
                if (s.canCelebrate) {
                    activeCelebrants.push({ user: u, status: s });
                }
            }

            if (activeCelebrants.length === 0) {
                return sendChat(`🎈 @${sender}, no hay cumpleañeros activos hoy. Usa !prox para ver quién sigue 🎂`);
            }

            const todayOne = activeCelebrants.find(c => c.status.isToday) || activeCelebrants[0];
            targetUser = todayOne.user;
            customMsg = parts.slice(1).join(' ').trim();
        }

        // 4. Evitar auto-felicitación
        if (targetUser.username.toLowerCase() === senderLogin) {
            return sendChat(`😅 @${sender}, usa !cumplehoy para lanzar tu propia alerta 🎂`);
        }

        // 5. Determinar el sonido y gestionar el mutex de música
        let chosenSound = 'HBSilbato.mp3';
        let soundLabel = '🎺 Silbato Festivo';

        if (command.endsWith('1')) {
            chosenSound = 'MBMusica.mp3';
            soundLabel = '🎵 Música de Fiesta';
        } else if (command.endsWith('2')) {
            chosenSound = 'HBSilbato.mp3';
            soundLabel = '🎺 Silbato Festivo';
        } else if (command.endsWith('3')) {
            chosenSound = 'HBVoz.mp3';
            soundLabel = '🎤 Felicitación con Voz';
        } else {
            // Selección aleatoria
            const soundOptions = [
                { file: 'MBMusica.mp3', label: '🎵 Música de Fiesta' },
                { file: 'HBSilbato.mp3', label: '🎺 Silbato Festivo' },
                { file: 'HBVoz.mp3', label: '🎤 Felicitación con Voz' }
            ];
            const musicLock = getMusicLockStatusRef ? getMusicLockStatusRef() : { locked: false };
            const availableOptions = musicLock.locked
                ? soundOptions.filter(s => s.file !== 'MBMusica.mp3')
                : soundOptions;
            const picked = availableOptions[Math.floor(Math.random() * availableOptions.length)];
            chosenSound = picked.file;
            soundLabel = picked.label;
        }

        // Mutex si es música (MBMusica.mp3)
        if (chosenSound === 'MBMusica.mp3') {
            if (acquireMusicLockRef && !acquireMusicLockRef(sender)) {
                const musicStatus = getMusicLockStatusRef ? getMusicLockStatusRef() : {};
                const secsLeft = Math.ceil((musicStatus.remainingMs || 5000) / 1000);
                return sendChat(`🎵 @${sender}, rola sonando (${secsLeft}s). ¡Usa !feliz2 mientras tanto! 🎺`);
            }
        }

        // 6. Enviar al overlay de OBS
        if (broadcastToOverlayRef) {
            broadcastToOverlayRef({
                type: 'felicitation',
                from: senderUser.display_name || senderUser.username,
                fromAvatar: senderUser.profile_image || '/img/yocapi.png',
                to: targetUser.display_name || targetUser.username,
                sound: chosenSound,
                message: customMsg.slice(0, 60),
                timestamp: Date.now()
            });

            if (chosenSound === 'MBMusica.mp3') {
                broadcastToOverlayRef({
                    type: 'music_lock_update',
                    music_lock: getMusicLockStatusRef ? getMusicLockStatusRef() : { locked: true }
                });
            }
        }

        const toName = targetUser.display_name || targetUser.username;
        const msgSnippet = customMsg ? ` ("${customMsg.slice(0, 45)}")` : '';
        return sendChat(`💌 @${sender} felicitó a @${toName} en pantalla${msgSnippet} 🎉`);
    } // end else (not on/off control)
}

// ─── COMANDO 7: !frase / !hbcambio <frase> (Modificar frase de alerta) ──────
if (command === '!frase' || command === '!hbcambio' || command === '!hbfrase' || command === '!micumplefrase' || command === '!cambiarfrase' || command === '!mifrase') {
    if (!dbRef) return;
    const senderLogin = sender.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const user = await dbRef.getUser(senderLogin);

    if (!user || !user.birth_month || !user.birth_day || user.birthday_unlocked) {
        return sendChat(`⚠️ @${sender}, regístrate con !reg DD-MM antes de cambiar tu frase 🎂`);
    }

    const newPhrase = parts.slice(1).join(' ').trim();
    if (!newPhrase) {
        const currentPhrase = user.custom_message || '¡Hoy es mi cumpleaños!';
        return sendChat(`💬 @${sender}, tu frase actual es: "${currentPhrase}". Cambiar: !frase <tu texto> (máx 60 letras) 🎈`);
    }

    const cleanPhrase = newPhrase.slice(0, 60).trim();
    user.custom_message = cleanPhrase;
    await dbRef.saveUser(user);

    return sendChat(`✨ @${sender}, frase de alerta actualizada: "${cleanPhrase}" 🎂`);
}

// ─── COMANDO 8: !sonido / !audio / !hbsonido <1 | 2 | 3> ─────────────────────
if (command === '!sonido' || command === '!audio' || command === '!hbsonido' || command === '!cambiarsonido' || command === '!misonido' || command === '!cambiarmusica') {
    if (!dbRef) return;
    const senderLogin = sender.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const user = await dbRef.getUser(senderLogin);

    if (!user || !user.birth_month || !user.birth_day || user.birthday_unlocked) {
        return sendChat(`⚠️ @${sender}, regístrate con !reg DD-MM antes de elegir tu sonido 🎂`);
    }

    const soundNames = {
        'HBSilbato.mp3': '🎺 Silbato Festivo (Opción 1)',
        'MBMusica.mp3': '🎵 Música de Fiesta (Opción 2)',
        'HBVoz.mp3': '🎤 Felicitación con Voz (Opción 3)'
    };

    const choice = (parts[1] || '').trim().toLowerCase();
    let chosenSound = null;
    let soundLabel = '';

    if (choice === '1' || choice === 'silbato') {
        chosenSound = 'HBSilbato.mp3';
        soundLabel = '🎺 Silbato Festivo';
    } else if (choice === '2' || choice === 'musica' || choice === 'música' || choice === 'fiesta') {
        chosenSound = 'MBMusica.mp3';
        soundLabel = '🎵 Música de Fiesta';
    } else if (choice === '3' || choice === 'voz' || choice === 'felicitacion' || choice === 'felicitación') {
        chosenSound = 'HBVoz.mp3';
        soundLabel = '🎤 Felicitación con Voz';
    }

    if (!chosenSound) {
        const currentSoundName = soundNames[user.selected_sound] || '🎺 Silbato Festivo (Opción 1)';
        return sendChat(`🎵 @${sender}, sonido actual: ${currentSoundName}. Cambiar: !sonido 1 (Silbato) · !sonido 2 (Música) · !sonido 3 (Voz) 🥳`);
    }

    user.selected_sound = chosenSound;
    await dbRef.saveUser(user);

    return sendChat(`🎵 @${sender}, sonido cambiado a: ${soundLabel} 🔊`);
}

// ─── COMANDO PIÑATA: !piñata / !pata / !pstop ───────────────────────────────
if (command === '!piñata' || command === '!pinata' || command === '!pata' || command === '!pstop' || command === '!piñatastop' || command === '!pinatastop') {
    if (!pinataManagerRef) return;

    const subAction = (parts[1] || '').toLowerCase().trim();
    const isStopCmd = command === '!pstop' || command === '!piñatastop' || command === '!pinatastop' || subAction === 'stop' || subAction === 'detener' || subAction === 'cancelar';

    if (isStopCmd) {
        if (!isStreamerOrMod(tags, channel)) {
            return sendChat(`⛔ @${sender}, solo streamer (@yocapi_pr) y mods pueden detener la piñata 🛡️`);
        }
        const stopped = pinataManagerRef.stop(true);
        if (!stopped) {
            return sendChat(`ℹ️ @${sender}, no hay piñata activa en este momento.`);
        }
        return sendChat(`🛑 @${sender}, piñata cancelada por moderación.`);
    }

    // Solo streamer, desarrollador y mods pueden iniciar la piñata
    if (!isStreamerOrMod(tags, channel)) {
        const pStatus = pinataManagerRef.getStatus();
        if (pStatus.active) {
            return sendChat(`🪅 ¡Piñata activa (${pStatus.currentHp}/${pStatus.maxHp} HP)! Escribe !dale o !pegar para batear 💥`);
        }
        return sendChat(`🪅 La piñata comunitaria la inicia la streamer (@yocapi_pr) o mods. ¡Atentos! 🎉`);
    }

    const currentStatus = pinataManagerRef.getStatus();
    if (currentStatus.active && subAction !== 'restart' && subAction !== 'reiniciar') {
        return sendChat(`🪅 @${sender}, piñata en curso (${currentStatus.currentHp}/${currentStatus.maxHp} HP, ${currentStatus.remainingSec}s restantes). Usa !pstop para cancelar.`);
    }

    // Parsear nombre y golpes
    let targetName = 'la Comunidad';
    let targetAvatar = '/img/yocapi.png';
    let hp = 30;

    const part1Raw = (parts[1] || '').replace(/^@/, '').trim();
    const part1Num = parseInt(part1Raw, 10);
    const part1IsNum = !isNaN(part1Num) && part1Raw !== '';

    if (part1IsNum) {
        hp = part1Num;
    } else if (part1Raw && part1Raw !== 'start' && part1Raw !== 'iniciar') {
        targetName = part1Raw;

        if (dbRef) {
            try {
                const u = await dbRef.getUser(part1Raw.toLowerCase());
                if (u) {
                    targetName = u.display_name || u.username;
                    if (u.profile_image) targetAvatar = u.profile_image;
                }
            } catch (_) { }
        }

        const hpArg = parseInt((parts[2] || ''), 10);
        if (!isNaN(hpArg) && hpArg >= 10 && hpArg <= 100) {
            hp = hpArg;
        }
    } else {
        if (dbRef && getBirthdayStatusRef) {
            try {
                const allUsers = await dbRef.getAllUsers();
                for (const u of allUsers) {
                    if (!u.birth_month || !u.birth_day) continue;
                    const bStatus = getBirthdayStatusRef(u.birth_month, u.birth_day);
                    if (bStatus.canCelebrate && bStatus.isToday) {
                        targetName = u.display_name || u.username;
                        targetAvatar = u.profile_image || '/img/yocapi.png';
                        break;
                    }
                }
            } catch (_) { }
        }
    }

    hp = Math.min(100, Math.max(10, hp));

    await pinataManagerRef.start({
        targetUser: targetName,
        targetAvatar,
        maxHp: hp,
        durationSec: null,
        initiatedBy: sender
    });
    return;
}

// ─── COMANDO 9: !cumplecmds / !ccmds / !cumpleayuda (Guía de Cumpleaños) ─────
if (command === '!cumplecmds' || command === '!ccmds' || command === '!cumpleayuda' || command === '!cumpleguia' || command === '!cumpleinfo' || command === '!cumplecomandos' || command === '!bday') {
    return sendChat(`📜 Guía: ${appUrlRef}/comandos 🎂 | !cumplehoy · !reg DD-MM · !cumple · !dale (piñata) · !feliz [msg] · !frase · !sonido`);
}

// ─── COMANDOS EXCLUSIVOS DE MODERACIÓN Y CONTROL (STREAMER & MODS) ─────────

// COMANDO MOD 1: !alertas [on|off]
if (command === '!alertas' || command === '!hbalertas' || command === '!cumplealertas' || command === '!alertascumple') {
    if (!isStreamerOrMod(tags, channel)) {
        return sendChat(`⛔ @${sender}, comando exclusivo de mods 🛡️`);
    }

    const appSettings = getAppSettingsRef ? getAppSettingsRef() : {};
    const subAction = (parts[1] || '').toLowerCase().trim();

    if (subAction === 'on' || subAction === 'activar' || subAction === 'habilitar' || subAction === '1') {
        appSettings.birthday_alerts_enabled = true;
        if (saveSettingsCallback) saveSettingsCallback({ birthday_alerts_enabled: true });
        if (broadcastToOverlayRef) broadcastToOverlayRef({ type: 'birthday_alerts_status', enabled: true });
        return sendChat(`👑 @${sender}, Alertas de cumpleañero ACTIVADAS ✅ (!cumplehoy disponible)`);
    } else if (subAction === 'off' || subAction === 'desactivar' || subAction === 'pausar' || subAction === 'bloquear' || subAction === '0') {
        appSettings.birthday_alerts_enabled = false;
        if (saveSettingsCallback) saveSettingsCallback({ birthday_alerts_enabled: false });
        if (broadcastToOverlayRef) broadcastToOverlayRef({ type: 'birthday_alerts_status', enabled: false });
        return sendChat(`👑 @${sender}, Alertas de cumpleañero DESACTIVADAS 🔒`);
    } else {
        const isEnabled = appSettings.birthday_alerts_enabled !== false;
        return sendChat(`👑 @${sender}, Alertas: ${isEnabled ? 'ACTIVADAS ✅' : 'DESACTIVADAS 🔒'}. Cambiar: !alertas on/off`);
    }
}

// COMANDO MOD 2: !hbfelicitar [on|off]
    if (command === '!hbfelicitar' || command === '!hbfelicitaciones' || ((command === '!felicitar' || command === '!felicitaciones') && (parts[1] === 'on' || parts[1] === 'off'))) {
        if (!isStreamerOrMod(tags, channel)) {
            return sendChat(`⛔ @${sender}, comando exclusivo de mods 🛡️`);
        }

        const appSettings = getAppSettingsRef ? getAppSettingsRef() : {};
        const subAction = (parts[1] || '').toLowerCase().trim();

        if (subAction === 'on' || subAction === 'activar' || subAction === 'habilitar' || subAction === '1') {
            appSettings.felicitations_enabled = true;
            if (saveSettingsCallback) saveSettingsCallback({ felicitations_enabled: true });
            if (broadcastToOverlayRef) broadcastToOverlayRef({ type: 'felicitations_status', enabled: true });
            return sendChat(`💌 @${sender}, Felicitaciones en stream ACTIVADAS ✅`);
        } else if (subAction === 'off' || subAction === 'desactivar' || subAction === 'pausar' || subAction === 'bloquear' || subAction === '0') {
            appSettings.felicitations_enabled = false;
            if (saveSettingsCallback) saveSettingsCallback({ felicitations_enabled: false });
            if (broadcastToOverlayRef) broadcastToOverlayRef({ type: 'felicitations_status', enabled: false });
            return sendChat(`💌 @${sender}, Felicitaciones en stream DESACTIVADAS 🔒`);
        } else {
            const isEnabled = !!appSettings.felicitations_enabled;
            return sendChat(`💌 @${sender}, Felicitaciones: ${isEnabled ? 'ACTIVADAS ✅' : 'DESACTIVADAS 🔒'}. Cambiar: !hbfelicitar on/off`);
        }
    }

    // COMANDO MOD 3: !rec / !grabar / !hbgrabacion [on|off]
    if (command === '!rec' || command === '!grabar' || command === '!hbgrabacion' || command === '!hbmodovideo' || command === '!hbcine' || command === '!hbpausa') {
        if (!isStreamerOrMod(tags, channel)) {
            return sendChat(`⛔ @${sender}, comando exclusivo de mods 🛡️`);
        }

        const appSettings = getAppSettingsRef ? getAppSettingsRef() : {};
        const subAction = (parts[1] || '').toLowerCase().trim();

        if (subAction === 'on' || subAction === 'activar' || subAction === '1' || subAction === 'iniciar') {
            appSettings.birthday_alerts_enabled = false;
            appSettings.felicitations_enabled = false;
            if (saveSettingsCallback) saveSettingsCallback({ birthday_alerts_enabled: false, felicitations_enabled: false });
            if (broadcastToOverlayRef) broadcastToOverlayRef({ type: 'recording_mode', active: true });
            return sendChat(`🎬 @${sender}, Modo Grabación ACTIVADO 🔴 (Alertas silenciadas). Desactivar: !rec off`);
        } else if (subAction === 'off' || subAction === 'desactivar' || subAction === '0' || subAction === 'terminar') {
            appSettings.birthday_alerts_enabled = true;
            appSettings.felicitations_enabled = true;
            if (saveSettingsCallback) saveSettingsCallback({ birthday_alerts_enabled: true, felicitations_enabled: true });
            if (broadcastToOverlayRef) broadcastToOverlayRef({ type: 'recording_mode', active: false });
            return sendChat(`🎬 @${sender}, Modo Grabación DESACTIVADO 🟢 (Alertas y felicitaciones activas)`);
        } else {
            const isRecording = (appSettings.birthday_alerts_enabled === false && !appSettings.felicitations_enabled);
            return sendChat(`🎬 @${sender}, Modo Grabación: ${isRecording ? 'ACTIVADO 🔴' : 'DESACTIVADO 🟢'}. Cambiar: !rec on/off`);
        }
    }

    // COMANDO MOD 4: !hbmod / !cumplemod (Panel de Estado Rápido)
    if (command === '!hbmod' || command === '!cumplemod' || command === '!hbadmin' || command === '!hbestado') {
        if (!isStreamerOrMod(tags, channel)) {
            return sendChat(`⛔ @${sender}, panel exclusivo de mods 🛡️`);
        }

        const appSettings = getAppSettingsRef ? getAppSettingsRef() : {};
        const bdayAct = appSettings.birthday_alerts_enabled !== false ? '✅' : '🔒';
        const felicAct = appSettings.felicitations_enabled ? '✅' : '🔒';
        const recMode = (appSettings.birthday_alerts_enabled === false && !appSettings.felicitations_enabled) ? '🔴 REC' : '🟢 OK';
        const mins = botConfig.timer_minutes || 60;
        const testMode = botConfig.silent_mode ? '🧪 SILENCIO' : '🔊 ACTIVO';

        return sendChat(`🛡️ [Mods] Estado: ${recMode} · Bot: ${testMode} · Alertas: ${bdayAct} · Felicitaciones: ${felicAct} · Timer: ${mins}m | !listo @u · !relanzar @u · !libre @u · !alertas on/off · !rec on/off`);
    }

    // COMANDO MOD 5: !silencio / !hbpruebas [on|off]
    if (command === '!silencio' || command === '!hbpruebas' || command === '!hbsilencio' || command === '!hbsilent' || command === '!hbmodoprueba') {
        if (!isStreamerOrMod(tags, channel)) {
            return sendChat(`⛔ @${sender}, comando exclusivo de mods 🛡️`);
        }

        const subAction = (parts[1] || '').toLowerCase().trim();
        if (subAction === 'on' || subAction === 'activar' || subAction === '1' || subAction === 'silencio') {
            botConfig.silent_mode = true;
            if (saveSettingsCallback) saveSettingsCallback({ twitch_bot: botConfig });
            console.log('[TwitchBot] 🧪 Modo pruebas / silencio de chat ACTIVADO');
            return sendChat(`🧪 @${sender}, Modo Pruebas ACTIVADO 🤫 (Bot silenciado en Twitch chat). Desactivar: !silencio off`);
        } else if (subAction === 'off' || subAction === 'desactivar' || subAction === '0' || subAction === 'hablar') {
            botConfig.silent_mode = false;
            if (saveSettingsCallback) saveSettingsCallback({ twitch_bot: botConfig });
            console.log('[TwitchBot] 🔊 Modo pruebas / silencio de chat DESACTIVADO');
            return sendChat(`🔊 @${sender}, Modo Pruebas DESACTIVADO 💬 (Bot hablando normal en Twitch chat)`);
        } else {
            const isSilent = !!botConfig.silent_mode;
            return sendChat(`🧪 @${sender}, Modo Pruebas: ${isSilent ? 'ACTIVADO 🤫 (Silencio)' : 'DESACTIVADO 🔊 (Normal)'}. Cambiar: !silencio on/off`);
        }
    }

    // COMANDO MOD 6: !libre / !abrir / !hblibre @usuario
    if (command === '!libre' || command === '!abrir' || command === '!hblibre' || command === '!hbdesbloquear') {
        if (!isStreamerOrMod(tags, channel)) {
            return sendChat(`⛔ @${sender}, comando exclusivo de mods 🛡️`);
        }
        if (!dbRef) return;
        const target = (parts[1] || '').trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (!target) {
            return sendChat(`🛡️ @${sender}, uso: !libre @usuario 📅`);
        }
        const targetUser = await dbRef.getUser(target);
        if (!targetUser) {
            return sendChat(`⚠️ @${sender}, no se encontró al usuario @${target}`);
        }
        targetUser.birthday_unlocked = true;
        targetUser.birthday_locked_at = null;
        await dbRef.saveUser(targetUser);
        return sendChat(`🔓 @${sender}, fecha de @${targetUser.display_name || targetUser.username} desbloqueada 📅`);
    }

    // COMANDO MOD 7: !listo / !hecho / !yacelebro / !hbyacelebro @usuario
    if (command === '!listo' || command === '!hecho' || command === '!yacelebro' || command === '!hbyacelebro' || command === '!hbcelebrado' || command === '!hblisto') {
        if (!isStreamerOrMod(tags, channel)) {
            return sendChat(`⛔ @${sender}, comando exclusivo de mods 🛡️`);
        }
        if (!dbRef) return;
        const target = (parts[1] || '').trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (!target) {
            return sendChat(`ℹ️ @${sender}, uso: !listo @usuario 🎂`);
        }
        const targetUser = await dbRef.getUser(target);
        if (!targetUser) {
            return sendChat(`⚠️ @${sender}, no se encontró al usuario @${target}`);
        }
        const bStatus = getBirthdayStatusRef ? getBirthdayStatusRef(targetUser.birth_month, targetUser.birth_day) : null;
        const year = bStatus?.celebrationYear || new Date().getFullYear();
        targetUser.last_celebrated_year = year;
        targetUser.last_played_date = new Date().toISOString().split('T')[0];
        targetUser.last_activated = new Date().toISOString();
        await dbRef.saveUser(targetUser);

        return sendChat(`✅ @${sender}, @${targetUser.display_name || targetUser.username} marcado como YA CELEBRADO (${year}) 🎂`);
    }

    // COMANDO MOD 8: !relanzar / !reinicio / !hbrelanzar @usuario
    if (command === '!relanzar' || command === '!reinicio' || command === '!hbrelanzar' || command === '!hbreiniciar') {
        if (!isStreamerOrMod(tags, channel)) {
            return sendChat(`⛔ @${sender}, comando exclusivo de mods 🛡️`);
        }
        if (!dbRef) return;
        const target = (parts[1] || '').trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (!target) {
            return sendChat(`ℹ️ @${sender}, uso: !relanzar @usuario 🔄`);
        }
        const targetUser = await dbRef.getUser(target);
        if (!targetUser) {
            return sendChat(`⚠️ @${sender}, no se encontró al usuario @${target}`);
        }
        targetUser.last_celebrated_year = 0;
        targetUser.last_played_date = null;
        targetUser.last_activated = null;
        await dbRef.saveUser(targetUser);

        return sendChat(`🔄 @${sender}, celebración de @${targetUser.display_name || targetUser.username} reiniciada. Ya puede usar !cumplehoy 🎂`);
    }
}

// ─── CONEXIÓN / DESCONEXIÓN DEL BOT ─────────────────────────────────────────
let isConnecting = false;

async function connectBot() {
    if (status === 'connected') return { success: true, message: 'El bot ya está conectado' };
    if (isConnecting) return { success: true, message: 'El bot ya se está conectando...' };

    if (!botConfig.bot_username || !botConfig.oauth_token || !botConfig.channel) {
        status = 'error';
        lastError = 'Faltan credenciales del bot (Nick, OAuth Token o Canal)';
        return { success: false, error: lastError };
    }

    isConnecting = true;
    status = 'connecting';
    lastError = null;

    try {
        if (client) {
            try {
                client.removeAllListeners();
                await client.disconnect();
            } catch (_) { }
            client = null;
        }

        const username = botConfig.bot_username.toLowerCase().trim();
        const password = formatOauthToken(botConfig.oauth_token);
        const channel = formatChannelName(botConfig.channel);

        client = new tmi.Client({
            options: { debug: false },
            connection: {
                reconnect: true,
                secure: true
            },
            identity: {
                username,
                password
            },
            channels: [channel]
        });

        client.on('message', handleChatMessage);

        client.on('connected', (addr, port) => {
            status = 'connected';
            lastError = null;
            connectedAt = new Date().toISOString();
            console.log(`[TwitchBot] ✅ Conectado como ${username} al canal ${channel} (${addr}:${port})`);
            startTimer();
            startStreamWatchdog();
        });

        client.on('disconnected', (reason) => {
            status = 'disconnected';
            console.log(`[TwitchBot] Desconectado: ${reason}`);
            stopTimer();
            if (streamWatchdogInterval) {
                clearInterval(streamWatchdogInterval);
                streamWatchdogInterval = null;
            }
        });

        await client.connect();
        return { success: true, message: `Conectado exitosamente al canal ${channel}` };
    } catch (err) {
        status = 'error';
        lastError = err.message || 'Error conectando a Twitch IRC';
        console.error('[TwitchBot] Error al conectar:', lastError);
        stopTimer();
        return { success: false, error: lastError };
    } finally {
        isConnecting = false;
    }
}

async function disconnectBot() {
    stopTimer();
    if (streamWatchdogInterval) {
        clearInterval(streamWatchdogInterval);
        streamWatchdogInterval = null;
    }
    if (client) {
        try {
            await client.disconnect();
        } catch (_) { }
        client = null;
    }
    status = 'disconnected';
    return { success: true, message: 'Bot desconectado correctamente' };
}

function initTwitchBot(options) {
    dbRef = options.db;
    getBirthdayStatusRef = options.getBirthdayStatus;
    appUrlRef = options.APP_URL || appUrlRef;
    saveSettingsCallback = options.saveSettings;
    broadcastToOverlayRef = options.broadcastToOverlay || null;
    getAppSettingsRef = options.getAppSettings || null;
    acquireMusicLockRef = options.acquireMusicLock || null;
    getMusicLockStatusRef = options.getMusicLockStatus || null;
    pausedAlertsQueueRef = options.pausedAlertsQueue || null;
    pinataManagerRef = options.pinataManager || null;

    if (options.initialConfig) {
        botConfig = { ...botConfig, ...options.initialConfig };
    }

    if (options.streamConfig) {
        updateStreamConfig(options.streamConfig);
    }

    // Cargar comandos personalizados desde la BD
    loadCustomCommandsCache().catch(e => console.warn('[TwitchBot] Error al cargar custom_commands:', e.message));

    // Cargar respuestas personalizadas desde settings guardados
    if (options.cmdResponses) {
        for (const [cmd, text] of Object.entries(options.cmdResponses)) {
            updateCmdResponse(cmd, text);
        }
    }

    // Auto-conectar si estaba habilitado y cuenta con credenciales
    if (botConfig.enabled && botConfig.bot_username && botConfig.oauth_token) {
        connectBot().catch(e => console.warn('[TwitchBot] Auto-connect falló:', e.message));
    }
}

function getBotStatus() {
    return {
        status,
        connected: status === 'connected',
        last_error: lastError,
        connected_at: connectedAt,
        last_announcement: lastAnnouncementTime,
        config: {
            bot_username: botConfig.bot_username || '',
            has_token: !!botConfig.oauth_token,
            oauth_token_preview: botConfig.oauth_token ? `${botConfig.oauth_token.slice(0, 10)}...` : '',
            channel: botConfig.channel || 'yocapi_pr',
            enabled: !!botConfig.enabled,
            timer_enabled: !!botConfig.timer_enabled,
            timer_minutes: botConfig.timer_minutes || 60,
            silent_mode: !!botConfig.silent_mode
        }
    };
}

async function updateBotConfig(newConf) {
    if (!newConf) return getBotStatus();

    if (typeof newConf.bot_username === 'string') botConfig.bot_username = newConf.bot_username.trim();
    if (typeof newConf.oauth_token === 'string' && newConf.oauth_token.trim().length > 0) {
        botConfig.oauth_token = newConf.oauth_token.trim();
    }
    if (typeof newConf.channel === 'string') botConfig.channel = newConf.channel.trim().replace(/^#/, '');
    if (typeof newConf.enabled === 'boolean') botConfig.enabled = newConf.enabled;
    if (typeof newConf.timer_enabled === 'boolean') {
        botConfig.timer_enabled = newConf.timer_enabled;
        if (botConfig.timer_enabled && status === 'connected') startTimer();
        else stopTimer();
    }
    if (newConf.timer_minutes !== undefined) {
        botConfig.timer_minutes = Math.max(5, parseInt(newConf.timer_minutes, 10) || 60);
        if (botConfig.timer_enabled && status === 'connected') startTimer();
    }
    if (typeof newConf.silent_mode === 'boolean') {
        botConfig.silent_mode = newConf.silent_mode;
    }

    if (saveSettingsCallback) {
        saveSettingsCallback({ twitch_bot: botConfig });
    }

    return getBotStatus();
}

/**
 * Simulación de comando de chat para pruebas desde Dashboard sin tocar Twitch IRC
 */
async function simulateChatMessage(senderName = 'capiluisxavihdx', messageText = '', isMod = true) {
    const cleanSender = (senderName || 'capiluisxavihdx').trim().replace(/^@/, '');
    const cleanLogin = cleanSender.toLowerCase();
    const tags = {
        username: cleanLogin,
        'display-name': cleanSender,
        'user-id': 'sim_' + cleanLogin,
        mod: isMod,
        badges: isMod ? { moderator: '1' } : {}
    };

    if (dbRef) {
        try {
            const u = await dbRef.getUser(cleanLogin);
            if (u && u.twitch_id) tags['user-id'] = u.twitch_id;
        } catch (_) { }
    }

    const channel = formatChannelName(botConfig.channel);
    await handleChatMessage(channel, tags, messageText, false);
    return {
        sender: cleanSender,
        message: messageText,
        silent_mode: !!botConfig.silent_mode,
        recentResponses: getRecentBotMessages().slice(-3)
    };
}

module.exports = {
    initTwitchBot,
    getBotStatus,
    updateBotConfig,
    updateCmdResponse,
    connectBot,
    disconnectBot,
    sendChat,
    runTimerTick,
    buildAnnouncementMessage,
    simulateChatMessage,
    getRecentBotMessages,
    handleChatMessage,
    // Stream status & StreamElements live detection
    getStreamStatus,
    setStreamLive,
    updateStreamConfig,
    simulateStreamOnline,
    // StreamElements-style custom commands
    loadCustomCommandsCache,
    findCustomCommand,
    getCustomCommandsList,
    saveCustomCommandCached,
    deleteCustomCommandCached
};
