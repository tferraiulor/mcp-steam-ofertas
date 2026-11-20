# 🎮 Oferta Steam • Paquete Portable (MCP + Bot de Discord + IA Gamer)

Este paquete es una solución **completamente portable** para consultar la tienda de Steam, explorar ofertas, buscar juegos por presupuesto, revisar los más jugados del mundo, encontrar títulos Free to Play y recibir recomendaciones inteligentes personalizadas según los juegos que tienes instalados en tu PC, conversando directamente por **Discord** desde tu teléfono o computador.

---

## ⚡ Inicio Rápido en 1 Minuto (En cualquier PC)

### 1. Configurar tu Bot de Discord
1. Copia o renombra el archivo `.env.example` como `.env` (si no existe ya).
2. Abre el archivo `.env` con el Bloc de Notas y pega tu token de Discord:
   ```env
   DISCORD_BOT_TOKEN=tu_token_aqui
   ```
   *(Si aún no tienes un bot, mira la sección [Cómo crear tu Bot de Discord](#-cómo-crear-tu-bot-de-discord-en-2-minutos) más abajo).*

### 2. Ejecutar el Bot
- **Modo con ventana:** Haz doble clic en `Iniciar-Bot-Discord.bat`.
  - Verifica automáticamente que tengas Node.js listo.
  - Ya incluye las dependencias listas (`node_modules`), no requiere compilar ni instalar nada.
  - Autodetecta la ruta de Steam en tu computador (Windows Registry, `C:\Program Files (x86)\Steam`, etc.).
- **Modo segundo plano (invisible):** Haz doble clic en `Iniciar-Bot-Invisible.vbs`.

¡Listo! Ya puedes hablarle al bot desde cualquier canal de tu servidor de Discord o mencionarlo con `@tu-bot`.

---

## 🚀 Capacidades y Preguntas que Puedes Hacerle

El sistema ahora cuenta con un entorno de búsqueda ampliado con **11 herramientas MCP especializadas**:

### 1. Juegos por Presupuesto (Incluso fuera de oferta)
> *Ejemplo:* **"¿Qué juegos me recomiendas bajo 10.000 CLP aunque no estén en oferta?"**  
> *Ejemplo:* **"Busca juegos bajo 15.000 que me puedan gustar"**  
- Encuentra juegos cuyo precio normal o de oferta esté por debajo de tu presupuesto.
- Si no están en oferta, te avisa su precio regular y sus valoraciones comunitarias.

### 2. Recomendaciones Inteligentes Basadas en tu Biblioteca
> *Ejemplo:* **"Según los juegos de mi biblioteca, ¿qué me recomiendas comprar bajo 10 lucas?"**  
- El sistema lee tus juegos instalados (ej: *Counter-Strike 2*, *Delta Force*, etc.), analiza los géneros que más juegas (Acción, Shooters, Aventura, Multijugador) y te explica el motivo exacto de la recomendación:
  *(ej: "Te recomendamos Rust (100% afinidad) porque juegas a Counter-Strike 2 y Delta Force (Acción y Multijugador)").*

### 3. Juegos Más Jugados en Tiempo Real (Steam Charts)
> *Ejemplo:* **"¿Cuáles son los juegos más jugados ahora mismo en Steam?"**  
> *Ejemplo:* **"¿Qué está jugando la gente hoy?"**  
- Conecta directamente con la API de Steam Charts y muestra los juegos con mayor número de jugadores en vivo concurrentes y su pico de las últimas 24 horas.

### 4. Juegos Free to Play (Gratuitos)
> *Ejemplo:* **"Muéstrame los mejores juegos gratis"**  
> *Ejemplo:* **"¿Qué juegos Free to Play populares hay?"**  
- Filtra el catálogo de Steam para traerte los títulos gratuitos mejor valorados por la comunidad.

### 5. Preguntar por un Juego en Específico
> *Ejemplo:* **"¿Cuánto cuesta Cyberpunk 2077 y está en oferta?"**  
> *Ejemplo:* **"Dime el precio e info de Elden Ring"**  
- Entrega la ficha completa: precio actual, descuento, sinopsis, géneros, desarrollador, puntuación en Metacritic y si ya lo tienes instalado en tu PC.

### 6. Ofertas y Nuevos Lanzamientos
> *Ejemplo:* **"¿Qué ofertas buenas hay hoy con más del 50% de descuento?"**  
> *Ejemplo:* **"¿Qué nuevos lanzamientos destacados salieron en Steam?"**

### 7. Ver tus Juegos Locales
> *Ejemplo:* **"¿Qué juegos tengo instalados en el PC?"**

---

## 🛠️ Uso como Servidor MCP (Claude Desktop, Opencode, Cursor, Antigravity)

Si quieres usar el servidor directamente con herramientas de IA en tu editor o entorno MCP:

### En Opencode
El archivo `opencode.json` ya viene configurado:
```json
{
  "mcp": {
    "oferta-steam": {
      "type": "local",
      "command": ["node", "./dist/index.js"],
      "enabled": true
    }
  }
}
```

### En Claude Desktop / Cursor
Agrega a tu configuración MCP:
```json
{
  "mcpServers": {
    "oferta-steam": {
      "command": "node",
      "args": ["C:/ruta/donde/descomprimiste/oferta-steam-portable/dist/index.js"]
    }
  }
}
```

---

## 🤖 Cómo Crear tu Bot de Discord en 2 Minutos

1. Entra a [Discord Developer Portal](https://discord.com/developers/applications).
2. Haz clic en **"New Application"** y ponle un nombre (ej: `Oferta Steam`).
3. Ve a la pestaña **"Bot"** en el menú de la izquierda:
   - Haz clic en **"Reset Token"** y copia el token generado. Pégalo en tu archivo `.env` en `DISCORD_BOT_TOKEN=`.
   - Más abajo, en la sección **"Privileged Gateway Intents"**, activa:
     - ✅ **PRESENCE INTENT**
     - ✅ **SERVER MEMBERS INTENT**
     - ✅ **MESSAGE CONTENT INTENT** *(Recomendado para responder en cualquier canal)*.
4. Ve a la pestaña **"OAuth2" -> "URL Generator"**:
   - En **Scopes**, marca: `bot`.
   - En **Bot Permissions**, marca: `Send Messages`, `Embed Links`, `Read Message History`.
   - Copia la URL que aparece al fondo y ábrela en tu navegador para invitar al bot a tu servidor de Discord.

---

## 📁 Estructura del Paquete Portable

```text
oferta-steam-portable/
├── Iniciar-Bot-Discord.bat      <- Lanzador con 1 clic (Windows)
├── Iniciar-Bot-Invisible.vbs    <- Ejecución en segundo plano sin ventana
├── Iniciar-Servidor-MCP.bat     <- Lanzador de prueba MCP en consola
├── .env.example                 <- Plantilla de configuración
├── LEEME-PORTABLE.md            <- Esta guía completa
├── opencode.json                <- Configuración para clientes MCP
├── package.json                 <- Configuración del proyecto
├── dist/                        <- Código JavaScript pre-compilado listo
│   ├── index.js
│   └── tools/
│       └── oferta_steam.js      <- Las 11 herramientas completas de Steam
├── scripts/
│   ├── bot-discord.mjs          <- Bot con IA abierta y conexion al MCP
│   └── smoke-test.mjs           <- Verificador del sistema
└── node_modules/                <- Dependencias listas (@modelcontextprotocol/sdk, zod)
```

---

## 💡 Ventajas de este Paquete
- **Zero Config:** Autodetecta Steam en cualquier equipo sin tener que editar rutas fijas.
- **Portabilidad Total:** Puede llevarse en un pendrive o carpeta comprimida y funciona en cualquier máquina con Windows, Mac o Linux.
- **IA Libre Incluida:** No requiere tarjetas de crédito ni claves de API de pago; usa modelos de código abierto optimizados.
