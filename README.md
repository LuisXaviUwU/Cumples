# 🎂 YoCapi Birthday Platform 2.0

> **Plataforma Cloud 24/7 de Cumpleaños para Twitch & OBS Studio**  
> Diseñada para el canal de **yocapi_pr**.  
> **100% Cloud:** El streamer **NO** necesita ejecutar ningún servidor en su PC ni abrir puertos/ngrok. Todo funciona a través de una simple **URL de Navegador en OBS**.

---

## 🌟 Novedades de la Versión 2.0

- 🚀 **Despliegue 100% Cloud en Render:** Funciona 24/7 de forma completamente gratuita.
- 🔥 **Persistencia Universal con Firebase Firestore:** Base de datos en la nube sin tarjeta de crédito ni expiración, con fallback automático a SQLite local para pruebas inmediatas.
- 🎨 **Rediseño Visual Completo (Midnight Cyber Celebration):**
  - **Portal de Seguidores (`/`):** Estilo neón con glassmorphism, indicador de estado en directo, selector de mes y día con cálculo automático de signo zodiacal, vista previa interactiva de sonidos (`HBSilbato`, `HBVoz`, `MBMusica`), y botón pulsante de lanzamiento a stream con explosión de confeti.
  - **Overlay para OBS (`/overlay`):** 100% transparente, animaciones elásticas, avatar giratorio con halo de colores, citas en pantalla, sistema de cola FIFO y confeti sincronizado.
  - **Panel de Streamer (`/dashboard`):** Centro de comando protegido por clave, métricas en tiempo real, listado de cumpleañeros de hoy + período de gracia (14 días), base de datos con búsqueda y filtros, y lanzador de alertas de prueba para OBS.

---

## 📁 Estructura del Proyecto

```text
CumpleNuevo/
├── server.js              # Servidor Express + Twitch OAuth + SSE OBS Stream
├── db.js                  # Abstracción universal (Firestore + SQLite local)
├── package.json           # Dependencias de producción
├── .env.example           # Plantilla de variables de entorno
├── .env                   # Variables de entorno locales
├── public/                # Frontend servido directamente
│   ├── index.html         # Portal de seguidores (registro y activación)
│   ├── dashboard.html     # Panel de administración de yocapi_pr
│   ├── overlay.html       # Fuente de navegador para OBS Studio
│   ├── css/
│   │   ├── style.css      # Sistema de diseño principal (Midnight Cyber)
│   │   ├── dashboard.css  # Estilos del panel de control
│   │   └── overlay.css    # Estilos y animaciones del overlay de OBS
│   ├── js/
│   │   ├── app.js         # Lógica interactiva del portal de seguidores
│   │   ├── dashboard.js   # Controlador del panel de administración
│   │   └── overlay.js     # Controlador SSE y cola de reproducción de OBS
│   ├── img/               # Recursos gráficos y avatares
│   └── music/             # Sonidos oficiales (.mp3)
└── README.md
```

---

## ⚡ Inicio Rápido en Local

1. **Instalar dependencias:**
   ```bash
   npm install
   ```
2. **Iniciar servidor:**
   ```bash
   npm start
   ```
3. **Acceder a las interfaces:**
   - **Portal de Seguidores:** [http://localhost:3001](http://localhost:3001)
   - **Panel de Streamer:** [http://localhost:3001/dashboard](http://localhost:3001/dashboard)
   - **Overlay de OBS:** [http://localhost:3001/overlay?token=33c98a5e7659ee191e539ec5cbb7a1b131266643dbd752b6](http://localhost:3001/overlay?token=33c98a5e7659ee191e539ec5cbb7a1b131266643dbd752b6)

---

## ☁️ Guía de Despliegue en la Nube (Render + Firebase)

### 1. Base de Datos Gratuita en Firebase Firestore
1. Entra a [Firebase Console](https://console.firebase.google.com/) y crea un proyecto nuevo (ej. `yocapi-cumple`).
2. En el menú lateral, ve a **Compilación > Firestore Database** y haz clic en **Crear base de datos** (modo de prueba o producción).
3. Ve a **Configuración del proyecto (icono de engranaje) > Cuentas de servicio**.
4. Haz clic en **Generar nueva clave privada**. Se descargará un archivo `.json`.
5. Copia todo el contenido de ese archivo JSON (lo usarás en Render).

### 2. Despliegue en Render (Hosting Gratis 24/7)
1. Sube este repositorio a tu cuenta de GitHub.
2. Entra a [Render.com](https://render.com/) y crea un **New Web Service**.
3. Selecciona tu repositorio de GitHub.
4. Configura:
   - **Name:** `yocapi-cumple`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** `Free`
5. En la sección **Environment Variables**, añade:
   - `APP_URL`: `https://tu-servicio.onrender.com`
   - `TWITCH_CLIENT_ID`: Tu Client ID de Twitch Developer Console
   - `TWITCH_CLIENT_SECRET`: Tu Client Secret de Twitch
   - `STREAMER_LOGIN`: `yocapi_pr`
   - `DASHBOARD_KEY`: Tu clave privada de acceso al dashboard
   - `OVERLAY_TOKEN`: Un token seguro para OBS
   - `FIREBASE_SERVICE_ACCOUNT`: *Pega aquí el contenido JSON completo de la clave de Firebase*
6. Haz clic en **Deploy Web Service**.

### 3. Configuración en OBS Studio para el Streamer
1. En tu OBS Studio, en la escena donde quieras la alerta, añade una fuente: **+ > Navegador (Browser)**.
2. Abre tu panel de control (`https://tu-servicio.onrender.com/dashboard`) y haz clic en **Copiar URL para OBS**.
3. Pega esa URL en el campo URL de OBS.
4. Establece el tamaño en **Ancho: 1920**, **Alto: 1080**.
5. ¡Listo! El streamer nunca más tiene que abrir terminales ni ejecutar programas en su PC.

---

## 🛡️ Período de Gracia de 14 Días
Los seguidores pueden activar su alerta en directo el día exacto de su cumpleaños y durante los **14 días posteriores**. Pasado ese período, la plataforma mostrará la cuenta regresiva en días hacia su próximo cumpleaños.
