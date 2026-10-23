/**
 * YoCapi Birthday System — Bot de Twitch Integrado (tmi.js)
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
    timer_enabled: true,
    timer_minutes: 60
};

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
let appUrlRef = 'http://localhost:3001';
let saveSettingsCallback = null;

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

async function sendChat(message) {
    if (!client || status !== 'connected') {
        throw new Error('El bot de Twitch no está conectado al chat');
    }
    const ch = formatChannelName(botConfig.channel);
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
                const lastCelebrated = parseInt(u.last_celebrated_year, 10) || 0;
                const alreadyCelebrated = lastCelebrated >= bStatus.celebrationYear;

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
        if (todayBirthdays.length > 0) {
            const list = todayBirthdays.map(b => `@${b.name}`).join(', ');
            return `🎂 ¡ALERTA DE FIESTA EN DIRECTO! 🎉 Hoy cumple años ${list} 🥳 ¡Llenen el chat de amor, mañanitas y recuérdenle entrar a lanzar su alerta con música en pantalla! 👉 ${appUrlRef} 👑✨`;
        }

        // 2. Prioridad: Cumpleaños en Período de Gracia (que aún no han lanzado)
        if (graceBirthdays.length > 0) {
            const list = graceBirthdays.map(b => `@${b.name}`).join(', ');
            return `🎈 ¡Tiempo extra de fiesta! ${list} aún está en período de gracia. ¡Entra a detonar tu alerta festiva en directo antes de que se termine tu plazo! 👉 ${appUrlRef} 🍰✨`;
        }

        // 3. Prioridad: Cumpleaños muy cercanos (1 a 3 días)
        if (upcomingVerySoon.length > 0) {
            upcomingVerySoon.sort((a, b) => a.days - b.days);
            const list = upcomingVerySoon.map(u => {
                const when = u.days === 1 ? '¡MAÑANA!' : `en ${u.days} días (${u.day} de ${u.month})`;
                return `@${u.name} (${when})`;
            }).join(' · ');
            return `⏳ ¡SE ACERCA FIESTA EN STREAM! ${list} 🎂 ¡Vayan alistando los confetis y emotes para felicitarles en directo! 🎉🥳`;
        }

        // 4. Mensajes rotativos de invitación a la comunidad (más dinámicos y divertidos)
        const communityInvites = [
            `✨ ¿Cumples años pronto? ¡Regístrate gratis para que YoCapi y el chat te festejen en vivo con tu música y alerta favorita en pantalla! 👉 ${appUrlRef} 🎂🎈`,
            `👑 ¡Que no pase tu cumple sin fiestón! Anota tu fecha gratis en el sistema de YoCapi y el día de tu cumple activa tu propia tarjeta con sonido en vivo 👉 ${appUrlRef} 🎉🍰`,
            `🎈 ¿Sabías que tenemos sistema de cumpleaños en vivo? Regístrate gratis para que el bot te recuerde y celebres tu día especial junto a toda la comunidad 👉 ${appUrlRef} 🎂✨`
        ];
        return communityInvites[Math.floor(Math.random() * communityInvites.length)];
    } catch (e) {
        console.error('[TwitchBot] Error construyendo recordatorio:', e);
        return null;
    }
}

async function runTimerTick() {
    if (!botConfig.timer_enabled || status !== 'connected') return;
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
    if (!text.startsWith('!')) return;

    // 1. DEDUPLICACIÓN DE MENSAJES (Evita que el mismo mensaje se procese dos veces)
    if (tags && tags.id && isDuplicateMessage(tags.id)) {
        return;
    }

    const parts = text.split(/\s+/);
    const command = parts[0].toLowerCase();
    const arg = (parts[1] || '').trim().replace(/^@/, '');
    const sender = tags['display-name'] || tags.username || 'amigo';

    // 2. COOLDOWN ANTI-SPAM (Evita que el mismo usuario dispare el mismo comando repetidamente en < 3s)
    if (['!cumple', '!micumple', '!proximos', '!cumplemes', '!regcumple', '!felicitar', '!cumpleinfo', '!ayudacumple'].includes(command)) {
        if (isCommandRateLimited(sender, command)) {
            return;
        }
    }

    // ─── COMANDO 1: !cumple [usuario] o !micumple ─────────────────────────────
    if (command === '!cumple' || command === '!micumple') {
        const isSelf = !arg || arg.toLowerCase() === sender.toLowerCase();
        const targetLogin = (arg || sender).toLowerCase().replace(/[^a-z0-9_]/g, '');

        if (!dbRef || !getBirthdayStatusRef) return;
        const user = await dbRef.getUser(targetLogin);

        if (!user || !user.birth_month || !user.birth_day || user.birthday_unlocked) {
            if (isSelf) {
                return sendChat(`⚠️ @${sender}, ¡todavía no estás en la lista VIP de cumpleañeros! 🎂 Regístrate gratis y asegura tu rolón con confeti en pantalla en tu día especial 👉 ${appUrlRef} ✨`);
            } else {
                return sendChat(`👀 Oye @${sender}, @${arg} todavía no se anota en el libro de cumpleaños. ¡Pásale el link para que no se quede sin pastel ni fiesta en vivo! 👉 ${appUrlRef} 🎈`);
            }
        }

        const bStatus = getBirthdayStatusRef(user.birth_month, user.birth_day);
        const monthText = MONTH_NAMES[user.birth_month] || user.birth_month;
        const displayName = user.display_name || user.username;

        if (bStatus.canCelebrate) {
            const lastCelebrated = parseInt(user.last_celebrated_year, 10) || 0;
            const alreadyCelebrated = lastCelebrated >= bStatus.celebrationYear;

            if (bStatus.isToday) {
                if (isSelf) {
                    if (alreadyCelebrated) {
                        return sendChat(`👑 ¡Feliz cumpleaños @${displayName}! 🥳 Ya reventaste el stream con tu alerta en directo. ¡Esperamos que estés disfrutando tu día al máximo en el canal de YoCapi! 🎂✨`);
                    } else {
                        return sendChat(`🚨 ¡PONGAN MÚSICA Y SAQUEN LOS REGALOS! 🎂👑 ¡HOY ES TU DÍA @${displayName}! 🎉🎈 El chat se viste de gala. ¡Entra a lanzar tu alerta en directo con tu canción favorita AHORA MISMO! 👉 ${appUrlRef} 🥳✨`);
                    }
                } else {
                    if (alreadyCelebrated) {
                        return sendChat(`👑 ¡Hoy es el cumpleaños de @${displayName} y ya celebró en directo con su rola y alerta! 🎂🥳 ¡Llenen el chat de felicitaciones y amor! 🎊✨`);
                    } else {
                        return sendChat(`🎂 ¡ATENCIÓN CHAT! ¡HOY es el cumpleaños de @${displayName}! 🎉 Dile que entre a lanzar su alerta en directo con música y confeti en pantalla 👉 ${appUrlRef} 👑✨`);
                    }
                }
            } else {
                // Período de gracia
                const daysLeft = bStatus.daysRemainingInGrace;
                const daysLeftText = daysLeft === 1 ? 'solo 1 día' : `${daysLeft} días`;

                if (isSelf) {
                    if (alreadyCelebrated) {
                        return sendChat(`🥳 ¡Cumpleaños celebrado @${displayName}! Ya disfrutaste tu alerta festiva este año. ¡A esperar la próxima vuelta al sol! 🎈🎂`);
                    } else {
                        return sendChat(`⏰ ¡Ojo @${displayName}! Tu cumple fue el ${user.birth_day} de ${monthText} y aún estás en tu semana de gracia (${daysLeftText} restantes). ¡No dejes que se te enfríe el pastel y lanza tu alerta en pantalla! 👉 ${appUrlRef} 🍰🎈`);
                    }
                } else {
                    if (alreadyCelebrated) {
                        return sendChat(`🎈 @${displayName} cumplió años el ${user.birth_day} de ${monthText} y ya celebró en vivo este año. 🥳 ¡Déjale sus felicitaciones en el chat!`);
                    } else {
                        return sendChat(`🎈 @${displayName} cumplió años el ${user.birth_day} de ${monthText} y aún está en período de gracia (${daysLeftText} restantes). ¡Dile que entre a activar su alerta en stream! 👉 ${appUrlRef}`);
                    }
                }
            }
        }

        const days = bStatus.daysUntilBirthday;
        if (days === 1) {
            if (isSelf) {
                return sendChat(`😱 ¡DETENGAN TODO! ¡MAÑANA (${user.birth_day} de ${monthText}) es tu cumpleaños @${displayName}! 🎂🕯️ ¡Prepárate para reventar el stream mañana! 👉 ${appUrlRef} 🎉`);
            } else {
                return sendChat(`😱 ¡DETENGAN TODO! ¡MAÑANA (${user.birth_day} de ${monthText}) es el cumpleaños de @${displayName}! 🎂🕯️ ¡Vayan afinando las mañanitas y preparando los emotes para mañana en stream! 🎉✨`);
            }
        } else if (days <= 7) {
            if (isSelf) {
                return sendChat(`⏳ ¡Modo fiesta activándose! @${displayName}, faltan solo ${days} días para tu cumpleaños (${user.birth_day} de ${monthText}). 🎈 ¡Se viene fiestón en el stream de YoCapi! 🎂🥳`);
            } else {
                return sendChat(`⏳ ¡Cuenta regresiva activada! Faltan solo ${days} días para festejar a @${displayName} (${user.birth_day} de ${monthText}). 🎈 ¡Anoten la fecha en el calendario chat! 🎂🎉`);
            }
        } else {
            if (isSelf) {
                return sendChat(`🗓️ @${displayName}, tu fecha dorada en el calendario es el ${user.birth_day} de ${monthText} (faltan ${days} días). 🎂 ¡Ya tenemos la fiesta y el confeti listos en el stream de YoCapi! ✨🎈`);
            } else {
                return sendChat(`🗓️ El cumpleaños de @${displayName} está anotado para el ${user.birth_day} de ${monthText} (faltan ${days} días). 🎂 ¡A marcar la fecha en el calendario para llenarle el chat de amor! 🎈✨`);
            }
        }
    }

    // ─── COMANDO 2: !proximos ─────────────────────────────────────────────────
    if (command === '!proximos') {
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
            return sendChat(`🎈 El calendario está tranquilo por los próximos 15 días... ¿o será que aún no te anotas? Registra tu fecha gratis aquí 👉 ${appUrlRef} 🎂✨`);
        }

        upcoming.sort((a, b) => a.days - b.days);
        const list = upcoming.slice(0, 5).map(u => `@${u.name} (${u.day} de ${u.month}, en ${u.days} días)`).join(' · ');
        return sendChat(`📅 Próximas velitas por soplar (15 días): ${list} 🎂🥳 ¡Preparen esos regalitos y emotes de fiesta en stream!`);
    }

    // ─── COMANDO 3: !cumplemes ────────────────────────────────────────────────
    if (command === '!cumplemes') {
        if (!dbRef) return;
        const currentMonth = new Date().getMonth() + 1;
        const users = await dbRef.getAllUsers();
        const monthCelebrants = users.filter(u => u.birth_month === currentMonth && !u.birthday_unlocked);

        const currentMonthName = MONTH_NAMES[currentMonth] || 'este mes';
        if (monthCelebrants.length === 0) {
            return sendChat(`🗓️ Nadie registrado para ${currentMonthName}... ¡Sé la leyenda que inaugure los festejos de este mes entrando a: ${appUrlRef}! 🎈🎂`);
        }

        monthCelebrants.sort((a, b) => a.birth_day - b.birth_day);
        const list = monthCelebrants.slice(0, 7).map(u => `@${u.display_name || u.username} (día ${u.birth_day})`).join(' · ');
        return sendChat(`🗓️ Cartelera festiva de ${currentMonthName} (${monthCelebrants.length} cumpleañeros): ${list} 🎂🎈 ¡Este mes hay fiesta asegurada en el canal de YoCapi!`);
    }

    // ─── COMANDO 4: !regcumple ────────────────────────────────────────────────
    if (command === '!regcumple') {
        const msg = customCmdResponses.regcumple
            ? customCmdResponses.regcumple.replace(/\{URL\}/gi, appUrlRef)
            : `🎂 ¿Quieres que el stream de YoCapi explote con tu música y alerta personalizada en pantalla el día de tu cumpleaños? ¡Regístrate 100% gratis aquí! 👉 ${appUrlRef} 🎈✨`;
        return sendChat(msg);
    }

    // ─── COMANDO 5: !felicitar ────────────────────────────────────────────────
    if (command === '!felicitar') {
        const msg = customCmdResponses.felicitar
            ? customCmdResponses.felicitar.replace(/\{URL\}/gi, appUrlRef)
            : `💌 ¿Alguien cumple años hoy? ¡Mándale una felicitación en directo que saldrá en la pantalla del stream con audio, confeti y tarjeta festiva! 👉 ${appUrlRef} 🎉🥳`;
        return sendChat(msg);
    }

    // ─── COMANDO 6: !cumpleinfo o !ayudacumple ────────────────────────────────
    if (command === '!cumpleinfo' || command === '!ayudacumple') {
        return sendChat(`🎉 Comandos de Fiesta: !cumple (tu fecha o !cumple @amigo) · !proximos (en 15 días) · !cumplemes (del mes) · !regcumple (anótate gratis) · !felicitar (alerta en directo) 🎂✨`);
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
            } catch (_) {}
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
            channels: [ channel ]
        });

        client.on('message', handleChatMessage);

        client.on('connected', (addr, port) => {
            status = 'connected';
            lastError = null;
            connectedAt = new Date().toISOString();
            console.log(`[TwitchBot] ✅ Conectado como ${username} al canal ${channel} (${addr}:${port})`);
            startTimer();
        });

        client.on('disconnected', (reason) => {
            status = 'disconnected';
            console.log(`[TwitchBot] Desconectado: ${reason}`);
            stopTimer();
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
    if (client) {
        try {
            await client.disconnect();
        } catch (_) {}
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

    if (options.initialConfig) {
        botConfig = { ...botConfig, ...options.initialConfig };
    }

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
            timer_minutes: botConfig.timer_minutes || 60
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

    if (saveSettingsCallback) {
        saveSettingsCallback({ twitch_bot: botConfig });
    }

    return getBotStatus();
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
    buildAnnouncementMessage
};
