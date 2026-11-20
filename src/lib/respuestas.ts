/**
 * Helpers para construir respuestas MCP con el formato correcto.
 */

export function texto(mensaje: string) {
  return { content: [{ type: "text" as const, text: mensaje }] };
}

export function json(datos: unknown) {
  return texto(JSON.stringify(datos, null, 2));
}

export function error(mensaje: string) {
  return { isError: true, content: [{ type: "text" as const, text: mensaje }] };
}
