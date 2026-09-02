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
- No se observaron pull requests abiertos durante esta actualización.
- **CI rojo en el HEAD (`a4cccc1`)**: el job "Typecheck, build y pruebas" falló en
  `tests/migrations.test.ts > … el rollback devuelve exactamente el estado
  anterior`. Typecheck y los tres builds pasaron; el fallo está en el rollback de
  migraciones. "Detección de secretos" y "Auditoría de dependencias" quedaron en
  verde.
- **Causa raíz:** `20260827000000_brand_logo` y `20260828000000_brand_favicon`
  **crean** la fila `settings.brand` cuando no existe, pero su `down()` sólo la
  vacía (nunca la borra). Sobre una base migrada sin sembrar, el rollback deja un
  residuo `{ logoUrl:"", faviconUrl:"" }` que el snapshot de la prueba detecta.
  Reproducido 3/3 de forma determinística.
- **Corrección en curso (rama `fix/brand-rollback-idempotente`, PR Draft):**
  migración correctiva nueva `20260901000000_brand_rollback_idempotente.ts` cuyo
  `down()` —posterior, corre antes que los de marca— elimina **sólo** la fila
  auto-generada (claves ⊆ `logoUrl`/`faviconUrl` con los valores por defecto) y
  preserva marca sembrada o personalizada; `up()` no toca datos; idempotente y
  seguro ante fila ausente, JSON inválido o estructura parcial. No se editaron
  migraciones ya fusionadas. Pruebas nuevas en `tests/migrations-brand-rollback.test.ts`.
- **Producción sigue en NO-GO** por los bloqueantes externos de
  `docs/ESTADO-PROYECTO.md` (secreto histórico, protección de `main`, dominio/DNS/
  TLS, backups/restore, monitoreo y contenido). Esta corrección no los altera.
- `docs/ESTADO-PROYECTO.md` mantiene la evaluación histórica más detallada; su
  baseline previo (`fd49743a`/`7eb570c`) no coincide con el HEAD actual, así que
  sus conteos de CI no valen como evidencia del HEAD hasta revalidar.

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
