#!/usr/bin/env node
/**
 * Bot bidireccional de Discord conectado al servidor MCP "oferta-steam"
 * y a una IA gratuita de código abierto (gpt-oss-20b via Pollinations OpenAI API,
 * sin necesidad de cuenta ni clave de API, o compatible con OpenRouter/Ollama).
 *
 * Funcionalidades ampliadas:
 * - Detección inteligente de juegos bajo presupuesto (ej: bajo 10.000 CLP aunque no estén en oferta).
 * - Recomendaciones personalizadas según la biblioteca instalada del usuario.
 * - Juegos más jugados en vivo con estadísticas de Steam Charts (jugadores concurrentes).
 * - Top juegos Free to Play / Gratuitos.
 * - Ficha detallada de juegos específicos por nombre.
 * - Ofertas y nuevos lanzamientos en Steam.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function leerEnv(clave) {
  if (process.env[clave]?.trim()) return process.env[clave].trim();
  try {
    const txt = await readFile(path.join(raiz, ".env"), "utf8");
    for (const linea of txt.split(/\r?\n/)) {
      const l = linea.trim();
      if (!l || l.startsWith("#")) continue;
      const i = l.indexOf("=");
      if (i > 0 && l.slice(0, i).trim() === clave) return l.slice(i + 1).trim();
    }
  } catch {
    /* ignorar */
  }
  return undefined;
}

const token = await leerEnv("DISCORD_BOT_TOKEN");
if (!token) {
  console.error("ERROR: Falta DISCORD_BOT_TOKEN en el archivo .env");
  process.exit(1);
}

// 1. Conectar como cliente MCP al servidor oferta-steam (dist/index.js)
const transport = new StdioClientTransport({
  command: "node",
  args: [path.join(raiz, "dist", "index.js")],
});
const mcp = new Client({ name: "discord-bot-oferta-steam", version: "1.1.0" });
await mcp.connect(transport);
console.error("[Bot Discord] Conectado al MCP oferta-steam con éxito.");

async function llamarMcp(name, args = {}) {
  try {
    const res = await mcp.callTool({ name, arguments: args });
    const txt = res.content?.[0]?.text ?? "{}";
    try {
      return JSON.parse(txt);
    } catch {
      return { raw: txt };
    }
  } catch (err) {
    console.error(`[Bot Discord] Error llamando a ${name}:`, err.message);
    return { error: err.message };
  }
}

/**
 * Llama a la API de IA gratuita y sin clave (modelo open-source via Pollinations)
 * o al endpoint compatible con OpenAI configurado en .env.
 */
async function consultarIALibre(mensajes) {
  const apiUrl = (await leerEnv("AI_API_URL")) || "https://text.pollinations.ai/openai";
  const apiKey = await leerEnv("AI_API_KEY");
  const modelo = (await leerEnv("AI_MODEL")) || "openai";

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: modelo,
      messages: mensajes,
    }),
    signal: AbortSignal.timeout(35_000),
  });

  if (!res.ok) {
    throw new Error(`API IA respondio HTTP ${res.status}`);
  }
  const data = await res.json();
  return {
    texto: data.choices?.[0]?.message?.content?.trim() || "",
    modeloUsado: data.model || "gpt-oss-20b (Open Source)",
  };
}

async function mostrarEscribiendo(channelId) {
  try {
    await fetch(`https://discord.com/api/v10/channels/${channelId}/typing`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}` },
    });
  } catch {
    /* ignorar */
  }
}

async function responderDiscord(channelId, messageId, embed, contenidoTexto) {
  const payload = {
    content: contenidoTexto ? contenidoTexto.slice(0, 1900) : undefined,
    message_reference: messageId ? { message_id: messageId } : undefined,
    embeds: embed ? [embed] : undefined,
  };

  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error("[Bot Discord] Error enviando respuesta con Bot API:", res.status, await res.text());
    const webhook = await leerEnv("DISCORD_WEBHOOK_URL");
    if (webhook) {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "Oferta Steam (IA)",
          content: payload.content,
          embeds: payload.embeds,
        }),
      });
    }
  }
}

/**
 * Extrae presupuesto numérico si el usuario menciona un precio
 * (ej: "bajo 10.000", "menos de 10000", "< 15000", "por 5000")
 */
function extraerPrecioMaximo(texto) {
  const m = texto.match(/(?:bajo|menos\s*de|hasta|menor\s*a|por\s*menos\s*de|\<\s*)\s*(\d+(?:[.,]\d+)?)\s*(?:k|mil)?/i);
  if (m) {
    let numStr = m[1].replace(/\./g, "").replace(/,/g, ".");
    let valor = Number(numStr);
    if (/k|mil/i.test(m[0]) && valor < 1000) {
      valor *= 1000;
    }
    if (valor > 0) return valor;
  }
  // Búsqueda simple de 10.000 o 15000 con signo peso o clp
  const mPeso = texto.match(/\$?\s*(\d{1,3}(?:\.\d{3})+|\d{4,6})\s*(?:pesos|clp|\$)?/i);
  if (mPeso) {
    const val = Number(mPeso[1].replace(/\./g, ""));
    if (val >= 1000) return val;
  }
  return null;
}

/**
 * Decide con precisión qué herramientas del MCP ejecutar según la consulta del usuario
 * y pasa los datos reales de Steam a la IA para una respuesta enriquecida.
 */
async function procesarPreguntaConIA(textoOriginal, channelId, messageId) {
  const limpio = textoOriginal.replace(/<@!?\d+>/g, "").trim();
  if (!limpio) return;

  await mostrarEscribiendo(channelId);

  const min = limpio.toLowerCase();
  let contextoSteam = {};
  let imagenDestacada = null;
  let tituloEmbed = "🎮 Steam • Asistente Gamer IA";

  try {
    const precioFiltro = extraerPrecioMaximo(min);

    // 0. Comando de ayuda (!help, help, ayuda, comandos)
    if (
      min === "help" ||
      min === "!help" ||
      min === "ayuda" ||
      min === "!ayuda" ||
      min === "comandos" ||
      min.startsWith("help ") ||
      min.startsWith("!help ")
    ) {
      await responderDiscord(channelId, messageId, {
        title: "🎮 Centro de Ayuda y Comandos • Oferta Steam",
        description:
          "¡Hola! Soy tu asistente gamer conectado en tiempo real a Steam y a tu biblioteca local. Aquí tienes todo lo que puedes preguntarme:",
        color: 0x1b2838,
        fields: [
          {
            name: "🔥 Juegos Más Jugados (En Vivo)",
            value: "Pregunta `mas jugados`, `top jugados` o `que juega la gente` para ver el ranking en vivo de Steam Charts con jugadores concurrentes y pico de 24h.",
          },
          {
            name: "🏷️ Ficha de Juego & Historial de Precios",
            value: "Pregunta `precio de Cyberpunk`, `historial de Rust` o `minimo historico de Elden Ring` para ver precio actual, descuento, ficha técnica y su **mínimo histórico registrado**.",
          },
          {
            name: "🏆 Perfil Gamer & Categorización",
            value: "Escribe `mi perfil`, `categorizarme` o `que tipo de jugador soy` para analizar tus juegos y obtener tu Arquetipo Gamer, nivel e insignia.",
          },
          {
            name: "🎯 Presupuesto & Recomendaciones",
            value: "Pregunta `juegos bajo 10.000` o `que me recomiendas bajo 15k segun mi biblioteca` (encuentra títulos tanto a precio normal como en oferta).",
          },
          {
            name: "💻 Juegos Instalados en tu PC",
            value: "Escribe `mis juegos`, `que tengo instalado` o `mi biblioteca` para ver tus juegos locales con su peso en GB y fechas.",
          },
          {
            name: "🎁 Juegos Gratis (Free to Play)",
            value: "Pregunta `juegos gratis` o `free to play` para ver los mejores títulos sin costo.",
          },
          {
            name: "💸 Ofertas y Novedades",
            value: "Pregunta `ofertas del 50%` o `ultimos lanzamientos` para ver las mejores rebajas actuales.",
          },
        ],
        footer: { text: "Tip: Puedes hablarme en lenguaje natural o mencionarme con @steam ofertas" },
      });
      return;
    }

    // 1. Categorización del usuario y Perfil Gamer
    if (
      min.includes("perfil") ||
      min.includes("categoriz") ||
      min.includes("que tipo de jugador") ||
      min.includes("mi arquetipo") ||
      min.includes("mi rango")
    ) {
      const perfil = await llamarMcp("categorizar_usuario_steam", {});
      contextoSteam = { tipo: "categorizacion_perfil_gamer", datos: perfil };
      tituloEmbed = `🏆 ${perfil.insignia || "Perfil Gamer"} • ${perfil.arquetipo_gamer || "Gamer"}`;
    }
    // 2. Consulta de juegos instalados en el PC
    else if (
      min.includes("instalado") ||
      min.includes("mis juegos") ||
      min.includes("mi biblioteca") ||
      min.includes("que tengo")
    ) {
      const instalados = await llamarMcp("listar_juegos_instalados", {});
      contextoSteam = { tipo: "juegos_instalados_en_pc", datos: instalados };
      tituloEmbed = `💻 Tu Biblioteca Local (${instalados.total_instalados ?? 0} juegos detectados)`;
    }
    // 3. Historial de Precios y Mínimo Histórico
    else if (
      min.includes("historial") ||
      min.includes("historico") ||
      min.includes("mínimo") ||
      min.includes("minimo") ||
      min.includes("precio de") ||
      min.includes("cuanto cuesta")
    ) {
      const terminoLimpio = limpio
        .replace(/^(hola|oye|dime|busca|buscar|precio de|historial de precios de|historial de|minimo historico de|cuanto cuesta|que tal es|esta en oferta|info de|informacion de)\s+/i, "")
        .trim();

      const [historial, detalle] = await Promise.all([
        terminoLimpio.length >= 2
          ? llamarMcp("historial_precio_juego", { nombre: terminoLimpio.slice(0, 80) })
          : Promise.resolve(null),
        terminoLimpio.length >= 2
          ? llamarMcp("detalle_juego_steam", { nombre: terminoLimpio.slice(0, 80) })
          : Promise.resolve(null),
      ]);

      const juegoPrincipal = (historial?.appid ? historial : null) || (detalle?.appid ? detalle : null);
      if (juegoPrincipal?.imagen_portada) imagenDestacada = juegoPrincipal.imagen_portada;
      tituloEmbed = `🏷️ ${juegoPrincipal?.nombre || terminoLimpio} — Historial y Precio`;

      contextoSteam = {
        tipo: "consulta_historial_precios_y_ficha",
        juego: juegoPrincipal?.nombre || terminoLimpio,
        historial_precios: historial,
        ficha_tecnica: detalle,
      };
    }
    // 4. Juegos más jugados en vivo (Steam Charts)
    else if (
      min.includes("mas jugado") ||
      min.includes("más jugado") ||
      min.includes("top jugado") ||
      min.includes("jugadores en vivo") ||
      min.includes("concurrencia") ||
      min.includes("que juega la gente") ||
      min.includes("lo que mas se juega") ||
      min.includes("steam charts")
    ) {
      const soloGratis = min.includes("gratis") || min.includes("free");
      const masJugados = await llamarMcp("juegos_mas_jugados_steam", {
        limite: 10,
        solo_gratuitos: soloGratis,
        precio_maximo: precioFiltro ?? undefined,
      });
      contextoSteam = { tipo: "juegos_mas_jugados_steam_charts", datos: masJugados };
      const top1 = masJugados.juegos_mas_jugados?.[0];
      if (top1?.imagen_portada) imagenDestacada = top1.imagen_portada;
      tituloEmbed = "🔥 Juegos Más Jugados en Steam (En Vivo)";
    }
    // 3. Juegos gratuitos / Free to Play
    else if (
      min.includes("free to play") ||
      min.includes("f2p") ||
      min.includes("juegos gratis") ||
      min.includes("juego gratis") ||
      min.includes("gratuitos") ||
      min.includes("sin pagar")
    ) {
      const [gratuitos, topJugados] = await Promise.all([
        llamarMcp("juegos_gratuitos_steam", { limite: 10 }),
        llamarMcp("juegos_mas_jugados_steam", { solo_gratuitos: true, limite: 5 }),
      ]);
      contextoSteam = {
        tipo: "juegos_free_to_play",
        mejores_gratuitos: gratuitos.juegos_gratuitos,
        mas_jugados_gratuitos: topJugados.juegos_mas_jugados,
      };
      const primero = gratuitos.juegos_gratuitos?.[0];
      if (primero?.imagen_portada) imagenDestacada = primero.imagen_portada;
      tituloEmbed = "🎁 Los Mejores Juegos Free to Play en Steam";
    }
    // 4. Búsqueda por presupuesto o recomendación según biblioteca (ej: bajo 10.000 aunque no esté en oferta)
    else if (
      precioFiltro !== null ||
      min.includes("recomiend") ||
      min.includes("podria gustar") ||
      min.includes("segun mi biblioteca") ||
      min.includes("segun mis juegos") ||
      min.includes("que me gusta") ||
      min.includes("que jugar")
    ) {
      const [recomendaciones, porPrecio, destacados] = await Promise.all([
        llamarMcp("recomendar_segun_biblioteca", {
          precio_maximo: precioFiltro ?? undefined,
          solo_en_oferta: false,
          limite: 8,
        }),
        precioFiltro !== null
          ? llamarMcp("buscar_juegos_por_precio", {
              precio_maximo: precioFiltro,
              solo_en_oferta: false,
              limite: 8,
            })
          : Promise.resolve({ juegos: [] }),
        llamarMcp("juegos_destacados_steam", {
          precio_maximo: precioFiltro ?? undefined,
          solo_con_descuento: false,
          limite: 6,
        }),
      ]);

      contextoSteam = {
        tipo: "recomendaciones_personalizadas_y_presupuesto",
        presupuesto_maximo_solicitado: precioFiltro ? `$${precioFiltro.toLocaleString("es-CL")}` : "Sin limite",
        recomendaciones_segun_tu_biblioteca: recomendaciones.recomendaciones ?? [],
        generos_detectados_en_tu_pc: recomendaciones.generos_preferidos_detectados ?? [],
        juegos_en_tu_pc: recomendaciones.biblioteca_analizada ?? [],
        juegos_bajo_presupuesto_catalogo: porPrecio.juegos ?? [],
        destacados_y_mas_vendidos: destacados.juegos_destacados ?? [],
      };

      const topRec = (recomendaciones.recomendaciones?.[0] || porPrecio.juegos?.[0] || destacados.juegos_destacados?.[0]);
      if (topRec?.imagen_portada) imagenDestacada = topRec.imagen_portada;
      tituloEmbed = precioFiltro
        ? `🎯 Recomendaciones bajo $${precioFiltro.toLocaleString("es-CL")} • Steam`
        : "🎯 Recomendaciones Basadas en tu Biblioteca";
    }
    // 5. Juegos más destacados / Lo más vendido (con o sin oferta)
    else if (
      min.includes("destacado") ||
      min.includes("mas vendido") ||
      min.includes("más vendido") ||
      min.includes("top seller") ||
      min.includes("populares") ||
      min.includes("tendencia")
    ) {
      const destacados = await llamarMcp("juegos_destacados_steam", {
        solo_con_descuento: false,
        limite: 10,
      });
      contextoSteam = { tipo: "juegos_destacados_y_mas_vendidos", datos: destacados };
      const top1 = destacados.juegos_destacados?.[0];
      if (top1?.imagen_portada) imagenDestacada = top1.imagen_portada;
      tituloEmbed = "⭐ Juegos Más Destacados y Populares de Steam";
    }
    // 6. Nuevos lanzamientos
    else if (
      min.includes("lanzamiento") ||
      min.includes("nuevo") ||
      min.includes("estreno") ||
      min.includes("novedad")
    ) {
      const nuevos = await llamarMcp("nuevos_lanzamientos_steam", { limite: 10 });
      contextoSteam = { tipo: "nuevos_lanzamientos_steam", datos: nuevos };
      const primero = nuevos.nuevos_lanzamientos?.[0];
      if (primero?.imagen_portada) imagenDestacada = primero.imagen_portada;
      tituloEmbed = "🚀 Nuevos Lanzamientos Relevantes en Steam";
    }
    // 7. Ofertas con descuento
    else if (
      min.includes("oferta") ||
      min.includes("descuento") ||
      min.includes("rebaja") ||
      min.includes("barato") ||
      min.includes("ganga")
    ) {
      const matchNum = min.match(/(\d{1,2})\s*%/);
      const dto = matchNum ? Math.max(10, Math.min(90, Number(matchNum[1]))) : 30;
      const [ofertas, nuevos] = await Promise.all([
        llamarMcp("buscar_ofertas_steam", { descuento_minimo: dto, limite: 10 }),
        llamarMcp("nuevos_lanzamientos_steam", { solo_con_descuento: true, limite: 5 }),
      ]);
      contextoSteam = {
        tipo: "ofertas_y_lanzamientos_actuales",
        ofertas: ofertas.ofertas,
        nuevos_con_descuento: nuevos.nuevos_lanzamientos,
      };
      const top = ofertas.ofertas?.[0];
      if (top?.imagen_portada) imagenDestacada = top.imagen_portada;
      tituloEmbed = "🔥 Ofertas Destacadas en Steam";
    }
    // 8. Preguntar por un juego en específico o búsqueda general
    else {
      const terminoLimpio = limpio
        .replace(/^(hola|oye|dime|busca|buscar|precio de|cuanto cuesta|que tal es|esta en oferta|informacion de|info de)\s+/i, "")
        .trim();

      const [detalle, busqueda, masJugados] = await Promise.all([
        terminoLimpio.length >= 2
          ? llamarMcp("detalle_juego_steam", { nombre: terminoLimpio.slice(0, 80) })
          : Promise.resolve(null),
        terminoLimpio.length >= 2
          ? llamarMcp("buscar_juego_steam", { consulta: terminoLimpio.slice(0, 80) })
          : Promise.resolve({ resultados: [] }),
        llamarMcp("juegos_mas_jugados_steam", { limite: 5 }),
      ]);

      const juegoPrincipal = detalle?.appid ? detalle : null;
      if (juegoPrincipal?.imagen_portada) {
        imagenDestacada = juegoPrincipal.imagen_portada;
        tituloEmbed = `🎮 ${juegoPrincipal.nombre} — Ficha de Steam`;
      } else if (busqueda.resultados?.[0]?.imagen_portada) {
        imagenDestacada = busqueda.resultados[0].imagen_portada;
        tituloEmbed = `🎮 ${busqueda.resultados[0].nombre} — Steam`;
      }

      contextoSteam = {
        tipo: "consulta_especifica_de_juego",
        detalle_juego_especifico: juegoPrincipal,
        otros_resultados: busqueda.resultados?.slice(0, 5) ?? [],
        juegos_top_del_momento: masJugados.juegos_mas_jugados ?? [],
      };
    }

    // 2. Consultar a la IA con los datos reales del MCP
    const { texto: respuestaIA, modeloUsado } = await consultarIALibre([
      {
        role: "system",
        content:
          "Eres 'Oferta Steam', un asistente gamer inteligente y experto conectado al servidor MCP de Steam del usuario y a su biblioteca local de juegos. " +
          "Responde SIEMPRE en español, de forma concisa, amigable, estructurada y muy clara para leer en Discord desde el teléfono. " +
          "Reglas estrictas:\n" +
          "1. Usa UNICAMENTE los precios, porcentajes de descuento, nombres, enlaces y datos reales del JSON DATOS_MCP_STEAM. No inventes precios ni juegos.\n" +
          "2. Si se consulta por el historial de precios o el precio de un juego, muestra su precio actual, precio normal, descuento, y destaca su MINIMO HISTORICO REGISTRADO y fecha, concluyendo con el consejo de compra (si conviene comprar ahora o esperar rebajas).\n" +
          "3. Si se solicita la categorización o perfil gamer del usuario, presenta con entusiasmo y estilo gamer su Arquetipo de Jugador, Insignia de Rango, géneros dominantes en %, estadísticas de biblioteca y una recomendación hecha a su medida.\n" +
          "4. Si pregunta por los juegos más jugados, menciona los jugadores concurrentes en vivo actuales y su pico en 24h.\n" +
          "5. Si el usuario pide juegos bajo cierto presupuesto (ej: bajo $10.000 CLP), incluye tanto juegos con descuento como juegos a precio normal regular bajo ese valor, y explica claramente por qué le pueden gustar según lo que juega en su biblioteca.\n" +
          "6. Si pregunta por sus juegos instalados, lista los juegos de su PC, tamaño en GB y fecha de última partida.\n" +
          "7. Incluye siempre enlaces en formato Markdown [Nombre del Juego](url_tienda) para que el usuario pueda abrirlo directamente en Steam.",
      },
      {
        role: "user",
        content:
          `Pregunta del usuario en Discord: "${limpio}"\n\n` +
          `DATOS_MCP_STEAM (en vivo desde Steam y la biblioteca del PC):\n${JSON.stringify(contextoSteam, null, 2)}`,
      },
    ]);

    await responderDiscord(channelId, messageId, {
      title: tituloEmbed,
      description: respuestaIA.slice(0, 3900) || "Aquí tienes la información solicitada de Steam.",
      color: 0x1b2838,
      image: imagenDestacada ? { url: imagenDestacada } : undefined,
      footer: { text: `IA Gamer (${modeloUsado}) • MCP oferta-steam` },
    });
  } catch (err) {
    console.error("[Bot Discord] Error en IA/MCP:", err);
    await responderDiscord(channelId, messageId, {
      title: "⚠️ Error al procesar la consulta",
      description: `No pude completar la consulta: ${err.message}`,
      color: 0xe74c3c,
    });
  }
}

// 3. Conectar al Gateway de Discord (con fallback automático si MESSAGE_CONTENT no está activo)
function conectarGateway(usarMessageContentIntent = true) {
  const ws = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");
  let latido = null;

  ws.addEventListener("message", async (ev) => {
    const pkt = JSON.parse(String(ev.data));
    const { op, t, d } = pkt;

    if (op === 10) {
      const intervalo = d.heartbeat_interval;
      latido = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ op: 1, d: null }));
        }
      }, intervalo);

      const intents = usarMessageContentIntent ? 1 | 512 | 4096 | 32768 : 1 | 512 | 4096;
      ws.send(
        JSON.stringify({
          op: 2,
          d: {
            token,
            intents,
            properties: { os: process.platform, browser: "oferta-steam", device: "oferta-steam" },
          },
        }),
      );
    } else if (t === "READY") {
      console.error(
        `[Bot Discord + IA Libre] Conectado como ${d.user?.username}#${d.user?.discriminator} (ID: ${d.user?.id})`,
      );
    } else if (t === "MESSAGE_CREATE") {
      if (d.author?.bot) return;
      const contenido = (d.content ?? "").trim();
      if (!contenido) {
        console.error(
          "[Bot Discord] Mensaje recibido vacio: menciona al bot (@steam ofertas) o activa 'MESSAGE CONTENT INTENT' en Discord Developer Portal.",
        );
        return;
      }
      console.error(`[Bot Discord] Pregunta de ${d.author.username}: ${contenido}`);
      await procesarPreguntaConIA(contenido, d.channel_id, d.id);
    }
  });

  ws.addEventListener("close", (ev) => {
    if (latido) clearInterval(latido);
    if (ev.code === 4014 && usarMessageContentIntent) {
      console.error(
        "[Bot Discord] MESSAGE CONTENT INTENT no activado en el portal; reconectando en modo mencion (@steam ofertas)...",
      );
      conectarGateway(false);
      return;
    }
    console.error(`[Bot Discord] Conexion cerrada (codigo ${ev.code}). Reintentando en 5s...`);
    setTimeout(() => conectarGateway(usarMessageContentIntent), 5000);
  });
}

conectarGateway(true);
