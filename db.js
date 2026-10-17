/**
 * YoCapi Birthday System — Capa de Persistencia Universal
 * Modo: Nick de Twitch + PIN + Palabra Secreta de Recuperación
 * Soporta:
 *  1. Firebase Firestore (Modo Cloud en Render con proyecto yocapi-cumples)
 *  2. SQLite nativo (node:sqlite, Fallback local automático)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let mode = 'sqlite';
let firestoreDb = null;
let sqliteDb = null;

function hashPin(pin) {
    return crypto.createHash('sha256').update('yocapi_pin_salt_' + String(pin).trim()).digest('hex');
}

function hashSecret(secret) {
    return crypto.createHash('sha256').update('yocapi_secret_salt_' + String(secret).toLowerCase().trim()).digest('hex');
}

function initDatabase() {
    // 1. Probar Firebase Firestore si está configurado
    try {
        const admin = require('firebase-admin');

        let serviceAccount = null;
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            try {
                let raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
                if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
                    raw = raw.slice(1, -1);
                }
                if (!raw.startsWith('{')) {
                    try {
                        const decoded = Buffer.from(raw, 'base64').toString('utf8');
                        if (decoded.trim().startsWith('{')) raw = decoded;
                    } catch (_) {}
                }
                serviceAccount = JSON.parse(raw);
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
            if (serviceAccount.private_key && typeof serviceAccount.private_key === 'string') {
                serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
            }
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

    // 2. Modo SQLite Local
    const { DatabaseSync } = require('node:sqlite');
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    
    const dbPath = path.join(dataDir, 'birthdays.db');
    sqliteDb = new DatabaseSync(dbPath);
    
    sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS users (
            username        TEXT PRIMARY KEY,
            display_name    TEXT NOT NULL,
            pin_hash        TEXT NOT NULL,
            recovery_hash   TEXT DEFAULT '',
            profile_image   TEXT,
            birth_month     INTEGER NOT NULL,
            birth_day       INTEGER NOT NULL,
            custom_message  TEXT DEFAULT '',
            selected_sound  TEXT DEFAULT 'HBSilbato.mp3',
            registered_at   TEXT NOT NULL,
            last_changed_at TEXT,
            last_activated  TEXT,
            last_played_date TEXT
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token        TEXT PRIMARY KEY,
            username     TEXT NOT NULL,
            display_name TEXT NOT NULL,
            profile_image TEXT,
            created_at   TEXT NOT NULL,
            expires_at   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS alert_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            display_name TEXT NOT NULL,
            sound_file TEXT NOT NULL,
            message TEXT DEFAULT '',
            launched_at TEXT NOT NULL
        );
    `);

    try {
        sqliteDb.exec("ALTER TABLE users ADD COLUMN recovery_hash TEXT DEFAULT '';");
    } catch (e) {}
    try {
        sqliteDb.exec("ALTER TABLE users ADD COLUMN birthday_unlocked INTEGER DEFAULT 0;");
    } catch (e) {}
    try {
        sqliteDb.exec("ALTER TABLE users ADD COLUMN created_at TEXT DEFAULT '';");
    } catch (e) {}

    mode = 'sqlite';
    console.log('💾 [DB] Conectado a SQLite local (data/birthdays.db)');
}

initDatabase();

const db = {
    getMode() {
        return mode;
    },
    hashPin,
    hashSecret,

    // ─ USUARIOS / CUMPLEAÑOS ──────────────────────────────────────────────
    async getUser(rawUsername) {
        const username = rawUsername.toLowerCase().trim();
        if (mode === 'firestore') {
            const doc = await firestoreDb.collection('users').doc(username).get();
            return doc.exists ? doc.data() : null;
        } else {
            const stmt = sqliteDb.prepare('SELECT * FROM users WHERE username = ?');
            return stmt.get(username) || null;
        }
    },

    async saveUser(data) {
        const username = data.username.toLowerCase().trim();
        const record = {
            username,
            display_name: data.display_name || data.username,
            pin_hash: data.pin_hash,
            recovery_hash: data.recovery_hash || '',
            profile_image: data.profile_image || `/img/yocapi.png`,
            birth_month: parseInt(data.birth_month, 10) || 0,
            birth_day: parseInt(data.birth_day, 10) || 0,
            custom_message: (data.custom_message || '').slice(0, 100),
            selected_sound: data.selected_sound || 'HBSilbato.mp3',
            registered_at: data.registered_at || new Date().toISOString(),
            last_changed_at: new Date().toISOString(),
            last_activated: data.last_activated || null,
            last_played_date: data.last_played_date || null,
            birthday_unlocked: (data.birthday_unlocked === true || data.birthday_unlocked === 1) ? 1 : 0,
            created_at: data.created_at || data.registered_at || new Date().toISOString()
        };

        if (mode === 'firestore') {
            // In Firestore, store boolean directly
            const firestoreRecord = {
                ...record,
                birthday_unlocked: (data.birthday_unlocked === true || data.birthday_unlocked === 1)
            };
            await firestoreDb.collection('users').doc(username).set(firestoreRecord, { merge: true });
        } else {
            const stmt = sqliteDb.prepare(`
                INSERT INTO users (
                    username, display_name, pin_hash, recovery_hash, profile_image,
                    birth_month, birth_day, custom_message, selected_sound,
                    registered_at, last_changed_at, last_activated, last_played_date,
                    birthday_unlocked, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(username) DO UPDATE SET
                    display_name = excluded.display_name,
                    pin_hash = excluded.pin_hash,
                    recovery_hash = CASE WHEN excluded.recovery_hash != '' THEN excluded.recovery_hash ELSE users.recovery_hash END,
                    profile_image = excluded.profile_image,
                    birth_month = excluded.birth_month,
                    birth_day = excluded.birth_day,
                    custom_message = excluded.custom_message,
                    selected_sound = excluded.selected_sound,
                    last_changed_at = excluded.last_changed_at,
                    last_activated = excluded.last_activated,
                    last_played_date = excluded.last_played_date,
                    birthday_unlocked = excluded.birthday_unlocked,
                    created_at = CASE WHEN excluded.created_at != '' THEN excluded.created_at ELSE users.created_at END
            `);
            stmt.run(
                record.username, record.display_name, record.pin_hash, record.recovery_hash, record.profile_image,
                record.birth_month, record.birth_day, record.custom_message, record.selected_sound,
                record.registered_at, record.last_changed_at, record.last_activated, record.last_played_date,
                record.birthday_unlocked, record.created_at
            );
        }
        return record;
    },

    async updatePin(rawUsername, newPin) {
        const username = rawUsername.toLowerCase().trim();
        const pin_hash = hashPin(newPin);
        if (mode === 'firestore') {
            await firestoreDb.collection('users').doc(username).update({ pin_hash, last_changed_at: new Date().toISOString() });
        } else {
            const stmt = sqliteDb.prepare('UPDATE users SET pin_hash = ?, last_changed_at = ? WHERE username = ?');
            stmt.run(pin_hash, new Date().toISOString(), username);
        }
        return true;
    },

    async getAllUsers() {
        if (mode === 'firestore') {
            const snapshot = await firestoreDb.collection('users').get();
            const list = [];
            snapshot.forEach(doc => list.push(doc.data()));
            return list.sort((a, b) => a.birth_month - b.birth_month || a.birth_day - b.birth_day);
        } else {
            const stmt = sqliteDb.prepare('SELECT * FROM users ORDER BY birth_month ASC, birth_day ASC');
            return stmt.all();
        }
    },

    async deleteUser(rawUsername) {
        const username = rawUsername.toLowerCase().trim();
        if (mode === 'firestore') {
            await firestoreDb.collection('users').doc(username).delete();
        } else {
            sqliteDb.prepare('DELETE FROM users WHERE username = ?').run(username);
        }
        return true;
    },

    // ─ SESIONES ─────────────────────────────────────────────────────────────
    async createSession(token, user) {
        const expiresAt = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();
        const session = {
            token,
            username: user.username,
            display_name: user.display_name,
            profile_image: user.profile_image,
            created_at: new Date().toISOString(),
            expires_at: expiresAt
        };

        if (mode === 'firestore') {
            await firestoreDb.collection('sessions').doc(token).set(session);
        } else {
            sqliteDb.prepare(`
                INSERT INTO sessions (token, username, display_name, profile_image, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(session.token, session.username, session.display_name, session.profile_image, session.created_at, session.expires_at);
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

    // ─ ALERT LOG ────────────────────────────────────────────────────────────
    async logAlert(data) {
        const item = {
            username: data.username,
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
                INSERT INTO alert_log (username, display_name, sound_file, message, launched_at)
                VALUES (?, ?, ?, ?, ?)
            `);
            const res = stmt.run(item.username, item.display_name, item.sound_file, item.message, item.launched_at);
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
    }
};

module.exports = db;
