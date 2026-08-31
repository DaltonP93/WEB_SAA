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
  /**
   * Migraciones en el repo que la base todavía no aplicó. `0` es "esquema al
   * día"; `undefined` es "no se pudo averiguar" (no es lo mismo que cero).
   */
  migrationsPending?: number;
}

const HEALTH_TIMEOUT_MS = Number(process.env.DB_HEALTH_TIMEOUT_MS ?? 3000);

/**
 * Corre `promesa` con el techo de tiempo del health check.
 *
 * El endpoint tiene que responder aunque MySQL esté caído: sin esto el driver
 * puede quedarse esperando indefinidamente. El `clearTimeout` es para no dejar
 * el temporizador vivo cuando la consulta gana la carrera.
 */
function conLimite<T>(promesa: PromiseLike<T>): Promise<T> {
  let temporizador: NodeJS.Timeout;
  return Promise.race([
    promesa,
    new Promise<never>((_resolve, reject) => {
      temporizador = setTimeout(() => reject(new Error("timeout")), HEALTH_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(temporizador)) as Promise<T>;
}

/**
 * Cuenta las migraciones pendientes.
 *
 * Un `select 1` confirma que la base responde, no que su esquema sea el que el
 * código espera. Con el esquema atrasado la API arranca y el health da 200
 * mientras las rutas que tocan las columnas nuevas devuelven 500 sueltos —el
 * síntoma es opaco y cuesta rastrearlo hasta la migración que falta—. Contarlas
 * acá convierte eso en una señal explícita.
 *
 * Devuelve `undefined` si no se puede averiguar: el ping es la señal primaria y
 * un fallo al listar migraciones no debe tumbar el health por sí solo.
 */
async function contarMigracionesPendientes(): Promise<number | undefined> {
  try {
    // `list()` devuelve [completadas, pendientes]. Sólo lee el directorio: no
    // importa los módulos, así que sirve igual con las migraciones en .ts.
    //
    // El directorio del knexfile es relativo (`./migrations`), o sea relativo
    // al cwd. Eso es correcto en los dos runtimes reales —`tsx watch` corre
    // desde `api/`, y el deploy arranca PM2 con `--cwd .../api`—, pero se rompe
    // si algo levanta la app desde otra parte. `MIGRATIONS_DIR` es la salida
    // para esos casos; sin ella manda el knexfile.
    const dir = process.env.MIGRATIONS_DIR;
    const listado = await conLimite(db.migrate.list(dir ? { directory: dir } : undefined));
    const pendientes = Array.isArray(listado) ? listado[1] : undefined;
    return Array.isArray(pendientes) ? pendientes.length : undefined;
  } catch (err) {
    console.error(`[health] no se pudieron listar las migraciones: ${errorSeguro(err)}`);
    return undefined;
  }
}

/**
 * Ping a la base para el health check, más el estado del esquema.
 */
export async function checkDatabase(): Promise<DatabaseStatus> {
  const started = Date.now();
  try {
    await conLimite(db.raw("select 1"));
    const latencyMs = Date.now() - started;
    return { ok: true, latencyMs, migrationsPending: await contarMigracionesPendientes() };
  } catch (err) {
    const message = (err as Error)?.message ?? "";
    const reason = /timeout/i.test(message) ? "timeout" : "unreachable";
    // Sin el mensaje crudo: `ER_ACCESS_DENIED_ERROR` lo trae con el usuario y
    // el host de la conexión adentro.
    console.error(`[health] base de datos no disponible: ${errorSeguro(err)}`);
    return { ok: false, latencyMs: Date.now() - started, error: reason };
  }
}
