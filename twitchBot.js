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
    timer_minutes: 20
};

let dbRef = null;
let getBirthdayStatusRef = null;
let appUrlRef = 'http://localhost:3001';
let saveSettingsCallback = null;

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
            return `🎂 ¡ATENCIÓN CHAT! ¡Hoy es el cumpleaños de ${list}! 🥳 ¡Mándale mucho amor y dile que entre a lanzar su alerta en directo con confeti y música! 👉 ${appUrlRef} 🎉`;
        }

        // 2. Prioridad: Cumpleaños en Período de Gracia (que aún no han lanzado)
        if (graceBirthdays.length > 0) {
            const list = graceBirthdays.map(b => `@${b.name}`).join(', ');
            return `🎈 ¡Aviso de Cumpleaños! ${list} está en período de gracia. ¡Entra a lanzar tu alerta en directo antes de que expire tu plazo! 👉 ${appUrlRef} ✨`;
        }

        // 3. Prioridad: Cumpleaños muy cercanos (1 a 3 días)
        if (upcomingVerySoon.length > 0) {
            upcomingVerySoon.sort((a, b) => a.days - b.days);
            const list = upcomingVerySoon.map(u => {
                const when = u.days === 1 ? '¡MAÑANA!' : `en ${u.days} días (${u.day} de ${u.month})`;
                return `@${u.name} (${when})`;
            }).join(' · ');
            return `🎈 ¡SE ACERCA UN CUMPLEAÑOS! ${list} 🎂 ¡Vayan preparando sus felicitaciones para el stream! 🎉`;
        }

        // 4. Mensaje invitacional de la comunidad
        return `✨ ¿Cumples años pronto? ¡Regístrate gratis para que el stream de yocapi_pr te festeje en vivo con tu música y alerta favorita en pantalla! 👉 ${appUrlRef} 🎂🎈`;
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
    const minutes = Math.max(5, parseInt(botConfig.timer_minutes, 10) || 20);
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

    const parts = text.split(/\s+/);
    const command = parts[0].toLowerCase();
    const arg = (parts[1] || '').trim().replace(/^@/, '');
    const sender = tags['display-name'] || tags.username || 'amigo';

    // 1. COMANDO DINÁMICO: !cumple [usuario]
    if (command === '!cumple' || command === '!micumple') {
        const isSelf = !arg || arg.toLowerCase() === sender.toLowerCase();
        const targetLogin = (arg || sender).toLowerCase().replace(/[^a-z0-9_]/g, '');

        if (!dbRef || !getBirthdayStatusRef) return;
        const user = await dbRef.getUser(targetLogin);

        if (!user || !user.birth_month || !user.birth_day || user.birthday_unlocked) {
            if (isSelf) {
                return sendChat(`⚠️ @${sender}, aún no tienes registrado tu cumpleaños. ¡Hazlo gratis para festejarte con tu alerta en directo! 👉 ${appUrlRef} 🎂`);
            } else {
                return sendChat(`⚠️ @${sender}, el usuario @${arg} aún no tiene su cumpleaños registrado en la plataforma. ¡Dile que se registre en ${appUrlRef}! 🎈`);
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
                        return sendChat(`🥳 ¡Feliz cumpleaños @${displayName}! 🎊 Ya lanzaste tu alerta especial hoy. ¡Esperamos que estés disfrutando tu día en el stream de yocapi_pr! 🎂✨`);
                    } else {
                        return sendChat(`🎂 ¡HOY ES TU CUMPLEAÑOS @${displayName}! 🎉 ¡Entra y lanza tu alerta con sonido y confeti en directo ahora mismo! 👉 ${appUrlRef}`);
                    }
                } else {
                    if (alreadyCelebrated) {
                        return sendChat(`🎂 ¡Hoy es el cumpleaños de @${displayName} y ya celebró en directo con su alerta! 🥳 ¡Déjale mucho amor en el chat! 🎊✨`);
                    } else {
                        return sendChat(`🎂 ¡ATENCIÓN CHAT! ¡HOY es el cumpleaños de @${displayName}! 🎉 Dile que entre a lanzar su alerta en directo con música y confeti 👉 ${appUrlRef}`);
                    }
                }
            } else {
                // Período de gracia
                const daysLeft = bStatus.daysRemainingInGrace;
                const daysLeftText = daysLeft === 1 ? 'solo 1 día' : `${daysLeft} días`;

                if (isSelf) {
                    if (alreadyCelebrated) {
                        return sendChat(`🥳 ¡Feliz cumple tardío @${displayName}! Ya celebraste tu alerta este año. ¡Hasta tu próximo cumpleaños! 🎈🎂`);
                    } else {
                        return sendChat(`🎈 @${displayName}, tu cumpleaños fue el ${user.birth_day} de ${monthText} y ¡aún estás en período de gracia! Te quedan ${daysLeftText} para lanzar tu alerta en directo. ¡Aprovéchalo aquí! 👉 ${appUrlRef}`);
                    }
                } else {
                    if (alreadyCelebrated) {
                        return sendChat(`🎈 @${displayName} cumplió años el ${user.birth_day} de ${monthText} y ya celebró en directo este año. 🥳 ¡Déjale sus felicitaciones en el chat!`);
                    } else {
                        return sendChat(`🎈 @${displayName} cumplió años el ${user.birth_day} de ${monthText} y aún está en período de gracia (${daysLeftText} restantes). ¡Dile que entre a lanzar su alerta! 👉 ${appUrlRef}`);
                    }
                }
            }
        }

        const days = bStatus.daysUntilBirthday;
        if (days === 1) {
            if (isSelf) {
                return sendChat(`🎉 @${displayName}, ¡MAÑANA (${user.birth_day} de ${monthText}) es tu cumpleaños! 🎂 ¡Prepárate para lanzar tu alerta en stream mañana! 👉 ${appUrlRef}`);
            } else {
                return sendChat(`🎉 ¡MAÑANA (${user.birth_day} de ${monthText}) es el cumpleaños de @${displayName}! 🎂 ¡No se olviden de felicitarle en stream!`);
            }
        } else if (days <= 7) {
            if (isSelf) {
                return sendChat(`🗓️ @${displayName}, ¡ya casi! Faltan solo ${days} días para tu cumpleaños (${user.birth_day} de ${monthText}). ¡Se viene la fiesta en stream! 🥳`);
            } else {
                return sendChat(`🗓️ ¡El cumpleaños de @${displayName} es muy pronto! Faltan solo ${days} días (${user.birth_day} de ${monthText}). ¡Anoten la fecha en el chat! 🎂`);
            }
        } else {
            if (isSelf) {
                return sendChat(`🗓️ @${displayName}, tu cumpleaños está registrado para el ${user.birth_day} de ${monthText} (faltan ${days} días). ¡Te esperamos en stream para festejarte! 🎂✨`);
            } else {
                return sendChat(`🗓️ El cumpleaños de @${displayName} es el ${user.birth_day} de ${monthText} (faltan ${days} días). ¡Anoten la fecha para felicitarle! 🎂✨`);
            }
        }
    }

    // 2. COMANDO: !proximos
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
            return sendChat(`🎈 No hay cumpleaños en los próximos 15 días. ¡Regístrate gratis para festejarte! 👉 ${appUrlRef}`);
        }

        upcoming.sort((a, b) => a.days - b.days);
        const list = upcoming.slice(0, 5).map(u => `@${u.name} (${u.day} de ${u.month}, en ${u.days} días)`).join(' · ');
        return sendChat(`📅 Próximos cumpleaños (15 días): ${list} 🎂 ¡Festejemos en stream!`);
    }

    // 3. COMANDO: !cumplemes
    if (command === '!cumplemes') {
        if (!dbRef) return;
        const currentMonth = new Date().getMonth() + 1;
        const users = await dbRef.getAllUsers();
        const monthCelebrants = users.filter(u => u.birth_month === currentMonth && !u.birthday_unlocked);

        const currentMonthName = MONTH_NAMES[currentMonth] || 'este mes';
        if (monthCelebrants.length === 0) {
            return sendChat(`🗓️ Aún no hay nadie registrado para ${currentMonthName}. ¡Sé el primero entrando a: ${appUrlRef}! 🎈`);
        }

        monthCelebrants.sort((a, b) => a.birth_day - b.birth_day);
        const list = monthCelebrants.slice(0, 7).map(u => `@${u.display_name || u.username} (día ${u.birth_day})`).join(' · ');
        return sendChat(`🗓️ Cumpleaños de ${currentMonthName} (${monthCelebrants.length}): ${list} 🎂 ¡No te los pierdas!`);
    }

    // 4. COMANDO: !regcumple
    if (command === '!regcumple') {
        return sendChat(`🎂 ¡Registra tu cumpleaños para que te festejemos con alerta en directo en tu día especial! Entra gratis aquí 👉 ${appUrlRef} 🎈`);
    }

    // 5. COMANDO: !felicitar
    if (command === '!felicitar') {
        return sendChat(`🎊 ¡Mándale una felicitación en directo al cumpleañero con música y tarjetas en pantalla entrando a: ${appUrlRef} 🎉`);
    }

    // 6. COMANDO: !cumpleinfo o !ayudacumple
    if (command === '!cumpleinfo' || command === '!ayudacumple') {
        return sendChat(`🎂 Comandos de Cumpleaños: !cumple (consulta tu fecha o la de un amigo !cumple @usuario) · !proximos (en 15 días) · !cumplemes (este mes) · !regcumple (registro) · !felicitar (en vivo)`);
    }
}

// ─── CONEXIÓN / DESCONEXIÓN DEL BOT ─────────────────────────────────────────
async function connectBot() {
    if (status === 'connected') return { success: true, message: 'El bot ya está conectado' };

    if (!botConfig.bot_username || !botConfig.oauth_token || !botConfig.channel) {
        status = 'error';
        lastError = 'Faltan credenciales del bot (Nick, OAuth Token o Canal)';
        return { success: false, error: lastError };
    }

    status = 'connecting';
    lastError = null;

    try {
        if (client) {
            try { await client.disconnect(); } catch (_) {}
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
            timer_minutes: botConfig.timer_minutes || 20
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
        botConfig.timer_minutes = Math.max(5, parseInt(newConf.timer_minutes, 10) || 20);
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
    connectBot,
    disconnectBot,
    sendChat,
    runTimerTick,
    buildAnnouncementMessage
};
