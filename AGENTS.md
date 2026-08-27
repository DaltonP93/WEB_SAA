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

**Credenciales seed**: el usuario administrador se siembra con el correo de
`SEED_ADMIN_EMAIL` y la contraseña de `SEED_ADMIN_PASSWORD`, ambas variables de
entorno. **Este archivo no publica ninguna credencial literal**, ni siquiera de
desarrollo: `tests/docs-sin-credenciales.test.ts` falla si vuelve a aparecer una.

- **Local**: definilas en `api/.env` antes de `pnpm db:seed` (ver `api/.env.example`).
- **Producción**: `SEED_ADMIN_PASSWORD` es obligatoria con `NODE_ENV=production`.
  El deploy la genera al azar y la deja en `${APP_DIR}/.deploy-credentials`, sólo
  legible por root, y únicamente cuando el seed realmente corrió
  (ver `scripts/deploy/prepare-env.sh`).

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
- **Zona horaria**: toda fecha que el sanatorio elige o filtra es hora de
  **`America/Asuncion`**, no la zona del proceso. La fuente única está en
  `api/src/timezone.ts` (y su par de presentación en
  `apps/admin/src/lib/fecha.ts`). Nunca `new Date(valorDeUnDatetimeLocal)`: eso
  lo interpreta con la zona del VPS y guarda una hora plausible y equivocada.
  Tampoco un offset fijo `-03:00`: la zona IANA es la que sabe de las reglas
  que cambiaron y de las que van a cambiar.
- **Logs**: nunca se registra un objeto de error entero ni `req.originalUrl`
  completo. Se pasa por `api/src/log-seguro.ts`, que conserva método, ruta y los
  **nombres** de los parámetros de query, y descarta los valores. De un error de
  base se registran nombre, código y dónde ocurrió — nunca `message`, `sql`,
  `sqlMessage` ni los bindings: cuando una consulta falla, mysql2 adjunta la
  sentencia **con los valores ya sustituidos**, y ahí van el nombre, el teléfono
  y el correo del paciente. La información personal sólo aparece dentro del
  panel autenticado, y un log no es eso.
- **Archivos subidos**: nada se escribe en el directorio que sirve `/uploads`
  antes de estar validado. Ver el pipeline de Multimedia más abajo.

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
- **Migraciones y Node**: `pnpm db:migrate` / `db:seed` corren knex **a través de
  `tsx`**. Antes dependían de que Node supiera cargar `.ts` por su cuenta (sólo
  Node ≥22.18), y en Node 20 fallaban con `Unknown file extension ".ts"`. La
  prueba de migraciones usa un `migrationSource` propio armado con
  `import.meta.glob` por el mismo motivo.

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
  Emergencias, correo de GTH, horarios definitivos y alcance exacto de Biopsias.
  **Todos viven en `contact_channels`** (filas `emergencias`, `whatsapp-turnos`,
  `whatsapp-estudios`, `whatsapp-general`, `whatsapp-samap`, `recepcion`,
  `email-general`, `gth`) y los horarios en `schedules`. `contact.emergencyPhone` y
  `contact.gthEmail` **ya no existen**: son campos retirados y la API los rechaza
  con 410. Guía paso a paso en [`docs/CARGA-DE-DATOS.md`](docs/CARGA-DE-DATOS.md).

### Base previa (al 2026-07-30)

✅ Estructura del monorepo, scripts de extracción, schema MySQL, seeds, API completa (público + admin + auth), frontend público con 19 bloques + páginas dinámicas + buscador de médicos, panel admin completo con page builder DnD, Tiptap, gestor de medios, usuarios.
✅ Documentación de deploy en [`docs/DEPLOY.md`](docs/DEPLOY.md).
✅ **Pipeline de Multimedia** con contrato explícito: `api/src/imagenes.ts` decide y `api/src/routes/admin/media.ts` orquesta.
  - **Staging primero.** El archivo aterriza en un directorio **hermano** de `UPLOAD_DIR` (`UPLOAD_STAGING_DIR`), que `/uploads` no sirve; recién se mueve al público con un `rename` atómico cuando ya se validó el contenido, se procesó, se verificó el resultado y se eligió el nombre. Staging se limpia siempre —éxito, rechazo, error de Sharp, error de base o petición cortada— y hay un barrido de huérfanos al arrancar.
  - **El formato lo dicen los bytes**, no `originalname` ni `file.mimetype`: firma del archivo + lo que decodifica libvips, y si no coinciden se rechaza.
  - **Cada formato sale como sí mismo.** JPEG→`.jpg`; PNG conserva alpha; WebP conserva alpha **y** animación; GIF conserva todos los cuadros; el PDF se valida por firma y **no pasa por libvips**. Bytes, extensión y MIME cambian juntos o no cambia ninguno: no puede existir un `.gif` con contenido JPEG.
  - **Nombres `crypto.randomUUID()`**: no colisionan y no filtran cómo se llamaba el archivo en la computadora de nadie.
  - **Límites**: peso (`MAX_UPLOAD_MB`), techo de píxeles decodificados vía `limitInputPixels`, guarda contra descompresión desproporcionada, mínimo por lado **y** por área — un logo de 400×80 se acepta, un 1×1 no. Resize sólo hacia abajo (`withoutEnlargement`), EXIF descartado.
  - **Nada queda a medias**: si el INSERT falla se borra el archivo público; si no se puede escribir, no queda fila.
  - **SVG saneado y aceptado** (`api/src/svg.ts`): allowlist de elementos y atributos con `sanitize-html`; se descartan `script`, `style`, `foreignObject`, `image`, `use`, `a`, las animaciones SMIL, todo `on*` y cualquier `url()` que no apunte al propio documento. `<!DOCTYPE`, `<!ENTITY` (XXE) y `<?xml-stylesheet?>` **rechazan el archivo** en vez de limpiarse. Una etiqueta peligrosa escrita en una grafía que no es la suya (`<SCRIPT>`) también: en SVG los nombres distinguen mayúsculas, así que no es un descuido de formato. Se guardan **los bytes saneados**, nunca el original. Las dimensiones se leen del texto, sin rasterizar con librsvg. Defensa de fondo: la CSP de la API es `default-src 'none'`.
  - **PDF validado estructuralmente y saneado** con `pdf-lib`: se exige un catálogo legible y al menos una página, no los cinco bytes de `%PDF-`; y se le quitan `/OpenAction`, `/AA`, `/AcroForm`, `/Names`, `/JavaScript`, `/EmbeddedFiles` y las anotaciones. El documento se **reconstruye** con `copyPages` —borrar la referencia deja el objeto huérfano escrito en el archivo— y el corte se hace sobre el origen **antes** de copiar. **Lo que no afirma**: no inspecciona los flujos de contenido de cada página; no es una desinfección demostrable. Los PDFs siguen sin aparecer en los selectores de imágenes.
  - **La animación se conserva entera**: cuadros, transparencia, `delay` por cuadro y `loop`. Sharp 0.35.3 los arrastra solo, pero se pasan explícitos porque esa conservación no está en su contrato público.
  - **La configuración de staging se comprueba al arrancar** (`api/src/staging.ts`): staging no puede ser `UPLOAD_DIR`, estar dentro de él ni en otro sistema de archivos. Una configuración insegura no deja arrancar, en vez de dejar el contrato sin cumplir en silencio.
  - **No se borra un archivo referenciado**: se responde 409 diciendo dónde está usado y cuántas veces —bloques (`blocks.props`), `settings.brand.logoUrl`, `settings.seo.ogImage`, `doctors.photo_url`— sin publicar el contenido institucional.
✅ **Confirmaciones escritas del sanatorio** (`api/src/routes/admin/data_confirmations.ts`): el lugar donde queda constancia de que una persona con autoridad afirmó algo que el código no puede deducir. Hoy el único ítem es **Biopsias**. `data_readiness.ts` lee esa confirmación para decidir el estado: **nunca** lo deduce del contenido de la página — que el texto sea largo o ya no diga "a confirmar" no significa que el alcance esté confirmado. `scope` obligatorio (qué se confirma), `confirmedAt` lo pone el servidor, confirmar y retirar exigen `superadmin`, leer no. Vive en `settings` con una clave **fuera** de `ADMIN_SETTING_KEYS`, así que el editor genérico de Configuración no la alcanza. Una fila ilegible no cuenta como confirmación. **Se opera desde el panel**, en *Datos pendientes* → *Alcance de Biopsias*: el formulario aparece sólo para superadmin, y la sección informa `confirmable` para distinguir "falta confirmar" de "todavía no hay nada que confirmar" (sin ese campo el panel ofrecería confirmar una página inexistente, guardaría con éxito y el estado no cambiaría).
✅ **El panel sabe quién entró** (`apps/admin/src/hooks/useSesion.ts`): lee `GET /auth/me` y expone id y rol. Hasta ahora ninguna pantalla lo consultaba, así que todas dibujaban lo mismo para un editor y para un superadmin — se ofrecían acciones que el servidor iba a rechazar con 403, y la lista de usuarios no podía evitar ofrecerte borrarte a vos mismo. **No es una autorización**: lo que decide sigue siendo `requireRole` en la API. Sólo evita ofrecer lo que no se va a poder hacer. Se consulta contra el servidor y no se decodifica del token, porque el rol de una sesión abierta puede haber cambiado desde que se emitió.
✅ **Usuarios blindado** (`api/src/routes/admin/users.ts`): no se puede borrar **ni bajarle el rol** al último superadmin — se cuenta cuántos quedarían *después* de la operación, porque sin ninguno nadie puede volver a administrar usuarios desde el panel. `safeParse` → **400** con los campos que fallan (un `parse()` salía como 500 "error interno" y quien escribió mal el email no sabía qué corregir); email repetido → **409**; `PUT` a un id inexistente → **404** en vez de un éxito vacío; `update({})` no genera SQL inválido. `password_hash` no sale nunca en ninguna respuesta.
✅ **Analítica, consentimiento y atribución (marketing, ronda 1)**:
  - **Consentimiento primero** (`apps/web/src/lib/consent.ts` + `ConsentBanner`): ninguna medición de terceros carga hasta que el visitante acepta. Decisión versionada en `localStorage`; "Rechazar" con el mismo peso que "Aceptar" (sin patrón oscuro). `null` (no decidió) ≠ `false` (rechazó).
  - **Medición por identificadores, no por JS pegado** (`api/src/marketing.ts`, clave `analytics`): GA4, GTM y Meta Pixel se configuran con su **ID**, validado por formato (`G-…`, `GTM-…`, dígitos); vacío = apagado. Es el "módulo propio" que prometía el mensaje de la clave retirada `scripts`. El loader (`apps/web/src/lib/analytics.ts`) inyecta el SDK oficial sólo si hay ID **y** consentimiento; es idempotente y revalida el ID antes de ponerlo en un `src`.
  - **Atribución de conversiones** (`apps/web/src/lib/attribution.ts` + columna `attribution` en `appointments` y `contact_messages`): captura `utm_*`/`gclid`/`fbclid` en la primera vista (first-touch de sesión) y los adjunta al turno o mensaje. Es dato de primera parte —no requiere consentimiento— saneado por allowlist en la API, mostrado en la bandeja y el CSV, y **nunca** en logs.
  - **CSP**: `script-src`/`connect-src` ya incluyen los hosts de Google (GA4/GTM) y Meta, en las **dos** CSP del sitio —Nginx (`setup-vps.sh`) y la `<meta>` de `apps/web/index.html`—, mantenidas en sincronía por `tests/analytics-csp.test.ts`. No cargan nada por sí mismos: sin ID configurado no hay script que los use. `default-src`/`object-src` siguen cerrados.
✅ **Backlog desarrollable (sin producción)** — cinco mejoras administrables, cada una con migración reversible + pruebas + corrector:
  - **Verificación de propiedad** (`api/src/seo.ts`, clave `seo.verification`): tokens de Search Console / Bing validados por forma; el front dibuja el `<meta>` sólo si hay token. Una fila con token roto se descarta al salir (nunca llega al `content`).
  - **Redirects 301 administrables** (`api/src/redirects.ts` + tabla `redirects`): las rutas viejas salen del código a una tabla editable; middleware con caché en memoria (no consulta la base por request), garantía dura contra *open redirect* (destino siempre interno), y las cuatro legacy del portal quedan sembradas. `legacy-redirects.ts` queda como su definición canónica.
  - **Papelera + publicación programada** (`deleted_at`/`publish_at` en `pages`): borrado recuperable con borrado definitivo aparte, y `publish_at` que oculta una página publicada hasta su fecha (`publish_at <= NOW()`, sin cron). El criterio de "página pública" vive en `api/src/pages-visibilidad.ts` y lo comparten lista, detalle y sitemap.
  - **Historial de versiones** (tabla `page_revisions`): cada guardado de bloques archiva una foto (título, estado, SEO, bloques + autor), podada a las últimas 30; restaurar aplica una versión y archiva otra (reversible). El `slug` no se restaura (identidad/URL).
  - **Newsletter propia** (tabla `newsletter_subscribers` + bloque `newsletter`): captura de correos sin proveedor externo —honeypot + rate-limit, idempotente, atribución saneada—, con bandeja y export CSV en el panel; el bloque se coloca donde el editor quiera.
✅ **SEO**: `sitemap.xml` + `robots.txt` dinámicos desde la DB (`api/src/index.ts`); meta por ruta con react-helmet-async; **prerender estático de `/estudios`** en el build (`apps/web/scripts/prerender.mjs`, parte de `pnpm --filter @sa/web build`) que inyecta la lista agrupada + meta + JSON-LD `ItemList` en `dist/estudios/index.html`, best-effort leyendo la API durante el deploy (servido por Nginx vía `try_files`, sin cambios de infra). La URL base de canonical/sitemap sale de `PUBLIC_SITE_URL` en `api/.env` (hoy apunta a la IP del VPS; cambiar al dominio real cuando esté en producción).
✅ **Panel admin nivelado** (deployado en prod) con componentes reutilizables:
  - `DataTable.tsx` — tabla genérica tipada: búsqueda accent-insensitive, orden por columna, paginación cliente, skeletons de carga, slot de acciones. Usada en `DoctorsListPage`.
  - `EntityManager.tsx` — CRUD reutilizable con búsqueda + reordenamiento drag-and-drop (dnd-kit) que persiste `order`. Reemplazó al viejo `SimpleCrud` (eliminado) en Especialidades / Servicios / Estudios.
  - `ConfirmDialog.tsx` + hook `useConfirm()` — modal de confirmación; reemplazó todos los `confirm()` nativos.
  - `useUnsavedGuard.ts` — aviso de cambios sin guardar (React Router `useBlocker` + `beforeunload`); en `DoctorEditPage`, `PageBuilderPage`, `SettingsPage`. Requirió migrar el router del admin a **data router** (`createBrowserRouter` + `RouterProvider`).
  - `lib/csv.ts` — `downloadCsv()` con escaping RFC4180 + BOM UTF-8 para Excel. Usado en Turnos y Mensajes.
  - **Turnos** (`AppointmentsPage`): bandeja de las solicitudes que llegan del
    sitio. Búsqueda, orden, filtros de estado y fecha y paginación los resuelve
    **el servidor** (`GET /api/admin/appointments`), no el navegador: la tabla
    crece sin techo y recortar sobre la página recibida hacía que una solicitud
    más allá de la fila 200 no apareciera al buscarla. La exportación pide su
    propio archivo completo a `/export`. Badge de pendientes en el sidebar y
    tarjeta en el Dashboard, los dos leyendo el `total` del servidor.
  - Mensajes: filtros por estado + rango de fecha, "marcar leído", export CSV. Badge de no leídos en el sidebar.
  - Sidebar agrupado (Inicio / Contenido / Operación / Sistema) y Dashboard con stats, actividad reciente y accesos rápidos.
  - Toggle publicar/despublicar inline en `PagesListPage` y `NewsListPage`.
  - `LucideIcon.tsx` — renderiza iconos [lucide](https://lucide.dev/icons/) por nombre kebab-case (`heart-pulse`). Usa `lucide-react/dynamicIconImports` + `React.lazy` + `Suspense` (⚠️ en lucide-react 0.460 **no existe** el subpath `lucide-react/dynamic`). `isIconName()` valida antes de renderizar. El helper `IconBadge` de `EntityManager` muestra el icono si el valor es un nombre lucide válido, y si no cae al emoji tal cual — antes el nombre se imprimía como texto crudo y se superponía a los títulos.

✅ **Tests automatizados**: `pnpm test` (vitest) — **1467 pruebas en 76 archivos**
tras el backlog desarrollable (verificación Search Console, redirects 301
administrables, papelera + publicación programada, historial de versiones y
captura de newsletter), sobre la reconciliación de SVG/PDF+Biopsias+Usuarios y
marketing (**1413 en 69**). Las que necesitan base real se activan con
`TEST_DATABASE=1` y se saltan solas si no está. CI corre la suite completa contra
MySQL 8. El smoke testing manual del Agente 3 **complementa** la suite, no la
reemplaza: lo que se puede afirmar con una prueba, se afirma con una prueba.
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

`update-vps.sh` hace: copia de sí mismo a `/tmp` → `git reset --hard origin/main` → **se re-ejecuta si el propio script cambió en el pull** → `pnpm install --frozen-lockfile` → `pnpm db:migrate` → builds → reload de Nginx + restart de PM2 → health check.

**Sólo va hacia adelante.** Si se le pasa `ROLLBACK_TO` aborta con **código 2** antes de tocar nada y remite a `rollback-vps.sh` (ver abajo). Aceptarlo hacía `git reset --hard` a la versión vieja *antes* de mirar la base, y eso deja `knex_migrations` con migraciones aplicadas cuyo archivo ya no existe: knex no las puede revertir.

**Sobre el re-exec** (corregido en la ronda 8): el script corre desde una copia en `/tmp` y compara esa copia contra el archivo del árbol *después* del reset. Antes comparaba `$0` contra `$SELF`, que tras el reset son el mismo archivo ya actualizado — los hashes daban iguales siempre y **la re-ejecución no ocurría nunca**, así que un arreglo del script se aplicaba recién en el deploy siguiente. Ya no: el arreglo entra en el mismo deploy que lo trae. La re-ejecución es **una sola**, garantizada por `DEPLOY_REEXEC=1`, y ocurre **entre el paso 1 y el paso 2** — o sea que lo único que se repite es el `git fetch` + `reset` (un no-op la segunda vez). **El `pnpm install` y los tres builds corren una sola vez**, lo cual importa en este VPS: tiene 1.9 GB de RAM y ya hubo un incidente en que `vite build` tumbó el daemon de PM2.

⚠️ `--frozen-lockfile` implica que **todo cambio de dependencia debe llevar el `pnpm-lock.yaml` commiteado**, o el deploy falla.

### Rollback

**`update-vps.sh` no hace rollback.** El único camino es:

```bash
ROLLBACK_TO=<sha-anterior> bash /var/www/sanatorio/scripts/deploy/rollback-vps.sh
```

El orden es al revés de lo que parece: **primero se revierten las migraciones, con el código nuevo todavía en disco, y recién después se baja el árbol** — knex necesita el archivo de la migración para poder revertirla, y el `down()` que hace falta es el de la versión nueva. Detalle completo en [`docs/DEPLOY.md`](docs/DEPLOY.md#rollback).

El script prevalida la versión destino en un `git worktree` aparte antes de tocar la base, y si algo falla *después* de revertirla, recupera el estado anterior (restaura el backup, vuelve al SHA que estaba, reconstruye y reinicia).

| Código | Significado |
|---|---|
| 0 | Rollback completo y la aplicación responde |
| 1 | Error de uso o de una etapa previa (nada se tocó) |
| 2 | La versión destino no pasó la prevalidación (nada se tocó) |
| 4 | Se abortó y la base quedó como antes; el código NO se bajó |
| 5 | La base quedó en un estado intermedio y no se pudo restaurar |
| 6 | El rollback se aplicó pero el health check no dio 200 |
| 7 | Falló una etapa posterior a la base y se recuperó el estado anterior |
| 8 | Falló una etapa posterior a la base y la recuperación quedó incompleta |

Si la base se **sembró después** de migrar, el `down()` no restaura nada y hay que ir por dump: `RESTORE_DUMP=<archivo.sql.gz>`. `rollback-guard.mjs` lo detecta y bloquea el camino equivocado.

`SKIP_PREVALIDACION=1` omite el worktree del paso 1 (menos disco y tiempo, pero un build roto se descubre con la base ya revertida). Ver el riesgo de memoria del VPS más abajo.

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
