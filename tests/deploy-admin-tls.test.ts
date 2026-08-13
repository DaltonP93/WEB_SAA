import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El panel nunca se publica antes que el TLS.
 *
 * La versión anterior del script escribía la configuración de Nginx con
 * `/admin` ya servido y recién lo cerraba si certbot fallaba: entre el primer
 * `reload` y el certificado había una ventana —minutos, si Let's Encrypt está
 * lento— en la que el login del panel viajaba en texto plano. También existía
 * una variable de entorno para saltarse el cierre a propósito.
 *
 * Ahora el orden es al revés: el snippet arranca en 403 y sólo se abre después
 * de que el certificado existe, hay un server 443 y `nginx -t` valida. Estas
 * pruebas verifican ese orden en el texto del script, que es lo único que se
 * puede comprobar sin un VPS.
 */

const ROOT = resolve(__dirname, "..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/deploy/setup-vps.sh"), "utf8");

/** Posición de la primera aparición; falla la prueba si no está. */
function at(needle: string | RegExp): number {
  const index = typeof needle === "string" ? SCRIPT.indexOf(needle) : SCRIPT.search(needle);
  expect(index, `no se encontró ${needle} en setup-vps.sh`).toBeGreaterThan(-1);
  return index;
}

describe("el panel arranca cerrado", () => {
  it("el snippet cerrado responde 403 y no sirve el build", () => {
    const closed = SCRIPT.slice(at("write_admin_closed() {"), at("write_admin_open() {"));
    expect(closed).toMatch(/location \^~ \/admin/);
    expect(closed).toMatch(/return 403/);
    // Nada de `alias` ni `try_files`: no hay archivos del panel que servir.
    expect(closed).not.toContain("alias");
    expect(closed).not.toContain("try_files");
  });

  it("se escribe cerrado antes de generar la configuración de Nginx", () => {
    // `write_admin_closed` suelto (la llamada, no la definición).
    const call = SCRIPT.search(/^write_admin_closed$/m);
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(at("cat > /etc/nginx/sites-available/sanatorio"));
  });

  it("el primer reload de Nginx ocurre con el panel todavía cerrado", () => {
    const firstClosed = SCRIPT.search(/^write_admin_closed$/m);
    const firstReload = at("systemctl reload nginx");
    const open = at(/^ *write_admin_open$/m);
    expect(firstClosed).toBeLessThan(firstReload);
    expect(firstReload).toBeLessThan(open);
  });

  it("la configuración incluye el snippet en vez de servir /admin directo", () => {
    const vhost = SCRIPT.slice(
      at("cat > /etc/nginx/sites-available/sanatorio"),
      at("ln -sf /etc/nginx/sites-available/sanatorio"),
    );
    expect(vhost).toContain("include /etc/nginx/snippets/sanatorio-admin.conf;");
    // El bloque del vhost no define ninguna location /admin propia.
    expect(vhost).not.toMatch(/location \^?~?\s*\/admin/);
  });
});

describe("el panel se abre recién con TLS verificado", () => {
  it("abrirlo ocurre después de que certbot devuelve éxito", () => {
    expect(at("certbot --nginx")).toBeLessThan(at(/^ *write_admin_open$/m));
  });

  it("exige el certificado en disco y un server escuchando en 443", () => {
    const gate = SCRIPT.slice(at("Certificado emitido"), at(/^ *write_admin_open$/m));
    expect(gate).toContain("fullchain.pem");
    expect(gate).toContain("listen.*443");
    // Ambas condiciones cortan antes de abrir.
    expect(gate).toMatch(/queda cerrado/);
  });

  it("valida la configuración y comprueba HTTPS antes de dejarlo abierto", () => {
    const after = SCRIPT.slice(at(/^ *write_admin_open$/m));
    expect(after).toMatch(/nginx -t/);
    expect(after).toMatch(/https:\/\/\$\{?DOMAIN/);
    // Y si algo falla vuelve al 403.
    expect(after).toContain("write_admin_closed");
  });

  it("si nginx -t falla con el panel abierto, revierte a 403", () => {
    const revert = SCRIPT.slice(at("nginx -t falló con /admin habilitado"));
    expect(revert.slice(0, 200)).toContain("write_admin_closed");
  });

  it("sin dominio el panel nunca se abre", () => {
    // `write_admin_open` vive dentro del bloque `if [ -n "$DOMAIN" ]`.
    const branch = at('if [ -n "$DOMAIN" ]; then');
    expect(branch).toBeLessThan(at(/^ *write_admin_open$/m));
    expect(SCRIPT).toMatch(/certbot falló: .*\/admin sigue cerrado/);
  });
});

describe("sin TLS el panel no transmite credenciales", () => {
  it("certbot deja el 301 de HTTP a HTTPS", () => {
    // Con --redirect el server :80 responde 301; sin certificado, 403.
    expect(SCRIPT).toContain("--redirect");
  });

  it("no queda ninguna forma de publicar /admin sin TLS", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (["node_modules", ".git", "dist", "coverage"].includes(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|sh|md|yml|yaml|example)$/.test(entry)) files.push(full);
      }
    };
    walk(ROOT);

    // Partido para que este archivo no cuente como aparición.
    const flag = ["ADMIN", "ALLOW", "INSECURE", "HTTP"].join("_");
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes(flag));
    // El principio no admite excepción configurable: el panel no viaja sin TLS.
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });

  it("el resumen final avisa cuando el panel quedó cerrado", () => {
    expect(SCRIPT).toMatch(/Panel admin:\s+cerrado \(403\)/);
  });

  it("el deploy documenta que /admin depende del certificado", () => {
    const deploy = readFileSync(resolve(ROOT, "docs/DEPLOY.md"), "utf8");
    expect(deploy).toMatch(/\/admin/);
    expect(deploy).toMatch(/403|HTTPS/);
  });
});
