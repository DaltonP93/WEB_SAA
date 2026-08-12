import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";

/**
 * Pruebas de la API sin base de datos disponible.
 *
 * Apuntamos la conexión a un puerto cerrado para simular MySQL caído: la API
 * tiene que seguir en pie, responder 503 en /api/health y 503 (no 500 ni caída
 * del proceso) en las rutas que consultan la base.
 */

process.env.NODE_ENV = "test";
process.env.DB_HOST = "127.0.0.1";
process.env.DB_PORT = "59999"; // puerto sin nada escuchando
process.env.DB_ACQUIRE_TIMEOUT_MS = "1500";
process.env.DB_HEALTH_TIMEOUT_MS = "1500";
process.env.PUBLIC_FORMS_RATE_MAX = "3";
process.env.PUBLIC_FORMS_RATE_WINDOW_MS = "60000";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const { createApp } = await import("../api/src/app.js");
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("health con la base caída", () => {
  it("responde 503 e informa el componente sin exponer credenciales", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.components.api.ok).toBe(true);
    expect(body.components.database.ok).toBe(false);
    // Nada de host, usuario, contraseña ni SQL en la respuesta.
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/password|DB_PASS|127\.0\.0\.1|59999/i);
  });
});

describe("rutas que dependen de la base", () => {
  it("devuelven 503 y no tiran el proceso", async () => {
    const res = await fetch(`${baseUrl}/api/public/services`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("servicio no disponible temporalmente");
    // El proceso sigue vivo: la request siguiente responde igual.
    const again = await fetch(`${baseUrl}/api/health`);
    expect(again.status).toBe(503);
  });
});

describe("rutas inexistentes", () => {
  it("devuelven 404 con JSON", async () => {
    const res = await fetch(`${baseUrl}/api/no-existe`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("no encontrado");
  });
});

describe("formularios públicos", () => {
  const post = (body: unknown) =>
    fetch(`${baseUrl}/api/public/contact-messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("rechaza payloads inválidos con 400 y detalle por campo", async () => {
    const res = await post({ name: "a", email: "no-es-email", message: "x" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("payload invalido");
    expect(body.details).toHaveProperty("email");
  });

  it("descarta el spam del honeypot sin tocar la base", async () => {
    const res = await post({
      name: "Bot",
      email: "bot@spam.test",
      message: "mensaje de spam",
      website: "http://spam.test",
    });
    // 201 sin id: no se guardó nada y el bot no recibe pistas.
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: null });
  });

  it("aplica rate limiting por IP", async () => {
    const spam = { name: "Bot", email: "b@b.test", message: "spam", website: "x" };
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await post(spam)).status);
    }
    expect(codes).toContain(429);
    const last = await post(spam);
    expect(last.status).toBe(429);
    expect(last.headers.get("retry-after")).toBeTruthy();
  });
});
