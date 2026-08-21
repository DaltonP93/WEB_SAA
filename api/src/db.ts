import "dotenv/config";
import knex from "knex";
import config from "../knexfile.js";
import { errorSeguro } from "./log-seguro.js";

export const db = knex(config[process.env.NODE_ENV === "production" ? "production" : "development"]);

export interface DatabaseStatus {
  ok: boolean;
  latencyMs?: number;
  /** Motivo genérico del fallo. Nunca incluye credenciales ni la query. */
  error?: string;
}

const HEALTH_TIMEOUT_MS = Number(process.env.DB_HEALTH_TIMEOUT_MS ?? 3000);

/**
 * Ping a la base para el health check. Con timeout propio: si MySQL está caído
 * el driver puede quedarse esperando y el endpoint tiene que responder igual.
 */
export async function checkDatabase(): Promise<DatabaseStatus> {
  const started = Date.now();
  try {
    await Promise.race([
      db.raw("select 1"),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("timeout")), HEALTH_TIMEOUT_MS),
      ),
    ]);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    const message = (err as Error)?.message ?? "";
    const reason = /timeout/i.test(message) ? "timeout" : "unreachable";
    // Sin el mensaje crudo: `ER_ACCESS_DENIED_ERROR` lo trae con el usuario y
    // el host de la conexión adentro.
    console.error(`[health] base de datos no disponible: ${errorSeguro(err)}`);
    return { ok: false, latencyMs: Date.now() - started, error: reason };
  }
}
