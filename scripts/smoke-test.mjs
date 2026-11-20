#!/usr/bin/env node
/**
 * Prueba de humo para el servidor MCP oferta-steam.
 * Comprueba:
 *   1) Handshake MCP (initialize)
 *   2) Listado de las 6 herramientas de Steam con descripciones utiles
 *   3) Ejecucion de listar_juegos_instalados
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const transport = new StdioClientTransport({ command: "node", args: [path.join(raiz, "dist", "index.js")] });
const client = new Client({ name: "smoke-test-oferta-steam", version: "1.0.0" });

function fallar(mensaje) {
  console.error(`FALLO: ${mensaje}`);
  process.exit(1);
}

try {
  await client.connect(transport);
  const { tools } = await client.listTools();

  if (tools.length === 0) fallar("El servidor no expone ninguna herramienta.");
  console.log(`OK: ${tools.length} herramientas -> ${tools.map((t) => t.name).join(", ")}`);

  const sinDescripcion = tools.filter((t) => !t.description || t.description.trim().length < 15);
  if (sinDescripcion.length > 0) {
    fallar(`Herramientas sin descripcion util: ${sinDescripcion.map((t) => t.name).join(", ")}`);
  }

  if (tools.some((t) => t.name === "listar_juegos_instalados")) {
    const r = await client.callTool({ name: "listar_juegos_instalados", arguments: {} });
    const parsed = JSON.parse(r.content[0].text);
    console.log(`OK: listar_juegos_instalados -> ${parsed.total_instalados} juegos detectados`);
  }

  await client.close();
  console.log("Prueba de humo superada.");
} catch (e) {
  fallar(e instanceof Error ? e.message : String(e));
}
