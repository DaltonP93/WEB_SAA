# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Read [`AGENTS.md`](AGENTS.md) first.** It is the canonical, exhaustive project context (architecture, conventions, multi-agent workflow, production runbook, incident history) and is kept up to date after every significant change. This file is a short operational summary for quick orientation — when the two disagree, `AGENTS.md` wins.

## What this is

Institutional website + fully parametric admin panel for **Sanatorio Adventista de Asunción** (Paraguay). pnpm monorepo: Node/Express API + two Vite/React SPAs (public site, admin panel), MySQL via Knex.

## Commands

```bash
pnpm install                # from repo root
pnpm dev                     # api (4000) + web (5173) + admin (5174) in parallel
pnpm dev:api / dev:web / dev:admin   # run one at a time

pnpm db:migrate              # apply Knex migrations
pnpm db:seed                 # run all 3 seeds (users, specialties+doctors, pages+content)
pnpm db:reset                # rollback all + migrate + seed

pnpm typecheck               # tsc --noEmit across api, web, admin
pnpm build                   # production build of all three (web build includes SEO prerender of /estudios)

pnpm test                    # vitest run, whole repo
pnpm test:watch              # vitest watch
TEST_DATABASE=1 pnpm test    # also runs migration tests against real MySQL
pnpm --filter @sa/api test -- path/to/file.test.ts   # single test file, scoped to a workspace
pnpm check:icons             # vitest run tests/icons.test.ts

pnpm check:secrets           # hardcoded-credential scanner (also runs in CI)
pnpm audit:prod              # prod dependency audit (high/critical)

pnpm extract:assets          # pull base64 images out of the reference HTML snapshots
pnpm extract:doctors         # extract Asunción doctor guide HTML into a JSON seed
```

Local ports: API `4000`, web `5173`, admin `5174`, phpMyAdmin `8080` (`docker compose up -d` for MySQL 8 + phpMyAdmin).

There is no literal seed admin password anywhere in the repo or docs — `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` come from `api/.env` (copy from `api/.env.example`), and `tests/docs-sin-credenciales.test.ts` fails the suite if one is ever reintroduced.

## Architecture

```
api/                  Node 20 + Express + TS + Knex + MySQL 8 + JWT   → :4000
  migrations/          schema, timestamped, never edit an applied one
  seeds/               01_users_and_settings, 02_specialties_doctors, 03_pages_and_content
  src/routes/
    public.ts           public endpoints (settings, pages/:slug, doctors, ...)
    auth.ts              JWT login
    admin/               12 protected routers (Zod-validated)
  uploads/ (+ a sibling staging dir, see Multimedia below)

apps/
  web/     React 18 + Vite + Tailwind + TanStack Query          → :5173
    src/blocks/          21 renderable block components
    scripts/prerender.mjs  post-build static SEO prerender of /estudios
  admin/   React 18 + Vite + Tailwind + dnd-kit + Tiptap        → :5174
    src/pages/            PageBuilder, Settings, Doctors, Appointments, ...

shared/types/          shared TS types — blocks.ts is the source of truth for
                        which block types exist and what props each accepts

scripts/deploy/         run-remote.py (SSH via paramiko), setup-vps.sh, update-vps.sh, rollback-vps.sh
docs/DEPLOY.md          full Nginx + PM2 + MySQL + Let's Encrypt deploy guide
```

**No SSR.** The public site is a client-side SPA; Nginx serves `dist/` as static files in production and the API only handles `/api/`, `/uploads/`, `/robots.txt`, `/sitemap.xml`. The one exception is the prerendered static HTML at `/estudios`.

### Page builder / block system

Every public page is an ordered array of `{ type, props }` blocks stored in MySQL, reordered via drag-and-drop and edited through auto-generated forms in the admin. **Adding a new block type is a 3-step change, all required:**
1. Type + props interface in `shared/types/blocks.ts`, registered in `BLOCK_REGISTRY`.
2. React component in `apps/web/src/blocks/<Name>.tsx`, registered in `BlockRenderer.tsx`.
3. Editor schema in `apps/admin/src/components/BlockPropsEditor.tsx`.

### Runtime theming

Admin writes colors/fonts to `settings.theme`. `apps/web/src/api.ts`'s `applyTheme()` converts hex → `R G B` and injects CSS variables (`--c-primary`, `--f-heading`, ...) that Tailwind tokens (`bg-primary`, `text-ink`) consume. Changing a color in the admin updates the live site on refresh — no rebuild.

### Multimedia upload pipeline

Contract split between `api/src/imagenes.ts` (decides) and `api/src/routes/admin/media.ts` (orchestrates). Files land first in `UPLOAD_STAGING_DIR` (a sibling of `UPLOAD_DIR`, not served by `/uploads`) and only get an atomic `rename` into the public dir after content validation, processing, and result verification. Format is determined by file signature + what libvips actually decodes, never by `originalname`/`mimetype`. SVG goes through an allowlist sanitizer (`api/src/svg.ts`); PDFs are structurally validated and sanitized with `pdf-lib`. See `AGENTS.md` §8 for the full contract (limits, naming, orphan cleanup, referenced-file protection).

### Other load-bearing conventions

- **Timezone**: any date the sanatorio chooses/filters is `America/Asuncion`, sourced from `api/src/timezone.ts` (and `apps/admin/src/lib/fecha.ts` on the admin side). Never `new Date(aDatetimeLocalValue)` and never a fixed `-03:00` offset.
- **Logging**: never log a full error object or full `req.originalUrl`. Go through `api/src/log-seguro.ts`, which keeps method/route/query-param *names* and drops values; DB errors log name+code only, never `message`/`sql`/`sqlMessage`/bindings (mysql2 embeds substituted values, which can include patient PII).
- **Contact data / hours**: single source of truth is the `contact_channels` table (admin → *Canales de contacto*) and `schedules` table (admin → *Horarios*). Never hardcode phone numbers, emails, or hours in code — missing values render as "A confirmar" / "Horarios en proceso de confirmación".
- **Branding** (Adventist Health guidelines, not negotiable without client sign-off): primary `#005587` (navy, Pantone 7462C), secondary `#00B5DA` (cyan, Pantone 311C), accent `#f5543f` (coral, reserved exclusively for Emergencias — "Reservar turno" always uses the cyan `.btn-turno`). Headings in Work Sans 600/700, body in Open Sans 400/600.
- Reuse existing admin primitives before writing new ones: `EntityManager`/`DataTable` (CRUDs), `ConfirmDialog`/`useConfirm`, `useUnsavedGuard`, `PhotoUploadField`, `crudRouter`.

## Workflow expectation

`AGENTS.md` §5 mandates a 4-role loop (Analista → Desarrollador → Tester → Corrector) for all work in this repo, including small changes — Analista is read-only, Tester runs build/typecheck/smoke checks before Corrector touches anything. Follow it when using the `Agent` tool.

## Deploy

Single command from repo root (credentials from `.env.deploy`, never as CLI args):
```bash
python scripts/deploy/run-remote.py "bash /var/www/sanatorio/scripts/deploy/update-vps.sh"
```
Any dependency change requires a committed `pnpm-lock.yaml` or `--frozen-lockfile` breaks the deploy. Post-deploy, checking that the homepage loads is not sufficient — Nginx serves static files even with the API down — always check `curl http://<IP>/api/health`. Full runbook, rollback procedure, and incident history in `AGENTS.md` §9.
