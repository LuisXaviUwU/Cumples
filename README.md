# 🎂 YoCapi Birthday Platform 2.0 (Mobile-First + Nick & PIN)

> **Plataforma Cloud 24/7 de Cumpleaños para la Comunidad de yocapi_pr**  
> **100% Cloud & Autónoma:** No depende de OAuth de Twitch, no pide permisos de moderador, no requiere tokens que expiren, y está **100% optimizada para celulares y PC**.

---

## 🌟 Novedades de esta Versión

1. **Autonomía Total (Nick de Twitch + PIN):**
   - El seguidor solo escribe su **Nombre de Twitch** y un **PIN secreto de 4 dígitos**.
   - El sistema obtiene y sincroniza automáticamente su foto de perfil pública oficial de Twitch en tiempo real (con vista previa al escribir).
   - ¡Cero ventanas emergentes de Twitch, cero autorizaciones complejas, cero tokens expirados!
2. **Diseño Mobile-First 100% Adaptable:**
   - Diseñado pensando en los seguidores que entran desde su celular (iPhone / Android) con teclado numérico para el PIN, selectores táctiles y botones grandes.
3. **Persistencia Cloud en Firebase Firestore:**
   - Almacenamiento 24/7 en la nube con el proyecto de Firebase `yocapi-cumples`.
4. **Overlay Transparente para OBS Studio:**
   - URL única para agregar como Browser Source en OBS (1920x1080).
   - Cola de reproducción de alertas con audio, avatares, citas y confeti.
5. **Dashboard Libre de Streamer:**
   - Panel de control en `/dashboard` sin contraseñas ni bloqueos para el streamer.

---

## 🚀 Despliegue en Render

Solo necesitas configurar **2 variables de entorno** en Render (las de Twitch ya no son necesarias):

| Variable | Valor |
|---|---|
| `OVERLAY_TOKEN` | `33c98a5e7659ee191e539ec5cbb7a1b131266643dbd752b6` |
| `FIREBASE_SERVICE_ACCOUNT` | *Pega aquí todo el contenido JSON de tu clave privada de Firebase* |
| `STREAMER_LOGIN` *(Opcional)* | `yocapi_pr` |

---

## 📺 Configuración en OBS Studio

1. Entra a tu dashboard (`https://tu-servicio.onrender.com/dashboard`).
2. Haz clic en **📋 Copiar URL**.
3. En OBS Studio, añade una fuente: **+ > Navegador (Browser)**.
4. Pega la URL y define: **Ancho: 1920**, **Alto: 1080**.
5. ¡Listo! Todo funciona en vivo 24/7.
