# AI handoff — WEB_SAA

> **Actualizado:** 2026-09-01  
> **Baseline confirmado:** `main@10d46957ca8a351e848f9cf8cbbb928960111d51`  
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

- `main` está en `10d4695`, con el ajuste de branding para usar el logo institucional navy monocromo (“Logo 4”).
- Los commits inmediatamente anteriores incluyen una corrección de CSP y una automatización de actualización del VPS al seguir `origin/main`.
- Esa automatización vuelve sensible cualquier cambio fusionado: no asumir que un merge está autorizado para producción; confirmar el flujo real, los controles y la aprobación del responsable antes de desplegar.
- No se observaron pull requests abiertos durante esta actualización.
- `docs/ESTADO-PROYECTO.md` contiene la evaluación histórica más detallada y un **NO-GO para producción**. Su baseline anterior no coincide con el HEAD actual, por lo que debe revalidarse antes de usarlo como evidencia de GO.
- No se registran en este archivo resultados nuevos de CI, staging o producción. No sustituir evidencia real por inferencias.

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
