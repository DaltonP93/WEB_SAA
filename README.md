# Sanatorio Adventista de Asunción — Web V2

> Sitio web institucional con **panel de administración paramétrico** para el Sanatorio Adventista de Asunción (Paraguay). Construido como monorepo unificando referencias del Sanatorio del Plata (estructura visual), Sanatorio de Hohenau (funcionalidades) y Sanatorio de Asunción (datos y branding).

![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite&logoColor=white)
![Node](https://img.shields.io/badge/Node-20-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8-4479a1?logo=mysql&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-3-06b6d4?logo=tailwindcss&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-9-f69220?logo=pnpm&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ed?logo=docker&logoColor=white)

---

## ✨ Features

- **Sitio público** SPA con páginas dinámicas armadas a partir de **19 tipos de bloques** renderizables (Hero, Cards, Slider, Acordeón, Galería, Grid de médicos/especialidades/servicios/estudios/noticias, Mapa, Video, Formularios de contacto y turno, CTA, Stats, Logos, etc.).
- **Page builder drag-and-drop** en el admin (dnd-kit) para componer páginas sin tocar código.
- **Branding paramétrico**: colores, tipografías Google Fonts y border-radius se aplican al sitio en runtime — cambiar el color primario en el admin actualiza el sitio sin rebuild.
- **Guía médica** filtrable por especialidad + buscador por nombre.
- **Solicitud de turnos** que llega al panel admin con estado pendiente/confirmado/cancelado.
- **Editor rich-text** Tiptap para noticias.
- **Multimedia**: uploader con validación de tipo, optimización con sharp y caché HTTP de 30 días.
- **Auth** JWT + rate-limit por IP+email en el login.
- **SEO**: meta tags por página, Open Graph + Twitter Cards, sitemap.xml dinámico, robots.txt, canonical URLs, JSON-LD Schema.org en fichas de médicos, y **prerender estático de `/estudios`** en el build (HTML con la lista real de estudios agrupada, para buscadores que no ejecutan JS).
- **Iconos**: los campos de icono de Especialidades / Servicios / Estudios aceptan un nombre [lucide](https://lucide.dev/icons/) en kebab-case (`heart-pulse`) o un emoji, con preview en vivo en el editor.
- **Accesibilidad**: skip-link, navegación con teclado en dropdowns, labels asociados a inputs, contraste WCAG.

## 🧱 Arquitectura

```
WebSantarioV2/
├── apps/
│   ├── web/           React + Vite + TS + Tailwind + TanStack Query  → puerto 5173
│   │   └── scripts/prerender.mjs   Prerender SEO de /estudios (post-build)
│   └── admin/         React + Vite + TS + dnd-kit + Tiptap           → puerto 5174
├── api/               Node 20 + Express + TS + Knex + MySQL + JWT    → puerto 4000
├── shared/types/      Tipos compartidos (fuente de verdad de bloques)
├── scripts/
│   ├── extract-assets.ts / extract-doctors.ts
│   └── deploy/        run-remote.py (SSH) + setup-vps.sh + update-vps.sh
├── docker-compose.yml MySQL 8 + phpMyAdmin
├── docs/DEPLOY.md     Guía completa de deploy (Nginx + PM2 + Let's Encrypt)
└── AGENTS.md          Contexto, flujo multi-agente y runbook de producción (§9)
```

> **El sitio es una SPA client-side, no hay SSR.** Nginx sirve los `dist/` como estáticos y la API sólo atiende `/api/`, `/uploads/`, `/robots.txt` y `/sitemap.xml`. La única excepción es el HTML prerenderizado de `/estudios`.

Para profundizar: [`AGENTS.md`](AGENTS.md) explica el sistema de bloques, theming en runtime, esquema de base de datos y el flujo de 4 agentes (Analista → Desarrollador → Tester → Corrector) que se recomienda seguir para cualquier cambio.

## 🚀 Quickstart

### Requisitos

- **Node 20+**
- **pnpm 8+** (`npm i -g pnpm`)
- **Docker Desktop** (para MySQL + phpMyAdmin) — opcional pero recomendado

### 1. Clonar e instalar

```bash
git clone https://github.com/cacostama/WebSamap2.git
cd WebSamap2
pnpm install
```

### 2. Levantar MySQL con Docker

```bash
docker compose up -d
```

Esto arranca:
- MySQL 8 en `localhost:3306` (root/root, base `sanatorio`)
- phpMyAdmin en http://localhost:8080

> ¿Ya tenés MySQL nativo? Saltá este paso, creá la DB `sanatorio` manualmente y ajustá `api/.env`.

### 3. Configurar entorno

```bash
cp api/.env.example api/.env
# Editar si hace falta (CORS_ORIGINS, JWT_SECRET, credenciales DB)
```

### 4. Migrar y sembrar

```bash
pnpm db:migrate
pnpm db:seed
```

Opcional — extraer logos, imágenes y datos de médicos desde los HTML de referencia:

```bash
pnpm extract:assets
pnpm extract:doctors
pnpm db:seed     # vuelve a sembrar con los datos extraídos
```

### 5. Levantar el stack

```bash
pnpm dev
```

| Servicio | URL | Credenciales |
|---|---|---|
| 🌐 Sitio público | http://localhost:5173 | — |
| 🛠️ Panel admin | http://localhost:5174 | `admin@sanatorio.local` / `admin1234` |
| ⚙️ API REST | http://localhost:4000 | Bearer JWT |
| 🐬 phpMyAdmin | http://localhost:8080 | `root` / `root` |

> **Importante**: cambiá la contraseña del admin sembrado antes de cualquier deploy real.

## 🧩 Sistema de bloques

Cada página se compone de bloques `{ type, props }` almacenados en MySQL. El admin permite reordenarlos con drag-and-drop y editar sus props con formularios autogenerados.

**Agregar un bloque nuevo requiere 3 pasos** (ver `AGENTS.md` §3):

1. Tipo + interface de props en [`shared/types/blocks.ts`](shared/types/blocks.ts).
2. Componente React en [`apps/web/src/blocks/<Nombre>.tsx`](apps/web/src/blocks/).
3. Schema del editor en [`apps/admin/src/components/BlockPropsEditor.tsx`](apps/admin/src/components/BlockPropsEditor.tsx).

## 📜 Scripts disponibles

| Script | Descripción |
|---|---|
| `pnpm dev` | Levanta API + web + admin en paralelo |
| `pnpm dev:api` / `dev:web` / `dev:admin` | Cada uno por separado |
| `pnpm build` | Build de producción de los tres |
| `pnpm db:migrate` | Aplica migraciones Knex |
| `pnpm db:seed` | Corre los 3 seeds (users, specialties+doctors, pages+content) |
| `pnpm db:reset` | Rollback total + migrate + seed |
| `pnpm extract:assets` | Saca imágenes base64 de los HTML de referencia |
| `pnpm extract:doctors` | Extrae la guía médica de Asunción a JSON |

## 🚢 Deploy

Guía paso a paso en [`docs/DEPLOY.md`](docs/DEPLOY.md). Runbook de operación (incidentes, PM2, verificación) en [`AGENTS.md` §9](AGENTS.md).

**Instalación inicial de un servidor nuevo:** `scripts/deploy/setup-vps.sh` (Node 20, MySQL 8, Nginx, PM2, Certbot).

**Deploy de cambios** — un solo comando, vía SSH con paramiko:

```bash
python scripts/deploy/run-remote.py <IP> root '<password>' \
  "bash /var/www/sanatorio/scripts/deploy/update-vps.sh"
```

`update-vps.sh` hace `git reset --hard origin/main` → `pnpm install --frozen-lockfile` → `pnpm db:migrate` → builds → reload de Nginx + restart de PM2 (`sanatorio-api`).

Dos cosas que muerden:

- Todo cambio de dependencia necesita el **`pnpm-lock.yaml` commiteado**, o `--frozen-lockfile` rompe el deploy.
- El script **se re-ejecuta si él mismo cambió**, así que el primer deploy que lo modifica corre con la versión vieja. Si el cambio que querés probar está en el script, deployá dos veces.

**Verificación post-deploy** — no alcanza con abrir la home: Nginx sirve los estáticos aunque la API esté caída, así que la home da 200 igual. Hay que chequear la API:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<IP>/api/health   # 200 esperado
```

## 🤖 Trabajo con IAs

El archivo [`AGENTS.md`](AGENTS.md) es el punto de entrada para cualquier asistente. Define:

- Contexto completo del proyecto en un solo lugar.
- Convenciones (idioma de UI, naming, reuso de patterns, no commitear secrets).
- **Flujo multi-agente obligatorio**: Analista → Desarrollador → Tester → Corrector.
- Skills disponibles del entorno Claude Code.

## 🔧 Troubleshooting

<details>
<summary><b>En producción la web carga pero no aparece ningún contenido (502 en /api)</b></summary>

El proceso de la API se cayó. Nginx sigue sirviendo el HTML/CSS/JS estático, por eso la página "carga" vacía.

```bash
pm2 list                                    # ¿está online 'sanatorio-api'?
pm2 logs sanatorio-api --lines 50 --nostream
cd /var/www/sanatorio/api && pm2 start dist/src/index.js \
  --name sanatorio-api --time --cwd /var/www/sanatorio/api && pm2 save
```

El `--cwd` no es opcional: sin él dotenv no encuentra `api/.env` y la API no conecta a MySQL. Detalle del incidente de julio 2026 y las mitigaciones en [`AGENTS.md` §9](AGENTS.md).
</details>

<details>
<summary><b>El sitio muestra caracteres tipo "AsunciÃ³n" en vez de "Asunción"</b></summary>

Encoding doble. Es por mysql2 que vuelve a decodificar JSON columns con latin1. El fix está aplicado en `api/knexfile.ts`. Si volvés a verlo:
1. Verificá que `api/knexfile.ts` **no tenga** un `typeCast` custom.
2. Reiniciá la API (`tsx watch` no detecta cambios en knexfile).
3. Si la data ya quedó corrupta, `pnpm db:reset`.
</details>

<details>
<summary><b>Cambios en componentes no se reflejan en el browser</b></summary>

Probablemente quedaron archivos `.js` stale al lado de los `.tsx` (alguien corrió `tsc -b` antes). Borrarlos:
```bash
find apps/web/src apps/admin/src shared -name "*.js" -not -path "*/node_modules/*" -delete
```
Los `tsconfig.json` tienen `noEmit: true` para prevenirlo.
</details>

<details>
<summary><b>tsx watch no recarga cambios de configuración</b></summary>

`knexfile.ts` y archivos no importados directamente desde `src/index.ts` no son observados. Mata el proceso del puerto 4000 y reiniciá:
```bash
PID=$(netstat -ano | grep ':4000' | grep LISTENING | awk '{print $5}' | head -1)
taskkill //PID $PID //F
pnpm dev:api
```
</details>

## 📄 Fuentes de referencia (HTML inputs)

Tres snapshots HTML que se usaron como fuente:

- `WebArgentina/` — Sanatorio del Plata (estructura visual + paleta)
- `WebHoenau/` — Sanatorio de Hohenau (funcionalidades simples)
- `websamapAsu/` — Sanatorio de Asunción (logos, imágenes, 90+ médicos, branding)

Estas carpetas NO son código fuente — son input para los scripts de extracción. No se versionan al producto final.

## 🪪 Licencia

Propietario — Sanatorio Adventista de Asunción. Todos los derechos reservados.
