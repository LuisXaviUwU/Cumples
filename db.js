/**
 * YoCapi Birthday System — Capa de Persistencia Universal
 * Soporta:
 *  1. Firebase Firestore (Modo Cloud recomendado para Render)
 *  2. SQLite nativo (node:sqlite, Fallback local automático sin configuración extra)
 */

const fs = require('fs');
const path = require('path');

let mode = 'sqlite'; // 'firestore' | 'sqlite'
let firestoreDb = null;
let sqliteDb = null;

// Inicialización de la base de datos
function initDatabase() {
    // 1. Probar Firebase Firestore si está configurado
    try {
        const admin = require('firebase-admin');

        let serviceAccount = null;
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            try {
                serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            } catch (err) {
                console.error('[DB] Error parseando FIREBASE_SERVICE_ACCOUNT JSON:', err.message);
            }
        } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
            const keyPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
            if (fs.existsSync(keyPath)) {
                serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
            }
        } else {
            const defaultKey = path.join(__dirname, 'firebase-key.json');
            if (fs.existsSync(defaultKey)) {
                serviceAccount = JSON.parse(fs.readFileSync(defaultKey, 'utf8'));
            }
        }

        if (serviceAccount && !admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            firestoreDb = admin.firestore();
            mode = 'firestore';
            console.log('🔥 [DB] Conectado exitosamente a Firebase Firestore (Modo Cloud)');
            return;
        }
    } catch (e) {
        console.log('[DB] Firebase no inicializado (' + e.message + '). Usando modo SQLite local.');
    }

    // 2. Modo SQLite (Local)
    const { DatabaseSync } = require('node:sqlite');
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    
    const dbPath = path.join(dataDir, 'birthdays.db');
    sqliteDb = new DatabaseSync(dbPath);
    
    sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS birthdays (
            twitch_id       TEXT PRIMARY KEY,
            twitch_login    TEXT NOT NULL,
            display_name    TEXT NOT NULL,
            profile_image   TEXT,
            birth_month     INTEGER NOT NULL,
            birth_day       INTEGER NOT NULL,
            custom_message  TEXT DEFAULT '',
            selected_sound  TEXT DEFAULT 'HBSilbato.mp3',
            changes_count   INTEGER DEFAULT 0,
            last_changed_at TEXT,
            registered_at   TEXT NOT NULL,
            last_activated  TEXT,
            last_played_date TEXT
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token        TEXT PRIMARY KEY,
            twitch_id    TEXT NOT NULL,
            login        TEXT NOT NULL,
            display_name TEXT NOT NULL,
            profile_image TEXT,
            created_at   TEXT NOT NULL,
            expires_at   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS oauth_states (
            state       TEXT PRIMARY KEY,
            flow        TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS alert_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            twitch_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            sound_file TEXT NOT NULL,
            message TEXT DEFAULT '',
            launched_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS system_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    `);

    mode = 'sqlite';
    console.log('💾 [DB] Conectado a SQLite local (data/birthdays.db)');
}

initDatabase();

// ─── API PÚBLICA DE BASE DE DATOS ──────────────────────────────────────────

const db = {
    getMode() {
        return mode;
    },

    // ─ CUMPLEAÑOS ───────────────────────────────────────────────────────────
    async getBirthday(twitch_id) {
        if (mode === 'firestore') {
            const doc = await firestoreDb.collection('birthdays').doc(String(twitch_id)).get();
            return doc.exists ? doc.data() : null;
        } else {
            const stmt = sqliteDb.prepare('SELECT * FROM birthdays WHERE twitch_id = ?');
            return stmt.get(String(twitch_id)) || null;
        }
    },

    async saveBirthday(data) {
        const id = String(data.twitch_id);
        const record = {
            twitch_id: id,
            twitch_login: data.twitch_login || '',
            display_name: data.display_name || '',
            profile_image: data.profile_image || '',
            birth_month: parseInt(data.birth_month, 10),
            birth_day: parseInt(data.birth_day, 10),
            custom_message: data.custom_message || '',
            selected_sound: data.selected_sound || 'HBSilbato.mp3',
            changes_count: data.changes_count !== undefined ? data.changes_count : 0,
            last_changed_at: data.last_changed_at || new Date().toISOString(),
            registered_at: data.registered_at || new Date().toISOString(),
            last_activated: data.last_activated || null,
            last_played_date: data.last_played_date || null
        };

        if (mode === 'firestore') {
            await firestoreDb.collection('birthdays').doc(id).set(record, { merge: true });
        } else {
            const stmt = sqliteDb.prepare(`
                INSERT INTO birthdays (
                    twitch_id, twitch_login, display_name, profile_image,
                    birth_month, birth_day, custom_message, selected_sound,
                    changes_count, last_changed_at, registered_at, last_activated, last_played_date
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(twitch_id) DO UPDATE SET
                    twitch_login = excluded.twitch_login,
                    display_name = excluded.display_name,
                    profile_image = excluded.profile_image,
                    birth_month = excluded.birth_month,
                    birth_day = excluded.birth_day,
                    custom_message = excluded.custom_message,
                    selected_sound = excluded.selected_sound,
                    changes_count = excluded.changes_count,
                    last_changed_at = excluded.last_changed_at,
                    last_activated = excluded.last_activated,
                    last_played_date = excluded.last_played_date
            `);
            stmt.run(
                record.twitch_id, record.twitch_login, record.display_name, record.profile_image,
                record.birth_month, record.birth_day, record.custom_message, record.selected_sound,
                record.changes_count, record.last_changed_at, record.registered_at, record.last_activated, record.last_played_date
            );
        }
        return record;
    },

    async getAllBirthdays() {
        if (mode === 'firestore') {
            const snapshot = await firestoreDb.collection('birthdays').get();
            const list = [];
            snapshot.forEach(doc => list.push(doc.data()));
            return list.sort((a, b) => a.birth_month - b.birth_month || a.birth_day - b.birth_day);
        } else {
            const stmt = sqliteDb.prepare('SELECT * FROM birthdays ORDER BY birth_month ASC, birth_day ASC');
            return stmt.all();
        }
    },

    async deleteBirthday(twitch_id) {
        if (mode === 'firestore') {
            await firestoreDb.collection('birthdays').doc(String(twitch_id)).delete();
        } else {
            sqliteDb.prepare('DELETE FROM birthdays WHERE twitch_id = ?').run(String(twitch_id));
        }
        return true;
    },

    // ─ SESIONES ─────────────────────────────────────────────────────────────
    async createSession(token, user) {
        const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(); // 30 días
        const session = {
            token,
            twitch_id: String(user.id || user.twitch_id),
            login: user.login,
            display_name: user.display_name,
            profile_image: user.profile_image_url || user.profile_image || '',
            created_at: new Date().toISOString(),
            expires_at: expiresAt
        };

        if (mode === 'firestore') {
            await firestoreDb.collection('sessions').doc(token).set(session);
        } else {
            sqliteDb.prepare(`
                INSERT INTO sessions (token, twitch_id, login, display_name, profile_image, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(session.token, session.twitch_id, session.login, session.display_name, session.profile_image, session.created_at, session.expires_at);
        }
        return session;
    },

    async getSession(token) {
        if (!token) return null;
        if (mode === 'firestore') {
            const doc = await firestoreDb.collection('sessions').doc(token).get();
            if (!doc.exists) return null;
            const data = doc.data();
            if (new Date(data.expires_at) < new Date()) {
                await firestoreDb.collection('sessions').doc(token).delete();
                return null;
            }
            return data;
        } else {
            const stmt = sqliteDb.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?');
            return stmt.get(token, new Date().toISOString()) || null;
        }
    },

    async deleteSession(token) {
        if (!token) return;
        if (mode === 'firestore') {
            await firestoreDb.collection('sessions').doc(token).delete();
        } else {
            sqliteDb.prepare('DELETE FROM sessions WHERE token = ?').run(token);
        }
    },

    // ─ OAUTH STATES ─────────────────────────────────────────────────────────
    async createOAuthState(state, flow) {
        const item = { state, flow, created_at: new Date().toISOString() };
        if (mode === 'firestore') {
            await firestoreDb.collection('oauth_states').doc(state).set(item);
        } else {
            sqliteDb.prepare('INSERT INTO oauth_states (state, flow, created_at) VALUES (?, ?, ?)').run(state, flow, item.created_at);
        }
    },

    async getOAuthState(state) {
        if (!state) return null;
        if (mode === 'firestore') {
            const doc = await firestoreDb.collection('oauth_states').doc(state).get();
            return doc.exists ? doc.data() : null;
        } else {
            const stmt = sqliteDb.prepare('SELECT * FROM oauth_states WHERE state = ?');
            return stmt.get(state) || null;
        }
    },

    async deleteOAuthState(state) {
        if (!state) return;
        if (mode === 'firestore') {
            await firestoreDb.collection('oauth_states').doc(state).delete();
        } else {
            sqliteDb.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
        }
    },

    // ─ ALERT LOG ────────────────────────────────────────────────────────────
    async logAlert(data) {
        const item = {
            twitch_id: String(data.twitch_id),
            display_name: data.display_name,
            sound_file: data.sound_file,
            message: data.message || '',
            launched_at: new Date().toISOString()
        };
        if (mode === 'firestore') {
            const ref = await firestoreDb.collection('alert_log').add(item);
            return { id: ref.id, ...item };
        } else {
            const stmt = sqliteDb.prepare(`
                INSERT INTO alert_log (twitch_id, display_name, sound_file, message, launched_at)
                VALUES (?, ?, ?, ?, ?)
            `);
            const res = stmt.run(item.twitch_id, item.display_name, item.sound_file, item.message, item.launched_at);
            return { id: res.lastInsertRowid, ...item };
        }
    },

    async getAlertLogs(limit = 50) {
        if (mode === 'firestore') {
            const snap = await firestoreDb.collection('alert_log')
                .orderBy('launched_at', 'desc')
                .limit(limit)
                .get();
            const list = [];
            snap.forEach(d => list.push({ id: d.id, ...d.data() }));
            return list;
        } else {
            const stmt = sqliteDb.prepare('SELECT * FROM alert_log ORDER BY launched_at DESC LIMIT ?');
            return stmt.all(limit);
        }
    },

    // ─ CONFIG PERSISTENTE ───────────────────────────────────────────────────
    async getConfig(key) {
        if (mode === 'firestore') {
            const doc = await firestoreDb.collection('system_config').doc(key).get();
            return doc.exists ? doc.data().value : null;
        } else {
            const stmt = sqliteDb.prepare('SELECT value FROM system_config WHERE key = ?');
            const row = stmt.get(key);
            return row ? row.value : null;
        }
    },

    async setConfig(key, value) {
        if (mode === 'firestore') {
            await firestoreDb.collection('system_config').doc(key).set({ key, value });
        } else {
            sqliteDb.prepare('INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
        }
    }
};

module.exports = db;
