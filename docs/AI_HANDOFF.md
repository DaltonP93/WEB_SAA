# AI handoff — WEB_SAA

> **Actualizado:** 2026-09-01  
> **Baseline confirmado:** `main@a4cccc1a3e36cae4fbb40b149f8809de0eac7b2a`  
> **Regla de lectura:** este es el resumen operativo. Antes de modificar algo, leer también `AGENTS.md`, `CLAUDE.md`, `docs/ESTADO-PROYECTO.md` y, si la tarea afecta despliegue, `docs/DEPLOY.md`. Si hay contradicción, priorizar `AGENTS.md` y validar contra el código actual.

## Propósito del producto

WEB_SAA es el sitio institucional y el CMS/panel administrativo paramétrico del **Sanatorio Adventista de Asunción** (Paraguay). El objetivo es que el contenido, los médicos, especialidades, horarios, canales de contacto, páginas y diseño se administren sin depender de cambios de código.

El alcance confirmado es:

- sitio público institucional;
- panel administrativo protegido;
- constructor de páginas mediante bloques ordenados;
- gestión de contenido, médicos, especialidades, medios, formularios y configuraciones;
- despliegue versionado del monorepo.

No inventar contactos, horarios, prestaciones ni datos del sanatorio. La integración de campañas, newsletter, CRM o cuentas publicitarias es una decisión posterior y requiere credenciales, autorización y un alcance explícito.

## Arquitectura confirmada

| Área | Tecnología / responsabilidad |
| --- | --- |
| API | Node 20, Express, TypeScript, Knex y MySQL 8; JWT, rutas públicas y administrativas |
| Sitio público | React 18, Vite, Tailwind y TanStack Query |
| Admin | React 18, Vite, Tailwind, dnd-kit y Tiptap |
| Tipos compartidos | `shared/types/`; `blocks.ts` define los tipos y props de bloques |
| Datos | MySQL para contenido estructurado; uploads gestionados por la API |
| Operación | pnpm workspaces; documentación de despliegue en `docs/DEPLOY.md` |

El sitio público es una SPA estática; la API sirve `/api/`, `/uploads/`, `/robots.txt` y `/sitemap.xml`. La ruta `/estudios` tiene prerender estático.

### Contratos que no se deben romper

- Un bloque nuevo exige tres cambios coordinados: registro y tipos en `shared/types/blocks.ts`, componente público y schema/editor del admin.
- El tema se aplica desde `settings.theme` y variables CSS; no duplicar colores en componentes sin necesidad.
- Los datos de contacto y horarios tienen tablas fuente de verdad; no hardcodearlos.
- Toda fecha elegida o filtrada por el sanatorio usa `America/Asuncion`; no usar offsets fijos ni conversiones implícitas.
- La carga multimedia pasa por staging, validación real del contenido y publicación atómica. No convertirla en un upload directo.
- Los logs deben pasar por el mecanismo seguro del proyecto y nunca exponer PII, URL completas con valores, SQL o secretos.
- No editar migraciones ya aplicadas; crear una nueva migración incremental cuando corresponda.

## Estado confirmado al 2026-09-01

- `main` está en `a4cccc1` (merge del PR #28, "docs: add AI handoff"). Los commits
  recientes incluyen el logo institucional navy monocromo ("Logo 4"), una
  corrección de CSP y una automatización que actualiza el VPS al seguir
  `origin/main`.
- Esa automatización vuelve sensible cualquier cambio fusionado: no asumir que un
  merge está autorizado para producción; confirmar el flujo real, los controles y
  la aprobación del responsable antes de desplegar. Desde el repositorio sólo se
  puede confirmar que el mecanismo **existe** (`scripts/deploy/auto-deploy.sh` +
  unidades systemd descritas en `AGENTS.md §9`); no que esté activo en el VPS.
- Al 2026-09-02 hay **un PR Draft abierto**: [#29 `fix/brand-rollback-idempotente`],
  base `a4cccc1`, dedicado a corregir el CI rojo del rollback de marca (detalle abajo).
  No hay otros PRs abiertos. (Corrige una contradicción de una versión previa de
  este archivo, que decía "no se observaron PRs abiertos" mientras el PR #29 ya
  estaba en curso.)
- **CI rojo en el HEAD (`a4cccc1`)**: el job "Typecheck, build y pruebas" falló en
  `tests/migrations.test.ts > … el rollback devuelve exactamente el estado
  anterior`. Typecheck y los tres builds pasaron; el fallo está en el rollback de
  migraciones. "Detección de secretos" y "Auditoría de dependencias" quedaron en
  verde.
- **Causa raíz:** `20260827000000_brand_logo` y `20260828000000_brand_favicon`
  **crean** la fila `settings.brand` cuando no existe, pero su `down()` original
  sólo la vaciaba (nunca la borraba). Sobre una base migrada sin sembrar, el
  rollback dejaba un residuo `{ logoUrl:"", faviconUrl:"" }` que el snapshot de la
  prueba detecta. Reproducido 3/3 de forma determinística.
- **Primera solución descartada (heurística de contenido).** Un intento previo del
  PR #29 agregó una migración posterior que borraba la fila si su contenido
  "parecía" autogenerado (claves ⊆ `logoUrl`/`faviconUrl` con los valores por
  defecto). Se **descartó**: una coincidencia de contenido no prueba procedencia.
  Una fila legítima, preexistente, con exactamente
  `{ logoUrl:"/logo-sanatorio.png", faviconUrl:"/favicon.png" }` es indistinguible
  por contenido de una autogenerada, y la heurística la habría borrado (verificado
  de forma reproducible contra `672ae96`). Esa migración se eliminó del PR.
- **Solución vigente (por snapshot, excepción autorizada).** Bajo una autorización
  explícita y acotada del propietario para editar **sólo** esas dos migraciones ya
  fusionadas, cada una ahora registra un **snapshot interno de procedencia** antes
  de tocar la base (`snapshot_brand_logo_20260827000000` /
  `snapshot_brand_favicon_20260828000000`, prefijo `snapshot_`: no publicado ni
  editable desde el CMS). El snapshot guarda si la fila existía, si la propiedad
  existía, su valor anterior exacto (distinguiendo ausente / `null` / `""` /
  default / personalizado) y si la migración realmente aplicó un cambio. El
  `down()` restaura a partir del snapshot —no del contenido— así que preserva una
  fila preexistente idéntica a los defaults y cualquier edición posterior del
  cliente; el `down()` del logo elimina la fila sólo si el snapshot demuestra que
  no existía y ya no queda ninguna propiedad. **Fail-closed:** en una base migrada
  **antes** de esta corrección el snapshot no existe y `down()` **aborta sin tocar
  datos**, remitiendo a restaurar un backup verificado o a un procedimiento manual
  autorizado; no hay fallback heurístico. Pruebas en
  `tests/migrations-brand-rollback.test.ts` (incluye la regresión que falla contra
  `672ae96` y pasa sólo con snapshots).
- **Segunda auditoría (sobre `bc2439a`) — endurecimiento.** La auditoría halló dos
  defectos: el lector de snapshot era laxo (aceptaba un objeto parcial y hacía cast,
  así un snapshot forjado podía borrar una fila legítima) y `up()` no validaba un
  snapshot preexistente corrupto (lo conservaba pero igual modificaba `brand`). Se
  corrigió con **validación estricta de estructura cerrada + coherencia** por
  migración (nunca un cast tras validar sólo algunos campos), `up()` que **lanza**
  ante un snapshot preexistente inválido y es **no-op idempotente** si es válido, y
  un **preflight de rollback** (`scripts/deploy/brand-snapshot-preflight.mjs`,
  invocado por `rollback-db.sh` tras calcular `PENDIENTES` y antes del primer
  `migrate:down`) que aborta un rollback múltiple **antes** de revertir nada si
  cruza favicon/logo sin snapshot válido (no se salta con
  `ROLLBACK_ALLOW_AFTER_SEED`; pide un backup **anterior** a esas migraciones).
  Pruebas: `tests/migrations-brand-rollback-strict.test.ts` (27) y
  `tests/rollback-brand-preflight.test.ts` (8) + 2 casos bash end-to-end.
- **Producción sigue en NO-GO** por los bloqueantes externos de
  `docs/ESTADO-PROYECTO.md` (secreto histórico, protección de `main`, dominio/DNS/
  TLS, backups/restore, monitoreo y contenido). Esta corrección no los altera.
- `docs/ESTADO-PROYECTO.md` mantiene la evaluación histórica más detallada; su
  baseline previo (`fd49743a`/`7eb570c`) no coincide con el HEAD actual, así que
  sus conteos de CI no valen como evidencia del HEAD hasta revalidar.
- **Desarrollo en curso (apilado sobre el PR #29):** rama `feat/admin-audit-log`
  —primer incremento seguro del módulo de seguridad/roles: **trazabilidad de
  acciones administrativas** (tabla `admin_audit_log`, emisor best-effort
  `api/src/audit.ts`, enganches en CRUD/páginas/usuarios/login, endpoint
  `GET /api/admin/audit` solo-superadmin + página en el panel). No cambia la
  autorización actual; los permisos granulares (deny-by-default) van en un PR
  posterior. Detalle y validación en `docs/ESTADO-PROYECTO.md` §16. Se revisa y
  fusiona **después** del PR #29. Producción sigue NO-GO.
- **Desarrollo en curso (apilado sobre `feat/admin-audit-log`):** rama
  `feat/roles-granulares` — **permisos granulares (RBAC deny-by-default)**: modelo
  de capacidades por recurso/acción (`api/src/permisos.ts`), 8 roles, middlewares
  `requirePermiso*`, mapa de autorización central en `routes/admin/index.ts`,
  separación editar-vs-publicar en páginas, y `/auth/me` con capacidades para el
  panel. `editor` conserva su poder actual (sin regresión); el tightening recae en
  los 6 roles nuevos y la denegación por defecto. Detalle en
  `docs/ESTADO-PROYECTO.md` §17. Orden de revisión: después de #29 y del PR de
  auditoría. Producción sigue NO-GO.

[#29 `fix/brand-rollback-idempotente`]: https://github.com/DaltonP93/WEB_SAA/pull/29

## Límites de seguridad y operación

- Nunca versionar ni copiar secretos, tokens, contraseñas, hosts internos, IPs privadas, datos clínicos, pacientes ni PII.
- No hacer deploy, cambio de DNS, SSH, reinicio de PM2/Nginx, migración, seed, limpieza masiva, rollback ni cambios de infraestructura sin autorización expresa.
- Antes de cambiar dependencias, conservar `pnpm-lock.yaml`; el despliegue usa instalación reproducible.
- La producción continúa en **NO-GO** hasta que se verifiquen los bloqueantes externos y la evidencia actualizada indicada en `docs/ESTADO-PROYECTO.md`.

## Flujo obligatorio para cualquier tarea

1. Leer `AGENTS.md`, este archivo y los módulos afectados; revisar `git status`, HEAD, PR relacionado y tests existentes.
2. Aplicar el ciclo Analista → Desarrollador → Tester → Corrector definido en `AGENTS.md`.
3. Hacer el cambio mínimo y mantener contratos, tipos y documentación alineados.
4. Ejecutar las verificaciones proporcionales: `pnpm typecheck`, `pnpm build`, `pnpm test`, y los checks específicos del área modificada. Si hay esquema, usar el procedimiento de migración del proyecto; no ejecutarlo en producción.
5. Registrar en el mismo PR el alcance real, comandos/checks observados, riesgos, pendientes y cambios de GO/NO-GO.
6. No declarar listo para producción si no existe evidencia actualizada y verificable.

## Cómo iniciar una conversación de desarrollo

Indicar siempre: objetivo, entorno autorizado, rama/PR, archivos afectados y resultado esperado. Un inicio seguro es:

> “Lee `AGENTS.md` y `docs/AI_HANDOFF.md`. Resume el baseline actual, señala riesgos y propone un plan mínimo con tests antes de editar.”

## Referencias

- `AGENTS.md`: contexto exhaustivo, convenciones y flujo multi-agente.
- `CLAUDE.md`: guía operativa y comandos.
- `docs/ESTADO-PROYECTO.md`: estado ejecutivo, riesgos y GO/NO-GO histórico.
- `docs/DEPLOY.md`: runbook de despliegue.
