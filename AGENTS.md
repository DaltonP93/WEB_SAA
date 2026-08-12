# AGENTS.md — Contexto del proyecto y flujo multi-agente

> **Lectura obligatoria para cualquier IA o desarrollador antes de tocar este repo.**
> Este archivo es el punto de entrada: explica qué es el proyecto, cómo está armado, y cómo se debe trabajar con un flujo de 4 agentes especializados.

---

## 1. ¿Qué es este proyecto?

Sitio web institucional + panel de administrador **100 % paramétrico** para el **Sanatorio Adventista de Asunción** (Paraguay).

Se construyó unificando tres referencias (todas son snapshots HTML, no código fuente):

| Carpeta | Sitio real | Rol |
|---|---|---|
| `WebArgentina/` | Sanatorio Adventista del Plata (Webflow) | Estructura visual + paleta primaria (navy `#004884`) |
| `WebHoenau/` | Sanatorio Adventista de Hohenau (SPA) | Funcionalidades simples (turno rápido) |
| `websamapAsu/` | Sanatorio Adventista de Asunción (Bootstrap) | **Datos reales**: logos, imágenes, 90+ médicos, especialidades, branding |

**Resultado**: un nuevo sitio que toma la estructura/estilo de Argentina, las features de los tres, y los datos/branding de Asunción — todo editable desde un admin.

---

## 2. Stack y arquitectura

**Monorepo pnpm workspaces.**

```
WebSantarioV2/
├── api/                  Node 20 + Express + TypeScript + Knex + MySQL 8 + JWT
│   ├── migrations/       Schema en TS (knex)
│   ├── seeds/            01_users_and_settings, 02_specialties_doctors, 03_pages_and_content
│   ├── src/routes/
│   │   ├── public.ts     Endpoints públicos (settings, pages/:slug, doctors, etc.)
│   │   ├── auth.ts       Login JWT
│   │   └── admin/        12 routers protegidos
│   └── uploads/          Archivos subidos (logos, fotos, imágenes)
│
├── apps/
│   ├── web/              React 18 + Vite + Tailwind + TanStack Query
│   │   └── src/blocks/   21 bloques renderizables (Hero, Cards, DoctorList, …)
│   └── admin/            React 18 + Vite + Tailwind + dnd-kit + Tiptap
│       └── src/pages/    Páginas del panel (PageBuilder, Settings, Doctors, …)
│
├── shared/types/         Tipos TS compartidos (blocks.ts es la fuente de verdad
│                         de qué bloques existen y qué props acepta cada uno)
│
├── scripts/              extract-assets.ts (imágenes base64 → archivos)
│                         extract-doctors.ts (HTML guía médica → JSON seed)
│
├── assets-extracted/     Salida de los scripts (imágenes + data JSON)
├── docs/DEPLOY.md        Guía Nginx + PM2 + MySQL + Let's Encrypt
└── AGENTS.md             ← este archivo
```

**Puertos locales**: API `4000`, web `5173`, admin `5174`.

**Credenciales seed**: `admin@sanatorio.local` / `admin1234` (cambiar en producción).

---

## 3. Conceptos clave

### Sistema de bloques (page builder)
- Cada **página** del sitio público se compone de un arreglo ordenado de **bloques**.
- Cada bloque tiene `type` (string) + `props` (JSON).
- Los tipos disponibles están en [`shared/types/blocks.ts`](shared/types/blocks.ts) en `BLOCK_REGISTRY`. **Agregar uno nuevo requiere 3 pasos**:
  1. Definir tipo + interface de props en `shared/types/blocks.ts` y registrarlo en `BLOCK_REGISTRY`.
  2. Crear el componente React en `apps/web/src/blocks/<Nombre>.tsx` y registrarlo en `BlockRenderer.tsx`.
  3. Definir el schema del editor de props en `apps/admin/src/components/BlockPropsEditor.tsx`.

### Theming en runtime
- El admin guarda colores/tipografías en `settings.theme`.
- `apps/web/src/api.ts` → `applyTheme()` convierte hex → `R G B` y los inyecta en CSS variables (`--c-primary`, `--f-heading`, etc.).
- Tailwind usa esas variables como tokens (`bg-primary`, `text-ink`). **Cambiar color en admin = sitio actualiza al refresh, sin rebuild.**

### Almacenamiento
- **MySQL** para todo el contenido estructurado (médicos, páginas, bloques, settings JSON, etc.).
- **Filesystem** (`api/uploads/`) para imágenes/PDFs, servidos como estáticos por la API y proxied por Nginx en prod.

---

## 4. Cómo correr el proyecto

```bash
pnpm install
cp api/.env.example api/.env        # editar credenciales MySQL
pnpm extract:assets                  # opcional: extrae imágenes de los HTML
pnpm extract:doctors                 # opcional: genera seed de médicos
pnpm db:migrate
pnpm db:seed
pnpm dev                             # api+web+admin en paralelo
```

Para deploy ver [`docs/DEPLOY.md`](docs/DEPLOY.md).

---

## 5. Flujo multi-agente OBLIGATORIO

**Para TODO trabajo en este repo** (features, fixes, refactors, deploys, ajustes de UI) se **debe** usar este flujo de agentes especializados, en orden. No es opcional ni solo para cambios grandes: incluso un cambio chico pasa como mínimo por Desarrollador → Tester. Si trabajás con Claude Code, usar `Agent` con `subagent_type` correspondiente; si trabajás con otra IA, crear un agente/rol por fase.

**Ciclo completo (siempre el mismo, en bucle):**

```
1. Analista   → analiza el requerimiento (solo lectura)
2. Desarrollador → implementa lo analizado
3. Tester     → prueba el desarrollo (build + smoke + funcional)
4. Corrector  → si el Tester reporta error, corrige
   └─ vuelve al paso 3 (re-testear) hasta PASS · máx. 3 ciclos Tester↔Corrector
→ cuando pasa, el siguiente requerimiento vuelve a empezar en el paso 1
```

> Trabajo grande = dividir en olas; **cada ola recorre el ciclo entero** antes de pasar a la siguiente.

### Agente 1 — **Analista** (`Explore` o equivalente read-only)
**Propósito**: entender el pedido, mapear el código actual, identificar archivos a tocar y patrones existentes a reusar.

**Inputs**: la tarea del usuario.
**Outputs** (texto, sin tocar archivos):
- Resumen del pedido en una línea
- Lista de archivos relevantes con rutas exactas y líneas clave
- Patrones existentes que conviene reusar (CRUD genérico, BlockPropsEditor, applyTheme, etc.)
- Riesgos/edge cases detectados
- Lista de tests que se deberían escribir o ejecutar

**Reglas**:
- Solo lectura. NO modifica archivos.
- Debe leer este `AGENTS.md`, `shared/types/blocks.ts`, y la migration init antes de cualquier análisis.
- Si la tarea es ambigua, pide aclaración antes de pasar al siguiente agente.

### Agente 2 — **Desarrollador** (`general-purpose` o equivalente con write)
**Propósito**: implementar la tarea según el análisis del Agente 1.

**Inputs**: el plan del Analista.
**Outputs**: cambios en archivos + lista de tests a correr.

**Reglas obligatorias**:
- Respetar el patrón de bloques (3 pasos si se agrega un bloque nuevo).
- Tipos en `shared/types/` cuando sean compartidos.
- Validar payloads con Zod en endpoints admin nuevos.
- Reusar componentes existentes antes de duplicar: `EntityManager` y `DataTable` (CRUDs de admin), `ConfirmDialog`/`useConfirm` (confirmaciones), `useUnsavedGuard` (aviso de cambios sin guardar), `PhotoUploadField`, `BlockPropsEditor`, `applyTheme`, `crudRouter`.
- **Nunca** romper la firma de un endpoint público sin actualizar el consumer.
- **No** commitear secrets ni archivos de `api/uploads/`.

### Agente 3 — **Tester** (`general-purpose` con permisos de ejecución)
**Propósito**: verificar que lo del Agente 2 funciona end-to-end.

**Pasos mínimos**:
1. `pnpm --filter @sa/api migrate` (si hubo cambios de schema)
2. Build/typecheck: `pnpm --filter @sa/web build` y/o `pnpm --filter @sa/admin build` y/o `tsc -p api/tsconfig.json --noEmit`
3. Levantar API + smoke tests con `curl`:
   - `curl localhost:4000/api/health`
   - `curl localhost:4000/api/public/settings`
   - `curl localhost:4000/api/public/pages/home`
   - Login: `curl -X POST localhost:4000/api/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"admin@sanatorio.local\",\"password\":\"$SEED_ADMIN_PASSWORD\"}"`
   - Endpoint admin tocado, con `Authorization: Bearer <token>`
4. Si la tarea tocó UI: levantar `pnpm dev:web` y/o `pnpm dev:admin`, abrir en browser, verificar el flujo crítico (golden path) y al menos un edge case.
5. Reportar PASS/FAIL por punto, con logs.

**Reglas**:
- Si algo falla, NO arreglar — pasar al Agente 4 con el error completo.
- Si algo pasa pero tiene warnings, reportarlos al Agente 4 igual.

### Agente 4 — **Corrector** (`general-purpose` con write)
**Propósito**: arreglar los fallos reportados por el Tester.

**Reglas**:
- Lee el reporte del Agente 3 + los archivos relacionados (NO repetir todo el trabajo del Analista, asumir su contexto).
- Aplica el mínimo cambio que arregla el fallo. Si encuentra un problema más profundo, lo flagea pero no lo arregla en el mismo loop (crear ticket aparte).
- Después de corregir, **devolver al Agente 3** para re-test.
- Máximo 3 ciclos Tester ↔ Corrector. Si al 3er ciclo sigue fallando, escalar al humano con resumen claro de qué se intentó.

---

## 6. Reglas transversales (todos los agentes)

- **Idioma**: el código en inglés, las strings de UI en español (es-PY).
- **No reformatear** archivos que no se están editando.
- **No agregar dependencias** sin justificar — preferir lo que ya está en `package.json`.
- **No crear archivos .md de planning** salvo que el usuario lo pida explícitamente. Este `AGENTS.md` es la excepción.
- **Branding** (lineamientos Adventist Health, no negociables salvo decisión del cliente):
  - **Primario**: Pantone **7462 C** → `#005587` (navy)
  - **Secundario**: Pantone **311 C** → `#00B5DA` (cyan)
  - Accent `#f5543f` (coral) opcional, cambiable.
- **Tipografía** (también Adventist Health):
  - **Headings**: **Work Sans** (peso `600`/`700`)
  - **Body**: **Open Sans** (peso `400`/`600`)
  - Ambas fuentes se preloadean desde Google Fonts en los `index.html`.
- **Datos sensibles**: nunca hardcodear credenciales. `SEED_ADMIN_PASSWORD` es obligatoria con `NODE_ENV=production`; el deploy genera contraseñas al azar y las deja en un archivo sólo-root. `pnpm check:secrets` corre en CI sobre el árbol.
- **Datos del cliente**: no inventar teléfonos, correos, horarios ni prestaciones. Los canales de contacto viven en `contact_channels` y los horarios en `schedules`; sin valor cargado la UI muestra "A confirmar" / "Horarios en proceso de confirmación".
- **Migraciones**: nuevas tablas o columnas → archivo nuevo en `api/migrations/` con timestamp creciente. NO editar migrations ya aplicadas.

---

## 7. Skills disponibles en este entorno

Si la IA que abre el repo está corriendo en Claude Code con la configuración actual del usuario, dispone de las siguientes **skills** (se invocan con `/<nombre>` o vía la herramienta `Skill`). Usarlas en lugar de reimplementar funcionalidad equivalente.

### Configuración del entorno
| Skill | Cuándo usarla |
|---|---|
| `update-config` | Modificar `settings.json` / `settings.local.json`: permisos, hooks, env vars, comportamientos automáticos ("from now on when X…"). Ejemplos: "allow npm commands", "set DEBUG=true", "when Claude stops show X". |
| `keybindings-help` | Personalizar `~/.claude/keybindings.json` (rebind keys, agregar chords). |
| `fewer-permission-prompts` | Escanea transcripts y arma un allowlist de Bash/MCP read-only en `.claude/settings.json` para reducir prompts. |

### Calidad de código
| Skill | Cuándo usarla |
|---|---|
| `simplify` | Revisar el código que se cambió en busca de reuso, calidad y eficiencia, y arreglar lo que aparezca. **Buen complemento del Agente 4 (Corrector).** |
| `review` | Code review de un pull request. |
| `security-review` | Security review de los cambios pendientes en la branch actual. **Correr antes de cualquier deploy a producción.** |
| `init` | Inicializar un `CLAUDE.md` con documentación del codebase (no necesario acá, ya tenemos `AGENTS.md`). |

### Programación recurrente / loops
| Skill | Cuándo usarla |
|---|---|
| `loop` | Correr un prompt o slash command en intervalo (ej. `/loop 5m /foo`). Para tareas recurrentes o polling de estado. |
| `schedule` / `anthropic-skills:schedule` | Crear/editar/listar agentes remotos programados (cron jobs en la nube). También sirve para runs únicos ("recordame mañana a las 3pm"). |

### Producción de documentos (output deliverables)
| Skill | Cuándo usarla |
|---|---|
| `anthropic-skills:pptx` | Cualquier cosa que toque archivos `.pptx` (crear/leer/editar slides, pitch decks, presentaciones). |
| `anthropic-skills:docx` | Cualquier cosa que toque archivos `.docx` (reportes, memos, cartas, templates en Word). |
| `anthropic-skills:pdf` | Cualquier cosa con PDFs: extraer texto/tablas, merge/split, rotar, watermark, OCR, fill forms, encriptar. |
| `anthropic-skills:xlsx` | Cualquier cosa con spreadsheets (`.xlsx`, `.xlsm`, `.csv`, `.tsv`): leer, editar, agregar fórmulas, limpiar data, generar reportes. |

### Anthropic API / SDK
| Skill | Cuándo usarla |
|---|---|
| `claude-api` | Construir, debuggear u optimizar apps que usan la Claude API / Anthropic SDK. Incluye prompt caching, thinking, tool use, batch, migración entre versiones de modelo. |

### Memoria del agente
| Skill | Cuándo usarla |
|---|---|
| `anthropic-skills:consolidate-memory` | Pasada reflexiva sobre los archivos de memoria del agente: merge de duplicados, fix de hechos viejos, poda del índice. Correr cada tanto si la memoria crece. |
| `anthropic-skills:skill-creator` | Crear skills nuevas, modificar existentes, correr evals/benchmarks, optimizar descripción para mejor triggering. |
| `anthropic-skills:setup-cowork` | Setup guiado de Cowork (plugins por rol, conectar herramientas). |

### Cuándo NO usar una skill
- Tareas triviales que se resuelven con una edición directa.
- Cuando el agente del flujo (Analista/Dev/Tester/Corrector) ya cubre el caso.
- Si el nombre no aparece exacto en este listado o el listado del system-reminder de la sesión actual: NO inventar. Solo invocar skills que estén activas en el entorno.

---

## 8. Estado actual (al 2026-08-13)

### Correcciones post-auditoría (2026-08-13)

- **Seguridad**: se sacaron las credenciales hardcodeadas de
  `scripts/deploy-doctor-photos.py` y `scripts/deploy/setup-vps.sh`. El SSH usa
  `.env.deploy` (fuera de git) con llave o, en el peor caso, contraseña — nunca
  argumentos de línea de comandos. `pnpm check:secrets` corre en CI.
  ⚠️ **El secreto sigue en el historial de git**: el propietario tiene que
  rotarlo y purgarlo (ver §10).
- **Estabilidad de API**: `api/src/http.ts` envuelve los handlers async
  (`wrapRouterAsync`), centraliza los errores sin filtrar internals y devuelve
  503 cuando la base no responde. `/api/health` informa por componente y
  responde 503 con MySQL caído. Apagado controlado en SIGTERM/SIGINT.
- **Formularios públicos**: rate limit por IP, honeypot (`website`), validación
  y saneado con Zod, límites de tamaño y CAPTCHA opcional (`CAPTCHA_PROVIDER`).
- **Fuente única de contacto**: tabla `contact_channels` (panel → *Canales de
  contacto*). Header, footer, Turnos, Contacto y el bloque `contactChannels`
  leen de ahí. Sin valor cargado se muestra "A confirmar" y **no** se genera
  enlace.
- **Horarios**: tabla `schedules` (panel → *Horarios*). Sin filas activas el
  sitio dice "Horarios en proceso de confirmación". No hay horas de ejemplo.
- **Bloques nuevos**: `steps` (infografía de pasos) y `scheduleTable`.
- **Pruebas**: `pnpm test` (vitest) cubre mapa de iconos, filtros de médicos,
  enlaces de canales, saneado de URLs, API con la base caída, rate limiting y
  migraciones (estas últimas con `TEST_DATABASE=1`).
- **Build**: `api` arranca con `dist/src/index.js`; el lockfile es v9 y
  `pnpm install --frozen-lockfile` funciona con el pnpm declarado.

### Base previa (al 2026-08-12)

### Minuta de ajustes del sitio (2026-08-12)

Los 25 puntos acordados con el cliente están implementados. Lo estructural:

- **IA del sitio**: el menú "Especialidades" pasó a ser **Servicios** (con especialidades,
  odontología, estudios por imágenes / cardiológicos / laboratorio / biopsias y preparación
  para estudios adentro). **Pacientes** tiene página propia (`/pacientes`) y su desplegable
  va Información → Portal del paciente → Atención al paciente. El **Portal del paciente**
  quedó unificado en `/portal-paciente`. Se agregaron `/horarios`, `/odontologia` y
  `/privacidad`. **Se eliminó la sección Noticias** del sitio público (rutas, página, links
  del menú, `newsGrid` del registro de bloques y URLs del sitemap); el CRUD de noticias
  sigue en el admin por si se reactiva.
- **Bloques nuevos**: `contactChannels` (WhatsApp/teléfono/email/emergencias diferenciados
  por tipo de atención) y `socialLinks` ("Conócenos en nuestras redes"). Varios bloques
  ganaron props: `heading`/`compact` en las grillas, `category` en `studyGrid`,
  `heading`/`text`/`directionsUrl` en `mapEmbed`, `icon` en items de `cards` y `stats`.
- **Color**: el rojo (accent) quedó **exclusivamente para Emergencias**. "Reservar turno"
  usa `.btn-turno` (cyan `secondary-700`) y Emergencias `.btn-emergency`. El `cta` sin
  `variant` ahora es `primary`, no `accent`.
- **Iconos**: cada especialidad / servicio / estudio tiene el suyo en la DB, con fallback por
  slug en `apps/web/src/lib/icons.ts`. Ojo: `lungs`, `venus` y `flask` **no existen** en
  lucide 0.460 (estaban en uso y no renderizaban nada).
- **Escala de tonos del theming**: `applyTheme` generaba la escala **invertida** respecto de
  `styles.css` y de Tailwind (50 salía oscuro y 900 claro). Corregido en `apps/web/src/api.ts`.
- **Estilos de contenido**: no está el plugin `@tailwindcss/typography`, así que `.prose`
  se define a mano en `styles.css` (listas, links y tablas del contenido cargado por el
  cliente salían sin estilo).
- **Seeds**: `03_pages_and_content.ts` borra páginas y bloques, así que al final **vuelve a
  aplicar las migraciones de contenido** (todas idempotentes) para que una instalación nueva
  quede igual que producción.
- **Pendientes del cliente** (quedan vacíos y la UI los muestra como "a confirmar", se cargan
  desde el admin sin tocar código): números de WhatsApp por tipo de atención, número de
  Emergencias (`contact.emergencyPhone`), correo de GTH (`contact.gthEmail`), horarios
  definitivos y alcance exacto de Biopsias.

### Base previa (al 2026-07-30)

✅ Estructura del monorepo, scripts de extracción, schema MySQL, seeds, API completa (público + admin + auth), frontend público con 19 bloques + páginas dinámicas + buscador de médicos, panel admin completo con page builder DnD, Tiptap, gestor de medios, usuarios.
✅ Documentación de deploy en [`docs/DEPLOY.md`](docs/DEPLOY.md).
✅ **Optimización de imágenes en upload** integrada con `sharp` en `api/src/routes/admin/media.ts` (auto-rotate por EXIF, resize máx 1600px, JPG progresivo mozjpeg q85, strip de metadata).
✅ **SEO**: `sitemap.xml` + `robots.txt` dinámicos desde la DB (`api/src/index.ts`); meta por ruta con react-helmet-async; **prerender estático de `/estudios`** en el build (`apps/web/scripts/prerender.mjs`, parte de `pnpm --filter @sa/web build`) que inyecta la lista agrupada + meta + JSON-LD `ItemList` en `dist/estudios/index.html`, best-effort leyendo la API durante el deploy (servido por Nginx vía `try_files`, sin cambios de infra). La URL base de canonical/sitemap sale de `PUBLIC_SITE_URL` en `api/.env` (hoy apunta a la IP del VPS; cambiar al dominio real cuando esté en producción).
✅ **Panel admin nivelado** (deployado en prod) con componentes reutilizables:
  - `DataTable.tsx` — tabla genérica tipada: búsqueda accent-insensitive, orden por columna, paginación cliente, skeletons de carga, slot de acciones. Usada en `DoctorsListPage`.
  - `EntityManager.tsx` — CRUD reutilizable con búsqueda + reordenamiento drag-and-drop (dnd-kit) que persiste `order`. Reemplazó al viejo `SimpleCrud` (eliminado) en Especialidades / Servicios / Estudios.
  - `ConfirmDialog.tsx` + hook `useConfirm()` — modal de confirmación; reemplazó todos los `confirm()` nativos.
  - `useUnsavedGuard.ts` — aviso de cambios sin guardar (React Router `useBlocker` + `beforeunload`); en `DoctorEditPage`, `PageBuilderPage`, `SettingsPage`. Requirió migrar el router del admin a **data router** (`createBrowserRouter` + `RouterProvider`).
  - `lib/csv.ts` — `downloadCsv()` con escaping RFC4180 + BOM UTF-8 para Excel. Usado en Turnos y Mensajes.
  - Turnos / Mensajes: filtros por estado + rango de fecha, "marcar leído", export CSV. Badges de pendientes/no leídos en el sidebar.
  - Sidebar agrupado (Inicio / Contenido / Operación / Sistema) y Dashboard con stats, actividad reciente y accesos rápidos.
  - Toggle publicar/despublicar inline en `PagesListPage` y `NewsListPage`.
  - `LucideIcon.tsx` — renderiza iconos [lucide](https://lucide.dev/icons/) por nombre kebab-case (`heart-pulse`). Usa `lucide-react/dynamicIconImports` + `React.lazy` + `Suspense` (⚠️ en lucide-react 0.460 **no existe** el subpath `lucide-react/dynamic`). `isIconName()` valida antes de renderizar. El helper `IconBadge` de `EntityManager` muestra el icono si el valor es un nombre lucide válido, y si no cae al emoji tal cual — antes el nombre se imprimía como texto crudo y se superponía a los títulos.

🔲 Tests automatizados (no hay; los agentes hacen smoke testing manual por ahora).
🔲 Contenido real seed (las imágenes y los textos definitivos los carga el cliente desde el admin).
🔲 `PUBLIC_SITE_URL` en el `api/.env` de producción todavía apunta a la **IP del VPS**, así que el `sitemap.xml` y todos los canonical usan la IP en vez del dominio. Cambiarlo cuando el DNS + HTTPS estén confirmados (requiere decisión del dueño del proyecto, no cambiarlo a ciegas).

---

## 9. Operación en producción (runbook)

### Dónde vive

| Qué | Dónde |
|---|---|
| Repo | `https://github.com/DaltonP93/WEB_SAA.git`, rama única **`main`** |
| VPS | `194.26.100.138` (Ubuntu, usuario `root`) — **compartido con otro proyecto** (existe un `/swapfile_futbot`) |
| Código en el VPS | `/var/www/sanatorio` |
| Config de la API | `/var/www/sanatorio/api/.env` (**fuera de git**, nunca commitear) |
| Proceso | PM2, nombre **`sanatorio-api`**, entry `api/dist/src/index.js`, `--cwd /var/www/sanatorio/api` (necesario para que dotenv encuentre el `.env`) |
| Reverse proxy | Nginx: `/api/`, `/uploads/`, `/robots.txt`, `/sitemap.xml` → `127.0.0.1:4000`; el resto sirve estáticos |

Nginx sirve `apps/web/dist` en `/` (con `try_files $uri $uri/ /index.html`) y `apps/admin/dist` en `/admin`. **Consecuencia importante:** si la API se cae, el sitio sigue devolviendo 200 pero sin nada de contenido dinámico — un check de "la home carga" NO alcanza para saber si producción está sana. Siempre verificar `/api/health`.

### Deploy

```bash
# Las credenciales salen de .env.deploy / variables de entorno, nunca de argv
python scripts/deploy/run-remote.py "bash /var/www/sanatorio/scripts/deploy/update-vps.sh"
```

`update-vps.sh` hace: `git reset --hard origin/main` → **se re-ejecuta a sí mismo si el propio script cambió** → `pnpm install --frozen-lockfile` → `pnpm db:migrate` → builds → reload de Nginx + restart de PM2.

⚠️ Por ese re-exec, **el primer deploy que modifica `update-vps.sh` corre con la versión vieja del script**. Si el cambio del deploy es el que querés probar, hay que deployar dos veces.

⚠️ `--frozen-lockfile` implica que **todo cambio de dependencia debe llevar el `pnpm-lock.yaml` commiteado**, o el deploy falla.

### Verificación post-deploy

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<IP>/api/health   # debe dar 200
for p in settings menus services specialties pages/home studies; do
  curl -s -o /dev/null -w "$p %{http_code}\n" "http://<IP>/api/public/$p"
done
```

### Si la API devuelve 502

```bash
pm2 list                      # ¿está 'sanatorio-api' online?
pm2 logs sanatorio-api --lines 50 --nostream
cd /var/www/sanatorio/api && pm2 start dist/src/index.js \
  --name sanatorio-api --time --cwd /var/www/sanatorio/api && pm2 save
```

**Incidente 2026-07: la API estuvo ~19 días caída.** `pm2 jlist` devolvía `[]` — no era un crash-loop, el daemon de PM2 había perdido la lista de procesos entera, sin reboot del VPS (uptime 19 días) y sin OOM en syslog. Hipótesis: el daemon murió por presión de memoria durante un build (el VPS tiene **1.9 GB de RAM y el swap ya estaba a ~666 MB usados**; `vite build` es voraz). Dos mitigaciones aplicadas:

1. `pm2 save` — lista de procesos congelada en `/root/.pm2/dump.pm2`.
2. `pm2 startup systemd -u root --hp /root` — creó y habilitó `pm2-root.service`, que **no existía**. Sin eso, cualquier reboot dejaba la API caída de forma permanente.

Si se repite, la solución de fondo es buildear fuera del VPS (subir artefactos) o ampliar la RAM.

### Ruido esperado en los logs

- `GET /api/vendor/phpunit/.../eval-stdin.php 404` — escaneo de bots buscando vulnerabilidades PHP. Inofensivo, la API los rechaza.
- `/estudios` responde **301** hacia `/estudios/`: es el comportamiento de directory-index de Nginx sobre el HTML prerenderizado. Por eso el canonical del prerender apunta a `/estudios/` **con** barra final.

---

## 10. Acciones pendientes del propietario (seguridad)

El árbol actual ya no tiene credenciales, pero **el historial de git sí**: la
contraseña del VPS estuvo commiteada en `scripts/deploy-doctor-photos.py` y en
`scripts/deploy/setup-vps.sh`. Reescribir el historial remoto es una decisión
del dueño del repo, así que no se hizo desde acá. Hay que:

1. **Rotar la contraseña de root del VPS** (y cualquier otra cuenta que la haya
   reutilizado). Hasta que eso pase, hay que considerarla comprometida.
2. **Revisar accesos SSH**: `last -F`, `/var/log/auth.log`, y las claves en
   `~/.ssh/authorized_keys` de root y de cualquier otro usuario.
3. **Deshabilitar el acceso por contraseña**: en `/etc/ssh/sshd_config`,
   `PasswordAuthentication no` y `PermitRootLogin prohibit-password`, después
   `systemctl restart ssh`. Antes, dejar cargada la llave pública del equipo.
4. **Purgar el secreto del historial** de forma coordinada (todos con el repo
   clonado tienen que re-clonar después):
   `git filter-repo --replace-text` o BFG, luego `push --force` y rotar
   nuevamente la credencial por las dudas.
5. **Revisar clones, forks y logs** (CI, capturas, historiales de shell) donde
   la contraseña haya quedado registrada.

Mientras 1–5 estén pendientes, el proyecto **no puede recibir un GO** para
producción por más que el código esté limpio.
