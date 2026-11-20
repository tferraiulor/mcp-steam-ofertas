/**
 * Herramientas MCP: oferta-steam (Supercargado)
 *
 * Funcionalidades completas:
 * 1. buscar_ofertas_steam: Ofertas con descuento y filtros avanzados.
 * 2. nuevos_lanzamientos_steam: Estrenos y lanzamientos recientes destacados.
 * 3. buscar_juego_steam: Búsqueda rápida por nombre o palabra clave con precios y estado de instalación.
 * 4. detalle_juego_steam: Ficha completa de un juego específico por AppID o nombre (géneros, reseñas, precio, requisitos).
 * 5. listar_juegos_instalados: Detección automática de Steam y bibliotecas múltiples en cualquier PC.
 * 6. juegos_destacados_steam: Los más vendidos y destacados de Steam (incluso a precio normal fuera de oferta).
 * 7. juegos_mas_jugados_steam: Los juegos con más jugadores en vivo en el mundo (Steam Charts en tiempo real).
 * 8. juegos_gratuitos_steam: Los mejores títulos Free to Play de Steam.
 * 9. buscar_juegos_por_precio: Búsqueda y filtrado por presupuesto máximo (ej: bajo $10.000 CLP / $15 USD), con o sin oferta.
 * 10. recomendar_segun_biblioteca: Recomendación personalizada analizando los géneros de los juegos instalados por el usuario.
 * 11. notificar_oferta_steam: Notificación directa al teléfono mediante Webhook de Discord y aviso nativo en Windows.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { run } from "../lib/exec.js";
import { error, json, texto } from "../lib/respuestas.js";

const DEFAULT_STEAM_DIR = "D:\\games\\steam";
const CODIGO_PAIS_REGEX = /^[A-Za-z]{2}$/;
const DISCORD_WEBHOOK_REGEX = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

// Caché en memoria para evitar llamadas redundantes a la API de Steam durante la sesión
const cacheDetalles = new Map<number, any>();
const cacheGeneros = new Map<number, string[]>();

async function obtenerVariableEntorno(clave: string): Promise<string | undefined> {
  const directa = process.env[clave]?.trim();
  if (directa) return directa;
  try {
    const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const envContenido = await readFile(path.join(raiz, ".env"), "utf8");
    for (const linea of envContenido.split(/\r?\n/)) {
      const limpia = linea.trim();
      if (!limpia || limpia.startsWith("#")) continue;
      const idx = limpia.indexOf("=");
      if (idx > 0 && limpia.slice(0, idx).trim() === clave) {
        return limpia.slice(idx + 1).trim();
      }
    }
  } catch {
    // .env es opcional
  }
  return undefined;
}

// Detección automática y dinámica de la carpeta de Steam en cualquier máquina y sistema operativo
async function detectarRutaSteam(): Promise<string> {
  const custom = await obtenerVariableEntorno("STEAM_DIR");
  if (custom && existsSync(custom)) return custom;

  if (process.platform === "win32") {
    // 1. Registro de Windows (HKCU\Software\Valve\Steam\SteamPath)
    try {
      const r = await run("reg.exe", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], { timeoutMs: 3000 });
      const m = r.stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i);
      if (m && m[1]) {
        const p = m[1].trim().replace(/\//g, "\\");
        if (existsSync(p)) return p;
      }
    } catch {}

    // 2. Registro de 64/32 bits alternativo
    try {
      const r = await run("reg.exe", ["query", "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "/v", "InstallPath"], { timeoutMs: 3000 });
      const m = r.stdout.match(/InstallPath\s+REG_SZ\s+(.+)/i);
      if (m && m[1]) {
        const p = m[1].trim();
        if (existsSync(p)) return p;
      }
    } catch {}

    // 3. Rutas típicas comunes
    const candidatos = [
      "D:\\games\\steam",
      "C:\\Program Files (x86)\\Steam",
      "C:\\Program Files\\Steam",
      "D:\\Steam",
      "E:\\Steam",
      "C:\\Steam",
    ];
    for (const c of candidatos) {
      if (existsSync(c)) return c;
    }
  } else if (process.platform === "darwin") {
    const macDir = path.join(process.env.HOME || "", "Library", "Application Support", "Steam");
    if (existsSync(macDir)) return macDir;
  } else {
    const linuxDirs = [
      path.join(process.env.HOME || "", ".steam", "steam"),
      path.join(process.env.HOME || "", ".local", "share", "Steam"),
    ];
    for (const d of linuxDirs) {
      if (existsSync(d)) return d;
    }
  }

  return DEFAULT_STEAM_DIR;
}

export interface InstalledSteamGame {
  appid: number;
  nombre: string;
  biblioteca: string;
  carpeta_instalacion: string;
  tamano_gb: number;
  ultima_vez_jugado: string | null;
  generos?: string[];
}

function formatearPrecio(centavos: number | undefined | null, moneda: string): string {
  if (centavos === undefined || centavos === null) return "Gratis / N/D";
  if (centavos === 0) return "Gratis";
  const valor = centavos / 100;
  try {
    return new Intl.NumberFormat("es-CL", {
      style: "currency",
      currency: moneda || "CLP",
      maximumFractionDigits: moneda === "CLP" ? 0 : 2,
    }).format(valor);
  } catch {
    return `${valor} ${moneda}`;
  }
}

function extraerValorAcf(contenido: string, clave: string): string | null {
  const regex = new RegExp(`"${clave}"\\s+"([^"]*)"`, "i");
  const match = contenido.match(regex);
  return match ? match[1] : null;
}

async function obtenerCarpetasBiblioteca(steamDir: string): Promise<string[]> {
  const carpetas = new Set<string>();
  if (existsSync(steamDir)) carpetas.add(steamDir);

  const vdfPath = path.join(steamDir, "steamapps", "libraryfolders.vdf");
  try {
    const contenido = await readFile(vdfPath, "utf8");
    const matches = contenido.matchAll(/"path"\s+"([^"]+)"/g);
    for (const match of matches) {
      const rutaLimpia = match[1].replace(/\\\\/g, "\\");
      if (existsSync(rutaLimpia)) carpetas.add(rutaLimpia);
    }
  } catch {
    // Si no se puede leer libraryfolders.vdf, usamos la carpeta base
  }

  // Comprobar también bibliotecas habituales en C:\SteamLibrary o D:\SteamLibrary
  for (const extra of ["C:\\SteamLibrary", "D:\\SteamLibrary", "E:\\SteamLibrary"]) {
    if (existsSync(extra)) carpetas.add(extra);
  }

  return carpetas.size > 0 ? Array.from(carpetas) : [steamDir];
}

async function leerJuegosInstalados(): Promise<InstalledSteamGame[]> {
  const steamDir = await detectarRutaSteam();
  const bibliotecas = await obtenerCarpetasBiblioteca(steamDir);
  const juegos: InstalledSteamGame[] = [];

  for (const bib of bibliotecas) {
    const steamappsDir = path.join(bib, "steamapps");
    let archivos: string[] = [];
    try {
      archivos = await readdir(steamappsDir);
    } catch {
      continue;
    }

    const manifiestos = archivos.filter((f) => /^appmanifest_\d+\.acf$/i.test(f));
    for (const archivo of manifiestos) {
      try {
        const contenido = await readFile(path.join(steamappsDir, archivo), "utf8");
        const appidRaw = extraerValorAcf(contenido, "appid");
        const nombre = extraerValorAcf(contenido, "name");
        if (!appidRaw || !nombre) continue;

        const appid = Number.parseInt(appidRaw, 10);
        if (appid === 228980) continue; // Ignorar Steamworks Common Redistributables

        const sizeRaw = extraerValorAcf(contenido, "SizeOnDisk");
        const lastPlayedRaw = extraerValorAcf(contenido, "LastPlayed");
        const installdir = extraerValorAcf(contenido, "installdir") ?? "";

        const bytes = sizeRaw ? Number.parseInt(sizeRaw, 10) : 0;
        const lastPlayedSec = lastPlayedRaw ? Number.parseInt(lastPlayedRaw, 10) : 0;

        juegos.push({
          appid,
          nombre,
          biblioteca: bib,
          carpeta_instalacion: installdir,
          tamano_gb: Number((bytes / (1024 ** 3)).toFixed(2)),
          ultima_vez_jugado:
            lastPlayedSec > 0 ? new Date(lastPlayedSec * 1000).toISOString().split("T")[0] : null,
        });
      } catch {
        // Ignorar manifiestos individuales con error
      }
    }
  }

  return juegos.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

interface SteamRawCategoryItem {
  id: number;
  name: string;
  discounted: boolean;
  discount_percent: number;
  original_price?: number;
  final_price: number;
  currency: string;
  windows_available?: boolean;
  mac_available?: boolean;
  linux_available?: boolean;
  header_image?: string;
  large_capsule_image?: string;
}

async function consultarCategoriasDestacadas(pais: string): Promise<Record<string, unknown>> {
  const cc = pais.toUpperCase();
  const url = new URL("https://store.steampowered.com/api/featuredcategories");
  url.searchParams.set("cc", cc);
  url.searchParams.set("l", "spanish");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`La API de Steam respondio HTTP ${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

async function consultarDestacadosGenerales(pais: string): Promise<Record<string, unknown>> {
  const cc = pais.toUpperCase();
  const url = new URL("https://store.steampowered.com/api/featured");
  url.searchParams.set("cc", cc);
  url.searchParams.set("l", "spanish");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    return {};
  }
  return (await res.json()) as Record<string, unknown>;
}

async function obtenerGenerosDeApp(appid: number, pais = "CL"): Promise<string[]> {
  if (cacheGeneros.has(appid)) {
    return cacheGeneros.get(appid)!;
  }
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${pais}&l=spanish&filters=genres`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const data = (await res.json()) as Record<string, { data?: { genres?: Array<{ description: string }> } }>;
    const genres = (data[String(appid)]?.data?.genres ?? []).map((g) => g.description);
    cacheGeneros.set(appid, genres);
    return genres;
  } catch {
    return [];
  }
}

interface HistorialPreciosCheapShark {
  minimo_historico_registrado: string | null;
  fecha_minimo_historico: string | null;
  precio_minimo_usd: number | null;
  mejor_oferta_actual_usd: string | null;
}

async function consultarHistorialPreciosCheapShark(appid: number): Promise<HistorialPreciosCheapShark | null> {
  try {
    const resCS = await fetch(`https://www.cheapshark.com/api/1.0/games?steamAppID=${appid}`, {
      headers: { "User-Agent": "OfertaSteamBot/1.0 (oferta-steam@uni.cl)" },
      signal: AbortSignal.timeout(4500),
    });
    if (!resCS.ok) return null;
    const dataCS = (await resCS.json()) as Array<{ gameID?: string }>;
    const gameID = dataCS?.[0]?.gameID;
    if (!gameID) return null;

    const resDetails = await fetch(`https://www.cheapshark.com/api/1.0/games?id=${gameID}`, {
      headers: { "User-Agent": "OfertaSteamBot/1.0 (oferta-steam@uni.cl)" },
      signal: AbortSignal.timeout(4500),
    });
    if (!resDetails.ok) return null;
    const d = (await resDetails.json()) as any;
    const lowest = d.cheapestPriceEver;
    const lowestDate = lowest?.date ? new Date(lowest.date * 1000).toISOString().split("T")[0] : null;

    return {
      minimo_historico_registrado: lowest ? `$${lowest.price} USD` : null,
      fecha_minimo_historico: lowestDate,
      precio_minimo_usd: lowest?.price ? Number(lowest.price) : null,
      mejor_oferta_actual_usd: d.deals?.[0]?.price ? `$${d.deals[0].price} USD` : null,
    };
  } catch {
    return null;
  }
}

// Script PowerShell para alerta emergente en Windows
const SCRIPT_TOAST_WINDOWS = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$notify.BalloonTipTitle = $env:MCP_TITULO
$notify.BalloonTipText = $env:MCP_MENSAJE
$notify.Visible = $true
$notify.ShowBalloonTip(5000)
Start-Sleep -Milliseconds 1500
$notify.Dispose()
`;

export function register(server: McpServer): void {
  // =========================================================================
  // 1. Juegos más destacados y más vendidos (con o sin oferta)
  // =========================================================================
  server.registerTool(
    "juegos_destacados_steam",
    {
      title: "Juegos más destacados y más vendidos en Steam",
      description:
        "Obtiene los juegos más destacados, populares y más vendidos en Steam. A diferencia de buscar_ofertas, INCLUYE juegos a precio normal fuera de oferta, y permite filtrar por precio máximo (ej: bajo $10.000 CLP). Ideal para descubrir los mejores juegos del momento con o sin descuento.",
      inputSchema: {
        precio_maximo: z
          .number()
          .positive()
          .optional()
          .describe("Precio final maximo en la moneda local (ej: 10000 para juegos bajo $10.000 CLP, o 20 para USD). Opcional."),
        solo_con_descuento: z
          .boolean()
          .default(false)
          .describe("Si es true, muestra solo los que tienen descuento; si es false (por defecto), incluye tambien juegos a precio normal."),
        ocultar_instalados: z
          .boolean()
          .default(true)
          .describe("Si es true, excluye los juegos que ya tienes instalados en tu PC"),
        pais: z
          .string()
          .regex(CODIGO_PAIS_REGEX)
          .default("CL")
          .describe("Codigo ISO de 2 letras del pais para precios (ej: CL, AR, MX, US, ES)"),
        limite: z
          .number()
          .int()
          .min(1)
          .max(40)
          .default(15)
          .describe("Cantidad maxima de juegos a devolver (1 a 40)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ precio_maximo, solo_con_descuento, ocultar_instalados, pais, limite }) => {
      try {
        const [catData, featData, instalados] = await Promise.all([
          consultarCategoriasDestacadas(pais),
          consultarDestacadosGenerales(pais),
          leerJuegosInstalados(),
        ]);

        const idsInstalados = new Set(instalados.map((j) => j.appid));
        const topSellers = (catData.top_sellers as { items?: SteamRawCategoryItem[] })?.items ?? [];
        const featuredWin = (featData.featured_win as SteamRawCategoryItem[]) ?? [];
        const specials = (catData.specials as { items?: SteamRawCategoryItem[] })?.items ?? [];
        const spotlights = [
          catData["0"], catData["1"], catData["2"], catData["3"], catData["4"], catData["5"]
        ].flatMap((c: any) => c?.items ?? []);

        const todos = [...topSellers, ...featuredWin, ...specials, ...spotlights];
        const vistos = new Set<number>();
        const unicos: SteamRawCategoryItem[] = [];

        for (const item of todos) {
          if (item && typeof item.id === "number" && !vistos.has(item.id)) {
            vistos.add(item.id);
            unicos.push(item);
          }
        }

        const filtrados = unicos
          .filter((item) => {
            if (ocultar_instalados && idsInstalados.has(item.id)) return false;
            if (solo_con_descuento && (!item.discounted || item.discount_percent <= 0)) return false;
            const precioReal = (item.final_price ?? 0) / 100;
            if (precio_maximo !== undefined && precioReal > precio_maximo) return false;
            return true;
          })
          .slice(0, limite)
          .map((item) => {
            const precioReal = (item.final_price ?? 0) / 100;
            return {
              appid: item.id,
              nombre: item.name,
              en_oferta: Boolean(item.discounted && item.discount_percent > 0),
              descuento_porcentaje: item.discount_percent || 0,
              precio_final: formatearPrecio(item.final_price, item.currency),
              precio_original: item.discounted ? formatearPrecio(item.original_price, item.currency) : undefined,
              valor_numerico: precioReal,
              es_gratis: item.final_price === 0,
              moneda: item.currency || "CLP",
              instalado_en_pc: idsInstalados.has(item.id),
              imagen_portada: item.header_image || `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${item.id}/header.jpg`,
              url_tienda: `https://store.steampowered.com/app/${item.id}`,
              uri_cliente_steam: `steam://store/${item.id}`,
            };
          });

        return json({
          pais: pais.toUpperCase(),
          filtro_precio_maximo: precio_maximo !== undefined ? `${precio_maximo}` : "Sin limite",
          solo_con_descuento,
          total_encontrados: filtrados.length,
          juegos_destacados: filtrados,
        });
      } catch (e) {
        return error(`Error al obtener los juegos destacados de Steam: ${(e as Error).message}`);
      }
    },
  );

  // =========================================================================
  // 2. Juegos más jugados en tiempo real (Steam Charts / Concurrent Players)
  // =========================================================================
  server.registerTool(
    "juegos_mas_jugados_steam",
    {
      title: "Juegos más jugados en Steam en vivo (Steam Charts)",
      description:
        "Consulta la lista oficial de los juegos con más jugadores en vivo en el mundo ahora mismo en Steam. Muestra jugadores concurrentes actuales, pico en 24h, precio actual, si está en oferta y si ya lo tienes instalado en tu PC.",
      inputSchema: {
        limite: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(10)
          .describe("Cantidad de juegos top a devolver (1 a 30, por defecto 10)"),
        solo_gratuitos: z
          .boolean()
          .default(false)
          .describe("Si es true, filtra únicamente los juegos más jugados que son Free to Play"),
        precio_maximo: z
          .number()
          .positive()
          .optional()
          .describe("Precio final maximo para filtrar los juegos mas jugados"),
        pais: z
          .string()
          .regex(CODIGO_PAIS_REGEX)
          .default("CL")
          .describe("Codigo ISO de 2 letras del pais para precios (ej: CL, AR, MX, US, ES)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ limite, solo_gratuitos, precio_maximo, pais }) => {
      try {
        const [resCharts, catData, instalados] = await Promise.all([
          fetch("https://api.steampowered.com/ISteamChartsService/GetGamesByConcurrentPlayers/v1/"),
          consultarCategoriasDestacadas(pais),
          leerJuegosInstalados(),
        ]);

        if (!resCharts.ok) {
          return error(`No se pudieron obtener los datos de Steam Charts (HTTP ${resCharts.status})`);
        }

        const chartsData = (await resCharts.json()) as {
          response?: { ranks?: Array<{ rank: number; appid: number; concurrent_in_game: number; peak_in_game: number }> };
        };

        const ranks = chartsData.response?.ranks?.slice(0, Math.min(50, limite * 3)) || [];
        const idsInstalados = new Set(instalados.map((j) => j.appid));

        // Diccionario rápido de nombres desde categorías destacadas
        const lookup = new Map<number, SteamRawCategoryItem>();
        for (const list of [
          (catData as any).top_sellers?.items || [],
          (catData as any).specials?.items || [],
          (catData as any).new_releases?.items || [],
        ]) {
          for (const item of list as SteamRawCategoryItem[]) {
            if (item?.id) lookup.set(item.id, item);
          }
        }

        const enriquecidos = await Promise.all(
          ranks.map(async (r) => {
            const appid = r.appid;
            const cacheItem = cacheDetalles.get(appid);
            if (cacheItem) {
              return { ...cacheItem, rank: r.rank, jugadores_actuales: r.concurrent_in_game, pico_24h: r.peak_in_game };
            }

            const itemFeat = lookup.get(appid);
            if (itemFeat) {
              const resObj = {
                rank: r.rank,
                appid,
                nombre: itemFeat.name,
                jugadores_actuales: r.concurrent_in_game,
                pico_24h: r.peak_in_game,
                es_gratis: itemFeat.final_price === 0,
                precio_final: formatearPrecio(itemFeat.final_price, itemFeat.currency),
                valor_numerico: (itemFeat.final_price ?? 0) / 100,
                en_oferta: Boolean(itemFeat.discounted && itemFeat.discount_percent > 0),
                descuento_porcentaje: itemFeat.discount_percent || 0,
                moneda: itemFeat.currency || "CLP",
                instalado_en_pc: idsInstalados.has(appid),
                url_tienda: `https://store.steampowered.com/app/${appid}`,
                uri_cliente_steam: `steam://store/${appid}`,
                imagen_portada: itemFeat.header_image || `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
              };
              cacheDetalles.set(appid, resObj);
              return resObj;
            }

            // Consultar appdetails si no estaba en destacados
            try {
              const resDetail = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${pais}&l=spanish&filters=basic,price_overview`);
              if (resDetail.ok) {
                const j = (await resDetail.json()) as any;
                const d = j[String(appid)]?.data;
                if (d) {
                  const po = d.price_overview;
                  const isFree = Boolean(d.is_free);
                  const resObj = {
                    rank: r.rank,
                    appid,
                    nombre: d.name,
                    jugadores_actuales: r.concurrent_in_game,
                    pico_24h: r.peak_in_game,
                    es_gratis: isFree,
                    precio_final: isFree ? "Gratis" : po?.final_formatted || formatearPrecio(po?.final, po?.currency),
                    valor_numerico: isFree ? 0 : (po?.final ?? 0) / 100,
                    en_oferta: po ? po.discount_percent > 0 : false,
                    descuento_porcentaje: po?.discount_percent || 0,
                    moneda: po?.currency || "CLP",
                    instalado_en_pc: idsInstalados.has(appid),
                    url_tienda: `https://store.steampowered.com/app/${appid}`,
                    uri_cliente_steam: `steam://store/${appid}`,
                    imagen_portada: d.header_image || `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
                  };
                  cacheDetalles.set(appid, resObj);
                  return resObj;
                }
              }
            } catch {}

            return {
              rank: r.rank,
              appid,
              nombre: `AppID ${appid}`,
              jugadores_actuales: r.concurrent_in_game,
              pico_24h: r.peak_in_game,
              es_gratis: false,
              precio_final: "Consultar en tienda",
              valor_numerico: 0,
              en_oferta: false,
              descuento_porcentaje: 0,
              moneda: "CLP",
              instalado_en_pc: idsInstalados.has(appid),
              url_tienda: `https://store.steampowered.com/app/${appid}`,
              uri_cliente_steam: `steam://store/${appid}`,
              imagen_portada: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
            };
          }),
        );

        const filtrados = enriquecidos
          .filter((g) => {
            if (solo_gratuitos && !g.es_gratis) return false;
            if (precio_maximo !== undefined && g.valor_numerico > precio_maximo) return false;
            return true;
          })
          .slice(0, limite);

        return json({
          total: filtrados.length,
          solo_gratuitos,
          precio_maximo: precio_maximo ?? "Sin limite",
          juegos_mas_jugados: filtrados,
        });
      } catch (e) {
        return error(`Error al consultar los juegos más jugados de Steam: ${(e as Error).message}`);
      }
    },
  );

  // =========================================================================
  // 3. Top Juegos Gratuitos / Free to Play
  // =========================================================================
  server.registerTool(
    "juegos_gratuitos_steam",
    {
      title: "Mejores juegos gratuitos (Free to Play) en Steam",
      description:
        "Obtiene los mejores y más populares juegos Free to Play (gratuitos) disponibles en Steam con su puntuación de reseñas, enlace a la tienda y si ya los tienes en tu biblioteca.",
      inputSchema: {
        limite: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(15)
          .describe("Cantidad de juegos gratuitos a devolver (1 a 30)"),
        ocultar_instalados: z
          .boolean()
          .default(false)
          .describe("Si es true, no muestra los juegos que ya tienes instalados en tu PC"),
        pais: z
          .string()
          .regex(CODIGO_PAIS_REGEX)
          .default("CL")
          .describe("Codigo ISO de 2 letras del pais (ej: CL, AR, MX, US, ES)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ limite, ocultar_instalados, pais }) => {
      try {
        const url = `https://store.steampowered.com/search/results/?maxprice=free&cc=${pais}&l=spanish`;
        const [res, instalados] = await Promise.all([
          fetch(url),
          leerJuegosInstalados(),
        ]);

        if (!res.ok) {
          return error(`Steam respondió HTTP ${res.status} al buscar juegos gratuitos.`);
        }

        const idsInstalados = new Set(instalados.map((j) => j.appid));
        const txt = await res.text();
        const rowRegex = /<a\s+href="https:\/\/store\.steampowered\.com\/app\/(\d+)\/[^"]*"[^>]*data-ds-appid="(\d+)"[^>]*>([\s\S]*?)<\/a>/g;

        let m: RegExpExecArray | null;
        const resultados: any[] = [];
        const vistos = new Set<number>();

        while ((m = rowRegex.exec(txt)) !== null) {
          const appid = Number(m[2]);
          if (!appid || vistos.has(appid)) continue;
          vistos.add(appid);

          if (ocultar_instalados && idsInstalados.has(appid)) continue;

          const inner = m[3];
          const nombre = inner.match(/<span class="title">([^<]+)<\/span>/)?.[1] || `AppID ${appid}`;
          const resenas = inner.match(/data-tooltip-html="([^"]+)"/)?.[1]?.split("&lt;br&gt;")[0] || "Positivas";

          resultados.push({
            appid,
            nombre,
            precio: "Gratuito",
            resenas,
            instalado_en_pc: idsInstalados.has(appid),
            imagen_portada: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
            url_tienda: `https://store.steampowered.com/app/${appid}`,
            uri_cliente_steam: `steam://store/${appid}`,
          });

          if (resultados.length >= limite) break;
        }

        return json({
          total_encontrados: resultados.length,
          pais: pais.toUpperCase(),
          juegos_gratuitos: resultados,
        });
      } catch (e) {
        return error(`Error al buscar juegos gratuitos en Steam: ${(e as Error).message}`);
      }
    },
  );

  // =========================================================================
  // 4. Búsqueda y filtrado amplio por precio (ej: juegos bajo $10.000)
  // =========================================================================
  server.registerTool(
    "buscar_juegos_por_precio",
    {
      title: "Buscar juegos en Steam por presupuesto o precio máximo",
      description:
        "Busca juegos en Steam filtrados por un precio máximo específico (ejemplo: buscar juegos bajo 10.000 CLP o bajo 15 USD). Acepta juegos tanto en oferta como a precio normal regular fuera de oferta, y permite filtrar por palabra clave (ej: 'shooter', 'rpg', 'zombies').",
      inputSchema: {
        precio_maximo: z
          .number()
          .positive()
          .describe("Precio máximo en tu moneda local (ej: 10000 para juegos bajo $10.000 CLP, o 15 para USD)"),
        termino: z
          .string()
          .optional()
          .describe("Palabra clave opcional para filtrar por temática o género (ej: 'shooter', 'indie', 'terror', 'estrategia')"),
        incluir_gratuitos: z
          .boolean()
          .default(true)
          .describe("Si es true, incluye juegos Free to Play además de los juegos de pago que estén bajo el presupuesto"),
        solo_en_oferta: z
          .boolean()
          .default(false)
          .describe("Si es true, exige que el juego tenga descuento; si es false, incluye juegos a precio normal bajo el presupuesto"),
        ocultar_instalados: z
          .boolean()
          .default(true)
          .describe("Si es true, excluye los juegos que ya tienes instalados en tu PC"),
        pais: z
          .string()
          .regex(CODIGO_PAIS_REGEX)
          .default("CL")
          .describe("Codigo ISO de 2 letras del pais para precios (ej: CL, AR, MX, US, ES)"),
        limite: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(15)
          .describe("Cantidad máxima de juegos a devolver (1 a 30)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ precio_maximo, termino, incluir_gratuitos, solo_en_oferta, ocultar_instalados, pais, limite }) => {
      try {
        const queryTerm = termino ? encodeURIComponent(termino.trim()) : "";
        const url = `https://store.steampowered.com/search/results/?query=${queryTerm}&start=0&count=50&cc=${pais}&l=spanish`;

        const [res, catData, instalados] = await Promise.all([
          fetch(url),
          consultarCategoriasDestacadas(pais),
          leerJuegosInstalados(),
        ]);

        const idsInstalados = new Set(instalados.map((j) => j.appid));
        const juegosEncontrados: any[] = [];
        const vistos = new Set<number>();

        // 1. Añadir candidatos del catálogo de búsqueda
        if (res.ok) {
          const txt = await res.text();
          const rowRegex = /<a\s+href="https:\/\/store\.steampowered\.com\/app\/(\d+)\/[^"]*"[^>]*data-ds-appid="(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
          let m: RegExpExecArray | null;

          while ((m = rowRegex.exec(txt)) !== null) {
            const appid = Number(m[2]);
            if (!appid || vistos.has(appid)) continue;

            const inner = m[3];
            const title = inner.match(/<span class="title">([^<]+)<\/span>/)?.[1] || "";
            const priceFinalRaw = inner.match(/data-price-final="(\d+)"/)?.[1];
            const finalPriceText = inner.match(/<div class="discount_final_price[^"]*">([^<]+)<\/div>/)?.[1]?.trim() || "";
            const discountPctRaw = inner.match(/<div class="discount_pct">([^<]+)<\/div>/)?.[1]?.trim() || "";
            const originalPrice = inner.match(/<div class="discount_original_price">([^<]+)<\/div>/)?.[1]?.trim() || null;
            const reviews = inner.match(/data-tooltip-html="([^"]+)"/)?.[1]?.split("&lt;br&gt;")[0] || null;

            const isFree = finalPriceText.toLowerCase().includes("gratuito") || finalPriceText.toLowerCase().includes("free") || priceFinalRaw === "0";
            const priceCents = priceFinalRaw ? Number(priceFinalRaw) : 0;
            const priceNum = isFree ? 0 : priceCents / 100;
            const discount = discountPctRaw ? Math.abs(parseInt(discountPctRaw.replace(/[-%]/g, ""), 10)) : 0;

            vistos.add(appid);
            juegosEncontrados.push({
              appid,
              nombre: title,
              precio_num: priceNum,
              precio_final: isFree ? "Gratuito" : finalPriceText || formatearPrecio(priceCents, "CLP"),
              precio_original: originalPrice,
              descuento_porcentaje: discount,
              en_oferta: discount > 0,
              es_gratis: isFree,
              resenas: reviews,
              instalado_en_pc: idsInstalados.has(appid),
              url_tienda: `https://store.steampowered.com/app/${appid}`,
              uri_cliente_steam: `steam://store/${appid}`,
              imagen_portada: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
            });
          }
        }

        // 2. Añadir también juegos destacados y top sellers que califiquen en precio
        const extras = [
          ...((catData as any).top_sellers?.items || []),
          ...((catData as any).specials?.items || []),
        ] as SteamRawCategoryItem[];

        for (const it of extras) {
          if (!it || !it.id || vistos.has(it.id)) continue;
          vistos.add(it.id);
          const priceNum = (it.final_price ?? 0) / 100;
          juegosEncontrados.push({
            appid: it.id,
            nombre: it.name,
            precio_num: priceNum,
            precio_final: formatearPrecio(it.final_price, it.currency),
            precio_original: it.discounted ? formatearPrecio(it.original_price, it.currency) : null,
            descuento_porcentaje: it.discount_percent || 0,
            en_oferta: Boolean(it.discounted && it.discount_percent > 0),
            es_gratis: it.final_price === 0,
            resenas: "Muy destacadas",
            instalado_en_pc: idsInstalados.has(it.id),
            url_tienda: `https://store.steampowered.com/app/${it.id}`,
            uri_cliente_steam: `steam://store/${it.id}`,
            imagen_portada: it.header_image || `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${it.id}/header.jpg`,
          });
        }

        // 3. Filtrar según los criterios del usuario
        const filtrados = juegosEncontrados
          .filter((g) => {
            if (ocultar_instalados && g.instalado_en_pc) return false;
            if (!incluir_gratuitos && g.es_gratis) return false;
            if (solo_en_oferta && !g.en_oferta) return false;
            if (g.precio_num > precio_maximo) return false;
            return true;
          })
          .slice(0, limite);

        return json({
          pais: pais.toUpperCase(),
          precio_maximo_aplicado: precio_maximo,
          termino_busqueda: termino || "Cualquiera",
          solo_en_oferta,
          incluir_gratuitos,
          total_encontrados: filtrados.length,
          juegos: filtrados,
        });
      } catch (e) {
        return error(`Error al filtrar juegos por precio: ${(e as Error).message}`);
      }
    },
  );

  // =========================================================================
  // 5. Recomendación personalizada según la biblioteca instalada del usuario
  // =========================================================================
  server.registerTool(
    "recomendar_segun_biblioteca",
    {
      title: "Recomendar juegos según mi biblioteca de Steam",
      description:
        "Analiza los juegos instalados localmente en la biblioteca de Steam del usuario, extrae sus géneros y preferencias (ej: Shooters tácticos, Acción, RPG, Multijugador) y recomienda los mejores juegos de la tienda compatibles con esos gustos. Permite fijar un presupuesto máximo (ej: bajo $10.000 CLP) y recomienda títulos tanto en oferta como a precio normal que le podrían gustar.",
      inputSchema: {
        precio_maximo: z
          .number()
          .positive()
          .optional()
          .describe("Precio máximo en tu moneda local (ej: 10000 para juegos bajo $10.000 CLP, o 20 para USD). Opcional."),
        solo_en_oferta: z
          .boolean()
          .default(false)
          .describe("Si es true, recomienda únicamente juegos con descuento; si es false (por defecto), recomienda los mejores juegos aunque estén a precio normal bajo el presupuesto"),
        incluir_gratuitos: z
          .boolean()
          .default(true)
          .describe("Si es true, incluye recomendaciones Free to Play"),
        limite: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(8)
          .describe("Cantidad máxima de recomendaciones (1 a 20)"),
        pais: z
          .string()
          .regex(CODIGO_PAIS_REGEX)
          .default("CL")
          .describe("Codigo ISO de 2 letras del pais para precios (ej: CL, AR, MX, US, ES)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ precio_maximo, solo_en_oferta, incluir_gratuitos, limite, pais }) => {
      try {
        const instalados = await leerJuegosInstalados();
        if (instalados.length === 0) {
          return json({
            aviso: "No se detectaron juegos instalados en tu biblioteca local de Steam. Te sugerimos los más destacados de la tienda.",
            instalados_detectados: 0,
            recomendaciones: [],
          });
        }

        // Obtener géneros de los juegos instalados del usuario (máximo 5 para rapidez)
        const juegosConGeneros = await Promise.all(
          instalados.slice(0, 6).map(async (j) => {
            const genres = await obtenerGenerosDeApp(j.appid, pais);
            return { ...j, generos: genres };
          }),
        );

        const pesoGeneros: Record<string, number> = {};
        for (const j of juegosConGeneros) {
          for (const g of j.generos || []) {
            pesoGeneros[g] = (pesoGeneros[g] || 0) + 1;
          }
        }

        const generosFavoritos = Object.entries(pesoGeneros)
          .sort((a, b) => b[1] - a[1])
          .map(([gen]) => gen);

        // Recolectar candidatos de destacados, top sellers y búsqueda
        const [catData, featData] = await Promise.all([
          consultarCategoriasDestacadas(pais),
          consultarDestacadosGenerales(pais),
        ]);

        const idsInstalados = new Set(instalados.map((j) => j.appid));
        const poolCandidatos: any[] = [];
        const vistos = new Set<number>();

        const rawList = [
          ...((catData as any).top_sellers?.items || []),
          ...((catData as any).specials?.items || []),
          ...(((featData as any).featured_win as SteamRawCategoryItem[]) || []),
        ] as SteamRawCategoryItem[];

        for (const it of rawList) {
          if (!it || !it.id || vistos.has(it.id) || idsInstalados.has(it.id)) continue;
          vistos.add(it.id);

          const priceNum = (it.final_price ?? 0) / 100;
          if (precio_maximo !== undefined && priceNum > precio_maximo) continue;
          if (solo_en_oferta && (!it.discounted || it.discount_percent <= 0)) continue;
          if (!incluir_gratuitos && it.final_price === 0) continue;

          poolCandidatos.push({
            appid: it.id,
            nombre: it.name,
            precio_num: priceNum,
            precio_final: formatearPrecio(it.final_price, it.currency),
            precio_original: it.discounted ? formatearPrecio(it.original_price, it.currency) : null,
            en_oferta: Boolean(it.discounted && it.discount_percent > 0),
            descuento_porcentaje: it.discount_percent || 0,
            es_gratis: it.final_price === 0,
            imagen_portada: it.header_image || `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${it.id}/header.jpg`,
            url_tienda: `https://store.steampowered.com/app/${it.id}`,
            uri_cliente_steam: `steam://store/${it.id}`,
          });
        }

        // Si el pool es pequeño o se pidió término, añadir más candidatos del catálogo
        if (poolCandidatos.length < limite) {
          const topTerm = generosFavoritos[0] || "Action";
          try {
            const resSearch = await fetch(`https://store.steampowered.com/search/results/?query=${encodeURIComponent(topTerm)}&start=0&count=20&cc=${pais}&l=spanish`);
            if (resSearch.ok) {
              const txt = await resSearch.text();
              const rowRegex = /<a\s+href="https:\/\/store\.steampowered\.com\/app\/(\d+)\/[^"]*"[^>]*data-ds-appid="(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
              let m: RegExpExecArray | null;
              while ((m = rowRegex.exec(txt)) !== null) {
                const appid = Number(m[2]);
                if (!appid || vistos.has(appid) || idsInstalados.has(appid)) continue;
                vistos.add(appid);

                const inner = m[3];
                const title = inner.match(/<span class="title">([^<]+)<\/span>/)?.[1] || "";
                const priceFinalRaw = inner.match(/data-price-final="(\d+)"/)?.[1];
                const finalPriceText = inner.match(/<div class="discount_final_price[^"]*">([^<]+)<\/div>/)?.[1]?.trim() || "";
                const isFree = finalPriceText.toLowerCase().includes("gratuito") || priceFinalRaw === "0";
                const priceNum = isFree ? 0 : (priceFinalRaw ? Number(priceFinalRaw) / 100 : 0);

                if (precio_maximo !== undefined && priceNum > precio_maximo) continue;
                if (!incluir_gratuitos && isFree) continue;

                poolCandidatos.push({
                  appid,
                  nombre: title,
                  precio_num: priceNum,
                  precio_final: isFree ? "Gratuito" : finalPriceText || formatearPrecio(Number(priceFinalRaw || 0), "CLP"),
                  precio_original: null,
                  en_oferta: false,
                  descuento_porcentaje: 0,
                  es_gratis: isFree,
                  imagen_portada: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
                  url_tienda: `https://store.steampowered.com/app/${appid}`,
                  uri_cliente_steam: `steam://store/${appid}`,
                });
              }
            }
          } catch {}
        }

        // Evaluar afinidad de cada candidato con los géneros de los juegos del usuario
        const evaluados = await Promise.all(
          poolCandidatos.slice(0, 25).map(async (cand) => {
            const candGenres = await obtenerGenerosDeApp(cand.appid, pais);
            const comunes = candGenres.filter((g) => pesoGeneros[g]);
            let puntos = 0;
            for (const g of comunes) puntos += pesoGeneros[g] || 1;

            const coincidenciaPct = Math.min(
              100,
              Math.max(25, Math.round((puntos / Math.max(1, juegosConGeneros.length * 1.5)) * 100)),
            );

            const juegosSimilares = juegosConGeneros
              .filter((j) => (j.generos || []).some((g) => candGenres.includes(g)))
              .map((j) => j.nombre);

            return {
              ...cand,
              generos: candGenres,
              porcentaje_afinidad: coincidenciaPct,
              generos_en_comun: comunes,
              inspirado_en_tus_juegos: juegosSimilares.slice(0, 3),
              motivo:
                comunes.length > 0
                  ? `Te podria gustar porque juegas a ${juegosSimilares.slice(0, 2).join(" y ")} (${comunes.join(", ")})`
                  : "Juego muy popular y valorado en la comunidad de Steam",
            };
          }),
        );

        evaluados.sort((a, b) => b.porcentaje_afinidad - a.porcentaje_afinidad);
        const seleccionados = evaluados.slice(0, limite);

        return json({
          pais: pais.toUpperCase(),
          biblioteca_analizada: instalados.map((j) => j.nombre),
          generos_preferidos_detectados: generosFavoritos.slice(0, 5),
          filtro_precio_maximo: precio_maximo ?? "Sin limite",
          total_recomendaciones: seleccionados.length,
          recomendaciones: seleccionados,
        });
      } catch (e) {
        return error(`Error al generar recomendaciones según la biblioteca: ${(e as Error).message}`);
      }
    },
  );

  // =========================================================================
  // 6. Consultar Ficha Detallada de un Juego Específico (por AppID o Nombre)
  // =========================================================================
  server.registerTool(
    "detalle_juego_steam",
    {
      title: "Detalle completo de un juego en Steam",
      description:
        "Obtiene la ficha completa de un juego en Steam especificando su AppID numerico o directamente su nombre (ej: 'Cyberpunk 2077', 'Elden Ring', 'Hades'). Devuelve descripcion, precio actual, descuento, generos, desarrolladores, puntuacion Metacritic y si ya lo tienes instalado en tu PC.",
      inputSchema: {
        appid: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("AppID numerico del juego en Steam (opcional si se provee 'nombre')"),
        nombre: z
          .string()
          .optional()
          .describe("Nombre o termino de busqueda del juego (ej: 'Cyberpunk 2077', 'Baldur\\'s Gate 3', 'Rust')"),
        pais: z
          .string()
          .regex(CODIGO_PAIS_REGEX)
          .default("CL")
          .describe("Codigo ISO de 2 letras del pais para precios (ej: CL, AR, MX, US, ES)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ appid, nombre, pais }) => {
      try {
        let appidFinal = appid;

        // Si no se proporcionó appid pero sí nombre, buscamos el juego para resolver el appid
        if (!appidFinal && nombre && nombre.trim().length >= 2) {
          const searchUrl = new URL("https://store.steampowered.com/api/storesearch/");
          searchUrl.searchParams.set("term", nombre.trim());
          searchUrl.searchParams.set("l", "spanish");
          searchUrl.searchParams.set("cc", pais.toUpperCase());

          const resSearch = await fetch(searchUrl.toString());
          if (resSearch.ok) {
            const dataSearch = (await resSearch.json()) as { items?: Array<{ id: number; name: string }> };
            if (dataSearch.items && dataSearch.items.length > 0) {
              appidFinal = dataSearch.items[0].id;
            }
          }
        }

        if (!appidFinal) {
          return error("Debes proporcionar al menos un 'appid' numerico o un 'nombre' de juego valido.");
        }

        const url = new URL("https://store.steampowered.com/api/appdetails");
        url.searchParams.set("appids", String(appidFinal));
        url.searchParams.set("cc", pais.toUpperCase());
        url.searchParams.set("l", "spanish");

        const [res, instalados, historialCS] = await Promise.all([
          fetch(url.toString(), { headers: { Accept: "application/json" } }),
          leerJuegosInstalados(),
          consultarHistorialPreciosCheapShark(appidFinal),
        ]);

        if (!res.ok) {
          return error(`Error HTTP ${res.status} al consultar detalles de AppID ${appidFinal}.`);
        }

        const payload = (await res.json()) as Record<string, any>;
        const entry = payload[String(appidFinal)];
        if (!entry?.success || !entry.data) {
          return error(`No se encontro informacion para el AppID ${appidFinal} en Steam.`);
        }

        const d = entry.data;
        const juegoLocal = instalados.find((j) => j.appid === appidFinal) ?? null;
        const po = d.price_overview;
        const isFree = Boolean(d.is_free);
        const dto = po ? po.discount_percent : 0;

        return json({
          appid: d.steam_appid,
          nombre: d.name,
          descripcion: d.short_description ?? "",
          es_gratis: isFree,
          fecha_lanzamiento: d.release_date?.date ?? "Desconocida",
          proximamente: Boolean(d.release_date?.coming_soon),
          desarrolladores: d.developers ?? [],
          editores: d.publishers ?? [],
          generos: (d.genres ?? []).map((g: any) => g.description),
          metacritic: d.metacritic?.score ?? null,
          recomendaciones_usuarios: d.recommendations?.total ?? null,
          oferta: po
            ? {
                en_descuento: po.discount_percent > 0,
                descuento_porcentaje: po.discount_percent,
                precio_final:
                  po.final_formatted ||
                  formatearPrecio(po.final, po.currency),
                precio_original:
                  po.initial_formatted ||
                  formatearPrecio(po.initial, po.currency),
                moneda: po.currency,
              }
            : null,
          historial_precios: {
            precio_actual: isFree ? "Gratis" : (po?.final_formatted || formatearPrecio(po?.final, po?.currency)),
            precio_base_normal: isFree ? "Gratis" : (po?.initial_formatted || formatearPrecio(po?.initial, po?.currency)),
            descuento_actual: `${dto}%`,
            minimo_historico_registrado: historialCS?.minimo_historico_registrado ?? "No disponible",
            fecha_minimo_historico: historialCS?.fecha_minimo_historico ?? "N/D",
            mejor_oferta_otras_tiendas_usd: historialCS?.mejor_oferta_actual_usd ?? null,
            consejo_compra: isFree
              ? "Juego Free to Play."
              : (dto >= 50
                  ? "🔥 ¡Gran descuento activo! Muy buen momento para comprar."
                  : (dto > 0
                      ? "✅ Está con descuento moderado."
                      : "⏳ Está a precio regular sin oferta. Si puedes esperar, las rebajas de temporada suelen ofrecer importantes descuentos.")),
          },
          instalado_localmente: juegoLocal !== null,
          detalles_instalacion: juegoLocal,
          imagen_portada: d.header_image ?? null,
          url_tienda: `https://store.steampowered.com/app/${appidFinal}`,
          uri_cliente_steam: `steam://store/${appidFinal}`,
        });
      } catch (e) {
        return error(`Fallo al consultar el detalle del juego: ${(e as Error).message}`);
      }
    },
  );

  // =========================================================================
  // 6b. Historial de Precios y Mínimo Histórico
  // =========================================================================
  server.registerTool(
    "historial_precio_juego",
    {
      title: "Historial de precios y mínimo histórico de un juego",
      description:
        "Consulta el precio actual, precio normal y el mínimo histórico registrado de un juego en Steam (con la fecha en que se registró), evaluando si es el momento ideal para comprar o si conviene esperar a una próxima oferta.",
      inputSchema: {
        nombre: z
          .string()
          .optional()
          .describe("Nombre o termino de busqueda del juego (ej: 'Cyberpunk 2077', 'Elden Ring', 'Rust')"),
        appid: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("AppID numerico del juego en Steam (opcional si se indica 'nombre')"),
        pais: z
          .string()
          .regex(CODIGO_PAIS_REGEX)
          .default("CL")
          .describe("Codigo ISO de 2 letras del pais para precios (ej: CL, AR, MX, US, ES)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ nombre, appid, pais }) => {
      try {
        let appidFinal = appid;
        let nombreResuelto = nombre;

        if (!appidFinal && nombre && nombre.trim().length >= 2) {
          const searchUrl = new URL("https://store.steampowered.com/api/storesearch/");
          searchUrl.searchParams.set("term", nombre.trim());
          searchUrl.searchParams.set("l", "spanish");
          searchUrl.searchParams.set("cc", pais.toUpperCase());

          const resSearch = await fetch(searchUrl.toString());
          if (resSearch.ok) {
            const dataSearch = (await resSearch.json()) as { items?: Array<{ id: number; name: string }> };
            if (dataSearch.items && dataSearch.items.length > 0) {
              appidFinal = dataSearch.items[0].id;
              nombreResuelto = dataSearch.items[0].name;
            }
          }
        }

        if (!appidFinal) {
          return error("Debes indicar un 'nombre' o un 'appid' de juego valido.");
        }

        const [resDetails, historialCS] = await Promise.all([
          fetch(`https://store.steampowered.com/api/appdetails?appids=${appidFinal}&cc=${pais}&l=spanish`),
          consultarHistorialPreciosCheapShark(appidFinal),
        ]);

        const dataSteam = (await resDetails.json()) as Record<string, any>;
        const entry = dataSteam[String(appidFinal)]?.data;

        if (!entry) {
          return error(`No se encontro informacion para el juego con AppID ${appidFinal}.`);
        }

        const po = entry.price_overview;
        const isFree = Boolean(entry.is_free);
        const precioActual = isFree ? "Gratis" : (po?.final_formatted || formatearPrecio(po?.final, po?.currency));
        const precioBase = isFree ? "Gratis" : (po?.initial_formatted || formatearPrecio(po?.initial, po?.currency));
        const descuentoPct = po ? po.discount_percent : 0;

        let consejo = "Juego gratuito sin costo base.";
        if (!isFree) {
          if (descuentoPct >= 50) {
            consejo = "🔥 ¡Excelente momento para comprar! Gran descuento activo.";
          } else if (descuentoPct > 0) {
            consejo = "✅ Está en oferta moderada. Si lo deseas jugar pronto es una buena opción.";
          } else {
            consejo = "⏳ Actualmente está a precio normal sin oferta. Si puedes esperar, las rebajas de temporada suelen ofrecer importantes descuentos.";
          }
        }

        return json({
          appid: appidFinal,
          nombre: entry.name,
          es_gratis: isFree,
          precio_actual_steam: precioActual,
          precio_base_normal: precioBase,
          descuento_actual: `${descuentoPct}%`,
          en_oferta_hoy: descuentoPct > 0,
          minimo_historico_registrado: historialCS?.minimo_historico_registrado ?? "No disponible",
          fecha_minimo_historico: historialCS?.fecha_minimo_historico ?? "N/D",
          mejor_oferta_otras_tiendas_usd: historialCS?.mejor_oferta_actual_usd ?? null,
          consejo_de_compra: consejo,
          imagen_portada: entry.header_image,
          url_tienda: `https://store.steampowered.com/app/${appidFinal}`,
          uri_cliente_steam: `steam://store/${appidFinal}`,
        });
      } catch (e) {
        return error(`Error al consultar el historial de precios: ${(e as Error).message}`);
      }
    },
  );

  // =========================================================================
  // 6c. Categorizar Usuario y Perfil Gamer
  // =========================================================================
  server.registerTool(
    "categorizar_usuario_steam",
    {
      title: "Categorizar perfil gamer del usuario según su biblioteca",
      description:
        "Analiza a fondo la biblioteca local de Steam del usuario (juegos instalados, géneros predominantes, volumen en GB y actividad) y genera un perfil gamer completo con su Arquetipo de Jugador, Insignia de Rango, géneros dominantes y recomendaciones personalizadas.",
      inputSchema: {
        pais: z
          .string()
          .regex(CODIGO_PAIS_REGEX)
          .default("CL")
          .describe("Codigo ISO de 2 letras del pais para precios (ej: CL, AR, MX, US, ES)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ pais }) => {
      try {
        const instalados = await leerJuegosInstalados();
        if (instalados.length === 0) {
          return json({
            mensaje: "No se detectaron juegos instalados en tu biblioteca local de Steam.",
            arquetipo_gamer: "Gamer Casual / Explorador Nuevo",
            insignia_rango: "🌱 Recluta de Steam",
            total_juegos: 0,
            espacio_total_gb: 0,
            generos_dominantes: [],
          });
        }

        const juegosConGeneros = await Promise.all(
          instalados.map(async (j) => {
            const genres = await obtenerGenerosDeApp(j.appid, pais);
            return { ...j, generos: genres };
          }),
        );

        const conteoGeneros: Record<string, number> = {};
        let totalGb = 0;
        for (const j of juegosConGeneros) {
          totalGb += j.tamano_gb || 0;
          for (const g of j.generos || []) {
            conteoGeneros[g] = (conteoGeneros[g] || 0) + 1;
          }
        }

        const rankingGeneros = Object.entries(conteoGeneros)
          .sort((a, b) => b[1] - a[1])
          .map(([gen, count]) => ({
            genero: gen,
            frecuencia: count,
            porcentaje: `${Math.round((count / Math.max(1, instalados.length)) * 100)}%`,
          }));

        // Clasificación de arquetipo
        let arquetipo = "Gamer Polivalente / Versátil";
        let insignia = "🎮 Jugador Multidisciplinario";
        let descripcion = "Disfrutas de una amplia variedad de experiencias de juego y te adaptas a cualquier estilo.";

        const tieneAccion = (conteoGeneros["Acción"] || 0) >= 1;
        const tieneShooter = (conteoGeneros["Free to Play"] || 0) >= 1 || (conteoGeneros["Multijugador masivo"] || 0) >= 1;
        const tieneRol = (conteoGeneros["Rol"] || 0) >= 1;
        const tieneAventura = (conteoGeneros["Aventura"] || 0) >= 1;
        const tieneEstrategia = (conteoGeneros["Estrategia"] || 0) >= 1 || (conteoGeneros["Simulación"] || 0) >= 1;

        if (tieneAccion && tieneShooter) {
          arquetipo = "Táctico Competitivo / Operador Especial";
          insignia = "🎖️ Maestro de Shooters & Tácticas";
          descripcion = "Te apasionan los combates de alta intensidad, el juego cooperativo/competitivo, la puntería y la adrenalina del multijugador.";
        } else if (tieneRol || tieneAventura) {
          arquetipo = "Explorador de Rol & Lore Master";
          insignia = "🗡️ Conquistador de Historias y Mundos";
          descripcion = "Buscas mundos ricos, exploración profunda, personalización de personajes y narrativas inmersivas.";
        } else if (tieneEstrategia) {
          arquetipo = "Estratega & Gestor Maestro";
          insignia = "♟️ Mente Estratégica";
          descripcion = "Prefieres el análisis táctico, la planificación a largo plazo y la gestión óptima de recursos.";
        }

        let rangoNivel = "Soldado Raso";
        if (totalGb >= 100 || instalados.length >= 6) {
          rangoNivel = "Comandante Veterano";
        } else if (totalGb >= 40 || instalados.length >= 3) {
          rangoNivel = "Operador Especial";
        }

        return json({
          arquetipo_gamer: arquetipo,
          insignia: insignia,
          rango_nivel: rangoNivel,
          descripcion_perfil: descripcion,
          estadisticas: {
            total_juegos_instalados: instalados.length,
            almacenamiento_total_ocupado_gb: Number(totalGb.toFixed(1)),
            juego_mas_pesado: [...instalados].sort((a, b) => b.tamano_gb - a.tamano_gb)[0]?.nombre ?? "N/D",
          },
          generos_dominantes: rankingGeneros.slice(0, 5),
          juegos_analizados: instalados.map((j) => ({ nombre: j.nombre, tamano_gb: j.tamano_gb })),
        });
      } catch (e) {
        return error(`Error al categorizar el perfil gamer: ${(e as Error).message}`);
      }
    },
  );

  // =========================================================================
  // 7. Buscar juego por nombre en la tienda de Steam
  // =========================================================================
  server.registerTool(
    "buscar_juego_steam",
    {
      title: "Buscar juego en la tienda de Steam",
      description:
        "Busca juegos por nombre o palabra clave en el catalogo de Steam y devuelve su appid, precio actual, si tiene descuento y si ya esta instalado en tu PC.",
      inputSchema: {
        consulta: z
          .string()
          .min(2)
          .max(100)
          .describe("Nombre o palabra clave del juego a buscar (ej: 'Baldur', 'Cyberpunk', 'Hades')"),
        pais: z
          .string()
          .regex(CODIGO_PAIS_REGEX)
          .default("CL")
          .describe("Codigo ISO de 2 letras del pais para precios (ej: CL, AR, MX, US, ES)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ consulta, pais }) => {
      try {
        const termino = consulta.trim();
        if (termino.length < 2) {
          return error("La consulta debe tener al menos 2 caracteres.");
        }

        const url = new URL("https://store.steampowered.com/api/storesearch/");
        url.searchParams.set("term", termino);
        url.searchParams.set("l", "spanish");
        url.searchParams.set("cc", pais.toUpperCase());

        const [res, instalados] = await Promise.all([
          fetch(url.toString(), { headers: { Accept: "application/json" } }),
          leerJuegosInstalados(),
        ]);

        if (!res.ok) {
          return error(`La busqueda en Steam respondio con estado HTTP ${res.status}`);
        }

        const idsInstalados = new Set(instalados.map((j) => j.appid));
        const data = (await res.json()) as {
          total?: number;
          items?: Array<{
            id: number;
            name: string;
            price?: { currency: string; initial: number; final: number };
            metascore?: string | number;
          }>;
        };

        const resultados = (data.items ?? []).map((item) => {
          const initial = item.price?.initial ?? 0;
          const final = item.price?.final ?? 0;
          const currency = item.price?.currency ?? "CLP";
          const descuento =
            initial > final && initial > 0 ? Math.round(((initial - final) / initial) * 100) : 0;

          return {
            appid: item.id,
            nombre: item.name,
            descuento_porcentaje: descuento,
            precio_final: item.price ? formatearPrecio(final, currency) : "Gratis / Por anunciar",
            precio_original: descuento > 0 ? formatearPrecio(initial, currency) : undefined,
            metascore: item.metascore || null,
            instalado_en_pc: idsInstalados.has(item.id),
            url_tienda: `https://store.steampowered.com/app/${item.id}`,
            uri_cliente_steam: `steam://store/${item.id}`,
            imagen_portada: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${item.id}/header.jpg`,
          };
        });

        return json({
          consulta: termino,
          total: resultados.length,
          resultados,
        });
      } catch (e) {
        return error(`Error al buscar el juego en Steam: ${(e as Error).message}`);
      }
    },
  );

  // =========================================================================
  // 8. Buscar ofertas con descuento en Steam
  // =========================================================================
  server.registerTool(
    "buscar_ofertas_steam",
    {
      title: "Buscar buenas ofertas en Steam",
      description:
        "Encuentra las mejores ofertas especiales y rebajas actuales dentro de la tienda de Steam filtradas por porcentaje mínimo de descuento o precio máximo. Cruza con la biblioteca para indicar o excluir juegos instalados.",
      inputSchema: {
        descuento_minimo: z
          .number()
          .int()
          .min(1)
          .max(99)
          .default(30)
          .describe("Porcentaje minimo de descuento (1 a 99, por defecto 30)"),
        precio_maximo: z
          .number()
          .positive()
          .optional()
          .describe("Precio final maximo en la moneda del pais elegido (opcional)"),
        pais: z
          .string()
          .regex(CODIGO_PAIS_REGEX)
          .default("CL")
          .describe("Codigo ISO de 2 letras del pais para precios (ej: CL, AR, MX, US, ES)"),
        ocultar_instalados: z
          .boolean()
          .default(true)
          .describe("Si es true, oculta los juegos que ya estan instalados localmente en Steam"),
        limite: z
          .number()
          .int()
          .min(1)
          .max(40)
          .default(15)
          .describe("Cantidad maxima de ofertas a devolver (1 a 40)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ descuento_minimo, precio_maximo, pais, ocultar_instalados, limite }) => {
      try {
        const [datos, instalados] = await Promise.all([
          consultarCategoriasDestacadas(pais),
          leerJuegosInstalados(),
        ]);

        const idsInstalados = new Set(instalados.map((j) => j.appid));
        const seccionSpecials = datos.specials as { items?: SteamRawCategoryItem[] } | undefined;
        const seccionTopSellers = datos.top_sellers as { items?: SteamRawCategoryItem[] } | undefined;

        const combinados = [
          ...(seccionSpecials?.items ?? []),
          ...(seccionTopSellers?.items ?? []),
        ];

        const vistos = new Set<number>();
        const unicos: SteamRawCategoryItem[] = [];
        for (const item of combinados) {
          if (item && typeof item.id === "number" && !vistos.has(item.id)) {
            vistos.add(item.id);
            unicos.push(item);
          }
        }

        const filtrados = unicos
          .filter((item) => {
            if (!item.discounted || item.discount_percent < descuento_minimo) return false;
            if (ocultar_instalados && idsInstalados.has(item.id)) return false;
            const precioReal = (item.final_price ?? 0) / 100;
            if (precio_maximo !== undefined && precioReal > precio_maximo) return false;
            return true;
          })
          .sort((a, b) => b.discount_percent - a.discount_percent)
          .slice(0, limite)
          .map((item) => ({
            appid: item.id,
            nombre: item.name,
            descuento_porcentaje: item.discount_percent,
            precio_final: formatearPrecio(item.final_price, item.currency),
            precio_original: formatearPrecio(item.original_price, item.currency),
            valor_numerico: (item.final_price ?? 0) / 100,
            moneda: item.currency || "CLP",
            instalado_en_pc: idsInstalados.has(item.id),
            imagen_portada: item.header_image || `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${item.id}/header.jpg`,
            url_tienda: `https://store.steampowered.com/app/${item.id}`,
            uri_cliente_steam: `steam://store/${item.id}`,
          }));

        return json({
          pais: pais.toUpperCase(),
          descuento_minimo_aplicado: `${descuento_minimo}%`,
          total_encontrados: filtrados.length,
          ofertas: filtrados,
        });
      } catch (e) {
        return error(`No se pudieron obtener las ofertas de Steam: ${(e as Error).message}`);
      }
    },
  );

  // =========================================================================
  // 9. Nuevos lanzamientos relevantes en Steam
  // =========================================================================
  server.registerTool(
    "nuevos_lanzamientos_steam",
    {
      title: "Nuevos lanzamientos relevantes en Steam",
      description:
        "Obtiene la lista de nuevos lanzamientos relevantes y destacados en Steam junto con su precio, descuento de lanzamiento y enlace directo.",
      inputSchema: {
        solo_con_descuento: z
          .boolean()
          .default(false)
          .describe("Si es true, filtra unicamente los nuevos lanzamientos que tienen descuento de estreno"),
        pais: z
          .string()
          .regex(CODIGO_PAIS_REGEX)
          .default("CL")
          .describe("Codigo ISO de 2 letras del pais para precios (ej: CL, AR, MX, US, ES)"),
        limite: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(15)
          .describe("Cantidad maxima de lanzamientos a devolver (1 a 30)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ solo_con_descuento, pais, limite }) => {
      try {
        const [datos, instalados] = await Promise.all([
          consultarCategoriasDestacadas(pais),
          leerJuegosInstalados(),
        ]);

        const idsInstalados = new Set(instalados.map((j) => j.appid));
        const seccionNuevos = datos.new_releases as { items?: SteamRawCategoryItem[] } | undefined;
        const items = seccionNuevos?.items ?? [];

        const vistos = new Set<number>();
        const lanzamientos = items
          .filter((item) => {
            if (!item || typeof item.id !== "number" || vistos.has(item.id)) return false;
            vistos.add(item.id);
            if (solo_con_descuento && (!item.discounted || item.discount_percent <= 0)) {
              return false;
            }
            return true;
          })
          .slice(0, limite)
          .map((item) => ({
            appid: item.id,
            nombre: item.name,
            en_oferta_lanzamiento: Boolean(item.discounted && item.discount_percent > 0),
            descuento_porcentaje: item.discount_percent ?? 0,
            precio_final: formatearPrecio(item.final_price, item.currency),
            precio_original: item.discounted ? formatearPrecio(item.original_price, item.currency) : undefined,
            moneda: item.currency || "CLP",
            plataformas: [
              item.windows_available ? "Windows" : null,
              item.mac_available ? "macOS" : null,
              item.linux_available ? "Linux" : null,
            ].filter(Boolean),
            instalado_en_pc: idsInstalados.has(item.id),
            imagen_portada: item.header_image || `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${item.id}/header.jpg`,
            url_tienda: `https://store.steampowered.com/app/${item.id}`,
            uri_cliente_steam: `steam://store/${item.id}`,
          }));

        return json({
          pais: pais.toUpperCase(),
          solo_con_descuento,
          total_lanzamientos: lanzamientos.length,
          nuevos_lanzamientos: lanzamientos,
        });
      } catch (e) {
        return error(`No se pudieron obtener los nuevos lanzamientos de Steam: ${(e as Error).message}`);
      }
    },
  );

  // =========================================================================
  // 10. Listar juegos instalados localmente en Steam
  // =========================================================================
  server.registerTool(
    "listar_juegos_instalados",
    {
      title: "Listar juegos instalados en Steam local",
      description:
        "Detecta automáticamente la carpeta de Steam y todas las bibliotecas configuradas (libraryfolders.vdf) en el PC del usuario, mostrando los juegos instalados, appid, tamaño en GB y última vez jugados.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const rutaBase = await detectarRutaSteam();
        const bibliotecas = await obtenerCarpetasBiblioteca(rutaBase);
        const juegos = await leerJuegosInstalados();

        return json({
          ruta_steam_detectada: rutaBase,
          bibliotecas_encontradas: bibliotecas,
          total_instalados: juegos.length,
          juegos,
        });
      } catch (e) {
        return error(`No se pudieron leer los juegos instalados en Steam: ${(e as Error).message}`);
      }
    },
  );

  // =========================================================================
  // 11. Notificar oferta o lanzamiento al teléfono mediante Discord Webhook
  // =========================================================================
  server.registerTool(
    "notificar_oferta_steam",
    {
      title: "Notificar oferta o lanzamiento de Steam al telefono (Discord)",
      description:
        "Envía una notificación al teléfono del usuario a través de un Webhook de Discord (DISCORD_WEBHOOK_URL) con ofertas, juegos destacados o nuevos lanzamientos. También muestra un aviso emergente en Windows y opcionalmente abre el juego en el cliente local de Steam.",
      inputSchema: {
        titulo: z
          .string()
          .min(1)
          .max(120)
          .describe("Titulo de la alerta (ej: 'Nuevas ofertas y lanzamientos en Steam')"),
        mensaje: z
          .string()
          .min(1)
          .max(1800)
          .describe("Cuerpo del mensaje con los juegos, precios, descuentos y enlaces"),
        appid: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("AppID opcional de un juego principal para adjuntar su portada y enlace directo a la tienda"),
        abrir_en_steam_pc: z
          .boolean()
          .default(false)
          .describe("Si es true, abre ademas la tienda de Steam en el cliente local del PC"),
        confirmar: z
          .literal(true)
          .describe("Confirmacion obligatoria (true) para autorizar el envio de la notificacion al telefono"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ titulo, mensaje, appid, abrir_en_steam_pc, confirmar }) => {
      try {
        if (confirmar !== true) {
          return error("Debes pasar confirmar: true para autorizar el envio.");
        }

        const resultadosAcciones: string[] = [];
        const urlTienda = appid ? `https://store.steampowered.com/app/${appid}` : "https://store.steampowered.com/specials";
        const imagenPortada = appid
          ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`
          : undefined;

        const webhookUrl = await obtenerVariableEntorno("DISCORD_WEBHOOK_URL");
        let enviadoADiscord = false;

        if (webhookUrl) {
          if (!DISCORD_WEBHOOK_REGEX.test(webhookUrl)) {
            return error(
              "La variable DISCORD_WEBHOOK_URL no tiene un formato valido (debe comenzar con https://discord.com/api/webhooks/...).",
            );
          }

          const embed: Record<string, unknown> = {
            title: titulo,
            description: mensaje,
            url: urlTienda,
            color: 0x1b2838,
            timestamp: new Date().toISOString(),
            footer: {
              text: "MCP oferta-steam • Asistente Gamer",
            },
          };

          if (imagenPortada) {
            embed.image = { url: imagenPortada };
          }

          const resDiscord = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: "Oferta Steam",
              embeds: [embed],
            }),
          });

          if (!resDiscord.ok) {
            const detalle = await resDiscord.text().catch(() => "");
            return error(`Discord respondio con HTTP ${resDiscord.status}: ${detalle.slice(0, 200)}`);
          }
          enviadoADiscord = true;
          resultadosAcciones.push("Notificacion enviada con exito al telefono por Discord Webhook.");
        } else {
          resultadosAcciones.push(
            "AVISO: DISCORD_WEBHOOK_URL no configurado en .env. Se procesa localmente.",
          );
        }

        if (process.platform === "win32") {
          await run(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", SCRIPT_TOAST_WINDOWS],
            {
              env: {
                MCP_TITULO: titulo.slice(0, 60),
                MCP_MENSAJE: mensaje.slice(0, 200),
              },
              timeoutMs: 8000,
            },
          );
          resultadosAcciones.push("Notificacion emergente mostrada en el escritorio de Windows.");
        }

        if (abrir_en_steam_pc) {
          const steamDir = await detectarRutaSteam();
          const steamExe = path.join(steamDir, "steam.exe");
          const destinoUri = appid ? `steam://store/${appid}` : "steam://store";
          const rSteam = await run(steamExe, [destinoUri], { timeoutMs: 8000 });
          if (rSteam.code === 0) {
            resultadosAcciones.push(`Abierto en cliente de Steam local (${destinoUri}).`);
          } else {
            resultadosAcciones.push(`No se pudo lanzar ${steamExe}.`);
          }
        }

        return texto(
          [
            enviadoADiscord
              ? `✅ Notificacion "${titulo}" enviada con exito a tu telefono por Discord.`
              : `⚠️ Notificacion procesada localmente. Configura DISCORD_WEBHOOK_URL para enviarla al telefono.`,
            ...resultadosAcciones.map((linea) => `- ${linea}`),
          ].join("\n"),
        );
      } catch (e) {
        return error(`Fallo al enviar la notificacion: ${(e as Error).message}`);
      }
    },
  );
}
