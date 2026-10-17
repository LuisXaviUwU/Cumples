/**
 * YoCapi Birthday System v2.0 — Backend Server
 * Express + Firebase Firestore (con SQLite fallback) + Twitch OAuth + SSE OBS Overlay
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
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || '';
const STREAMER_LOGIN = (process.env.STREAMER_LOGIN || 'yocapi_pr').toLowerCase();
const DASHBOARD_KEY = process.env.DASHBOARD_KEY || 'C4p1!267';
const OVERLAY_TOKEN = process.env.OVERLAY_TOKEN || 'yocapi_birthday_secret_token';

const BIRTHDAY_GRACE_DAYS = 14;
const ALERT_COOLDOWN_MS = 30_000; // 30 segundos entre alertas del mismo usuario

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Servir estáticos
app.use(express.static(path.join(__dirname, 'public')));

// ─── Estado en Memoria para OBS Overlay ──────────────────────────────────────
const sseClients = new Set(); // Conexiones activas de OBS
const recentAlertsCache = new Map(); // twitch_id -> timestamp última alerta

// ─── Helpers Twitch API ──────────────────────────────────────────────────────
function httpsRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });
        req.on('error', reject);
        if (postData) req.write(postData);
        req.end();
    });
}

async function getTwitchUserByToken(accessToken) {
    const res = await httpsRequest({
        hostname: 'api.twitch.tv',
        path: '/helix/users',
        method: 'GET',
        headers: {
            'Client-Id': TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${accessToken}`
        }
    });
    if (res.status === 200 && res.body?.data?.length > 0) {
        return res.body.data[0];
    }
    return null;
}

async function checkFollowerStatus(streamerId, userId, streamerToken) {
    if (!streamerToken || !streamerId) return true; // Si no hay token de streamer, permitir
    try {
        const res = await httpsRequest({
            hostname: 'api.twitch.tv',
            path: `/helix/channels/followers?broadcaster_id=${streamerId}&user_id=${userId}`,
            method: 'GET',
            headers: {
                'Client-Id': TWITCH_CLIENT_ID,
                'Authorization': `Bearer ${streamerToken}`
            }
        });
        return res.status === 200 && res.body?.data?.length > 0;
    } catch {
        return true;
    }
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

    // Calcular días faltantes para el próximo cumpleaños
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

// ─── Auth Middleware ────────────────────────────────────────────────────────
async function authenticateUser(req, res, next) {
    const token = req.cookies.yocapi_session || req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No autenticado' });

    const session = await db.getSession(token);
    if (!session) return res.status(401).json({ error: 'Sesión expirada o inválida' });

    req.user = session;
    next();
}

function authenticateDashboard(req, res, next) {
    const key = req.headers['x-dashboard-key'] || req.cookies.yocapi_dash_key;
    if (key !== DASHBOARD_KEY) {
        return res.status(403).json({ error: 'Clave de acceso de streamer inválida' });
    }
    next();
}

// ─── Rutas de Autenticación Twitch ──────────────────────────────────────────

// Iniciar login de seguidor
app.get('/auth/twitch/user', async (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    await db.createOAuthState(state, 'user');

    const redirectUri = `${APP_URL}/auth/twitch/callback`;
    const twitchUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${TWITCH_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=user:read:email&state=${state}`;
    res.redirect(twitchUrl);
});

// Iniciar login de streamer
app.get('/auth/twitch/streamer', async (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    await db.createOAuthState(state, 'streamer');

    const redirectUri = `${APP_URL}/auth/twitch/callback`;
    const twitchUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${TWITCH_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=moderator:read:followers&state=${state}`;
    res.redirect(twitchUrl);
});

// Callback unificado de Twitch
app.get('/auth/twitch/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error || !code || !state) {
        return res.redirect('/?error=' + encodeURIComponent(error || 'auth_failed'));
    }

    const savedState = await db.getOAuthState(state);
    if (!savedState) {
        return res.redirect('/?error=invalid_state');
    }
    await db.deleteOAuthState(state);

    const redirectUri = `${APP_URL}/auth/twitch/callback`;
    const tokenParams = new URLSearchParams({
        client_id: TWITCH_CLIENT_ID,
        client_secret: TWITCH_CLIENT_SECRET,
        code: String(code),
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
    });

    try {
        const tokenRes = await httpsRequest({
            hostname: 'id.twitch.tv',
            path: '/oauth2/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }, tokenParams.toString());

        if (tokenRes.status !== 200 || !tokenRes.body.access_token) {
            console.error('Error obteniendo token de Twitch:', tokenRes.body);
            return res.redirect('/?error=token_exchange_failed');
        }

        const accessToken = tokenRes.body.access_token;
        const refreshToken = tokenRes.body.refresh_token;
        const twitchUser = await getTwitchUserByToken(accessToken);

        if (!twitchUser) {
            return res.redirect('/?error=user_fetch_failed');
        }

        if (savedState.flow === 'streamer') {
            // Guardar credenciales del streamer
            await db.setConfig('streamer_access_token', accessToken);
            if (refreshToken) await db.setConfig('streamer_refresh_token', refreshToken);
            await db.setConfig('streamer_id', twitchUser.id);
            await db.setConfig('streamer_login', twitchUser.login);

            res.cookie('yocapi_dash_key', DASHBOARD_KEY, { httpOnly: true, maxAge: 30 * 86400 * 1000 });
            return res.redirect('/dashboard?streamer_connected=1');
        } else {
            // Flujo de usuario seguidor
            const sessionToken = crypto.randomBytes(32).toString('hex');
            await db.createSession(sessionToken, twitchUser);

            res.cookie('yocapi_session', sessionToken, {
                httpOnly: true,
                maxAge: 30 * 24 * 60 * 60 * 1000,
                sameSite: 'lax'
            });

            return res.redirect('/');
        }
    } catch (err) {
        console.error('Error en callback:', err);
        return res.redirect('/?error=server_error');
    }
});

app.get('/auth/logout', async (req, res) => {
    const token = req.cookies.yocapi_session;
    if (token) await db.deleteSession(token);
    res.clearCookie('yocapi_session');
    res.redirect('/');
});

// ─── API PÚBLICA / USUARIO ──────────────────────────────────────────────────

// Obtener datos del usuario logueado + su registro de cumpleaños
app.get('/api/me', authenticateUser, async (req, res) => {
    const bday = await db.getBirthday(req.user.twitch_id);
    let status = null;
    if (bday) {
        status = getBirthdayStatus(bday.birth_month, bday.birth_day);
    }
    res.json({
        user: {
            twitch_id: req.user.twitch_id,
            login: req.user.login,
            display_name: req.user.display_name,
            profile_image: req.user.profile_image
        },
        birthday: bday,
        status: status,
        streamer_login: STREAMER_LOGIN
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

// Registrar o actualizar fecha de cumpleaños
app.post('/api/birthday/register', authenticateUser, async (req, res) => {
    const { birth_month, birth_day, custom_message, selected_sound } = req.body;
    const month = parseInt(birth_month, 10);
    const day = parseInt(birth_day, 10);

    if (isNaN(month) || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Mes inválido (1-12)' });
    }
    if (isNaN(day) || day < 1 || day > 31) {
        return res.status(400).json({ error: 'Día inválido (1-31)' });
    }

    const existing = await db.getBirthday(req.user.twitch_id);
    const changesCount = existing ? (existing.changes_count || 0) + 1 : 0;

    const saved = await db.saveBirthday({
        twitch_id: req.user.twitch_id,
        twitch_login: req.user.login,
        display_name: req.user.display_name,
        profile_image: req.user.profile_image,
        birth_month: month,
        birth_day: day,
        custom_message: (custom_message || '').slice(0, 120),
        selected_sound: selected_sound || 'HBSilbato.mp3',
        changes_count: changesCount,
        last_changed_at: new Date().toISOString(),
        registered_at: existing?.registered_at || new Date().toISOString()
    });

    const status = getBirthdayStatus(month, day);
    res.json({ success: true, birthday: saved, status });
});

// Lanzar alerta en directo a OBS (Seguidor)
app.post('/api/birthday/alert', authenticateUser, async (req, res) => {
    const bday = await db.getBirthday(req.user.twitch_id);
    if (!bday) {
        return res.status(400).json({ error: 'No tienes un cumpleaños registrado' });
    }

    const status = getBirthdayStatus(bday.birth_month, bday.birth_day);
    if (!status.canCelebrate) {
        return res.status(400).json({
            error: `Aún no es tu período de cumpleaños. Faltan ${status.daysUntilBirthday} días.`
        });
    }

    // Cooldown check
    const lastAlert = recentAlertsCache.get(req.user.twitch_id) || 0;
    const now = Date.now();
    if (now - lastAlert < ALERT_COOLDOWN_MS) {
        const remainingSeconds = Math.ceil((ALERT_COOLDOWN_MS - (now - lastAlert)) / 1000);
        return res.status(429).json({
            error: `Espera ${remainingSeconds}s antes de enviar otra alerta.`
        });
    }

    recentAlertsCache.set(req.user.twitch_id, now);

    // Actualizar registro
    bday.last_activated = new Date().toISOString();
    bday.last_played_date = new Date().toISOString().split('T')[0];
    await db.saveBirthday(bday);

    // Registrar en log
    await db.logAlert({
        twitch_id: bday.twitch_id,
        display_name: bday.display_name,
        sound_file: bday.selected_sound,
        message: bday.custom_message
    });

    // Enviar a todos los overlays de OBS conectados
    const alertPayload = {
        type: 'alert',
        user: bday.display_name,
        avatar: bday.profile_image,
        sound: bday.selected_sound,
        message: bday.custom_message,
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

// Heartbeat ping a OBS cada 20 segundos para evitar que Render o el navegador cierren la conexión
setInterval(() => {
    if (sseClients.size > 0) {
        broadcastToOverlay({ type: 'ping', time: Date.now() });
    }
}, 20_000);

// ─── API DASHBOARD STREAMER ─────────────────────────────────────────────────

app.post('/api/dashboard/auth', (req, res) => {
    const { key } = req.body;
    if (key === DASHBOARD_KEY) {
        res.cookie('yocapi_dash_key', DASHBOARD_KEY, {
            httpOnly: true,
            maxAge: 30 * 86400 * 1000,
            sameSite: 'lax'
        });
        return res.json({ success: true });
    }
    return res.status(401).json({ error: 'Clave incorrecta' });
});

app.get('/api/dashboard/stats', authenticateDashboard, async (req, res) => {
    const allBirthdays = await db.getAllBirthdays();
    const alertLogs = await db.getAlertLogs(100);

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();

    let todayCount = 0;
    let graceCount = 0;

    for (const b of allBirthdays) {
        const status = getBirthdayStatus(b.birth_month, b.birth_day);
        if (status.isToday) todayCount++;
        else if (status.isGracePeriod) graceCount++;
    }

    res.json({
        totalRegistered: allBirthdays.length,
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
    const allBirthdays = await db.getAllBirthdays();
    const todayList = [];

    for (const b of allBirthdays) {
        const status = getBirthdayStatus(b.birth_month, b.birth_day);
        if (status.canCelebrate) {
            todayList.push({
                ...b,
                status
            });
        }
    }

    res.json(todayList);
});

app.get('/api/dashboard/birthdays', authenticateDashboard, async (req, res) => {
    const month = req.query.month ? parseInt(req.query.month, 10) : null;
    const search = (req.query.search || '').toLowerCase().trim();

    let all = await db.getAllBirthdays();

    if (month && !isNaN(month)) {
        all = all.filter(b => b.birth_month === month);
    }
    if (search) {
        all = all.filter(b =>
            (b.display_name && b.display_name.toLowerCase().includes(search)) ||
            (b.twitch_login && b.twitch_login.toLowerCase().includes(search))
        );
    }

    res.json(all);
});

app.delete('/api/dashboard/birthdays/:id', authenticateDashboard, async (req, res) => {
    await db.deleteBirthday(req.params.id);
    res.json({ success: true });
});

// Lanzar alerta manual o de test desde el Dashboard
app.post('/api/dashboard/trigger-alert', authenticateDashboard, async (req, res) => {
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
        twitch_id: 'manual_' + Date.now(),
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

// ─── Rutas Frontend (HTML) ──────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/overlay', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
});

// ─── Inicio de Servidor ─────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n==================================================`);
    console.log(`🎂 YoCapi Birthday Platform v2.0 Activa`);
    console.log(`🌐 Servidor: http://localhost:${PORT}`);
    console.log(`📺 Overlay OBS: http://localhost:${PORT}/overlay?token=${OVERLAY_TOKEN}`);
    console.log(`⚙️  Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`💾 Base de datos: ${db.getMode().toUpperCase()}`);
    console.log(`==================================================\n`);
});
