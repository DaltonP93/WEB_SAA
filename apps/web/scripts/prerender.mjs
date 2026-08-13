// Prerender best-effort de páginas públicas data-driven para SEO.
//
// Corre DESPUÉS de `vite build`. Lee dist/index.html y, usando los datos que
// expone la API (que sigue corriendo durante el deploy), genera HTML estático
// con el contenido ya renderizado + meta + JSON-LD. Nginx lo sirve vía
// try_files sin tocar la configuración. Si la API no está disponible (build
// local sin backend), avisa y NO rompe el build.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../dist");
const API_BASE = (process.env.PRERENDER_API_BASE ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const SITE_URL = (process.env.PUBLIC_SITE_URL ?? "https://sanatorioadventista.com.py").replace(/\/$/, "");

// Mismos grupos y títulos que apps/web/src/blocks/StudyGrid.tsx
const GROUPS = [
  { key: "laboratorio", title: "Laboratorio clínico y bacteriológico" },
  { key: "imagenes", title: "Estudios por imágenes" },
  { key: "cardiologicos", title: "Estudios cardiológicos" },
  { key: "biopsias", title: "Biopsias y anatomía patológica" },
];

function esc(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

function studyCard(s) {
  const desc = s.description ? `<p class="text-sm text-gray-600 mt-2">${esc(s.description)}</p>` : "";
  return `<div class="bg-white border rounded p-5"><h3 class="font-semibold text-primary">${esc(s.name)}</h3>${desc}</div>`;
}

function buildStudiesHtml(all) {
  const known = new Set(GROUPS.map((g) => g.key));
  const sections = [
    ...GROUPS.map((g) => ({ title: g.title, items: all.filter((s) => s.category === g.key) })),
    { title: "Otros estudios", items: all.filter((s) => !known.has(s.category)) },
  ].filter((sec) => sec.items.length > 0);

  const inner = sections
    .map(
      (sec) =>
        `<div><h2 class="text-xl font-bold text-primary mb-5">${esc(sec.title)}</h2>` +
        `<div class="grid grid-cols-1 md:grid-cols-3 gap-5">${sec.items.map(studyCard).join("")}</div></div>`,
    )
    .join("");
  return `<section class="container-x py-12 space-y-10">${inner}</section>`;
}

function injectHead(html, { title, description, canonical, jsonLd }) {
  let out = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  const tags = [
    description ? `<meta name="description" content="${esc(description)}" />` : "",
    `<link rel="canonical" href="${esc(canonical)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    description ? `<meta property="og:description" content="${esc(description)}" />` : "",
    `<meta property="og:url" content="${esc(canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
  ].filter(Boolean).join("\n    ");
  return out.replace("</head>", `    ${tags}\n  </head>`);
}

async function prerenderStudies(shell) {
  const [page, studies] = await Promise.all([
    fetchJson(`${API_BASE}/api/public/pages/estudios`),
    fetchJson(`${API_BASE}/api/public/studies`),
  ]);
  const all = Array.isArray(studies) ? studies : [];
  if (all.length === 0) {
    // Sin estudios publicados el prerender escribiría una página vacía, que es
    // peor que servir el shell del SPA: el buscador indexaría el hueco. Se
    // deja el index.html normal y se avisa, no se falla el build.
    console.log("✓ prerender: /estudios omitido (no hay estudios publicados)");
    return;
  }
  const seo = page?.seo ?? {};
  const title = seo.title ?? page?.title ?? "Estudios";
  const description = seo.description ?? "";
  // Nginx sirve el HTML estático desde el directorio /estudios/ y redirige
  // /estudios → /estudios/ (301). El canonical apunta a la URL realmente servida.
  const canonical = `${SITE_URL}/estudios/`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: title,
    itemListElement: all.map((s, i) => ({ "@type": "ListItem", position: i + 1, name: s.name })),
  };

  let html = injectHead(shell, { title, description, canonical, jsonLd });
  const content = buildStudiesHtml(all);
  html = html.replace('<div id="root"></div>', `<div id="root">${content}</div>`);

  const dir = path.join(DIST, "estudios");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "index.html"), html, "utf8");
  console.log(`✓ prerender: /estudios (${all.length} estudios)`);
}

async function main() {
  let shell;
  try {
    shell = await readFile(path.join(DIST, "index.html"), "utf8");
  } catch {
    console.warn("prerender: no se encontró dist/index.html → skip");
    return;
  }
  try {
    await prerenderStudies(shell);
  } catch (err) {
    console.warn(`prerender: omitido (API no disponible en ${API_BASE}): ${err.message}`);
  }
}

main();
