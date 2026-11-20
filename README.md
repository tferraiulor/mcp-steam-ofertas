# 🎮 MCP Steam Ofertas • Asistente Gamer con IA Open-Source & Bot de Discord

[![MCP Version](https://img.shields.io/badge/MCP%20SDK-1.12.0-blue.svg)](https://modelcontextprotocol.io)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Servidor **Model Context Protocol (MCP)** y **Bot de Discord bidireccional** con inteligencia artificial de código abierto (*gpt-oss-20b* sin costo). Permite explorar ofertas de Steam, buscar juegos por presupuesto (incluso a precio normal fuera de oferta), consultar estadísticas en tiempo real (Steam Charts), ver el **historial de precios y mínimo histórico** de cualquier juego, revisar los títulos instalados localmente y **categorizar el perfil gamer del usuario** según su biblioteca.

---

## ⚡ Inicio Rápido (1 Clic)

1. **Clonar o descargar:**
   Descarga el paquete portable pre-compilado listo para usar: [`oferta-steam-portable.zip`](oferta-steam-portable.zip)
2. **Configurar tu token de Discord:**
   Copia el archivo `.env.example` como `.env` y pega tu token:
   ```env
   DISCORD_BOT_TOKEN=tu_token_aqui
   ```
3. **Ejecutar:**
   Haz doble clic en:
   👉 **`1-CLIC-INICIAR-AQUI.bat`** (o `Iniciar-Bot-Discord.bat`)

¡Listo! El bot se conectará a Discord y autodetectará la instalación de Steam en cualquier computador.

---

## ✨ Características Principales

### 1. 🔍 Búsqueda de Juegos & Historial de Precios
* **Mínimo histórico registrado:** Consulta el precio actual, precio normal y el precio más bajo histórico registrado en tiendas autorizadas con la fecha exacta.
* **Consejo de compra inteligente:** Evalúa si es el mejor momento para comprar o si conviene esperar a las rebajas de temporada de Steam.
* *Ejemplo:* `@steam ofertas precio de Cyberpunk 2077` o `historial de Rust`.

### 2. 🏆 Categorización del Perfil Gamer del Usuario
* Analiza los juegos instalados localmente en tu PC, calcula el almacenamiento ocupado y los géneros predominantes.
* Asigna un **Arquetipo Gamer** (*Táctico Competitivo, Explorador de Rol, Estratega*), **Insignia de Rango** (*🎖️ Maestro de Shooters*) y estadísticas de tu biblioteca.
* *Ejemplo:* `@steam ofertas mi perfil` o `categorizarme`.

### 3. 🔥 Juegos Más Jugados en Vivo (Steam Charts)
* Métricas oficiales en tiempo real: jugadores concurrentes en vivo y pico de las últimas 24 horas.
* *Ejemplo:* `@steam ofertas los mas jugados` o `que juega la gente`.

### 4. 🎯 Búsqueda por Presupuesto (Con o Sin Oferta)
* Encuentra juegos bajo un límite presupuestario (ej: bajo $10.000 CLP o $15 USD), tanto a precio normal regular como en oferta.
* *Ejemplo:* `@steam ofertas juegos bajo 10.000 que me puedan gustar`.

### 5. 🧠 Recomendaciones según tu Biblioteca Local
* Cruza tus juegos instalados (*Counter-Strike 2, Delta Force*, etc.) con el catálogo para sugerir juegos con porcentaje de afinidad y motivo causal.

### 6. 💻 Gestor de Biblioteca Local
* Detecta automáticamente Steam en Windows, macOS y Linux, leyendo múltiples unidades de almacenamiento (`libraryfolders.vdf`).
* *Ejemplo:* `@steam ofertas mis juegos` o `que tengo instalado`.

### 7. 📖 Comando Help
* Menú interactivo con todos los comandos y ejemplos al escribir `help` o `!help`.

---

## 🛠️ Herramientas MCP Expuestas

El servidor expone **13 herramientas estandarizadas** compatibles con Claude Desktop, Opencode, Cursor y Antigravity:

| Herramienta | Descripción |
| :--- | :--- |
| `historial_precio_juego` | Precio actual, precio normal, descuento y mínimo histórico registrado con fecha y consejo de compra. |
| `detalle_juego_steam` | Ficha técnica completa de un juego por nombre o AppID. |
| `categorizar_usuario_steam` | Arquetipo gamer, rango, porcentaje de géneros y estadísticas del usuario. |
| `juegos_mas_jugados_steam` | Concurrencia en vivo de jugadores y pico 24h vía Steam Charts. |
| `buscar_juegos_por_precio` | Búsqueda por presupuesto máximo (con o sin oferta). |
| `recomendar_segun_biblioteca` | Motor de recomendación de afinidad con base en los juegos del PC. |
| `juegos_destacados_steam` | Los más vendidos y destacados de Steam. |
| `juegos_gratuitos_steam` | Catálogo de los mejores títulos Free to Play. |
| `buscar_ofertas_steam` | Rebajas y descuentos especiales con porcentaje mínimo. |
| `nuevos_lanzamientos_steam` | Estrenos y lanzamientos recientes destacados. |
| `buscar_juego_steam` | Búsqueda rápida en el catálogo de Steam. |
| `listar_juegos_instalados` | Lectura del almacenamiento local y discos secundarios. |
| `notificar_oferta_steam` | Alerta al teléfono mediante Webhook de Discord y aviso nativo Windows. |

---

## 📚 Documentación e Informe Académico

* 📄 **[Informe Académico Completo](INFORME_ACADEMICO_MCP_STEAM.md):** Fundamentación teórica, arquitectura de software, mitigación de alucinaciones en LLMs, aplicaciones en Estudios de Mercado (*Market Intelligence*) y formulación matemática.
* 📦 **[Guía Portable](LEEME-PORTABLE.md):** Instrucciones detalladas de despliegue y configuración para cualquier usuario.

---

## 📜 Licencia

Distribuido bajo la Licencia MIT. Consulta el archivo `LICENSE` para más detalles.
