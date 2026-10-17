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
const PORT = process.env.PORT || 3001;

// Configuración general
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const STREAMER_LOGIN = (process.env.STREAMER_LOGIN || 'yocapi_pr').toLowerCase();
const OVERLAY_TOKEN = process.env.OVERLAY_TOKEN || '33c98a5e7659ee191e539ec5cbb7a1b131266643dbd752b6';

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

// ─── Helper: Obtener Avatar Público de Twitch ───────────────────────────────
function fetchPublicTwitchAvatar(username) {
    return new Promise((resolve) => {
        const cleanName = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (!cleanName) return resolve('/img/yocapi.png');

        const req = https.get(`https://decapi.me/twitch/avatar/${cleanName}`, {
            headers: { 'User-Agent': 'YoCapi-Birthday-System/2.0' },
            timeout: 3000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const url = data.trim();
                if (url.startsWith('http://') || url.startsWith('https://')) {
                    resolve(url);
                } else {
                    resolve('/img/yocapi.png');
                }
            });
        });

        req.on('error', () => resolve('/img/yocapi.png'));
        req.on('timeout', () => {
            req.destroy();
            resolve('/img/yocapi.png');
        });
    });
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
    const token = req.cookies.yocapi_session || req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No autenticado' });

    const session = await db.getSession(token);
    if (!session) return res.status(401).json({ error: 'Sesión expirada o inválida' });

    req.user = session;
    next();
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
        const cleanPin = pin ? String(pin).trim() : '';
        if (!cleanPin || cleanPin.length < 6 || cleanPin.length > 10 || !/^\d+$/.test(cleanPin)) {
            return res.status(400).json({ error: 'El PIN debe ser numérico y tener entre 6 y 10 dígitos' });
        }
        if (!secret_word || secret_word.trim().length < 2) {
            return res.status(400).json({ error: 'Ingresa tu palabra secreta para recuperar tu cuenta si olvidas el PIN' });
        }

        const cleanName = username.trim();
        const existing = await db.getUser(cleanName);
        if (existing) {
            return res.status(400).json({ error: 'Este usuario ya está registrado. Por favor inicia sesión con tu PIN.' });
        }

        const month = parseInt(birth_month, 10);
        const day = parseInt(birth_day, 10);
        if (isNaN(month) || month < 1 || month > 12) {
            return res.status(400).json({ error: 'Selecciona un mes válido' });
        }
        if (isNaN(day) || day < 1 || day > 31) {
            return res.status(400).json({ error: 'Selecciona un día válido' });
        }

        // Obtener avatar público de Twitch
        const avatarUrl = await fetchPublicTwitchAvatar(cleanName);

        const newUser = await db.saveUser({
            username: cleanName,
            display_name: cleanName,
            pin_hash: db.hashPin(cleanPin),
            recovery_hash: db.hashSecret(secret_word),
            profile_image: avatarUrl,
            birth_month: month,
            birth_day: day,
            custom_message: custom_message || '',
            selected_sound: selected_sound || 'HBSilbato.mp3'
        });

        const token = crypto.randomBytes(32).toString('hex');
        await db.createSession(token, newUser);

        res.cookie('yocapi_session', token, {
            httpOnly: true,
            maxAge: 60 * 24 * 60 * 60 * 1000,
            sameSite: 'lax'
        });

        res.json({ success: true, user: newUser });
    } catch (err) {
        console.error('Error en registro:', err);
        res.status(500).json({ error: 'Error al registrar: ' + (err.message || 'Error del servidor') });
    }
});

// Recuperar / Restablecer PIN con palabra secreta
app.post('/api/auth/reset-pin', async (req, res) => {
    try {
        const { username, secret_word, new_pin } = req.body;
        if (!username || !secret_word || !new_pin) {
            return res.status(400).json({ error: 'Completa todos los campos' });
        }
        const cleanNewPin = String(new_pin).trim();
        if (cleanNewPin.length < 6 || cleanNewPin.length > 10 || !/^\d+$/.test(cleanNewPin)) {
            return res.status(400).json({ error: 'El nuevo PIN debe ser numérico y tener entre 6 y 10 dígitos' });
        }

        const user = await db.getUser(username);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        if (!user.recovery_hash) {
            return res.status(400).json({ error: 'No tienes una palabra secreta registrada. Pide a yocapi_pr que restablezca tu PIN desde su panel.' });
        }

        if (user.recovery_hash !== db.hashSecret(secret_word)) {
            return res.status(401).json({ error: 'La palabra secreta es incorrecta' });
        }

        await db.updatePin(user.username, cleanNewPin);
        res.json({ success: true, message: '¡PIN restablecido con éxito! Ya puedes iniciar sesión con tu nuevo PIN.' });
    } catch (err) {
        console.error('Error al resetear PIN:', err);
        res.status(500).json({ error: 'Error del servidor al restablecer PIN' });
    }
});

// Inicio de sesión con Nick + PIN
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, pin } = req.body;
        if (!username || !pin) {
            return res.status(400).json({ error: 'Ingresa tu usuario y tu PIN' });
        }

        const user = await db.getUser(username);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado. Regístrate primero.' });
        }

        const hash = db.hashPin(pin);
        if (user.pin_hash !== hash) {
            return res.status(401).json({ error: 'PIN incorrecto' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        await db.createSession(token, user);

        res.cookie('yocapi_session', token, {
            httpOnly: true,
            maxAge: 60 * 24 * 60 * 60 * 1000,
            sameSite: 'lax'
        });

        res.json({ success: true, user });
    } catch (err) {
        console.error('Error en login:', err);
        res.status(500).json({ error: 'Error del servidor al iniciar sesión' });
    }
});

// Cerrar sesión
app.post('/api/auth/logout', async (req, res) => {
    const token = req.cookies.yocapi_session;
    if (token) await db.deleteSession(token);
    res.clearCookie('yocapi_session');
    res.json({ success: true });
});

// ─── API DE USUARIO (DATOS & CUMPLEAÑOS) ────────────────────────────────────

app.get('/api/me', authenticateUser, async (req, res) => {
    const user = await db.getUser(req.user.username);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const status = getBirthdayStatus(user.birth_month, user.birth_day);
    res.json({
        user: {
            username: user.username,
            display_name: user.display_name,
            profile_image: user.profile_image,
            birth_month: user.birth_month,
            birth_day: user.birth_day,
            custom_message: user.custom_message,
            selected_sound: user.selected_sound
        },
        status,
        streamer_login: STREAMER_LOGIN
    });
});

// Actualizar cumpleaños o configuración
app.post('/api/birthday/update', authenticateUser, async (req, res) => {
    try {
        const { birth_month, birth_day, custom_message, selected_sound, new_pin } = req.body;
        const user = await db.getUser(req.user.username);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        const month = parseInt(birth_month, 10);
        const day = parseInt(birth_day, 10);
        if (isNaN(month) || month < 1 || month > 12) {
            return res.status(400).json({ error: 'Mes inválido' });
        }
        if (isNaN(day) || day < 1 || day > 31) {
            return res.status(400).json({ error: 'Día inválido' });
        }

        user.birth_month = month;
        user.birth_day = day;
        user.custom_message = (custom_message || '').slice(0, 100);
        user.selected_sound = selected_sound || 'HBSilbato.mp3';
        if (new_pin && String(new_pin).trim().length > 0) {
            const cleanPin = String(new_pin).trim();
            if (cleanPin.length < 6 || cleanPin.length > 10 || !/^\d+$/.test(cleanPin)) {
                return res.status(400).json({ error: 'El nuevo PIN debe ser numérico y tener entre 6 y 10 dígitos' });
            }
            user.pin_hash = db.hashPin(cleanPin);
        }
        if (req.body.new_secret && req.body.new_secret.trim().length >= 2) {
            user.recovery_hash = db.hashSecret(req.body.new_secret);
        }

        // Refrescar avatar de Twitch por si cambió
        user.profile_image = await fetchPublicTwitchAvatar(user.username);

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

// ─── API DASHBOARD STREAMER (SIN CLAVE) ──────────────────────────────────────

app.get('/api/dashboard/stats', async (req, res) => {
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

app.get('/api/dashboard/today', async (req, res) => {
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

app.get('/api/dashboard/birthdays', async (req, res) => {
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

app.delete('/api/dashboard/birthdays/:username', async (req, res) => {
    await db.deleteUser(req.params.username);
    res.json({ success: true });
});

// Cambiar o restablecer PIN de un usuario desde el Dashboard
app.post('/api/dashboard/users/:username/reset-pin', async (req, res) => {
    try {
        const { new_pin } = req.body;
        const candidate = new_pin ? String(new_pin).trim() : '';
        const pin = (/^\d{6,10}$/.test(candidate)) ? candidate : '123456';
        await db.updatePin(req.params.username, pin);
        res.json({ success: true, message: `PIN de ${req.params.username} cambiado a: ${pin}`, new_pin: pin });
    } catch (err) {
        res.status(500).json({ error: 'Error al cambiar PIN' });
    }
});

// Lanzar alerta manual o de prueba desde el Dashboard
app.post('/api/dashboard/trigger-alert', async (req, res) => {
    const { user, sound, message, avatar, theme } = req.body;

    const alertPayload = {
        type: 'alert',
        user: user || 'Cumpleañero VIP',
        avatar: avatar || '/img/yocapi.png',
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

app.get('/api/dashboard/logs', async (req, res) => {
    const logs = await db.getAlertLogs(30);
    res.json(logs);
});

// ─── Rutas Frontend ─────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/overlay', (req, res) => res.sendFile(path.join(__dirname, 'public', 'overlay.html')));

// ─── Inicio de Servidor ─────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n==================================================`);
    console.log(`🎂 YoCapi Birthday Platform v2.0 (Nick + PIN)`);
    console.log(`🌐 Servidor: http://localhost:${PORT}`);
    console.log(`📺 Overlay OBS: http://localhost:${PORT}/overlay?token=${OVERLAY_TOKEN}`);
    console.log(`⚙️  Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`💾 Base de datos: ${db.getMode().toUpperCase()}`);
    console.log(`==================================================\n`);
});
