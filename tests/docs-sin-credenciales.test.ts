import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ninguna documentación del repo publica credenciales literales.
 *
 * `AGENTS.md` traía esta línea, y sobrevivió siete rondas de auditoría:
 *
 *     **Credenciales seed**: `<correo>` / `<contraseña literal>` (cambiar en producción)
 *
 * **Ni `check-secrets` ni `gitleaks` la detectaban.** Se verificó ejecutando los
 * dos sobre el árbol con esa línea presente: ambos salían en verde. El motivo es
 * que las dos herramientas buscan formas de *asignación* —`PASSWORD="…"`,
 * `VAR="${VAR:-…}"`— y una credencial escrita en prosa, entre backticks y
 * separada por una barra, no tiene esa forma.
 *
 * Por eso este archivo no delega la comprobación: implementa su propio detector
 * para las dos formas en que una credencial aparece en documentación, y se
 * autoverifica contra muestras sintéticas para no pasar en verde por estar roto.
 */

const ROOT = resolve(__dirname, "..");

/** Markdown versionado, sin la documentación de terceros vendoreada. */
function markdownVersionado(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "*.md"], { cwd: ROOT, encoding: "buffer" });
  return out
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((f) => !f.startsWith(".agents/skills/"));
}

/**
 * Valores que no son secretos: nombres de variable, expansiones, rutas y las
 * palabras que se usan como marcador de posición.
 */
const PLACEHOLDER =
  /^(x{3,}|\.{3,}|<.*>|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|tu[-_ ].*|your[-_ ].*|cambia.*|change.*|placeholder|ejemplo|example|dummy|fake|sha|token|clave|contrase[ñn]a|password|secreto?|null|undefined|ninguna|obligatoria|generada|aleatoria)$/i;

/** `SEED_ADMIN_PASSWORD`, `DB_PASS`: nombres de variable, no valores. */
const NOMBRE_DE_VARIABLE = /^[A-Z][A-Z0-9_]*$/;

/** Rutas, URLs y archivos: no son contraseñas. */
const RUTA_O_URL = /^(\.{0,2}\/|https?:|[\w.-]+\.(sh|ts|tsx|js|mjs|json|md|env|yml|yaml|sql|gz|py))/i;

function esValorSospechoso(valor: string): boolean {
  const v = valor.trim().replace(/^[`'"]+|[`'"]+$/g, "");
  if (v.length < 6) return false;
  if (PLACEHOLDER.test(v)) return false;
  if (NOMBRE_DE_VARIABLE.test(v)) return false;
  if (RUTA_O_URL.test(v)) return false;
  // Un SHA de git o un hash no es una credencial.
  if (/^[0-9a-f]{7,40}$/i.test(v)) return false;
  // Rutas, asignaciones y llamadas: son código citado, no valores.
  if (/[/=()\\]/.test(v)) return false;
  return true;
}

/**
 * Forma 1 — el par en prosa: un correo, un separador y un valor.
 * Es la que tenía `AGENTS.md` y la que ninguna herramienta detectaba.
 */
function paresCredenciales(linea: string): string[] {
  const re = /[`'"]?[\w.+-]+@[\w-]+\.[a-z]{2,}[`'"]?\s*[/|]\s*[`'"]?([^\s`'"|)]+)[`'"]?/gi;
  const hallazgos: string[] = [];
  for (const m of linea.matchAll(re)) if (esValorSospechoso(m[1])) hallazgos.push(m[1]);
  return hallazgos;
}

/**
 * Forma 2 — la etiqueta pegada al valor: "contraseña: `xxx`", "clave es `xxx`".
 *
 * La etiqueta tiene que estar **adyacente** al valor. Una versión más laxa
 * —cualquier backtick en una línea que mencione contraseñas— marcaba rutas,
 * nombres de variable y `NODE_ENV=production` en prosa perfectamente legítima
 * sobre cómo NO guardar credenciales, que es justamente lo que esta
 * documentación tiene que poder decir.
 */
function valoresEtiquetados(linea: string): string[] {
  const etiqueta = "(?:contrase[ñn]a|password|passwd|clave|credencial(?:es)?)\\s*(?:es|son|:|=)\\s*";
  const hallazgos: string[] = [];
  // Entrecomillado o entre backticks: la forma normal en markdown.
  for (const m of linea.matchAll(new RegExp(`${etiqueta}[\`'"]([^\`'"\n]{6,})[\`'"]`, "gi"))) {
    if (esValorSospechoso(m[1])) hallazgos.push(m[1]);
  }
  // Sin comillas. Acá no alcanza con "≥6 caracteres": "Contraseña: la que generó
  // el deploy" es prosa legítima. Se exige que el valor tenga forma de
  // contraseña —un token sin espacios con dígitos o mayúsculas y minúsculas
  // mezcladas—, que es lo que distingue `hunter2` de `generada`.
  for (const m of linea.matchAll(new RegExp(`${etiqueta}([^\\s\`'"]{6,})`, "gi"))) {
    const v = m[1].replace(/[.,;:)]+$/, "");
    const pareceContrasena = /\d/.test(v) && /[a-z]/i.test(v);
    const mezclaMayusculas = /[a-z]/.test(v) && /[A-Z]/.test(v);
    if ((pareceContrasena || mezclaMayusculas) && esValorSospechoso(v)) hallazgos.push(v);
  }
  return [...new Set(hallazgos)];
}

function analizar(texto: string): { linea: number; valor: string; forma: string }[] {
  const out: { linea: number; valor: string; forma: string }[] = [];
  texto.split("\n").forEach((linea, i) => {
    for (const v of paresCredenciales(linea)) out.push({ linea: i + 1, valor: v, forma: "par" });
    for (const v of valoresEtiquetados(linea)) out.push({ linea: i + 1, valor: v, forma: "etiqueta" });
  });
  return out;
}

describe("el detector funciona", () => {
  // Sin esto, un detector roto pasaría en verde para siempre y el archivo daría
  // una garantía que no da.
  it("marca el par correo / contraseña en prosa", () => {
    const muestra = "**Credenciales seed**: `usuario@ejemplo.test` / `Zx9pQr-demo` (cambiar en producción).";
    const h = analizar(muestra);
    expect(h.map((x) => x.valor)).toContain("Zx9pQr-demo");
  });

  it("marca una contraseña etiquetada", () => {
    expect(analizar("Contraseña: `Zx9pQr-demo`").map((x) => x.valor)).toContain("Zx9pQr-demo");
    expect(analizar("La clave es `Zx9pQr-demo`.").map((x) => x.valor)).toContain("Zx9pQr-demo");
  });

  it("marca también la contraseña sin comillas", () => {
    // La primera versión del detector sólo miraba valores entrecomillados: una
    // credencial escrita en prosa plana se le escapaba entera.
    expect(analizar("Contraseña: Zx9pQr7demo").map((x) => x.valor)).toContain("Zx9pQr7demo");
    expect(analizar("password = hunter2000").map((x) => x.valor)).toContain("hunter2000");
  });

  it("pero no marca prosa que describe de dónde sale la contraseña", () => {
    expect(analizar("Contraseña: la que generó el deploy.")).toEqual([]);
    expect(analizar("Contraseña: obligatoria en producción.")).toEqual([]);
    expect(analizar("La contraseña es aleatoria y queda sólo para root.")).toEqual([]);
  });

  it("marca exactamente la forma que tenía AGENTS.md", () => {
    // Reconstruida sin escribirla entera, para no reintroducir el literal.
    const muestra = ["**Credenciales seed**: `admin@sanatorio.local` / `", "admin", "1234", "` (cambiar en producción)."].join("");
    expect(analizar(muestra).length).toBeGreaterThan(0);
  });

  it("no marca nombres de variable ni expansiones", () => {
    expect(analizar("`SEED_ADMIN_PASSWORD` es obligatoria con `NODE_ENV=production`.")).toEqual([]);
    expect(analizar('Login: -d "{\\"password\\":\\"$SEED_ADMIN_PASSWORD\\"}"')).toEqual([]);
    expect(analizar("La contraseña sale de `SEED_ADMIN_PASSWORD`.")).toEqual([]);
  });

  it("no marca rutas, comandos ni prosa sobre contraseñas", () => {
    expect(analizar("Deshabilitar el acceso por contraseña en `/etc/ssh/sshd_config`.")).toEqual([]);
    expect(analizar("`PasswordAuthentication no` y `PermitRootLogin prohibit-password`.")).toEqual([]);
    expect(analizar("El deploy deja la contraseña en `.deploy-credentials`.")).toEqual([]);
    expect(analizar("Rotar la contraseña de root del VPS es decisión del propietario.")).toEqual([]);
  });
});

describe("ningún markdown del repo publica credenciales", () => {
  const archivos = markdownVersionado();

  it("hay markdown para revisar", () => {
    expect(archivos.length).toBeGreaterThan(0);
    expect(archivos).toContain("AGENTS.md");
  });

  it.each(archivos)("%s", (archivo) => {
    const hallazgos = analizar(readFileSync(resolve(ROOT, archivo), "utf8"));
    const detalle = hallazgos.map((h) => `  ${archivo}:${h.linea} (${h.forma}) → ${h.valor}`).join("\n");
    expect(hallazgos, `credencial literal en documentación:\n${detalle}`).toEqual([]);
  });
});

describe("AGENTS.md explica de dónde sale la credencial", () => {
  const agents = readFileSync(resolve(ROOT, "AGENTS.md"), "utf8");

  it("no basta con borrar la línea: hay que decir cómo se obtiene", () => {
    expect(agents).toContain("SEED_ADMIN_PASSWORD");
    expect(agents).toMatch(/\.deploy-credentials/);
  });

  it("refleja que la suite de pruebas existe", () => {
    // Decía "Tests automatizados (no hay)" mientras corrían cientos.
    expect(agents).not.toMatch(/Tests automatizados \(no hay/i);
    expect(agents).toMatch(/pruebas en \d+ archivos/i);
  });

  it("documenta el rollback y sus códigos de salida", () => {
    expect(agents).toContain("rollback-vps.sh");
    expect(agents).toMatch(/ROLLBACK_TO=<sha-anterior> bash [^\n]*rollback-vps\.sh/);
    // Los códigos propios del rollback, no los genéricos.
    for (const codigo of ["| 2 |", "| 7 |", "| 8 |"]) expect(agents).toContain(codigo);
  });

  it("documenta que update-vps.sh rechaza ROLLBACK_TO", () => {
    expect(agents).toMatch(/c[óo]digo 2/i);
    expect(agents).toMatch(/no hace rollback/i);
    // Y ya no promete que hay que deployar dos veces.
    expect(agents).not.toMatch(/hay que deployar dos veces/i);
  });
});
