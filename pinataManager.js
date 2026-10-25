/**
 * Yocapi Birthday System — Motor del Minijuego: Piñata Comunitaria de Capibara 🪅
 * Maneja estado en memoria, temporizadores, recuento de golpes y comunicación con OBS y Twitch.
 */

class PinataManager {
    constructor() {
        this.activePinata = null;
        this.broadcastFn = null;
        this.sendChatFn = null;
        this.userHitCooldowns = new Map(); // username -> timestamp
    }

    init({ broadcastToOverlay, sendChat }) {
        this.broadcastFn = broadcastToOverlay;
        this.sendChatFn = sendChat;
    }

    getStatus() {
        if (!this.activePinata) {
            return { active: false };
        }
        const remainingMs = Math.max(0, this.activePinata.expiresAt - Date.now());
        const remainingSec = Math.ceil(remainingMs / 1000);
        return {
            active: true,
            targetUser: this.activePinata.targetUser,
            targetAvatar: this.activePinata.targetAvatar,
            maxHp: this.activePinata.maxHp,
            currentHp: this.activePinata.currentHp,
            percentage: Math.max(0, Math.round((this.activePinata.currentHp / this.activePinata.maxHp) * 100)),
            durationSec: this.activePinata.durationSec,
            remainingSec,
            totalHits: this.activePinata.totalHits,
            uniqueHitters: this.activePinata.hits.size,
            lastHitBy: this.activePinata.lastHitBy
        };
    }

    async start({ targetUser = 'la Comunidad', targetAvatar = '', maxHp = 30, durationSec = 35, initiatedBy = 'streamer' } = {}) {
        // Si hay una piñata activa previa, cancelarla limpiamente
        this.stop(false);

        const cleanHp = Math.min(100, Math.max(10, parseInt(maxHp, 10) || 30));
        const cleanDuration = Math.min(90, Math.max(15, parseInt(durationSec, 10) || 35));
        const now = Date.now();
        const expiresAt = now + (cleanDuration * 1000);

        this.userHitCooldowns.clear();

        this.activePinata = {
            targetUser: targetUser || 'la Comunidad',
            targetAvatar: targetAvatar || '/img/yocapi.png',
            maxHp: cleanHp,
            currentHp: cleanHp,
            durationSec: cleanDuration,
            startedAt: now,
            expiresAt,
            totalHits: 0,
            hits: new Map(), // username -> { username, displayName, avatar, count }
            lastHitBy: null,
            timerHandle: setTimeout(() => {
                this.handleTimeout();
            }, cleanDuration * 1000)
        };

        // Broadcast a OBS
        if (this.broadcastFn) {
            this.broadcastFn({
                type: 'pinata_start',
                targetUser: this.activePinata.targetUser,
                targetAvatar: this.activePinata.targetAvatar,
                maxHp: cleanHp,
                currentHp: cleanHp,
                durationSec: cleanDuration,
                expiresAt
            });
        }

        // Anuncio en chat de Twitch
        if (this.sendChatFn) {
            try {
                await this.sendChatFn(`🪅 ¡SE COLGÓ LA PIÑATA DE CAPIBARA DE CUMPLEAÑOS! 🎂🎉 Tienen ${cleanDuration}s para romperla entre todos. ¡Escriban !dale o !pegar para batear! 🏑💥 (Salud: ${cleanHp} golpes)`);
            } catch (e) {
                console.warn('[Pinata] Error enviando chat start:', e.message);
            }
        }

        return this.getStatus();
    }

    async hit({ username, displayName, avatar }) {
        if (!this.activePinata) return { success: false, reason: 'no_active' };

        const now = Date.now();
        if (now >= this.activePinata.expiresAt) {
            return { success: false, reason: 'expired' };
        }

        const cleanUser = (username || '').toLowerCase().trim();
        // Cooldown anti-spam por usuario: 700ms para permitir múltiples golpes durante los 35s pero evitar macros de 50 hits/segundo
        const lastHit = this.userHitCooldowns.get(cleanUser) || 0;
        if (now - lastHit < 700) {
            return { success: false, reason: 'cooldown', remainingMs: 700 - (now - lastHit) };
        }
        this.userHitCooldowns.set(cleanUser, now);

        this.activePinata.currentHp--;
        this.activePinata.totalHits++;
        const dispName = displayName || username || 'Amigo';
        this.activePinata.lastHitBy = dispName;

        const currentHits = this.activePinata.hits.get(cleanUser) || {
            username: cleanUser,
            displayName: dispName,
            avatar: avatar || '/img/yocapi.png',
            count: 0
        };
        currentHits.count++;
        currentHits.avatar = avatar || currentHits.avatar;
        this.activePinata.hits.set(cleanUser, currentHits);

        const currentHp = Math.max(0, this.activePinata.currentHp);
        const percentage = Math.max(0, Math.round((currentHp / this.activePinata.maxHp) * 100));

        // Broadcast de golpe inmediato a OBS
        if (this.broadcastFn) {
            this.broadcastFn({
                type: 'pinata_hit',
                user: dispName,
                avatar: avatar || currentHits.avatar || '/img/yocapi.png',
                currentHp,
                maxHp: this.activePinata.maxHp,
                percentage
            });
        }

        if (currentHp <= 0) {
            await this.handleBroken(dispName);
            return { success: true, broken: true, currentHp: 0 };
        }

        return { success: true, broken: false, currentHp, percentage };
    }

    async handleBroken(lastHitter) {
        if (!this.activePinata) return;
        clearTimeout(this.activePinata.timerHandle);

        const hittersArray = Array.from(this.activePinata.hits.values())
            .sort((a, b) => b.count - a.count);

        const topHitters = hittersArray.slice(0, 3);
        const target = this.activePinata.targetUser;
        const totalHits = this.activePinata.totalHits;

        // Broadcast a OBS
        if (this.broadcastFn) {
            this.broadcastFn({
                type: 'pinata_broken',
                targetUser: target,
                lastHitter,
                topHitters,
                totalHits
            });
        }

        // Anuncio en chat de Twitch
        if (this.sendChatFn) {
            try {
                let topStr = topHitters.map((h, i) => `${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} @${h.displayName} (${h.count} golpes)`).join(' · ');
                await this.sendChatFn(`💥 ¡LA PIÑATA DE CAPIBARA EXPLOTÓ EN MIL DULCES Y CONFETI! 🍬🍭🎉 ¡Felicidades @${target}! ⚡ Golpe de gracia por @${lastHitter}. ${topStr} 🏑👑`);
            } catch (e) {
                console.warn('[Pinata] Error enviando chat broken:', e.message);
            }
        }

        this.activePinata = null;
    }

    async handleTimeout() {
        if (!this.activePinata) return;

        const hittersArray = Array.from(this.activePinata.hits.values())
            .sort((a, b) => b.count - a.count);
        const topHitters = hittersArray.slice(0, 3);
        const remainingHp = this.activePinata.currentHp;
        const target = this.activePinata.targetUser;

        // Broadcast a OBS
        if (this.broadcastFn) {
            this.broadcastFn({
                type: 'pinata_timeout',
                targetUser: target,
                remainingHp,
                topHitters
            });
        }

        // Anuncio en chat de Twitch
        if (this.sendChatFn) {
            try {
                await this.sendChatFn(`⏰ ¡SE ACABÓ EL TIEMPO! La piñata de capibara aguantó con ${remainingHp} de vida y escapó corriendo 🪅💨 ¡Estuvo cerca chat, buen intento! 🍰`);
            } catch (e) {
                console.warn('[Pinata] Error enviando chat timeout:', e.message);
            }
        }

        this.activePinata = null;
    }

    stop(notify = true) {
        if (!this.activePinata) return false;
        clearTimeout(this.activePinata.timerHandle);
        this.activePinata = null;

        if (notify && this.broadcastFn) {
            this.broadcastFn({ type: 'pinata_cancel' });
        }
        if (notify && this.sendChatFn) {
            this.sendChatFn('🛑 La piñata de capibara fue guardada por la streamer. ¡Gracias por participar! 🪅').catch(() => {});
        }
        return true;
    }
}

module.exports = new PinataManager();
