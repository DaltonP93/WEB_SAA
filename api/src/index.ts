import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { publicRouter } from "./routes/public.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin/index.js";
import { db } from "./db.js";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin: (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    credentials: true,
  }),
);
app.use(express.json({ limit: "5mb" }));
app.use(morgan("dev"));

app.use("/uploads", express.static(UPLOAD_DIR, {
  immutable: true,
  maxAge: "30d",
  setHeaders: (res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
  },
}));

app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
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

app.use("/api/public", publicRouter);
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message ?? "internal error" });
});

app.listen(PORT, () => {
  console.log(`✓ API en http://localhost:${PORT}`);
});

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
