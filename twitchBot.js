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
let broadcastToOverlayRef = null;
let getAppSettingsRef = null;
let acquireMusicLockRef = null;
let getMusicLockStatusRef = null;
let pausedAlertsQueueRef = null;
let pinataManagerRef = null;

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

// ─── VERIFICADOR DE PERMISOS: STREAMER (@yocapi_pr) O MODERADOR DE TWITCH ──────
function isStreamerOrMod(tags, channel) {
    if (!tags) return false;
    const username = (tags.username || '').toLowerCase().trim();
    const cleanChannel = (channel || botConfig.channel || 'yocapi_pr').replace(/^#/, '').toLowerCase().trim();

    // 1. Es la streamer oficial (dueña del canal o yocapi_pr)
    if (username === cleanChannel || username === 'yocapi_pr') {
        return true;
    }

    // 2. Mod flag nativo de Twitch
    if (tags.mod === true || tags.mod === '1' || tags.mod === 1) {
        return true;
    }

    // 3. Badges del usuario (broadcaster o moderator)
    if (tags.badges) {
        if (tags.badges.broadcaster || tags.badges.moderator) return true;
        if (typeof tags.badges === 'string' && (tags.badges.includes('broadcaster') || tags.badges.includes('moderator'))) {
            return true;
        }
    }

    // 4. Badges raw de IRC
    if (tags['badges-raw'] && typeof tags['badges-raw'] === 'string') {
        if (tags['badges-raw'].includes('broadcaster') || tags['badges-raw'].includes('moderator')) {
            return true;
        }
    }

    return false;
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
            `✨ ¿Cumples años pronto? ¡Regístrate gratis para que Yocapi y el chat te festejen en vivo con tu música y alerta favorita en pantalla! 👉 ${appUrlRef} 🎂🎈`,
            `👑 ¡Que no pase tu cumple sin fiestón! Anota tu fecha gratis en el sistema de Yocapi y el día de tu cumple activa tu propia tarjeta con sonido en vivo 👉 ${appUrlRef} 🎉🍰`,
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

    // ─── EASTER EGG: "bang" exclusivo de capiluisxavi ─────────────────────────
    // Solo para el usuario capiluisxavi, sin respuesta en chat y sin visual en overlay.
    const senderLogin = (tags.username || '').toLowerCase();
    if (text.toLowerCase() === 'bang' && senderLogin === 'capiluisxavi') {
        if (broadcastToOverlayRef) {
            broadcastToOverlayRef({ type: 'play_audio', sound: 'bang.mp3' });
        }
        return; // Silencio total: no responde en chat
    }

    // ─── DETECCIÓN PASIVA DE CAMBIO DE NOMBRE DE TWITCH ───────────────────────
    // Twitch envía `user-id` en cada mensaje — es permanente aunque el nombre cambie.
    // Si el user-id está en la BD con otro username, renombramos automáticamente en segundo plano.
    if (dbRef && tags['user-id'] && senderLogin) {
        (async () => {
            try {
                const twitchId = String(tags['user-id']).trim();
                const registeredByLogin = await dbRef.getUser(senderLogin);

                if (registeredByLogin) {
                    // El usuario ya existe con su nombre actual. Guardar su twitch_id si aún no lo tiene.
                    if (!registeredByLogin.twitch_id) {
                        registeredByLogin.twitch_id = twitchId;
                        await dbRef.saveUser(registeredByLogin);
                        console.log(`[TwitchBot] ✅ twitch_id guardado para @${senderLogin} → ${twitchId}`);
                    }
                } else if (dbRef.getUserByTwitchId) {
                    // El nombre actual no está en la BD, pero quizá cambió el username.
                    // Buscar por twitch_id permanente.
                    const oldRecord = await dbRef.getUserByTwitchId(twitchId);
                    if (oldRecord && oldRecord.username !== senderLogin) {
                        console.log(`[TwitchBot] 🔄 Cambio de nombre detectado: @${oldRecord.username} → @${senderLogin}. Migrando...`);
                        await dbRef.migrateUser(oldRecord.username, senderLogin, {
                            display_name: tags['display-name'] || senderLogin,
                            twitch_id: twitchId
                        });
                        console.log(`[TwitchBot] ✅ Migración completada: @${oldRecord.username} → @${senderLogin}`);
                    }
                }
            } catch (e) {
                // Nunca interrumpir el flujo principal por un error de sincronización de nombre
                console.warn('[TwitchBot] Error en detección de cambio de nombre:', e.message);
            }
        })();
    }

    if (!text.startsWith('!')) return;

    // 1. DEDUPLICACIÓN DE MENSAJES (Evita que el mismo mensaje se procese dos veces)
    if (tags && tags.id && isDuplicateMessage(tags.id)) {
        return;
    }

    const parts = text.split(/\s+/);
    const command = parts[0].toLowerCase();
    const arg = (parts[1] || '').trim().replace(/^@/, '');
    const sender = tags['display-name'] || tags.username || 'amigo';

    // ─── MINIJUEGO: GOLPES A LA PIÑATA DE CAPIBARA (!dale, !pegar, !hit, etc.) ─
    const PINATA_HIT_COMMANDS = ['!dale', '!pegar', '!hit', '!palo', '!golpe', '!batear'];
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

    // 2. COOLDOWN ANTI-SPAM (Evita que el mismo usuario dispare el mismo comando repetidamente en < 3s)
    const KNOWN_COMMANDS = [
        '!registro', '!regcumple', '!registrarme',
        '!cumple', '!micumple', '!proximos', '!cumplemes',
        '!cumpleinfo', '!ayudacumple', '!hoyesmicumple', '!hoyesmicum', '!mialerta', '!lanzarmicumple',
        '!felicidades', '!felicidades1', '!felicidades2', '!felicidades3',
        '!felicitar', '!felicitar1', '!felicitar2', '!felicitar3',
        '!piñata', '!piñatastop',
        '!hbcambio', '!hbfrase', '!micumplefrase',
        '!hbsonido', '!cambiarsonido', '!misonido',
        '!hbalertas', '!cumplealertas', '!alertascumple',
        '!hbfelicitar', '!hbfelicitaciones', '!felicitaciones',
        '!hbgrabacion', '!hbmodovideo', '!hbcine', '!hbpausa',
        '!hbmod', '!hbadmin', '!hbestado'
    ];
    if (KNOWN_COMMANDS.includes(command)) {
        if (isCommandRateLimited(sender, command)) {
            return;
        }
    }

    // ─── COMANDO 0: !registro DD-MM [usuario] (Registrarse o registrar a un compañero) ─────────
    if (command === '!registro' || command === '!registrarme') {
        if (!dbRef) return;

        // Detectar si la fecha está en parts[1] o parts[2], y si hay un usuario objetivo
        const arg1 = (parts[1] || '').trim();
        const arg2 = (parts[2] || '').trim();

        const match1 = arg1.match(/^(\d{1,2})[-\/](\d{1,2})$/);
        const match2 = arg2.match(/^(\d{1,2})[-\/](\d{1,2})$/);

        let match = null;
        let targetPart = '';

        if (match1) {
            match = match1;
            targetPart = arg2;
        } else if (match2) {
            match = match2;
            targetPart = arg1;
        }

        if (!match) {
            return sendChat(`🎂 @${sender}, para registrar tu cumpleaños escribe: !registro DD-MM ` +
                `(Ej: !registro 11-06 para el 11 de junio). Para registrar a un compañero: !registro DD-MM usuario (Ej: !registro 11-06 capiluisxavi) 🎉`);
        }

        const regDay   = parseInt(match[1], 10);
        const regMonth = parseInt(match[2], 10);

        if (regMonth < 1 || regMonth > 12) {
            return sendChat(`⚠️ @${sender}, el mes debe ser del 1 al 12. Ej: !registro 11-06 = 11 de Junio 📅`);
        }
        if (regDay < 1 || regDay > 31) {
            return sendChat(`⚠️ @${sender}, el día debe ser del 1 al 31. Ej: !registro 11-06 = 11 de Junio 📅`);
        }

        const monthName      = MONTH_NAMES[regMonth] || regMonth;
        const senderLoginReg = (tags.username || sender).toLowerCase().replace(/[^a-z0-9_]/g, '');

        const cleanTarget   = targetPart.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]/g, '');
        const isSelf        = !cleanTarget || cleanTarget === senderLoginReg;
        const targetLogin   = isSelf ? senderLoginReg : cleanTarget;
        const targetDisplay = isSelf ? (tags['display-name'] || senderLoginReg) : targetPart.replace(/^@/, '');
        const twitchId      = isSelf && tags['user-id'] ? String(tags['user-id']).trim() : '';

        try {
            const existing = await dbRef.getUser(targetLogin);

            if (existing) {
                if (existing.birthday_unlocked && isSelf) {
                    return sendChat(`⚠️ @${sender}, tu cuenta está desbloqueada por el dashboard — ` +
                        `actualiza tu fecha desde ${appUrlRef} 🎂`);
                }

                // Comprobar bloqueo de 1 año para cambio de fecha
                const lockedSince = existing.created_at || existing.registered_at || null;
                const isLocked = lockedSince
                    ? (Date.now() - new Date(lockedSince).getTime()) < 365 * 24 * 3600 * 1000
                    : false;

                if (isLocked && (existing.birth_month !== regMonth || existing.birth_day !== regDay)) {
                    if (isSelf) {
                        return sendChat(`🔒 @${sender}, tu fecha ya está registrada como el ` +
                            `${existing.birth_day} de ${MONTH_NAMES[existing.birth_month] || existing.birth_month}. ` +
                            `Solo puedes cambiarla una vez al año. Si hay un error, pide ayuda a la streamer 🎂`);
                    } else {
                        return sendChat(`🔒 @${sender}, @${targetLogin} ya tiene fecha registrada como el ` +
                            `${existing.birth_day} de ${MONTH_NAMES[existing.birth_month] || existing.birth_month}. ` +
                            `Solo se puede cambiar una vez al año 🎂`);
                    }
                }

                // Misma fecha — confirmar que ya está registrado
                if (existing.birth_month === regMonth && existing.birth_day === regDay) {
                    if (isSelf) {
                        return sendChat(`✅ @${sender}, ¡ya tienes el ${regDay} de ${monthName} registrado! ` +
                            `Cuando llegue tu día escribe !hoyesmicumple para lanzar tu alerta 🎉`);
                    } else {
                        return sendChat(`✅ @${sender}, ¡@${targetLogin} ya tenía registrado el ${regDay} de ${monthName}! 🎉🎂`);
                    }
                }

                // Actualizar fecha
                existing.birth_month  = regMonth;
                existing.birth_day    = regDay;
                existing.created_at   = new Date().toISOString();
                existing.birthday_unlocked = false;
                if (twitchId && !existing.twitch_id) existing.twitch_id = twitchId;
                await dbRef.saveUser(existing);

                if (isSelf) {
                    return sendChat(`✅ @${sender}, ¡fecha de cumpleaños actualizada al ${regDay} de ${monthName}! ` +
                        `🎉 El sistema ya te tiene en el radar para tu día especial en stream 🎂✨`);
                } else {
                    return sendChat(`✅ @${sender}, ¡has actualizado la fecha de cumpleaños de @${targetLogin} al ${regDay} de ${monthName}! 🎉🎂✨`);
                }
            }

            // ── Registro NUEVO desde chat ──
            const nowIso = new Date().toISOString();
            await dbRef.saveUser({
                username:       targetLogin,
                display_name:   targetDisplay,
                pin_hash:       '',
                recovery_hash:  '',
                profile_image:  '/img/yocapi.png',
                birth_month:    regMonth,
                birth_day:      regDay,
                custom_message: '',
                selected_sound: 'HBSilbato.mp3',
                birthday_unlocked: false,
                created_at:     nowIso,
                registered_at:  nowIso,
                twitch_id:      twitchId
            });

            if (isSelf) {
                return sendChat(`🎉🎂 ¡@${sender} YA ESTÁ EN LA LISTA VIP DE CUMPLEAÑEROS! ` +
                    `Fecha guardada: ${regDay} de ${monthName} 🥳 ` +
                    `Cuando llegue tu día escribe !hoyesmicumple para lanzar tu alerta en pantalla con música 🎈`);
            } else {
                return sendChat(`🎉🎂 ¡@${sender} ha registrado a @${targetLogin} en la lista VIP de cumpleañeros para el ${regDay} de ${monthName}! 🥳🎈 ¡Gracias por festejar a la comunidad!`);
            }

        } catch (e) {
            console.error('[TwitchBot] Error en !registro:', e);
            return sendChat(`❌ @${sender}, ocurrió un error al guardar. Inténtalo de nuevo en un momento.`);
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
                        return sendChat(`👑 ¡Feliz cumpleaños @${displayName}! 🥳 Ya reventaste el stream con tu alerta en directo. ¡Esperamos que estés disfrutando tu día al máximo en el canal de Yocapi! 🎂✨`);
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
                return sendChat(`⏳ ¡Modo fiesta activándose! @${displayName}, faltan solo ${days} días para tu cumpleaños (${user.birth_day} de ${monthText}). 🎈 ¡Se viene fiestón en el stream de Yocapi! 🎂🥳`);
            } else {
                return sendChat(`⏳ ¡Cuenta regresiva activada! Faltan solo ${days} días para festejar a @${displayName} (${user.birth_day} de ${monthText}). 🎈 ¡Anoten la fecha en el calendario chat! 🎂🎉`);
            }
        } else {
            if (isSelf) {
                return sendChat(`🗓️ @${displayName}, tu fecha dorada en el calendario es el ${user.birth_day} de ${monthText} (faltan ${days} días). 🎂 ¡Ya tenemos la fiesta y el confeti listos en el stream de Yocapi! ✨🎈`);
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
        return sendChat(`🗓️ Cartelera festiva de ${currentMonthName} (${monthCelebrants.length} cumpleañeros): ${list} 🎂🎈 ¡Este mes hay fiesta asegurada en el canal de Yocapi!`);
    }

    // ─── COMANDO 4: !regcumple ────────────────────────────────────────────────
    if (command === '!regcumple') {
        const msg = customCmdResponses.regcumple
            ? customCmdResponses.regcumple.replace(/\{URL\}/gi, appUrlRef)
            : `🎂 ¿Quieres que el stream de Yocapi explote con tu música y alerta personalizada en pantalla el día de tu cumpleaños? ¡Regístrate 100% gratis aquí! 👉 ${appUrlRef} 🎈✨`;
        return sendChat(msg);
    }

    // ─── COMANDO 5: !hoyesmicumple (Lanzar la alerta del cumpleañero en directo) ───
    if (command === '!hoyesmicumple' || command === '!hoyesmicum' || command === '!mialerta' || command === '!lanzarmicumple') {
        if (!dbRef || !getBirthdayStatusRef) return;
        const appSettings = getAppSettingsRef ? getAppSettingsRef() : {};

        // 1. SEGURIDAD: ¿Alertas del cumpleañero permitidas por la streamer / mods?
        if (appSettings.birthday_alerts_enabled === false) {
            return sendChat(`🎬🤫 @${sender}, las alertas de cumpleaños en directo están temporalmente desactivadas por Yocapi (grabación o momento especial en stream). ¡No te preocupes, tu festejo no se pierde! Podrás activarlo en cuanto se reanuden 🎂✨`);
        }

        const senderLogin = sender.toLowerCase().replace(/[^a-z0-9_]/g, '');
        const user = await dbRef.getUser(senderLogin);

        if (!user || !user.birth_month || !user.birth_day || user.birthday_unlocked) {
            return sendChat(`⚠️ @${sender}, ¡aún no estás registrado en el sistema de cumpleaños! Entra gratis a anotarte para activar tu alerta en vivo 👉 ${appUrlRef} 🎂`);
        }

        const bStatus = getBirthdayStatusRef(user.birth_month, user.birth_day);
        const monthText = MONTH_NAMES[user.birth_month] || user.birth_month;
        const displayName = user.display_name || user.username;

        if (!bStatus.canCelebrate) {
            const days = bStatus.daysUntilBirthday;
            return sendChat(`🗓️ @${displayName}, tu cumpleaños registrado es el ${user.birth_day} de ${monthText} (faltan ${days} días). ¡Tu alerta con música y confeti se desbloqueará en tu día especial! 🎂✨`);
        }

        const lastCelebrated = parseInt(user.last_celebrated_year, 10) || 0;
        const alreadyCelebrated = lastCelebrated >= bStatus.celebrationYear;

        if (alreadyCelebrated) {
            return sendChat(`👑 @${displayName}, ¡ya lanzaste tu alerta de cumpleaños este año! Esperamos que hayas disfrutado tu festejo en stream. ¡Te esperamos para el próximo año! 🥳🎂`);
        }

        // Marcar celebración en la base de datos para no duplicar
        user.last_activated = new Date().toISOString();
        user.last_played_date = new Date().toISOString().split('T')[0];
        user.last_celebrated_year = bStatus.celebrationYear;
        await dbRef.saveUser(user);

        const sound = user.selected_sound || 'HBSilbato.mp3';
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
            return sendChat(`🎂 @${displayName}, ¡tu alerta fue guardada en fila! Yocapi tiene las alertas pausadas momentáneamente; saldrá en pantalla en cuanto reanude 🎈✨`);
        }

        if (broadcastToOverlayRef) {
            broadcastToOverlayRef(alertPayload);
        }

        return sendChat(`🚨🎂 ¡FIESTA TOTAL EN DIRECTO! 👑 ¡@${displayName} acaba de detonar su alerta de cumpleaños en pantalla con confeti y música! 🥳🎉 ¡Llenen el chat de felicitaciones y amor!`);
    }

    // ─── COMANDO 6: !felicidades [mensaje] o !felicidades1/2/3 ─────────────────
    const felicitationCommands = [
        '!felicidades', '!felicidades1', '!felicidades2', '!felicidades3',
        '!felicitar', '!felicitar1', '!felicitar2', '!felicitar3'
    ];

    if (felicitationCommands.includes(command)) {
        if (!dbRef || !getBirthdayStatusRef) return;
        const appSettings = getAppSettingsRef ? getAppSettingsRef() : {};

        // Si es !felicitar a secas sin mensaje y sin que haya felicitaciones activas, mostrar mensaje informativo
        if (command === '!felicitar' && !arg && !appSettings.felicitations_enabled) {
            const msg = customCmdResponses.felicitar
                ? customCmdResponses.felicitar.replace(/\{URL\}/gi, appUrlRef)
                : `💌 ¿Alguien cumple años hoy? ¡Mándale una felicitación en directo con tarjeta en pantalla entrando a: ${appUrlRef} 🎉🥳`;
            return sendChat(msg);
        }

        // 1. Verificar si las felicitaciones están permitidas por la streamer
        if (!appSettings.felicitations_enabled) {
            return sendChat(`⚠️ @${sender}, las felicitaciones en pantalla están cerradas o en pausa por Yocapi en este momento. ¡Atento a cuando las active en directo! 📺✨`);
        }

        // 2. Verificar que el que felicita esté registrado en la BD
        const senderLogin = sender.toLowerCase().replace(/[^a-z0-9_]/g, '');
        const senderUser = await dbRef.getUser(senderLogin);

        if (!senderUser || !senderUser.birth_month || !senderUser.birth_day || senderUser.birthday_unlocked) {
            return sendChat(`⚠️ @${sender}, para enviar felicitaciones con tu tarjeta a la pantalla debes registrar tu cumpleaños gratis primero 👉 ${appUrlRef} 🎈`);
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
                return sendChat(`🎈 @${sender}, en este momento no hay cumpleañeros activos en stream para felicitar. Usa !proximos para ver los siguientes en el calendario 🎂`);
            }

            const todayOne = activeCelebrants.find(c => c.status.isToday) || activeCelebrants[0];
            targetUser = todayOne.user;
            customMsg = parts.slice(1).join(' ').trim();
        }

        // 4. Evitar auto-felicitación
        if (targetUser.username.toLowerCase() === senderLogin) {
            return sendChat(`😅 @${sender}, ¡no puedes auto-felicitarte! Para lanzar tu propia alerta en pantalla usa el comando !hoyesmicumple 🎂👑`);
        }

        // 5. Determinar el sonido y gestionar el mutex de música
        let chosenSound = 'HBSilbato.mp3';
        let soundLabel = '🎺 Silbato Festivo';

        if (command === '!felicidades1' || command === '!felicitar1') {
            chosenSound = 'MBMusica.mp3';
            soundLabel = '🎵 Música de Fiesta';
        } else if (command === '!felicidades2' || command === '!felicitar2') {
            chosenSound = 'HBSilbato.mp3';
            soundLabel = '🎺 Silbato Festivo';
        } else if (command === '!felicidades3' || command === '!felicitar3') {
            chosenSound = 'HBVoz.mp3';
            soundLabel = '🎤 Felicitación con Voz';
        } else {
            // !felicidades o !felicitar a secas -> Selección aleatoria de los 3
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
                return sendChat(`🎵 @${sender}, la música de cumpleaños ya está sonando (${secsLeft}s restantes). ¡Lanza !felicidades2 (silbato) o !felicidades3 (voz) mientras tanto! 🎺`);
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
        const msgSnippet = customMsg ? ` con el mensaje: "${customMsg.slice(0, 45)}"` : '';
        return sendChat(`💌 ¡Felicitación en pantalla! 🎉 @${sender} felicitó a @${toName} en directo (${soundLabel})${msgSnippet} 🥳✨`);
    }

    // ─── COMANDO 7: !hbcambio <frase> (Modificar frase/descripción de la ficha) ──
    if (command === '!hbcambio' || command === '!hbfrase' || command === '!micumplefrase') {
        if (!dbRef) return;
        const senderLogin = sender.toLowerCase().replace(/[^a-z0-9_]/g, '');
        const user = await dbRef.getUser(senderLogin);

        if (!user || !user.birth_month || !user.birth_day || user.birthday_unlocked) {
            return sendChat(`⚠️ @${sender}, primero debes registrar tu cumpleaños en el sistema para personalizar tu frase 👉 ${appUrlRef} 🎂`);
        }

        const newPhrase = parts.slice(1).join(' ').trim();
        if (!newPhrase) {
            const currentPhrase = user.custom_message || '¡Hoy es mi cumpleaños!';
            return sendChat(`💬 @${sender}, tu frase actual para la alerta es: "${currentPhrase}". Para cambiarla usa: !hbcambio Tu nueva frase aquí (máx 60 letras) 🎈`);
        }

        const cleanPhrase = newPhrase.slice(0, 60).trim();
        user.custom_message = cleanPhrase;
        await dbRef.saveUser(user);

        return sendChat(`✨ @${sender}, ¡frase de tu alerta actualizada con éxito! Se mostrará: "${cleanPhrase}" cuando lances tu festejo en stream 🎂🎉`);
    }

    // ─── COMANDO 8: !hbsonido <1 | 2 | 3> (Modificar sonido de la alerta) ─────────
    if (command === '!hbsonido' || command === '!cambiarsonido' || command === '!misonido') {
        if (!dbRef) return;
        const senderLogin = sender.toLowerCase().replace(/[^a-z0-9_]/g, '');
        const user = await dbRef.getUser(senderLogin);

        if (!user || !user.birth_month || !user.birth_day || user.birthday_unlocked) {
            return sendChat(`⚠️ @${sender}, primero debes registrar tu cumpleaños en el sistema para elegir tu sonido 👉 ${appUrlRef} 🎂`);
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
            return sendChat(`🎵 @${sender}, tu sonido actual es: ${currentSoundName}. Para cambiarlo usa: !hbsonido 1 (🎺 Silbato) · !hbsonido 2 (🎵 Música) · !hbsonido 3 (🎤 Voz) 🥳`);
        }

        user.selected_sound = chosenSound;
        await dbRef.saveUser(user);

        return sendChat(`🎵 @${sender}, ¡sonido de tu alerta actualizado a ${soundLabel}! Sonará cuando lances tu festejo en directo 🥳✨`);
    }

    // ─── COMANDO PIÑATA: !piñata [nombre] [golpes] o !piñatastop ──────────────────
    // Uso: !piñata capiluisxavi       -> piñata para esa persona (30 hits default)
    // Uso: !piñata capiluisxavi 60   -> piñata para esa persona con 60 hits
    // Uso: !piñata cumpleañeros       -> piñata genérica "cumpleañeros"
    // Uso: !piñata stop               -> detener piñata activa
    // Solo streamer (@yocapi_pr) y moderadores pueden iniciarlo o detenerlo.
    if (command === '!piñata' || command === '!piñatastop') {
        if (!pinataManagerRef) return;

        const subAction = (parts[1] || '').toLowerCase().trim();
        if (subAction === 'stop' || subAction === 'detener' || subAction === 'cancelar' || command === '!piñatastop') {
            if (!isStreamerOrMod(tags, channel)) {
                return sendChat(`⛔ @${sender}, solo la streamer (@yocapi_pr) y los moderadores pueden detener la piñata 🛡️`);
            }
            const stopped = pinataManagerRef.stop(true);
            if (!stopped) {
                return sendChat(`ℹ️ @${sender}, no hay ninguna piñata de capibara activa en este momento.`);
            }
            return;
        }

        // Solo streamer y mods pueden iniciar la piñata
        if (!isStreamerOrMod(tags, channel)) {
            const pStatus = pinataManagerRef.getStatus();
            if (pStatus.active) {
                return sendChat(`🪅 ¡La piñata de capibara está activa (${pStatus.currentHp}/${pStatus.maxHp} HP)! Escribe !dale o !pegar para batear 💥`);
            }
            return sendChat(`🪅 La piñata comunitaria de capibara es iniciada por la streamer (@yocapi_pr) o moderadores. ¡Atentos al stream! 🎉`);
        }

        const currentStatus = pinataManagerRef.getStatus();
        if (currentStatus.active && subAction !== 'restart' && subAction !== 'reiniciar') {
            return sendChat(`🪅 @${sender}, ya hay una piñata de capibara en curso (${currentStatus.currentHp}/${currentStatus.maxHp} HP, quedan ${currentStatus.remainingSec}s). Usa "!piñata stop" si deseas cancelarla.`);
        }

        // ── Parsear nombre y golpes ────────────────────────────────────────
        // parts[1] = nombre del cumpleañero (opcional)
        // parts[2] = golpes / maxHp (opcional, número)
        let targetName = 'la Comunidad';
        let targetAvatar = '/img/yocapi.png';
        let hp = 30;

        // Determinar si parts[1] es un número (golpes directos) o nombre
        const part1Raw = (parts[1] || '').replace(/^@/, '').trim();
        const part1Num = parseInt(part1Raw, 10);
        const part1IsNum = !isNaN(part1Num) && part1Raw !== '';

        if (part1IsNum) {
            // !piñata 60 → sin nombre, sólo golpes
            hp = part1Num;
        } else if (part1Raw && part1Raw !== 'start' && part1Raw !== 'iniciar') {
            // !piñata capiluisxavi [60]
            targetName = part1Raw;

            // Buscar avatar y displayName en la BD
            if (dbRef) {
                try {
                    const u = await dbRef.getUser(part1Raw.toLowerCase());
                    if (u) {
                        targetName = u.display_name || u.username;
                        if (u.profile_image) targetAvatar = u.profile_image;
                    }
                } catch (_) {}
            }

            // Leer golpes en parts[2]
            const hpArg = parseInt((parts[2] || ''), 10);
            if (!isNaN(hpArg) && hpArg >= 10 && hpArg <= 100) {
                hp = hpArg;
            }
        } else {
            // Sin argumentos: buscar automáticamente el cumpleañero de hoy
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
                } catch (_) {}
            }
        }

        hp = Math.min(100, Math.max(10, hp));

        await pinataManagerRef.start({
            targetUser: targetName,
            targetAvatar,
            maxHp: hp,
            // durationSec: null → pinataManager lo calcula automáticamente (35 hits=60s, 60 hits=90s)
            durationSec: null,
            initiatedBy: sender
        });
        return;
    }

    // ─── COMANDO 9: !cumpleinfo o !ayudacumple ────────────────────────────────
    if (command === '!cumpleinfo' || command === '!ayudacumple') {
        return sendChat(`🎉 Comandos de Fiesta: !hoyesmicumple · !felicidades [mensaje] · !dale (golpea la piñata 🪅) · !piñata [nombre] [golpes] · !hbcambio <frase> · !hbsonido <1/2/3> · !cumple · !proximos · !cumplemes 🎂✨`);
    }

    // ─── COMANDOS EXCLUSIVOS DE MODERACIÓN Y CONTROL (STREAMER & MODS) ─────────

    // COMANDO MOD 1: !hbalertas [on|off] (Activar/Desactivar Alertas del Cumpleañero)
    if (command === '!hbalertas' || command === '!cumplealertas' || command === '!alertascumple') {
        if (!isStreamerOrMod(tags, channel)) {
            return sendChat(`⛔ @${sender}, este comando de control es exclusivo para la streamer (@yocapi_pr) y los moderadores del canal 🛡️`);
        }

        const appSettings = getAppSettingsRef ? getAppSettingsRef() : {};
        const subAction = (parts[1] || '').toLowerCase().trim();

        if (subAction === 'on' || subAction === 'activar' || subAction === 'habilitar' || subAction === '1') {
            appSettings.birthday_alerts_enabled = true;
            if (saveSettingsCallback) saveSettingsCallback({ birthday_alerts_enabled: true });
            if (broadcastToOverlayRef) broadcastToOverlayRef({ type: 'birthday_alerts_status', enabled: true });
            return sendChat(`✅👑 @${sender}, ¡Alertas de cumpleaños del cumpleañero ACTIVADAS! Ya pueden detonar su festejo en directo con !hoyesmicumple 🎂🎉`);
        } else if (subAction === 'off' || subAction === 'desactivar' || subAction === 'pausar' || subAction === 'bloquear' || subAction === '0') {
            appSettings.birthday_alerts_enabled = false;
            if (saveSettingsCallback) saveSettingsCallback({ birthday_alerts_enabled: false });
            if (broadcastToOverlayRef) broadcastToOverlayRef({ type: 'birthday_alerts_status', enabled: false });
            return sendChat(`🔒🎬 @${sender}, ¡Alertas de cumpleaños del cumpleañero DESACTIVADAS! Nadie podrá interrumpir en directo con !hoyesmicumple hasta que se reactiven 🤫🎥`);
        } else {
            const isEnabled = appSettings.birthday_alerts_enabled !== false;
            return sendChat(`🛡️ @${sender}, las alertas del cumpleañero en pantalla están actualmente: ${isEnabled ? '✅ ACTIVADAS' : '🔒 DESACTIVADAS'}. Usa "!hbalertas on" para activar o "!hbalertas off" para desactivar 🎬`);
        }
    }

    // COMANDO MOD 2: !hbfelicitar [on|off] o !felicitaciones [on|off] (Control de Felicitaciones)
    if (command === '!hbfelicitar' || command === '!hbfelicitaciones' || ((command === '!felicitar' || command === '!felicitaciones') && (parts[1] === 'on' || parts[1] === 'off'))) {
        if (!isStreamerOrMod(tags, channel)) {
            return sendChat(`⛔ @${sender}, este comando de control es exclusivo para la streamer (@yocapi_pr) y los moderadores del canal 🛡️`);
        }

        const appSettings = getAppSettingsRef ? getAppSettingsRef() : {};
        const subAction = (parts[1] || '').toLowerCase().trim();

        if (subAction === 'on' || subAction === 'activar' || subAction === 'habilitar' || subAction === '1') {
            appSettings.felicitations_enabled = true;
            if (saveSettingsCallback) saveSettingsCallback({ felicitations_enabled: true });
            if (broadcastToOverlayRef) broadcastToOverlayRef({ type: 'felicitations_status', enabled: true });
            return sendChat(`✅💌 @${sender}, ¡Felicitaciones de la comunidad ACTIVADAS! Los espectadores ya pueden enviar tarjetas flotantes al stream con !felicidades 🥳🎈`);
        } else if (subAction === 'off' || subAction === 'desactivar' || subAction === 'pausar' || subAction === 'bloquear' || subAction === '0') {
            appSettings.felicitations_enabled = false;
            if (saveSettingsCallback) saveSettingsCallback({ felicitations_enabled: false });
            if (broadcastToOverlayRef) broadcastToOverlayRef({ type: 'felicitations_status', enabled: false });
            return sendChat(`🔒💌 @${sender}, ¡Felicitaciones de la comunidad DESACTIVADAS! No saldrán tarjetas flotantes en pantalla hasta que se reactiven 🤫📺`);
        } else {
            const isEnabled = !!appSettings.felicitations_enabled;
            return sendChat(`🛡️ @${sender}, las felicitaciones de los espectadores están actualmente: ${isEnabled ? '✅ ACTIVADAS' : '🔒 DESACTIVADAS'}. Usa "!hbfelicitar on" o "!hbfelicitar off" 💌`);
        }
    }

    // COMANDO MOD 3: !hbgrabacion [on|off] (Modo Cero Interrupciones para Grabación de Videos)
    if (command === '!hbgrabacion' || command === '!hbmodovideo' || command === '!hbcine' || command === '!hbpausa') {
        if (!isStreamerOrMod(tags, channel)) {
            return sendChat(`⛔ @${sender}, este comando de grabación es exclusivo para la streamer (@yocapi_pr) y los moderadores del canal 🛡️`);
        }

        const appSettings = getAppSettingsRef ? getAppSettingsRef() : {};
        const subAction = (parts[1] || '').toLowerCase().trim();

        if (subAction === 'on' || subAction === 'activar' || subAction === '1' || subAction === 'iniciar') {
            appSettings.birthday_alerts_enabled = false;
            appSettings.felicitations_enabled = false;
            if (saveSettingsCallback) saveSettingsCallback({ birthday_alerts_enabled: false, felicitations_enabled: false });
            if (broadcastToOverlayRef) broadcastToOverlayRef({ type: 'recording_mode', active: true });
            return sendChat(`🎬🤫 @${sender}, ¡MODO GRABACIÓN ACTIVADO! Alertas del cumpleañero y felicitaciones del chat desactivadas. Cero interrupciones garantizadas en video. Escribe "!hbgrabacion off" al terminar 🎥✨`);
        } else if (subAction === 'off' || subAction === 'desactivar' || subAction === '0' || subAction === 'terminar') {
            appSettings.birthday_alerts_enabled = true;
            appSettings.felicitations_enabled = true;
            if (saveSettingsCallback) saveSettingsCallback({ birthday_alerts_enabled: true, felicitations_enabled: true });
            if (broadcastToOverlayRef) broadcastToOverlayRef({ type: 'recording_mode', active: false });
            return sendChat(`🎉🎬 @${sender}, ¡MODO GRABACIÓN FINALIZADO! Se reactivaron las alertas de cumpleaños y las felicitaciones en directo para toda la comunidad 🎂🥳`);
        } else {
            const isRecording = (appSettings.birthday_alerts_enabled === false && !appSettings.felicitations_enabled);
            return sendChat(`🎬 @${sender}, Modo Grabación está: ${isRecording ? '🔴 ACTIVADO (Silencio Total)' : '⚪ DESACTIVADO (Normal)'}. Usa "!hbgrabacion on" para grabar sin alertas o "!hbgrabacion off" para reactivar 🎥`);
        }
    }

    // COMANDO MOD 4: !hbmod (Panel de Estado Rápido para Mods en Chat)
    if (command === '!hbmod' || command === '!hbadmin' || command === '!hbestado') {
        if (!isStreamerOrMod(tags, channel)) {
            return sendChat(`⛔ @${sender}, este panel de estado es exclusivo para la streamer (@yocapi_pr) y moderadores 🛡️`);
        }

        const appSettings = getAppSettingsRef ? getAppSettingsRef() : {};
        const bdayAct = appSettings.birthday_alerts_enabled !== false ? '✅ ACTIVO' : '🔒 PAUSADO';
        const felicAct = appSettings.felicitations_enabled ? '✅ ACTIVO' : '🔒 PAUSADO';
        const recMode = (appSettings.birthday_alerts_enabled === false && !appSettings.felicitations_enabled) ? '🔴 EN GRABACIÓN' : '🟢 NORMAL';
        const mins = botConfig.timer_minutes || 60;

        return sendChat(`🛡️ [Panel Mod Yocapi] Estado: ${recMode} · 👑 Alertas cumpleañero: ${bdayAct} · 💌 Felicitaciones: ${felicAct} · ⏰ Timer: ${mins}m · Comandos: !hbalertas on/off · !hbfelicitar on/off · !hbgrabacion on/off ✨`);
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
    broadcastToOverlayRef = options.broadcastToOverlay || null;
    getAppSettingsRef = options.getAppSettings || null;
    acquireMusicLockRef = options.acquireMusicLock || null;
    getMusicLockStatusRef = options.getMusicLockStatus || null;
    pausedAlertsQueueRef = options.pausedAlertsQueue || null;
    pinataManagerRef = options.pinataManager || null;

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
