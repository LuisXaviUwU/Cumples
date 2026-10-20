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

// Configuración persistente (Felicitaciones en directo activadas por la streamer, etc.)
const settingsFile = path.join(__dirname, 'data', 'settings.json');
const DEFAULT_OVERLAY_CONFIG = {
    posX: 50,
    posY: 85,
    scale: 0.85,
    animation: 'slide-up',
    volume: 0.85
};

let appSettings = { 
    felicitations_enabled: false,
    alerts_paused: false,
    overlay_config: { ...DEFAULT_OVERLAY_CONFIG }
};

const pausedAlertsQueue = []; // Alertas en cola cuando la streamer pausa las alertas en vivo

try {
    if (fs.existsSync(settingsFile)) {
        const loaded = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        appSettings = { 
            ...appSettings, 
            ...loaded,
            overlay_config: { ...DEFAULT_OVERLAY_CONFIG, ...(loaded.overlay_config || {}) }
        };
    }
} catch (e) {
    console.error('Error cargando settings.json:', e);
}

function saveAppSettings() {
    try {
        const dir = path.dirname(settingsFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(settingsFile, JSON.stringify(appSettings, null, 2));
    } catch (e) {
        console.error('Error guardando settings.json:', e);
    }
}

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Estado en Memoria para OBS Overlay ──────────────────────────────────────
const sseClients = new Set();
const recentAlertsCache = new Map(); // username -> timestamp

// ─── Mutex de Música: solo una canción de cumpleaños a la vez ─────────────────
let musicLock = null; // { lockedAt: Date, expiresAt: Date, lockedBy: string }
const MUSIC_LOCK_DURATION_MS = 90_000; // 90 segundos (duración aprox. de la canción)

function getMusicLockStatus() {
    if (!musicLock) return { locked: false };
    if (Date.now() >= musicLock.expiresAt) {
        musicLock = null;
        return { locked: false };
    }
    return {
        locked: true,
        lockedBy: musicLock.lockedBy,
        remainingMs: musicLock.expiresAt - Date.now()
    };
}

function acquireMusicLock(username) {
    const status = getMusicLockStatus();
    if (status.locked) return false;
    musicLock = {
        lockedAt: Date.now(),
        expiresAt: Date.now() + MUSIC_LOCK_DURATION_MS,
        lockedBy: username
    };
    return true;
}

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

        const nowIso = new Date().toISOString();
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
            birthday_unlocked: false,
            created_at: nowIso,
            registered_at: nowIso
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

    // Buscar cualquier fecha de registro/creación/modificación disponible
    const dateStr = user.created_at || user.registered_at || user.last_changed_at;
    const regTime = dateStr ? new Date(dateStr).getTime() : 0;
    // Si ya tiene fecha registrada pero no hay timestamp, por defecto está bloqueado por 1 año
    if (!regTime) return true;

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

        const isLocked = isUserDateLocked(user);
        const status = (!isLocked || !user.birth_month || !user.birth_day)
            ? { canCelebrate: false, isToday: false, isGracePeriod: false, daysUntilBirthday: 0 }
            : getBirthdayStatus(user.birth_month, user.birth_day);

        // Determine if the user already launched their celebration this year
        const alreadyCelebrated = status.canCelebrate
            && (parseInt(user.last_celebrated_year, 10) || 0) >= status.celebrationYear;

        res.json({
            user: {
                username: user.username,
                display_name: user.display_name,
                profile_image: user.profile_image,
                birth_month: user.birth_month,
                birth_day: user.birth_day,
                custom_message: user.custom_message,
                selected_sound: user.selected_sound,
                is_date_locked: isLocked,
                last_celebrated_year: parseInt(user.last_celebrated_year, 10) || 0
            },
            status,
            alreadyCelebrated,
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

    // Si la fecha fue desbloqueada para corrección, no se puede lanzar alerta hasta confirmar la nueva fecha
    if (!isUserDateLocked(user)) {
        return res.status(400).json({
            error: 'Tu fecha de cumpleaños está desbloqueada para corrección. Por favor selecciona tu fecha correcta y guárdala para confirmarla antes de lanzar alertas.'
        });
    }

    const status = getBirthdayStatus(user.birth_month, user.birth_day);
    if (!status.canCelebrate) {
        return res.status(400).json({
            error: `Aún no es tu período de cumpleaños. Faltan ${status.daysUntilBirthday} días.`
        });
    }

    // ── Restricción: solo una celebración por cumpleaños (por año) ──────────
    const lastCelebratedYear = parseInt(user.last_celebrated_year, 10) || 0;
    if (lastCelebratedYear >= status.celebrationYear) {
        return res.status(400).json({
            error: '🎂 ¡Ya lanzaste tu felicitación de cumpleaños este año! Solo puedes hacerlo una vez. ¡Hasta el próximo año!'
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

    // Actualizar registro — marcar año de celebración para evitar duplicados
    user.last_activated = new Date().toISOString();
    user.last_played_date = new Date().toISOString().split('T')[0];
    user.last_celebrated_year = status.celebrationYear;
    await db.saveUser(user);

    // Registrar en log
    await db.logAlert({
        username: user.username,
        display_name: user.display_name,
        sound_file: user.selected_sound,
        message: user.custom_message
    });

    // Enviar a todos los overlays de OBS conectados (o poner en cola si la streamer pausó)
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

    if (appSettings.alerts_paused) {
        pausedAlertsQueue.push({
            id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            user: user.display_name,
            avatar: user.profile_image,
            message: user.custom_message,
            sound: user.selected_sound,
            time: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
            payload: alertPayload
        });

        return res.json({
            success: true,
            queued: true,
            message: '🎂 ¡Tu alerta fue guardada! La streamer tiene las alertas pausadas momentáneamente; saldrá en cuanto reanude.',
            activeOverlayCount: sseClients.size
        });
    }

    broadcastToOverlay(alertPayload);

    res.json({
        success: true,
        queued: false,
        message: '¡Alerta enviada al directo con éxito!',
        activeOverlayCount: sseClients.size
    });
});

// ─── API PÚBLICA: Estado del mutex de música (polling para el frontend) ────────
app.get('/api/birthday/music-status', (req, res) => {
    res.json(getMusicLockStatus());
});

// ─── API PÚBLICA: Cumpleañeros actuales + próximos 14 días ──────────────────
// Acepta ?exclude=username para excluir al propio cumpleañero de la lista "Felicitar"
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

        // ?exclude=username — excluir al propio cumpleañero (para que no se autofelicite)
        const excludeUser = (req.query.exclude || '').toLowerCase().trim();

        for (const u of allUsers) {
            if (!u.birth_month || !u.birth_day || u.birthday_unlocked === true || u.birthday_unlocked === 1) continue;
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
                // No incluir al propio cumpleañero en la lista de "a felicitar"
                if (u.username !== excludeUser) {
                    result.today.push({ ...entry, status });
                }
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

        res.json({
            ...result,
            felicitations_enabled: !!appSettings.felicitations_enabled,
            music_lock: getMusicLockStatus()
        });
    } catch (err) {
        console.error('Error en /api/birthday/public-today:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ─── API PÚBLICA: Calendario Completo de la Comunidad ──────────────────────
app.get('/api/birthday/calendar', async (req, res) => {
    try {
        const allUsers = await db.getAllUsers();
        const users = [];

        for (const u of allUsers) {
            if (!u.birth_month || !u.birth_day || u.birthday_unlocked === true || u.birthday_unlocked === 1) continue;
            const status = getBirthdayStatus(u.birth_month, u.birth_day);
            users.push({
                username: u.username,
                display_name: u.display_name,
                profile_image: u.profile_image || '/img/yocapi.png',
                birth_month: parseInt(u.birth_month, 10),
                birth_day: parseInt(u.birth_day, 10),
                custom_message: u.custom_message || '',
                selected_sound: u.selected_sound || 'HBSilbato.mp3',
                isToday: status.isToday,
                isGrace: status.isGracePeriod,
                canCelebrate: status.canCelebrate,
                daysUntilBirthday: status.daysUntilBirthday
            });
        }

        users.sort((a, b) => a.birth_month - b.birth_month || a.birth_day - b.birth_day);

        res.json({
            success: true,
            total: users.length,
            felicitations_enabled: !!appSettings.felicitations_enabled,
            users
        });
    } catch (err) {
        console.error('Error en /api/birthday/calendar:', err);
        res.status(500).json({ error: 'Error del servidor al obtener el calendario' });
    }
});

// Cooldown de felicitaciones: username -> timestamp último envío
const felicitationCooldown = new Map();
const FELICITATION_COOLDOWN_MS = 5_000; // 5 segundos entre felicitaciones del mismo usuario

// Enviar felicitación al overlay (usuario autenticado felicita a un cumpleañero)
app.post('/api/birthday/send-felicitation', authenticateUser, async (req, res) => {
    try {
        if (!appSettings.felicitations_enabled) {
            return res.status(403).json({
                error: 'Las felicitaciones en vivo están desactivadas por la streamer en este momento.'
            });
        }

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

        // ── Bloquear auto-felicitación ──────────────────────────────────────────
        if (req.user.username === target_username) {
            return res.status(400).json({ error: 'No puedes felicitarte a ti mismo.' });
        }

        // ── Mutex de música (MBMusica.mp3): solo una a la vez ────────────────────
        if (sound === 'MBMusica.mp3') {
            if (!acquireMusicLock(req.user.username)) {
                const lockInfo = getMusicLockStatus();
                const secsLeft = Math.ceil(lockInfo.remainingMs / 1000);
                return res.status(429).json({
                    error: `🎵 La canción de cumpleaños ya está sonando (${secsLeft}s restantes). ¡Espera que termine!`
                });
            }
        }

        // Cooldown por usuario que felicita
        const senderKey = `${req.user.username}_${target_username}`;
        const lastFelic = felicitationCooldown.get(senderKey) || 0;
        const now = Date.now();
        if (now - lastFelic < FELICITATION_COOLDOWN_MS) {
            const remaining = Math.ceil((FELICITATION_COOLDOWN_MS - (now - lastFelic)) / 1000);
            // Si adquirimos el lock y va a fallar el cooldown, liberamos el lock
            if (sound === 'MBMusica.mp3') musicLock = null;
            return res.status(429).json({ error: `Espera ${remaining}s antes de volver a felicitar` });
        }
        felicitationCooldown.set(senderKey, now);

        // Obtener avatar del remitente
        const sender = await db.getUser(req.user.username);
        const senderAvatar = sender?.profile_image || '/img/yocapi.png';
        const senderName = sender?.display_name || req.user.username;

        const customMsg = (req.body.message || '').trim().slice(0, 60);

        // Broadcast al overlay como evento de felicitación
        broadcastToOverlay({
            type: 'felicitation',
            from: senderName,
            fromAvatar: senderAvatar,
            to: target.display_name,
            sound,
            message: customMsg,
            timestamp: Date.now()
        });

        // Si es música, broadcast del estado del lock a todos los clientes del portal
        if (sound === 'MBMusica.mp3') {
            broadcastToOverlay({ type: 'music_lock_update', music_lock: getMusicLockStatus() });
        }

        res.json({
            success: true,
            message: `¡Felicitación enviada a ${target.display_name}!`,
            music_lock: getMusicLockStatus()
        });
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

    res.write(`data: ${JSON.stringify({ 
        type: 'connected', 
        time: Date.now(),
        config: appSettings.overlay_config || DEFAULT_OVERLAY_CONFIG
    })}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
        sseClients.delete(res);
    });
});

// Obtener configuración visual del overlay
app.get('/api/overlay/config', (req, res) => {
    res.json(appSettings.overlay_config || DEFAULT_OVERLAY_CONFIG);
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
        if (!u.birth_month || !u.birth_day || u.birthday_unlocked === true || u.birthday_unlocked === 1) continue;
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
    try {
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
    } catch (err) {
        console.error('Error en /api/dashboard/birthdays:', err);
        res.status(500).json({ error: 'Error al consultar cumpleaños' });
    }
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
        user.birth_month = 0;
        user.birth_day = 0;
        await db.saveUser(user);

        res.json({ success: true, message: `¡Fecha de @${user.username} desbloqueada y reseteada! Ya puede elegir y confirmar su fecha correcta en su perfil.` });
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

// Obtener estado de felicitaciones en directo
app.get('/api/dashboard/felicitations-status', authenticateDashboard, (req, res) => {
    res.json({ enabled: !!appSettings.felicitations_enabled });
});

// Habilitar / Desactivar felicitaciones en directo
app.post('/api/dashboard/felicitations-toggle', authenticateDashboard, (req, res) => {
    if (typeof req.body.enabled === 'boolean') {
        appSettings.felicitations_enabled = req.body.enabled;
    } else {
        appSettings.felicitations_enabled = !appSettings.felicitations_enabled;
    }
    saveAppSettings();
    res.json({
        success: true,
        enabled: appSettings.felicitations_enabled,
        message: appSettings.felicitations_enabled ? '¡Felicitaciones en directo activadas!' : 'Felicitaciones en directo desactivadas.'
    });
});

// Lanzar alerta manual o de prueba desde el Dashboard
app.post('/api/dashboard/trigger-alert', authenticateDashboard, async (req, res) => {
    const { user, sound, message, avatar, theme, isTest } = req.body;

    let finalAvatar = avatar;
    if (!finalAvatar || finalAvatar === '/img/yocapi.png' || !finalAvatar.startsWith('http')) {
        const fetched = await fetchPublicTwitchAvatar(user || 'capiluisxavi');
        finalAvatar = (fetched && fetched.startsWith('http')) ? fetched : '/img/yocapi.png';
    }

    const alertPayload = {
        type: 'alert',
        user: user || 'capiluisxavi',
        avatar: finalAvatar,
        sound: sound || 'HBSilbato.mp3',
        message: message || '¡Festejando en directo con la comunidad! 🎂✨',
        isToday: true,
        isGrace: false,
        theme: theme || 'purple',
        timestamp: Date.now()
    };

    broadcastToOverlay(alertPayload);

    // Solo guardar en base de datos si NO es una prueba
    if (!isTest) {
        await db.logAlert({
            username: 'streamer_manual',
            display_name: alertPayload.user,
            sound_file: alertPayload.sound,
            message: alertPayload.message
        });
    }

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

// Obtener configuración del Overlay (Dashboard)
app.get('/api/dashboard/overlay-config', authenticateDashboard, (req, res) => {
    res.json(appSettings.overlay_config || DEFAULT_OVERLAY_CONFIG);
});

// Guardar y Aplicar en tiempo real la configuración del Overlay (Dashboard)
app.post('/api/dashboard/overlay-config', authenticateDashboard, (req, res) => {
    try {
        const { posX, posY, scale, animation, volume } = req.body;
        const cleanX = Math.max(5, Math.min(95, parseFloat(posX) || 50));
        const cleanY = Math.max(5, Math.min(95, parseFloat(posY) || 85));
        const cleanScale = Math.max(0.4, Math.min(1.5, parseFloat(scale) || 0.85));
        const validAnims = ['slide-up', 'slide-down', 'slide-left', 'slide-right', 'pop-zoom', 'bounce-drop', 'fade-glow'];
        const cleanAnim = validAnims.includes(animation) ? animation : 'slide-up';
        const cleanVol = Math.max(0, Math.min(1, parseFloat(volume) !== undefined && !isNaN(parseFloat(volume)) ? parseFloat(volume) : 0.85));

        appSettings.overlay_config = {
            posX: Math.round(cleanX * 10) / 10,
            posY: Math.round(cleanY * 10) / 10,
            scale: Math.round(cleanScale * 100) / 100,
            animation: cleanAnim,
            volume: Math.round(cleanVol * 100) / 100,
            updatedAt: Date.now()
        };

        saveAppSettings();

        // Broadcast instantáneo a todas las conexiones de OBS activas
        broadcastToOverlay({
            type: 'overlay_config',
            config: appSettings.overlay_config
        });

        res.json({
            success: true,
            message: '¡Configuración guardada y transmitida a OBS Studio en tiempo real!',
            config: appSettings.overlay_config
        });
    } catch (err) {
        console.error('Error guardando overlay-config:', err);
        res.status(500).json({ error: 'Error del servidor al guardar configuración' });
    }
});

// ─── BOTÓN DE PÁNICO (DETENER / OCULTAR ALERTA EN OBS) ──────────────────────
app.post('/api/dashboard/stop-alert', authenticateDashboard, (req, res) => {
    broadcastToOverlay({ type: 'stop_alert' });
    res.json({
        success: true,
        message: '🛑 Alerta detenida y silenciada en OBS de emergencia'
    });
});

// ─── PAUSAR / REANUDAR ENTRADA DE ALERTAS (MODO PARTIDA) ────────────────────
app.post('/api/dashboard/toggle-pause-alerts', authenticateDashboard, (req, res) => {
    if (typeof req.body.paused === 'boolean') {
        appSettings.alerts_paused = req.body.paused;
    } else {
        appSettings.alerts_paused = !appSettings.alerts_paused;
    }
    saveAppSettings();
    res.json({
        success: true,
        alerts_paused: appSettings.alerts_paused,
        message: appSettings.alerts_paused ? '⏸️ Alertas pausadas (se guardarán en cola)' : '▶️ Alertas reanudadas'
    });
});

app.get('/api/dashboard/paused-queue', authenticateDashboard, (req, res) => {
    res.json({
        alerts_paused: !!appSettings.alerts_paused,
        queue: pausedAlertsQueue
    });
});

app.post('/api/dashboard/release-paused-alert', authenticateDashboard, (req, res) => {
    const { id, releaseAll } = req.body;
    if (releaseAll) {
        const released = [...pausedAlertsQueue];
        pausedAlertsQueue.length = 0;
        released.forEach((item, index) => {
            setTimeout(() => {
                broadcastToOverlay(item.payload);
            }, index * 2500);
        });
        return res.json({ success: true, releasedCount: released.length, message: `Se liberaron ${released.length} alertas a OBS` });
    }

    const idx = pausedAlertsQueue.findIndex(a => a.id === id);
    if (idx !== -1) {
        const item = pausedAlertsQueue.splice(idx, 1)[0];
        broadcastToOverlay(item.payload);
        return res.json({ success: true, message: `Alerta de ${item.user} enviada a OBS` });
    }
    res.status(404).json({ error: 'Alerta no encontrada en la cola' });
});

// ─── EXPORTAR RESPALDO A CSV PARA EXCEL ────────────────────────────────────
app.get('/api/dashboard/export-csv', authenticateDashboard, async (req, res) => {
    try {
        const users = await db.getAllUsers();
        const monthNames = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

        let csv = '\uFEFF'; // BOM para que Excel abra UTF-8 con tildes y caracteres especiales
        csv += 'Usuario,Nombre_Pantalla,Mes,Dia,Mensaje,Sonido,Fecha_Registro,Fecha_Fijada\n';

        for (const u of users) {
            const m = monthNames[u.birth_month] || u.birth_month || '';
            const d = u.birth_day || '';
            const msg = `"${(u.custom_message || '').replace(/"/g, '""')}"`;
            const sound = u.selected_sound || 'HBSilbato.mp3';
            const regDate = u.created_at ? new Date(u.created_at).toLocaleDateString('es-ES') : '';
            const lockDate = u.birthday_locked_at ? new Date(u.birthday_locked_at).toLocaleDateString('es-ES') : '';

            csv += `"${u.username}","${u.display_name || u.username}","${m}",${d},${msg},"${sound}","${regDate}","${lockDate}"\n`;
        }

        const dateStr = new Date().toISOString().split('T')[0];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="yocapi_cumpleanos_${dateStr}.csv"`);
        res.send(csv);
    } catch (err) {
        console.error('Error exportando CSV:', err);
        res.status(500).send('Error exportando archivo CSV');
    }
});

// ─── API PARA NIGHTBOT & BOTS DE TWITCH (PLAIN TEXT) ─────────────────────────
app.get('/api/bot/today', async (req, res) => {
    res.type('text/plain; charset=utf-8');
    try {
        const users = await db.getAllUsers();
        const todayBirthdays = [];   // cumpleaños exacto hoy
        const graceNotLaunched = []; // en gracia, aún no han lanzado su alerta
        const graceLaunched = [];    // en gracia, ya lanzaron su alerta

        for (const u of users) {
            if (!u.birth_month || !u.birth_day || u.birthday_unlocked) continue;
            const status = getBirthdayStatus(u.birth_month, u.birth_day);
            if (!status.canCelebrate) continue;
            const lastCelebrated = parseInt(u.last_celebrated_year, 10) || 0;
            const alreadyCelebrated = lastCelebrated >= status.celebrationYear;
            const name = u.display_name || u.username;
            if (status.isToday) {
                todayBirthdays.push(name);
            } else if (alreadyCelebrated) {
                graceLaunched.push(name);
            } else {
                graceNotLaunched.push(name);
            }
        }

        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers.host || `localhost:${PORT}`;
        const siteUrl = `${protocol}://${host}`;

        const parts = [];
        if (todayBirthdays.length > 0) {
            const list = todayBirthdays.map(n => `@${n}`).join(', ');
            parts.push(`🎂 ¡HOY de cumpleaños: ${list}! ¡Lanza tu alerta ahora en ${siteUrl} 🎉`);
        }
        if (graceNotLaunched.length > 0) {
            const list = graceNotLaunched.map(n => `@${n}`).join(', ');
            parts.push(`🎈 ¡Aún en período de gracia: ${list}! ¡Entra y lanza tu alerta antes de que expire! 👉 ${siteUrl}`);
        }
        if (graceLaunched.length > 0) {
            const list = graceLaunched.map(n => `@${n}`).join(', ');
            parts.push(`🥳 ¡Feliz cumple tardío a ${list}! ¡Ya celebraron este año! 🎊`);
        }

        if (parts.length > 0) {
            return res.send(parts.join(' | '));
        } else {
            return res.send(`✨ Hoy no hay cumpleaños registrados en la comunidad. ¡Registra el tuyo para que te festejemos en stream! 👉 ${siteUrl}`);
        }
    } catch (err) {
        res.send('⚠️ Error consultando cumpleaños.');
    }
});

app.get('/api/bot/check', async (req, res) => {
    res.type('text/plain; charset=utf-8');
    try {
        let rawUser = req.query.user || req.query.sender || req.query.q || '';
        // Si Nightbot pasó "$(query)" como texto literal porque no hubo argumentos, usar fallback
        if (rawUser.includes('$(query)')) {
            rawUser = req.query.sender || '';
        }
        const queryUser = rawUser.trim().replace(/^@/, '').toLowerCase();
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers.host || `localhost:${PORT}`;
        const siteUrl = `${protocol}://${host}`;

        if (!queryUser) {
            return res.send(`ℹ️ Usa: !micumple [usuario] | Para registrarte: ${siteUrl}`);
        }

        const user = await db.getUser(queryUser);
        if (!user || !user.birth_month || !user.birth_day || user.birthday_unlocked) {
            return res.send(`⚠️ @${queryUser}, aún no has registrado tu cumpleaños en la plataforma. ¡Hazlo gratis aquí! 👉 ${siteUrl}`);
        }

        const status = getBirthdayStatus(user.birth_month, user.birth_day);
        const monthNames = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const monthText = monthNames[user.birth_month] || user.birth_month;
        const displayName = user.display_name || user.username;

        if (status.canCelebrate) {
            const lastCelebrated = parseInt(user.last_celebrated_year, 10) || 0;
            const alreadyCelebrated = lastCelebrated >= status.celebrationYear;

            if (status.isToday) {
                if (alreadyCelebrated) {
                    // Cumpleaños hoy pero ya lanzó la alerta
                    return res.send(`🥳 ¡Feliz cumpleaños @${displayName}! 🎊 ¡Ya lanzaste tu alerta de cumpleaños hoy, esperamos que hayas disfrutado tu momento especial en el stream! 🎂`);
                } else {
                    // Cumpleaños exacto hoy, no ha lanzado
                    return res.send(`🎂 ¡HOY ES TU CUMPLEAÑOS @${displayName}! 🎉 ¡No te olvides de entrar y lanzar tu alerta con sonido en directo ahora! 👉 ${siteUrl}`);
                }
            } else {
                // Período de gracia
                const daysLeft = status.daysRemainingInGrace;
                const daysLeftText = daysLeft === 1 ? 'solo 1 día' : `${daysLeft} días`;
                if (alreadyCelebrated) {
                    // Ya celebró en el período de gracia
                    return res.send(`🥳 ¡Feliz cumple tardío @${displayName}! 🎊 Ya lanzaste tu alerta este año. ¡Hasta el próximo cumpleaños! 🎂`);
                } else {
                    // En gracia, aún no ha lanzado
                    return res.send(`🎈 @${displayName}, tu cumpleaños fue el ${user.birth_day} de ${monthText} y ¡aún puedes lanzar tu alerta! Te quedan ${daysLeftText} de período de gracia. ¡Entra ya! 👉 ${siteUrl}`);
                }
            }
        }

        const days = status.daysUntilBirthday;
        const daysText = days === 1 ? '¡falta solo 1 día!' : `faltan ${days} días`;
        return res.send(`🎉 @${displayName}, tu cumpleaños está registrado para el ${user.birth_day} de ${monthText} (${daysText}). ¡Te esperamos en stream! 🎂`);
    } catch (err) {
        res.send('⚠️ Error consultando usuario.');
    }
});

// ─── API NIGHTBOT: Próximos cumpleaños en 15 días ───────────────────────────
app.get('/api/bot/next', async (req, res) => {
    res.type('text/plain; charset=utf-8');
    try {
        const users = await db.getAllUsers();
        const monthNames = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers.host || `localhost:${PORT}`;
        const siteUrl = `${protocol}://${host}`;

        const upcoming = [];
        for (const u of users) {
            if (!u.birth_month || !u.birth_day || u.birthday_unlocked) continue;
            const status = getBirthdayStatus(u.birth_month, u.birth_day);
            if (!status.canCelebrate && status.daysUntilBirthday > 0 && status.daysUntilBirthday <= 15) {
                upcoming.push({ name: u.display_name || u.username, day: u.birth_day, month: u.birth_month, days: status.daysUntilBirthday });
            }
        }
        upcoming.sort((a, b) => a.days - b.days);

        if (upcoming.length === 0) {
            return res.send(`📅 No hay cumpleaños registrados en los próximos 15 días en la comunidad. ¡Registra el tuyo aquí! 👉 ${siteUrl}`);
        }

        const list = upcoming.map(u => {
            const daysText = u.days === 1 ? '¡mañana!' : `en ${u.days} días`;
            return `@${u.name} (${u.day} de ${monthNames[u.month]}, ${daysText})`;
        }).join(' · ');
        return res.send(`📅 Próximos cumpleaños (15 días): ${list} 🎂 ¡Regístrate en ${siteUrl}!`);
    } catch (err) {
        res.send('⚠️ Error consultando próximos cumpleaños.');
    }
});

// ─── API NIGHTBOT: Cumpleaños de todo el mes en curso ───────────────────────
app.get('/api/bot/month', async (req, res) => {
    res.type('text/plain; charset=utf-8');
    try {
        const users = await db.getAllUsers();
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const monthNames = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const monthTitle = monthNames[currentMonth];
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers.host || `localhost:${PORT}`;
        const siteUrl = `${protocol}://${host}`;

        const inMonth = [];
        for (const u of users) {
            if (!u.birth_month || !u.birth_day || u.birthday_unlocked) continue;
            if (parseInt(u.birth_month, 10) === currentMonth) {
                inMonth.push({ name: u.display_name || u.username, day: parseInt(u.birth_day, 10) });
            }
        }
        inMonth.sort((a, b) => a.day - b.day);

        if (inMonth.length === 0) {
            return res.send(`🗓️ No hay cumpleaños registrados en ${monthTitle}. ¡Registra el tuyo en ${siteUrl}! 🎈`);
        }

        const list = inMonth.map(u => `@${u.name} (día ${u.day})`).join(', ');
        return res.send(`🗓️ Cumpleaños de ${monthTitle} (${inMonth.length}): ${list} 🎂 ¡Festejemos en stream!`);
    } catch (err) {
        res.send('⚠️ Error consultando cumpleaños del mes.');
    }
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
