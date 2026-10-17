/**
 * YoCapi Birthday System v2.0 — Backend Server
 * Nick de Twitch + PIN (Sin OAuth de Twitch) + Firebase Firestore + OBS Overlay
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const db = require('./db');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// Configuración general
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const STREAMER_LOGIN = (process.env.STREAMER_LOGIN || 'yocapi_pr').toLowerCase();
const OVERLAY_TOKEN = process.env.OVERLAY_TOKEN || '33c98a5e7659ee191e539ec5cbb7a1b131266643dbd752b6';
const DASHBOARD_SECRET_PATH = process.env.DASHBOARD_PATH || 'panel-streamer-yocapi-9842';
const DASHBOARD_KEY = process.env.DASHBOARD_KEY || 'yocapi_dash_auth_8492';

const BIRTHDAY_GRACE_DAYS = 14;
const ALERT_COOLDOWN_MS = 30_000; // 30 segundos entre alertas del mismo usuario

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Estado en Memoria para OBS Overlay ──────────────────────────────────────
const sseClients = new Set();
const recentAlertsCache = new Map(); // username -> timestamp

// ─── Cache y Helper Multi-Fuente para Avatar de Twitch ────────────────────────
const twitchAvatarCache = new Map(); // username -> { url, expires }
const AVATAR_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora de caché

function fetchHttpJson(url, options = {}) {
    return new Promise((resolve) => {
        const req = https.get(url, {
            timeout: 4000,
            headers: { 'User-Agent': 'YoCapi-Birthday-System/2.0', ...(options.headers || {}) }
        }, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) return resolve(null);
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

function fetchTwitchGQL(cleanName) {
    return new Promise((resolve) => {
        const postData = JSON.stringify({ query: `{ user(login: "${cleanName}") { profileImageURL(width: 300) } }` });
        const req = https.request('https://gql.twitch.tv/gql', {
            method: 'POST',
            timeout: 4000,
            headers: {
                'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'Mozilla/5.0'
            }
        }, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) return resolve(null);
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const url = json?.data?.user?.profileImageURL;
                    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                        resolve(url);
                    } else {
                        resolve(null);
                    }
                } catch (e) {
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.write(postData);
        req.end();
    });
}

function fetchDecapi(cleanName) {
    return new Promise((resolve) => {
        const req = https.get(`https://decapi.me/twitch/avatar/${cleanName}`, {
            headers: { 'User-Agent': 'YoCapi-Birthday-System/2.0' },
            timeout: 4000
        }, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) return resolve(null);
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const url = data.trim();
                if (url.startsWith('http://') || url.startsWith('https://')) {
                    resolve(url);
                } else {
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

async function fetchPublicTwitchAvatar(username) {
    const cleanName = (username || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanName) return null;

    const cached = twitchAvatarCache.get(cleanName);
    if (cached && Date.now() < cached.expires && cached.url) {
        return cached.url;
    }

    // Fuente 1: IVR API (CDN Oficial Twitch 600x600 de alta resolución)
    try {
        const ivrData = await fetchHttpJson(`https://api.ivr.fi/v2/twitch/user?login=${cleanName}`);
        const ivrLogo = ivrData && Array.isArray(ivrData) && ivrData[0]?.logo;
        if (ivrLogo && (ivrLogo.startsWith('http://') || ivrLogo.startsWith('https://'))) {
            twitchAvatarCache.set(cleanName, { url: ivrLogo, expires: Date.now() + AVATAR_CACHE_TTL_MS });
            return ivrLogo;
        }
    } catch (e) {}

    // Fuente 2: Twitch GQL Oficial
    try {
        const gqlLogo = await fetchTwitchGQL(cleanName);
        if (gqlLogo) {
            twitchAvatarCache.set(cleanName, { url: gqlLogo, expires: Date.now() + AVATAR_CACHE_TTL_MS });
            return gqlLogo;
        }
    } catch (e) {}

    // Fuente 3: DecAPI
    try {
        const decapiLogo = await fetchDecapi(cleanName);
        if (decapiLogo) {
            twitchAvatarCache.set(cleanName, { url: decapiLogo, expires: Date.now() + AVATAR_CACHE_TTL_MS });
            return decapiLogo;
        }
    } catch (e) {}

    return null;
}

// ─── Helper Cálculo de Cumpleaños & Gracia ──────────────────────────────────
function getBirthdayStatus(birthMonth, birthDay) {
    const now = new Date();
    const currentYear = now.getFullYear();

    for (const year of [currentYear, currentYear - 1]) {
        const bdayDate = new Date(year, birthMonth - 1, birthDay, 0, 0, 0, 0);
        const endDate = new Date(bdayDate.getTime() + (BIRTHDAY_GRACE_DAYS + 1) * 24 * 60 * 60 * 1000);
        if (now >= bdayDate && now < endDate) {
            const isToday = (now.getMonth() + 1 === birthMonth) && (now.getDate() === birthDay);
            const daysLeft = Math.ceil((endDate - now) / (24 * 60 * 60 * 1000));
            return {
                canCelebrate: true,
                isToday,
                isGracePeriod: !isToday,
                daysRemainingInGrace: daysLeft,
                celebrationYear: year
            };
        }
    }

    let nextBday = new Date(currentYear, birthMonth - 1, birthDay, 0, 0, 0, 0);
    const graceEnd = new Date(nextBday.getTime() + (BIRTHDAY_GRACE_DAYS + 1) * 24 * 60 * 60 * 1000);
    if (now > graceEnd) {
        nextBday = new Date(currentYear + 1, birthMonth - 1, birthDay, 0, 0, 0, 0);
    }
    const diffDays = Math.max(0, Math.ceil((nextBday - now) / (24 * 60 * 60 * 1000)));

    return {
        canCelebrate: false,
        isToday: false,
        isGracePeriod: false,
        daysUntilBirthday: diffDays
    };
}

// ─── Middleware Autenticación de Usuario ────────────────────────────────────
async function authenticateUser(req, res, next) {
    try {
        const token = req.cookies?.yocapi_session || req.headers.authorization?.replace('Bearer ', '').trim();
        if (!token) return res.status(401).json({ error: 'No autenticado' });

        const session = await db.getSession(token);
        if (!session) return res.status(401).json({ error: 'Sesión expirada o inválida' });

        req.user = session;
        next();
    } catch (err) {
        console.error('Error en authenticateUser:', err);
        return res.status(401).json({ error: 'Error de autenticación' });
    }
}

// ─── API DE AUTENTICACIÓN (NICK + PIN) ──────────────────────────────────────

// Vista previa de avatar en tiempo real
app.get('/api/avatar/:username', async (req, res) => {
    const avatar = await fetchPublicTwitchAvatar(req.params.username);
    res.json({ avatar });
});

// Registro de usuario nuevo
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, pin, secret_word, birth_month, birth_day, custom_message, selected_sound } = req.body;

        if (!username || username.trim().length < 2) {
            return res.status(400).json({ error: 'Ingresa tu nombre de Twitch válido' });
        }
        const cleanPassword = (pin || req.body.password) ? String(pin || req.body.password).trim() : '';
        if (!cleanPassword || cleanPassword.length < 6 || cleanPassword.length > 15) {
            return res.status(400).json({ error: 'La contraseña debe tener entre 6 y 15 caracteres' });
        }
        if (!secret_word || secret_word.trim().length < 2) {
            return res.status(400).json({ error: 'Ingresa tu palabra secreta para recuperar tu cuenta si olvidas la contraseña' });
        }

        const cleanName = username.trim();
        const existing = await db.getUser(cleanName);
        if (existing) {
            return res.status(400).json({ error: 'Este usuario ya está registrado. Por favor inicia sesión con tu contraseña.' });
        }

        const month = parseInt(birth_month, 10);
        const day = parseInt(birth_day, 10);
        if (isNaN(month) || month < 1 || month > 12) {
            return res.status(400).json({ error: 'Selecciona un mes válido' });
        }
        if (isNaN(day) || day < 1 || day > 31) {
            return res.status(400).json({ error: 'Selecciona un día válido' });
        }

        // Obtener avatar público de Twitch con multi-fuente
        const fetchedAvatar = await fetchPublicTwitchAvatar(cleanName);
        const avatarUrl = (fetchedAvatar && fetchedAvatar.startsWith('http')) ? fetchedAvatar : '/img/yocapi.png';

        const newUser = await db.saveUser({
            username: cleanName,
            display_name: cleanName,
            pin_hash: db.hashPin(cleanPassword),
            recovery_hash: db.hashSecret(secret_word),
            profile_image: avatarUrl,
            birth_month: month,
            birth_day: day,
            custom_message: custom_message || '',
            selected_sound: selected_sound || 'HBSilbato.mp3',
            created_at: new Date().toISOString()
        });

        const token = crypto.randomBytes(32).toString('hex');
        await db.createSession(token, newUser);

        res.cookie('yocapi_session', token, {
            httpOnly: true,
            maxAge: 60 * 24 * 60 * 60 * 1000,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production' || !!process.env.RENDER
        });

        res.json({ success: true, user: newUser, token });
    } catch (err) {
        console.error('Error en registro:', err);
        res.status(500).json({ error: 'Error al registrar: ' + (err.message || 'Error del servidor') });
    }
});

// Recuperar / Restablecer Contraseña con palabra secreta
app.post('/api/auth/reset-pin', async (req, res) => {
    try {
        const { username, secret_word, new_pin, new_password } = req.body;
        const passToReset = new_password || new_pin;
        if (!username || !secret_word || !passToReset) {
            return res.status(400).json({ error: 'Completa todos los campos' });
        }
        const cleanNewPass = String(passToReset).trim();
        if (cleanNewPass.length < 6 || cleanNewPass.length > 15) {
            return res.status(400).json({ error: 'La nueva contraseña debe tener entre 6 y 15 caracteres' });
        }

        const user = await db.getUser(username);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        if (!user.recovery_hash) {
            return res.status(400).json({ error: 'No tienes una palabra secreta registrada. Pide a yocapi_pr que restablezca tu contraseña desde su panel.' });
        }

        if (user.recovery_hash !== db.hashSecret(secret_word)) {
            return res.status(401).json({ error: 'La palabra secreta es incorrecta' });
        }

        await db.updatePin(user.username, cleanNewPass);
        res.json({ success: true, message: '¡Contraseña restablecida con éxito! Ya puedes iniciar sesión con tu nueva contraseña.' });
    } catch (err) {
        console.error('Error al resetear contraseña:', err);
        res.status(500).json({ error: 'Error del servidor al restablecer contraseña' });
    }
});

// Inicio de sesión con Nick + Contraseña
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, pin, password } = req.body;
        const pass = password || pin;
        if (!username || !pass) {
            return res.status(400).json({ error: 'Ingresa tu usuario y tu contraseña' });
        }

        const user = await db.getUser(username);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado. Regístrate primero.' });
        }

        const hash = db.hashPin(pass);
        if (user.pin_hash !== hash) {
            return res.status(401).json({ error: 'Contraseña incorrecta' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        await db.createSession(token, user);

        res.cookie('yocapi_session', token, {
            httpOnly: true,
            maxAge: 60 * 24 * 60 * 60 * 1000,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production' || !!process.env.RENDER
        });

        res.json({ success: true, user, token });
    } catch (err) {
        console.error('Error en login:', err);
        res.status(500).json({ error: 'Error del servidor al iniciar sesión' });
    }
});

// Cerrar sesión
app.post('/api/auth/logout', async (req, res) => {
    const token = req.cookies?.yocapi_session || req.headers.authorization?.replace('Bearer ', '').trim();
    if (token) await db.deleteSession(token);
    res.clearCookie('yocapi_session');
    res.json({ success: true });
});

// ─── API DE USUARIO (DATOS & CUMPLEAÑOS) ────────────────────────────────────

function isUserDateLocked(user) {
    if (!user) return false;
    // SQLite almacena 1/0, Firestore almacena true/false
    if (user.birthday_unlocked === true || user.birthday_unlocked === 1) return false;
    if (!user.birth_month || !user.birth_day) return false;
    const regTime = user.created_at ? new Date(user.created_at).getTime() : 0;
    // Si no hay created_at, es usuario viejo → no bloqueado (para no afectar registros anteriores)
    if (!regTime) return false;
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    return (Date.now() - regTime < oneYearMs);
}

app.get('/api/me', authenticateUser, async (req, res) => {
    try {
        const user = await db.getUser(req.user.username);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        // Auto-heal avatar si es default o falta
        if (!user.profile_image || user.profile_image === '/img/yocapi.png' || !user.profile_image.startsWith('http')) {
            fetchPublicTwitchAvatar(user.username).then(async (fresh) => {
                if (fresh && fresh.startsWith('http')) {
                    user.profile_image = fresh;
                    await db.saveUser(user);
                }
            }).catch(() => {});
        }

        const status = getBirthdayStatus(user.birth_month, user.birth_day);
        const isLocked = isUserDateLocked(user);

        res.json({
            user: {
                username: user.username,
                display_name: user.display_name,
                profile_image: user.profile_image,
                birth_month: user.birth_month,
                birth_day: user.birth_day,
                custom_message: user.custom_message,
                selected_sound: user.selected_sound,
                is_date_locked: isLocked
            },
            status,
            streamer_login: STREAMER_LOGIN
        });
    } catch (err) {
        console.error('Error en /api/me:', err);
        res.status(500).json({ error: 'Error del servidor al obtener datos' });
    }
});

// Actualizar cumpleaños o configuración
app.post('/api/birthday/update', authenticateUser, async (req, res) => {
    try {
        const { birth_month, birth_day, custom_message, selected_sound, new_pin } = req.body;
        const user = await db.getUser(req.user.username);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        let month = user.birth_month;
        let day = user.birth_day;

        // Si se envió mes o día para actualizar
        if (birth_month !== undefined && birth_day !== undefined) {
            const m = parseInt(birth_month, 10);
            const d = parseInt(birth_day, 10);
            if (isNaN(m) || m < 1 || m > 12) {
                return res.status(400).json({ error: 'Mes inválido' });
            }
            if (isNaN(d) || d < 1 || d > 31) {
                return res.status(400).json({ error: 'Día inválido' });
            }

            // Validar restricción de cambio de fecha por 1 año
            if (user.birth_month && user.birth_day && (user.birth_month !== m || user.birth_day !== d)) {
                if (isUserDateLocked(user)) {
                    return res.status(400).json({
                        error: 'Tu fecha de cumpleaños está fijada por 1 año. Si necesitas corregirla, contacta a la streamer para que te la desbloquee.'
                    });
                }
            }

            month = m;
            day = d;
            user.birth_month = m;
            user.birth_day = d;
            user.birthday_unlocked = false; // Se vuelve a bloquear por 1 año al actualizarla
            user.created_at = new Date().toISOString();
        }

        if (custom_message !== undefined) {
            user.custom_message = (custom_message || '').slice(0, 100);
        }
        if (selected_sound) {
            user.selected_sound = selected_sound;
        }

        const newPass = req.body.new_password || new_pin;
        if (newPass && String(newPass).trim().length > 0) {
            const cleanPass = String(newPass).trim();
            if (cleanPass.length < 6 || cleanPass.length > 15) {
                return res.status(400).json({ error: 'La nueva contraseña debe tener entre 6 y 15 caracteres' });
            }
            user.pin_hash = db.hashPin(cleanPass);
        }
        if (req.body.new_secret && req.body.new_secret.trim().length >= 2) {
            user.recovery_hash = db.hashSecret(req.body.new_secret);
        }

        // Refrescar avatar de Twitch por si cambió (sin sobreescribir si la API falla)
        const freshAvatar = await fetchPublicTwitchAvatar(user.username);
        if (freshAvatar && freshAvatar.startsWith('http')) {
            user.profile_image = freshAvatar;
        } else if (!user.profile_image) {
            user.profile_image = '/img/yocapi.png';
        }

        await db.saveUser(user);
        const status = getBirthdayStatus(month, day);

        res.json({ success: true, user, status });
    } catch (err) {
        console.error('Error al actualizar:', err);
        res.status(500).json({ error: 'Error al actualizar datos' });
    }
});

// Lanzar alerta al overlay de OBS (Seguidor)
app.post('/api/birthday/alert', authenticateUser, async (req, res) => {
    const user = await db.getUser(req.user.username);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const status = getBirthdayStatus(user.birth_month, user.birth_day);
    if (!status.canCelebrate) {
        return res.status(400).json({
            error: `Aún no es tu período de cumpleaños. Faltan ${status.daysUntilBirthday} días.`
        });
    }

    // Cooldown check
    const lastAlert = recentAlertsCache.get(user.username) || 0;
    const now = Date.now();
    if (now - lastAlert < ALERT_COOLDOWN_MS) {
        const remainingSeconds = Math.ceil((ALERT_COOLDOWN_MS - (now - lastAlert)) / 1000);
        return res.status(429).json({
            error: `Espera ${remainingSeconds}s antes de enviar otra alerta.`
        });
    }

    recentAlertsCache.set(user.username, now);

    // Auto-heal avatar si es default o falta antes de lanzar alerta
    if (!user.profile_image || user.profile_image === '/img/yocapi.png' || !user.profile_image.startsWith('http')) {
        const freshAvatar = await fetchPublicTwitchAvatar(user.username);
        if (freshAvatar && freshAvatar.startsWith('http')) {
            user.profile_image = freshAvatar;
            await db.saveUser(user);
        }
    }

    // Actualizar registro
    user.last_activated = new Date().toISOString();
    user.last_played_date = new Date().toISOString().split('T')[0];
    await db.saveUser(user);

    // Registrar en log
    await db.logAlert({
        username: user.username,
        display_name: user.display_name,
        sound_file: user.selected_sound,
        message: user.custom_message
    });

    // Enviar a todos los overlays de OBS conectados
    const alertPayload = {
        type: 'alert',
        user: user.display_name,
        avatar: user.profile_image,
        sound: user.selected_sound,
        message: user.custom_message,
        isToday: status.isToday,
        isGrace: status.isGracePeriod,
        theme: 'purple',
        timestamp: Date.now()
    };

    broadcastToOverlay(alertPayload);

    res.json({
        success: true,
        message: '¡Alerta enviada al directo con éxito!',
        activeOverlayCount: sseClients.size
    });
});

// ─── API PÚBLICA: Cumpleañeros actuales + próximos 14 días ──────────────────
app.get('/api/birthday/public-today', async (req, res) => {
    try {
        const allUsers = await db.getAllUsers();
        const today = new Date();
        const todayMonth = today.getMonth() + 1;
        const todayDay = today.getDate();

        const result = {
            today: [],
            upcoming: []
        };

        for (const u of allUsers) {
            if (!u.birth_month || !u.birth_day) continue;
            const status = getBirthdayStatus(u.birth_month, u.birth_day);

            const entry = {
                username: u.username,
                display_name: u.display_name,
                profile_image: u.profile_image || '/img/yocapi.png',
                birth_month: u.birth_month,
                birth_day: u.birth_day,
                selected_sound: u.selected_sound || 'HBSilbato.mp3'
            };

            if (status.canCelebrate) {
                result.today.push({ ...entry, status });
            } else {
                // Calcular días hasta cumpleaños en los próximos 14 días
                const days = status.daysUntilBirthday;
                if (days > 0 && days <= 14) {
                    result.upcoming.push({ ...entry, daysUntil: days });
                }
            }
        }

        // Ordenar próximos por días
        result.upcoming.sort((a, b) => a.daysUntil - b.daysUntil);

        res.json(result);
    } catch (err) {
        console.error('Error en /api/birthday/public-today:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Cooldown de felicitaciones: username -> timestamp último envío
const felicitationCooldown = new Map();
const FELICITATION_COOLDOWN_MS = 60_000; // 60 segundos entre felicitaciones del mismo usuario

// Enviar felicitación al overlay (usuario autenticado felicita a un cumpleañero)
app.post('/api/birthday/send-felicitation', authenticateUser, async (req, res) => {
    try {
        const { target_username, sound } = req.body;
        if (!target_username || !sound) {
            return res.status(400).json({ error: 'Faltan parámetros: target_username y sound' });
        }

        const validSounds = ['HBSilbato.mp3', 'HBVoz.mp3', 'MBMusica.mp3'];
        if (!validSounds.includes(sound)) {
            return res.status(400).json({ error: 'Sonido no válido' });
        }

        // Verificar que el target está de cumpleaños hoy
        const target = await db.getUser(target_username);
        if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

        const status = getBirthdayStatus(target.birth_month, target.birth_day);
        if (!status.canCelebrate) {
            return res.status(400).json({ error: 'Este usuario no está de cumpleaños hoy' });
        }

        // Cooldown por usuario que felicita
        const senderKey = `${req.user.username}_${target_username}`;
        const lastFelic = felicitationCooldown.get(senderKey) || 0;
        const now = Date.now();
        if (now - lastFelic < FELICITATION_COOLDOWN_MS) {
            const remaining = Math.ceil((FELICITATION_COOLDOWN_MS - (now - lastFelic)) / 1000);
            return res.status(429).json({ error: `Espera ${remaining}s antes de volver a felicitar` });
        }
        felicitationCooldown.set(senderKey, now);

        // Obtener avatar del remitente
        const sender = await db.getUser(req.user.username);
        const senderAvatar = sender?.profile_image || '/img/yocapi.png';
        const senderName = sender?.display_name || req.user.username;

        // Broadcast al overlay como evento de felicitación
        broadcastToOverlay({
            type: 'felicitation',
            from: senderName,
            fromAvatar: senderAvatar,
            to: target.display_name,
            sound,
            timestamp: Date.now()
        });

        res.json({ success: true, message: `¡Felicitación enviada a ${target.display_name}!` });
    } catch (err) {
        console.error('Error en send-felicitation:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Lista de sonidos disponibles
app.get('/api/sounds', (req, res) => {
    const musicDir = path.join(__dirname, 'public', 'music');
    try {
        if (!fs.existsSync(musicDir)) return res.json([]);
        const files = fs.readdirSync(musicDir).filter(f => f.endsWith('.mp3'));
        const soundList = files.map(file => {
            let label = file.replace('.mp3', '');
            if (label === 'HBSilbato') label = '🎺 Silbato Festivo';
            else if (label === 'HBVoz') label = '🎤 Felicitación de Voz';
            else if (label === 'MBMusica') label = '🎵 Música de Fiesta';
            return { file, label };
        });
        res.json(soundList);
    } catch {
        res.json([]);
    }
});

// ─── OBS OVERLAY SSE (Server-Sent Events) ────────────────────────────────────

function broadcastToOverlay(data) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        try {
            client.write(message);
        } catch {
            sseClients.delete(client);
        }
    }
}

app.get('/api/overlay/stream', (req, res) => {
    const token = req.query.token;
    if (token !== OVERLAY_TOKEN) {
        return res.status(403).send('Token de OBS inválido');
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    res.write(`data: ${JSON.stringify({ type: 'connected', time: Date.now() })}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
        sseClients.delete(res);
    });
});

setInterval(() => {
    if (sseClients.size > 0) {
        broadcastToOverlay({ type: 'ping', time: Date.now() });
    }
}, 20_000);

// ─── Middleware de Seguridad para el Dashboard ──────────────────────────────
function authenticateDashboard(req, res, next) {
    if (req.cookies?.yocapi_dashboard_auth === DASHBOARD_KEY) {
        return next();
    }
    return res.status(403).json({ error: 'Acceso no autorizado al panel de streamer' });
}

// ─── API DASHBOARD STREAMER (PROTEGIDA) ──────────────────────────────────────

app.get('/api/dashboard/stats', authenticateDashboard, async (req, res) => {
    const allUsers = await db.getAllUsers();
    const alertLogs = await db.getAlertLogs(100);

    let todayCount = 0;
    let graceCount = 0;

    for (const u of allUsers) {
        const status = getBirthdayStatus(u.birth_month, u.birth_day);
        if (status.isToday) todayCount++;
        else if (status.isGracePeriod) graceCount++;
    }

    res.json({
        totalRegistered: allUsers.length,
        todayCount,
        graceCount,
        totalAlertsSent: alertLogs.length,
        activeOverlayConnections: sseClients.size,
        databaseMode: db.getMode(),
        overlayToken: OVERLAY_TOKEN,
        appUrl: APP_URL
    });
});

app.get('/api/dashboard/today', authenticateDashboard, async (req, res) => {
    const allUsers = await db.getAllUsers();
    const todayList = [];

    for (const u of allUsers) {
        const status = getBirthdayStatus(u.birth_month, u.birth_day);
        if (status.canCelebrate) {
            todayList.push({
                ...u,
                status
            });
        }
    }

    res.json(todayList);
});

app.get('/api/dashboard/birthdays', authenticateDashboard, async (req, res) => {
    const month = req.query.month ? parseInt(req.query.month, 10) : null;
    const search = (req.query.search || '').toLowerCase().trim();

    let all = await db.getAllUsers();

    if (month && !isNaN(month)) {
        all = all.filter(u => u.birth_month === month);
    }
    if (search) {
        all = all.filter(u =>
            (u.display_name && u.display_name.toLowerCase().includes(search)) ||
            (u.username && u.username.toLowerCase().includes(search))
        );
    }

    res.json(all);
});

app.delete('/api/dashboard/birthdays/:username', authenticateDashboard, async (req, res) => {
    await db.deleteUser(req.params.username);
    res.json({ success: true });
});

// Cambiar o restablecer Contraseña de un usuario desde el Dashboard
app.post('/api/dashboard/users/:username/reset-pin', authenticateDashboard, async (req, res) => {
    try {
        const { new_pin, new_password } = req.body;
        const candidate = (new_password || new_pin) ? String(new_password || new_pin).trim() : '';
        const password = (candidate.length >= 6 && candidate.length <= 15) ? candidate : 'yocapi123';
        await db.updatePin(req.params.username, password);
        res.json({ success: true, message: `Contraseña de ${req.params.username} cambiada a: ${password}`, new_pin: password });
    } catch (err) {
        res.status(500).json({ error: 'Error al cambiar contraseña' });
    }
});

// Desbloquear fecha de cumpleaños para que el seguidor pueda corregirla
app.post('/api/dashboard/users/:username/unlock-date', authenticateDashboard, async (req, res) => {
    try {
        const user = await db.getUser(req.params.username);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        user.birthday_unlocked = true;
        await db.saveUser(user);

        res.json({ success: true, message: `¡Fecha de @${user.username} desbloqueada! Ya podrá modificarla en su perfil.` });
    } catch (err) {
        res.status(500).json({ error: 'Error al desbloquear fecha' });
    }
});

// Modificar directamente la fecha de un usuario desde el Dashboard
app.post('/api/dashboard/users/:username/change-date', authenticateDashboard, async (req, res) => {
    try {
        const { birth_month, birth_day } = req.body;
        const m = parseInt(birth_month, 10);
        const d = parseInt(birth_day, 10);
        if (isNaN(m) || m < 1 || m > 12 || isNaN(d) || d < 1 || d > 31) {
            return res.status(400).json({ error: 'Mes o día inválido' });
        }

        const user = await db.getUser(req.params.username);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        user.birth_month = m;
        user.birth_day = d;
        user.birthday_unlocked = false;
        user.created_at = new Date().toISOString();
        await db.saveUser(user);

        res.json({ success: true, message: `Fecha de @${user.username} cambiada a ${d}/${m} con éxito.` });
    } catch (err) {
        res.status(500).json({ error: 'Error al cambiar fecha' });
    }
});

// Lanzar alerta manual o de prueba desde el Dashboard
app.post('/api/dashboard/trigger-alert', authenticateDashboard, async (req, res) => {
    const { user, sound, message, avatar, theme } = req.body;

    let finalAvatar = avatar;
    if (!finalAvatar || finalAvatar === '/img/yocapi.png' || !finalAvatar.startsWith('http')) {
        const fetched = await fetchPublicTwitchAvatar(user || 'yocapi_pr');
        finalAvatar = (fetched && fetched.startsWith('http')) ? fetched : '/img/yocapi.png';
    }

    const alertPayload = {
        type: 'alert',
        user: user || 'Cumpleañero VIP',
        avatar: finalAvatar,
        sound: sound || 'HBSilbato.mp3',
        message: message || '¡Felicidades en tu día especial!',
        isToday: true,
        isGrace: false,
        theme: theme || 'purple',
        timestamp: Date.now()
    };

    broadcastToOverlay(alertPayload);
    await db.logAlert({
        username: 'streamer_manual',
        display_name: alertPayload.user,
        sound_file: alertPayload.sound,
        message: alertPayload.message
    });

    res.json({
        success: true,
        message: 'Alerta enviada a OBS',
        activeOverlayConnections: sseClients.size
    });
});

app.get('/api/dashboard/logs', authenticateDashboard, async (req, res) => {
    const logs = await db.getAlertLogs(30);
    res.json(logs);
});

// ─── Rutas Frontend ─────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/overlay', (req, res) => res.sendFile(path.join(__dirname, 'public', 'overlay.html')));

// Ruta secreta del Dashboard
app.get(`/${DASHBOARD_SECRET_PATH}`, (req, res) => {
    res.cookie('yocapi_dashboard_auth', DASHBOARD_KEY, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 días
    });
    res.sendFile(path.join(__dirname, 'private', 'dashboard.html'));
});

// Bloquear rutas comunes de dashboard con 404 para evitar que curiosos las encuentren
app.get(['/dashboard', '/dashboard.html', '/admin', '/panel'], (req, res) => {
    res.status(404).send('Página no encontrada');
});

// ─── Inicio de Servidor ─────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n==================================================`);
    console.log(`🎂 YoCapi Birthday Platform v2.0 (Nick + PIN)`);
    console.log(`🌐 Servidor: http://localhost:${PORT}`);
    console.log(`📺 Overlay OBS: http://localhost:${PORT}/overlay?token=${OVERLAY_TOKEN}`);
    console.log(`⚙️  Dashboard Secreto: http://localhost:${PORT}/${DASHBOARD_SECRET_PATH}`);
    console.log(`💾 Base de datos: ${db.getMode().toUpperCase()}`);
    console.log(`==================================================\n`);
});
