/**
 * Helpers para construir respuestas MCP con el formato correcto.
 */
export function texto(mensaje) {
    return { content: [{ type: "text", text: mensaje }] };
}
export function json(datos) {
    return texto(JSON.stringify(datos, null, 2));
}
export function error(mensaje) {
    return { isError: true, content: [{ type: "text", text: mensaje }] };
}
//# sourceMappingURL=respuestas.js.map