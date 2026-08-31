import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const leer = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const setup = leer("scripts/deploy/setup-vps.sh");
const update = leer("scripts/deploy/update-vps.sh");
const remote = leer("scripts/deploy/run-remote.py");
const prepare = leer("scripts/deploy/prepare-env.sh");
const apiEnv = leer("api/.env.example");
const deployEnv = leer(".env.deploy.example");
const deployDoc = leer("docs/DEPLOY.md");
const estado = leer("docs/ESTADO-PROYECTO.md");
const preprod = leer("docs/PREPRODUCCION-Y-GO-LIVE.md");
const historico = leer("docs/SEGURIDAD-SECRETO-HISTORICO.md");

describe("bootstrap de red fail-closed", () => {
  it("permite SSH/HTTP/HTTPS antes de habilitar UFW", () => {
    const openSsh = setup.indexOf("ufw allow OpenSSH");
    const http = setup.indexOf("ufw allow 80/tcp");
    const https = setup.indexOf("ufw allow 443/tcp");
    const enable = setup.indexOf("ufw --force enable");
    for (const pos of [openSsh, http, https, enable]) expect(pos).toBeGreaterThan(-1);
    expect(openSsh).toBeLessThan(enable);
    expect(http).toBeLessThan(enable);
    expect(https).toBeLessThan(enable);
  });

  it("no oculta un fallo de UFW", () => {
    const bloque = setup.slice(setup.indexOf("ufw allow OpenSSH"), setup.indexOf("# --- Health check"));
    expect(bloque).not.toContain("|| true");
  });
});

describe("update con versión y backup verificables", () => {
  it("resuelve un SHA aprobado que pertenece a main y sólo avanza", () => {
    for (const script of [setup, update]) {
      expect(script).toContain("DEPLOY_TO");
      expect(script).toContain('git merge-base --is-ancestor "$TARGET_SHA" "origin/${BRANCH}"');
      expect(script).toContain('git reset --hard "$TARGET_SHA"');
    }
    expect(update).toContain('git merge-base --is-ancestor "$PREVIOUS_SHA" "$TARGET_SHA"');
    expect(update).toContain("rollback-vps.sh");
  });

  it("valida el gzip antes de migrar", () => {
    const integrity = update.indexOf('gzip -t "$BACKUP_FILE"');
    const migrate = update.indexOf('pnpm db:migrate');
    expect(integrity).toBeGreaterThan(-1);
    expect(integrity).toBeLessThan(migrate);
  });

  it("ya no puede migrar sin backup", () => {
    expect(update).not.toContain("SKIP_DB_BACKUP");
    expect(deployDoc).not.toContain("SKIP_DB_BACKUP");
    expect(update).toMatch(/Sin backup válido no se migra/);
  });
});

describe("ejecutor SSH con timeout real", () => {
  it("sale 124 sin esperar indefinidamente el exit remoto", () => {
    const timeoutExit = remote.indexOf("sys.exit(124)");
    const recvExit = remote.indexOf("chan.recv_exit_status()");
    expect(remote).toContain("timed_out = True");
    expect(timeoutExit).toBeGreaterThan(-1);
    expect(recvExit).toBeGreaterThan(timeoutExit);
    expect(remote).toMatch(/comando remoto puede seguir/);
  });
});

describe("contrato de staging y SSH documentado", () => {
  it("staging queda explícito y fuera de uploads", () => {
    expect(apiEnv).toContain("UPLOAD_STAGING_DIR=./.uploads-staging");
    expect(prepare).toContain("UPLOAD_STAGING_DIR=${APP_DIR}/api/.uploads-staging");
    expect(deployDoc).toContain("UPLOAD_STAGING_DIR");
  });

  it("el ejemplo SSH no promete variables de rutas que nadie consume", () => {
    expect(deployEnv).not.toContain("SANATORIO_APP_DIR");
    expect(deployEnv).not.toContain("SANATORIO_UPLOADS_DIR");
    expect(deployEnv).toMatch(/fingerprint/i);
    expect(deployEnv).toContain("SANATORIO_SSH_ACCEPT_NEW=0");
  });
});

describe("procedimiento público de preproducción", () => {
  it("mantiene NO-GO y separa hechos de decisiones", () => {
    expect(preprod).toMatch(/Producción: NO-GO/i);
    expect(preprod).toMatch(/ruleset/i);
    expect(preprod).toMatch(/dominio.*Pendiente|dominio.*confirmar/i);
    expect(preprod).toMatch(/backup.*uploads/i);
    expect(estado).toContain("fd49743a27543a5cd0c12e2839b6ba9760484d33");
  });

  it("no publica el inventario sensible", () => {
    expect(historico).toMatch(/valores.*fuera de Git|nunca deben copiarse/i);
    expect(historico).toMatch(/rotar antes de purgar/i);
    expect(historico).not.toMatch(/(?:\d{1,3}\.){3}\d{1,3}/);
    expect(historico).not.toMatch(/@[\w.-]+:/);
  });

  it("prohíbe el pipe remoto y fija el deploy por SHA", () => {
    expect(preprod).toMatch(/No ejecutar \`curl \| bash\`/);
    expect(preprod).toContain('DEPLOY_TO="$APPROVED_SHA"');
    expect(deployDoc).toContain("APPROVED_SHA");
  });

  it("define gates de infraestructura, restore y rollback", () => {
    for (const requisito of ["≥4 GB RAM", "ruleset", "restore", "monitoreo", "Rollback inmediato"]) {
      expect(preprod).toContain(requisito);
    }
  });
});

describe("sintaxis de los scripts endurecidos", () => {
  it("setup, update y prepare-env siguen siendo bash válido", () => {
    for (const path of [
      "scripts/deploy/setup-vps.sh",
      "scripts/deploy/update-vps.sh",
      "scripts/deploy/prepare-env.sh",
    ]) {
      execFileSync("bash", ["-n", resolve(ROOT, path)], { stdio: "pipe" });
    }
  });

  it("run-remote sigue siendo Python válido", () => {
    execFileSync("python3", ["-m", "py_compile", resolve(ROOT, "scripts/deploy/run-remote.py")], {
      stdio: "pipe",
    });
  });
});
