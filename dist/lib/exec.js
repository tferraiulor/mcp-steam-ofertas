/**
 * Ejecutar programas del sistema de forma SEGURA.
 *
 * Usamos execFile (argumentos como lista) y NUNCA exec/shell con texto concatenado:
 * asi, aunque el modelo envie texto raro, no se puede inyectar comandos.
 */
import { execFile } from "node:child_process";
export function run(command, args = [], options = {}) {
    return new Promise((resolve) => {
        execFile(command, args, {
            timeout: options.timeoutMs ?? 15_000,
            cwd: options.cwd,
            env: options.env ? { ...process.env, ...options.env } : process.env,
            maxBuffer: 5 * 1024 * 1024,
            windowsHide: true,
        }, (error, stdout, stderr) => {
            const code = error && typeof error.code === "number"
                ? error.code
                : error
                    ? 1
                    : 0;
            resolve({ stdout: String(stdout), stderr: String(stderr || error?.message || ""), code });
        });
    });
}
//# sourceMappingURL=exec.js.map