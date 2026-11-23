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

    async start({ targetUser = 'la Comunidad', targetAvatar = '', maxHp = 30, durationSec = null, initiatedBy = 'streamer' } = {}) {
        // Si hay una piñata activa previa, cancelarla limpiamente
        this.stop(false);

        const cleanHp = Math.min(100, Math.max(10, parseInt(maxHp, 10) || 30));
        // Si no se provee duración, calcularla automáticamente según los golpes:
        //   35 hits → 60s (1 min), 60 hits → 90s (1.5 min), interpolación lineal.
        //   Fórmula: base 45s + 0.75s por hit adicional desde 10.
        const autoSec = Math.round(45 + (cleanHp - 10) * 0.75);
        const requestedSec = parseInt(durationSec, 10);
        const resolvedSec = (!isNaN(requestedSec) && requestedSec > 0) ? requestedSec : autoSec;
        const cleanDuration = Math.min(120, Math.max(20, resolvedSec));
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
            recentHits: [], // Timestamps de golpes para activar Frenesí
            frenzyUntil: 0, // Timestamp de fin de Frenesí
            lastFrenzyEnd: 0, // Timestamp del último fin de Frenesí (anti-duplicado)
            extraTimeGranted: false, // Control de tiempo extra de remontada
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
                const targetLabel = (this.activePinata.targetUser && this.activePinata.targetUser !== 'la Comunidad')
                    ? `¡Hoy celebramos a @${this.activePinata.targetUser}! `
                    : '';
                const minSec = cleanDuration >= 60 ? `${Math.floor(cleanDuration/60)}m ${cleanDuration % 60 > 0 ? `${cleanDuration % 60}s` : ''}`.trim() : `${cleanDuration}s`;
                await this.sendChatFn(`🪅 ¡SE COLGÓ LA PIÑATA DE CAPIBARA! 🎂🎉 ${targetLabel}¡Tienen ${minSec} para romperla! ⚡ Hay GOLPES CRÍTICOS y modo FRENESÍ. ¡Escriban !dale para batear! 🏑💥 (Salud: ${cleanHp})`);
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
        // Cooldown ágil: 380ms para permitir golpes fluidos sin sentirse bloqueado
        const lastHit = this.userHitCooldowns.get(cleanUser) || 0;
        if (now - lastHit < 380) {
            return { success: false, reason: 'cooldown', remainingMs: 380 - (now - lastHit) };
        }
        this.userHitCooldowns.set(cleanUser, now);

        // ─── CÁLCULO DE DAÑO Y CRÍTICOS ──────────────────────────────────────────
        const cleanTarget = (this.activePinata.targetUser || '').toLowerCase().replace(/^@/, '').trim();
        const isBirthdayCelebrant = cleanUser && cleanTarget && cleanUser === cleanTarget;

        let baseDamage = 1;
        let hitType = 'normal'; // 'normal' | 'crit' | 'super_crit' | 'birthday'
        let hitText = '+1';

        if (isBirthdayCelebrant) {
            // ¡El cumpleañero tiene el Bate de Oro! (Daño x3 o x4 garantizado)
            baseDamage = 3;
            hitType = 'birthday';
            hitText = '👑 ¡BATE DE ORO! +3';
        } else {
            const roll = Math.random();
            if (roll < 0.12) {
                // 12% probabilidad de Mega Crítico
                baseDamage = 3;
                hitType = 'super_crit';
                hitText = '⚡ ¡MEGA CRÍTICO! +3';
            } else if (roll < 0.38) {
                // 26% probabilidad de Golpe Crítico
                baseDamage = 2;
                hitType = 'crit';
                hitText = '💥 ¡CRÍTICO! +2';
            } else {
                baseDamage = 1;
                hitType = 'normal';
                hitText = '+1';
            }
        }

        // ─── MODO FRENESÍ COMUNITARIO ──────────────────────────────────────────
        let isFrenzy = now < (this.activePinata.frenzyUntil || 0);

        // Evaluar golpes recientes en los últimos 3.5 segundos
        this.activePinata.recentHits = (this.activePinata.recentHits || []).filter(t => now - t < 3500);
        this.activePinata.recentHits.push(now);

        // Activar Frenesí si hay 4 o más golpes en 3.5 segundos
        // Solo se puede re-activar si han pasado al menos 8s desde el último frenesí (evita duplicados)
        const lastFrenzyEnd = this.activePinata.lastFrenzyEnd || 0;
        const cooldownFrenzy = now > lastFrenzyEnd + 8000;
        if (!isFrenzy && cooldownFrenzy && this.activePinata.recentHits.length >= 4) {
            isFrenzy = true;
            this.activePinata.frenzyUntil = now + 7000; // 7 segundos de Frenesí
            // Limpiar recentHits para evitar reactivación inmediata en el siguiente golpe
            this.activePinata.recentHits = [];
            // Programar el fin del frenesí para registrar lastFrenzyEnd
            setTimeout(() => {
                if (this.activePinata) {
                    this.activePinata.lastFrenzyEnd = Date.now();
                }
            }, 7000);
            if (this.broadcastFn) {
                this.broadcastFn({
                    type: 'pinata_frenzy_start',
                    durationMs: 7000
                });
            }
            if (this.sendChatFn) {
                this.sendChatFn('🔥 ¡MODO FRENESÍ! ¡Daño x2, usen !dale! 🏑💥').catch(() => {});
            }
        }

        const finalDamage = isFrenzy ? (baseDamage * 2) : baseDamage;
        if (isFrenzy) {
            hitText += ' 🔥 (x2)';
        }

        // ─── TIEMPO EXTRA DRAMÁTICO (CLUTCH REMONTADA) ──────────────────────────
        // Si quedan <= 10s y la piñata tiene <= 35% de HP, regalar +10s una sola vez
        const remainingSec = Math.ceil((this.activePinata.expiresAt - now) / 1000);
        if (!this.activePinata.extraTimeGranted && remainingSec <= 10 && (this.activePinata.currentHp / this.activePinata.maxHp) <= 0.35) {
            this.activePinata.extraTimeGranted = true;
            const extraSec = 10;
            this.activePinata.expiresAt += (extraSec * 1000);
            clearTimeout(this.activePinata.timerHandle);
            this.activePinata.timerHandle = setTimeout(() => {
                this.handleTimeout();
            }, this.activePinata.expiresAt - now);

            if (this.broadcastFn) {
                this.broadcastFn({
                    type: 'pinata_extra_time',
                    extraSec,
                    newRemainingSec: remainingSec + extraSec
                });
            }
            if (this.sendChatFn) {
                this.sendChatFn('⏰ ¡TIEMPO EXTRA DE +10 SEGUNDOS! ¡Está a punto de romperse, rematen con !dale! 🪅💥').catch(() => {});
            }
        }

        // Aplicar daño a la piñata
        this.activePinata.currentHp = Math.max(0, this.activePinata.currentHp - finalDamage);
        this.activePinata.totalHits++;
        const dispName = displayName || username || 'Amigo';
        this.activePinata.lastHitBy = dispName;

        const currentHits = this.activePinata.hits.get(cleanUser) || {
            username: cleanUser,
            displayName: dispName,
            avatar: avatar || '/img/yocapi.png',
            count: 0
        };
        // El puntaje del usuario suma el daño infligido
        currentHits.count += finalDamage;
        currentHits.avatar = avatar || currentHits.avatar;
        this.activePinata.hits.set(cleanUser, currentHits);

        const currentHp = Math.max(0, this.activePinata.currentHp);
        const percentage = Math.max(0, Math.round((currentHp / this.activePinata.maxHp) * 100));

        // Broadcast de golpe inmediato a OBS con información del crítico y daño
        if (this.broadcastFn) {
            this.broadcastFn({
                type: 'pinata_hit',
                user: dispName,
                avatar: avatar || currentHits.avatar || '/img/yocapi.png',
                damage: finalDamage,
                hitType,
                hitText,
                isFrenzy,
                currentHp,
                maxHp: this.activePinata.maxHp,
                percentage
            });
        }

        if (currentHp <= 0) {
            await this.handleBroken(dispName);
            return { success: true, broken: true, currentHp: 0, damage: finalDamage, hitType };
        }

        return { success: true, broken: false, currentHp, percentage, damage: finalDamage, hitType };
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
                await this.sendChatFn(`💥 ¡LA PIÑATA CAPIBARA EXPLOTÓ EN MIL DULCES Y CONFETI! 🍬🍭🎉 ¡Felicidades @${target}! ⚡ Golpe de gracia: @${lastHitter} 🏑💥 ${topStr} 👑`);
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
