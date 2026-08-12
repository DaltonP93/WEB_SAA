import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { publicRouter } from "./routes/public.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin/index.js";
import { db, checkDatabase } from "./db.js";
import { errorHandler, wrapRouterAsync } from "./http.js";

export const PORT = Number(process.env.PORT ?? 4000);
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");

/**
 * Arma la aplicación Express sin levantarla. `index.ts` la escucha; las
 * pruebas la montan en un puerto efímero.
 */
export function createApp() {
  const app = express();

  // La API sólo devuelve JSON y archivos de /uploads: no necesita ejecutar
  // nada, así que la CSP puede ser máximamente restrictiva.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "default-src": ["'none'"],
          "img-src": ["'self'", "data:"],
          "base-uri": ["'none'"],
          "form-action": ["'none'"],
          "frame-ancestors": ["'none'"],
        },
      },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );
  app.use(
    cors({
      origin: (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      credentials: true,
    }),
  );
  // El JSON de las páginas del admin puede ser grande; el resto no necesita
  // tanto. 1mb alcanza para bloques y deja fuera payloads absurdos.
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "1mb" }));
  // Detrás de Nginx: req.ip tiene que ser la IP real del visitante para que el
  // rate limiting no cuente todo contra el proxy.
  app.set("trust proxy", process.env.TRUST_PROXY ?? "loopback");
  app.use(morgan("dev"));

  app.use("/uploads", express.static(UPLOAD_DIR, {
    immutable: true,
    maxAge: "30d",
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
    },
  }));

  /**
   * Health check con estado real de las dependencias.
   * 200 cuando la API y la base responden; 503 cuando la base no está
   * disponible, para que el deploy y los monitores lo detecten. No expone
   * credenciales ni datos de conexión.
   */
  app.get("/api/health", async (_req, res) => {
    const database = await checkDatabase();
    const ok = database.ok;
    res.status(ok ? 200 : 503).json({
      ok,
      ts: Date.now(),
      uptime: Math.round(process.uptime()),
      components: {
        api: { ok: true },
        database: { ok: database.ok, latencyMs: database.latencyMs, error: database.error },
      },
    });
  });
  app.get("/robots.txt", (_req, res) => {
    const siteUrl = getSiteUrl();
    res.type("text/plain").send([
      "User-agent: *",
      "Allow: /",
      "Disallow: /admin/",
      "Disallow: /api/",
      `Sitemap: ${siteUrl}/sitemap.xml`,
      "",
    ].join("\n"));
  });
  app.get("/sitemap.xml", async (_req, res) => {
    const siteUrl = getSiteUrl();
    // La sección Noticias se retiró del sitio público, así que no se indexa.
    const [pages, specialties, doctors] = await Promise.all([
      db("pages").where({ status: "published" }).select("slug", "updated_at"),
      db("specialties").select("slug"),
      db("doctors").select("slug"),
    ]);
    const urls: { loc: string; lastmod?: string | Date }[] = [
      ...pages.map((p) => ({ loc: p.slug === "home" ? "/" : `/${p.slug}`, lastmod: p.updated_at })),
      { loc: "/profesionales" },
      ...specialties.map((s) => ({ loc: `/especialidades/${s.slug}` })),
      ...doctors.map((d) => ({ loc: `/profesionales/${d.slug}` })),
    ];
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => sitemapUrl(siteUrl, u.loc, u.lastmod)).join("\n")}\n</urlset>`);
  });


  // wrapRouterAsync captura los rechazos de los handlers async y los deriva al
  // middleware de errores en vez de dejar caer el proceso.
  app.use("/api/public", wrapRouterAsync(publicRouter));
  app.use("/api/auth", wrapRouterAsync(authRouter));
  app.use("/api/admin", wrapRouterAsync(adminRouter));

  app.use((req, res) => {
    res.status(404).json({ error: "no encontrado", path: req.path });
  });

  app.use(errorHandler);


  return app;
}

function getSiteUrl() {
  return (process.env.PUBLIC_SITE_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");
}

function sitemapUrl(siteUrl: string, loc: string, lastmod?: string | Date) {
  const date = lastmod ? `\n    <lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : "";
  return `  <url>\n    <loc>${escapeXml(`${siteUrl}${loc}`)}</loc>${date}\n  </url>`;
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" }[ch]!));
}
