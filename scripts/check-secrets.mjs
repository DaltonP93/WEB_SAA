#!/usr/bin/env node
/**
 * Detector de secretos para el árbol actual (no reescribe historial).
 *
 * Corre sobre los archivos versionados: si encuentra algo que parezca una
 * credencial hardcodeada devuelve exit 1. Se usa en CI y localmente:
 *
 *   pnpm check:secrets
 *
 * No reemplaza a un escáner de historial (gitleaks/trufflehog), que corre
 * aparte en CI — este chequeo existe para que ningún commit nuevo vuelva a
 * meter un secreto y para poder correrlo sin red.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** Archivos/directorios que no se escanean. */
const SKIP_DIRS = [
  "node_modules",
  "dist",
  "build",
  ".git",
  "coverage",
  "assets-extracted",
  // Documentación de terceros vendoreada (ejemplos de librerías, no código propio).
  ".agents/skills",
];
const SKIP_FILES = [".env.example", ".env.deploy.example", "pnpm-lock.yaml"];
const SKIP_EXT = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".woff", ".woff2", ".ttf", ".zip", ".gz"];

/** Marcadores que indican un valor de ejemplo y no un secreto real. */
const PLACEHOLDER = /^(|x{3,}|\.{3}|<[^>]*>|\$\{[^}]*\}|\$[A-Z_]+|tu[-_ ]|your[-_ ]|cambia|change|placeholder|example|ejemplo|dummy|fake|test|secret|password|clave|admin|null|undefined|true|false)$/i;

const RULES = [
  {
    id: "private-key",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/,
    message: "llave privada embebida",
  },
  {
    id: "assignment-password",
    // PASSWORD = "algo" / password: 'algo' / DB_PASS="algo" en código
    re: /\b(?:password|passwd|pwd|pass|secret|token|api[_-]?key)\s*[:=]\s*["'`]([^"'`\n]{6,})["'`]/i,
    message: "credencial asignada en código",
    capture: 1,
  },
  {
    id: "env-inline-password",
    // PASSWORD=valor en scripts shell, sin ${...} ni $(...)
    re: /^[A-Z_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY)[A-Z_]*=(?!\s*$)(?!["']?\$)(["']?)([^\s"'#]{6,})\1/m,
    message: "credencial en variable de entorno hardcodeada",
    capture: 2,
  },
  {
    id: "ssh-password-arg",
    re: /\b(?:sshpass\s+-p|ssh.*--password[= ])\s*["']?([^\s"']{6,})/,
    message: "contraseña SSH en línea de comandos",
    capture: 1,
  },
  {
    id: "cloud-token",
    re: /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/,
    message: "token de servicio",
  },
];

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
  return out.toString("utf8").split("\0").filter(Boolean);
}

function shouldSkip(file) {
  if (SKIP_DIRS.some((d) => file === d || file.startsWith(`${d}/`) || file.includes(`/${d}/`))) return true;
  if (SKIP_FILES.includes(path.basename(file))) return true;
  if (SKIP_EXT.includes(path.extname(file).toLowerCase())) return true;
  return false;
}

function isPlaceholder(value) {
  if (!value) return true;
  const v = value.trim();
  if (PLACEHOLDER.test(v)) return true;
  // Referencias a variables o rutas, no valores.
  if (/^[$%{]/.test(v) || v.startsWith("./") || v.startsWith("/")) return true;
  // Cadenas sin ningún carácter "de secreto" (sólo letras y espacios) suelen
  // ser texto de UI: "Contraseña", "password inválida", etc.
  if (/^[a-záéíóúñ ]+$/i.test(v)) return true;
  return false;
}

const findings = [];

for (const file of trackedFiles()) {
  if (shouldSkip(file)) continue;
  let stat;
  try {
    stat = statSync(path.join(ROOT, file));
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;

  let content;
  try {
    content = readFileSync(path.join(ROOT, file), "utf8");
  } catch {
    continue;
  }
  if (content.includes("\u0000")) continue; // binario

  const lines = content.split("\n");
  lines.forEach((line, i) => {
    if (/check-secrets/.test(line)) return; // este mismo archivo describe patrones
    if (/allow-secret/.test(line)) return; // escape explícito y revisado
    for (const rule of RULES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      const value = rule.capture ? m[rule.capture] : null;
      if (value !== null && isPlaceholder(value)) continue;
      findings.push({ file, line: i + 1, rule: rule.id, message: rule.message });
    }
  });
}

if (findings.length === 0) {
  console.log("✓ check-secrets: sin credenciales hardcodeadas en el árbol actual");
  process.exit(0);
}

console.error(`✗ check-secrets: ${findings.length} hallazgo(s)\n`);
for (const f of findings) {
  // No imprimimos el valor detectado para no volver a filtrarlo en los logs.
  console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.message}`);
}
console.error("\nSi es un falso positivo, agregá el comentario 'allow-secret' en esa línea.");
process.exit(1);
