# AI handoff — WEB_SAA

> **Actualizado:** 2026-09-07  
> **Baseline confirmado:** `main@a4cccc1a3e36cae4fbb40b149f8809de0eac7b2a` (sin cambios en `main`).  
> **Fase actual:** stack de estabilización #29→#36 **completo y en verde en CI (MySQL 8)**, en **Draft**, listo para auditoría independiente de Codex. Producción **NO-GO**. Ver "Estado confirmado" abajo.  
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

## Estado confirmado al 2026-09-07

`main` sigue en `a4cccc1` (merge del PR #28, "docs: add AI handoff"); **nada se
fusionó a `main`** desde entonces. Todo el trabajo vive en un **stack lineal de 8
PR Draft** (#29→#36), cada uno basado en el anterior, con CI en **verde sobre
MySQL 8** (los tres jobs: "Typecheck, build y pruebas", "Detección de secretos",
"Auditoría de dependencias"). Ninguno debe fusionarse todavía: quedan para la
**auditoría independiente de Codex**. `#36` es sólo un PR de **integración** hacia
`main` para ver el diff completo del stack y **no debe fusionarse** (cada pieza se
fusiona por su propio PR, en orden, empezando por #29).

| PR | Rama | Head | Qué aporta |
|----|------|------|-----------|
| #29 | `fix/brand-rollback-idempotente` | `31b792d` | Rollback de `settings.brand` por **snapshot de procedencia** (fail-closed, sin heurística) + preflight; corrige el CI rojo histórico de `main`. |
| #30 | `feat/admin-audit-log` | `f70d9dd` | Bitácora `admin_audit_log` (append-only, gateada por `audit.read`, sin PII); middleware `auditarMutaciones` para routers sin auditoría propia. |
| #31 | `feat/roles-granulares` | `b588953` | RBAC por capacidades (`api/src/permisos.ts`, 8 roles, deny-by-default) + rollback fail-closed de roles. |
| #32 | `feat/jwt-revocacion` | `0e682ee` | Revocación de sesiones por `auth_version` (igualdad exacta, fail-closed, HS256 fijado). |
| #33 | `feat/security-hardening` | `50261a1` | Ronda 2: bind loopback, IP de auditoría vía `req.ip` (sin leer cabeceras a ciegas), escape de comodines LIKE, 400/404 en médicos, seudónimo de correo en `login_fail`, export de auditoría por streaming. |
| #34 | `feat/editorial-workflow` | `b90be5e` | Flujo editorial (API): **transiciones como única vía de cambiar el estado**; `PUT`/`content` rechazan `status`/`publish_at`; `unpublish` explícito; `schedule` sólo desde estados permitidos, atómico y bajo `FOR UPDATE`; restaurar sólo-contenido con schema estricto; auditoría `from/to`. |
| #35 | `feat/editorial-ui` | `ed88a54` | Flujo editorial (panel): estado de sólo lectura en el Page Builder, transiciones en la lista de Páginas, sin `PUT` de publicación; roles y auditoría en el admin. |
| #36 | `feat/editorial-ui` → `main` | `ed88a54` | **Integración, NO FUSIONAR.** Diff completo del stack contra `main` para auditoría. |

Detalle de diseño de cada pieza en el cuerpo de su PR (actualizados con SHAs y
conteos reales) y, para las de seguridad/roles/editorial, en `docs/ESTADO-PROYECTO.md`
§16–§17.

### Validación

- **CI (MySQL 8, la autoridad):** las 8 cabezas del stack en verde.
- **Local (MariaDB):** `pnpm typecheck` OK · suite completa `TEST_DATABASE=1`
  **99 archivos / 1844 pruebas** OK · `pnpm build` (web+admin+api, con prerender de
  `/estudios`) OK · `pnpm check:secrets` OK · `pnpm audit:prod` sin high/critical.
- **Nota MySQL 8 vs MariaDB:** las columnas JSON difieren (MySQL 8 devuelve valores
  no-objeto desenvueltos; MariaDB entre comillas). Las pruebas de base leen JSON con
  `jsonColumn()`/parse tolerante; CI en MySQL 8 es siempre la referencia final.

### Nota de estabilidad de CI (2026-09-07)

`tests/page-builder-panel.test.tsx` (prueba de componente que vive en `main` desde
la ronda del PR #23) tuvo un **flake** de timing bajo la carga del runner
(`waitFor` con el default de 1000 ms). Se endureció (`configure({ asyncUtilTimeout })`
+ `mutations:{retry:false}` en el QueryClient del test) y se propagó por todo el
stack; CI en verde lo confirmó en cada rama. Es cambio **sólo de prueba**, no toca
componentes ni contratos.

### Producción: NO-GO

Sigue en **NO-GO** por los bloqueantes externos de `docs/ESTADO-PROYECTO.md`
(secreto histórico en el historial de git, protección de `main`, dominio/DNS/TLS,
backups/restore verificados, monitoreo y contenido real del cliente). El stack
verde no altera esos bloqueantes; son decisiones/acciones del propietario.

`docs/ESTADO-PROYECTO.md` mantiene la evaluación histórica más detallada; sus
conteos de CI de baselines previos no valen como evidencia del HEAD actual del
stack hasta revalidar contra estos SHAs.

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
