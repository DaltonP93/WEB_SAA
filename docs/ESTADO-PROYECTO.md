# WEB_SAA — Estado completo posterior al merge y pendientes

**Repositorio:** [DaltonP93/WEB_SAA](https://github.com/DaltonP93/WEB_SAA)  
**Fecha de verificación:** 31 de agosto de 2026  
**Rama verificada:** `main`  
**HEAD de `main`:** `fd49743a27543a5cd0c12e2839b6ba9760484d33`  
**Último cambio fusionado:** [PR #25](https://github.com/DaltonP93/WEB_SAA/pull/25) (regla anti-ciclo y cierre documental), merge `fd49743a27543a5cd0c12e2839b6ba9760484d33`, sobre PR #24 y el código del PR #23

> **Documento canónico y vivo.** Este archivo debe actualizarse en toda ronda
> que cambie funcionalidades, migraciones, seguridad, despliegue, conteo de
> pruebas o pendientes. La actualización debe incluirse en el mismo PR del
> cambio; después del merge se confirma el SHA de `main` y el CI post-merge.

> ⚠️ **Baseline desactualizado.** Los SHA y conteos de las secciones 1–14 fueron
> verificados sobre `fd49743a`/`7eb570c` y **no coinciden con el HEAD actual de
> `main` (`a4cccc1`)**. Para el estado vigente ver la **sección 15**, a
> continuación; los conteos de CI previos no valen como evidencia del HEAD hasta
> revalidar sobre él.

---

## 15. Ronda correctiva — rollback de `settings.brand` por snapshot (2026-09-02)

**HEAD de `main` verificado:** `a4cccc1a3e36cae4fbb40b149f8809de0eac7b2a`
(merge del PR #28). **PR abierto:** [#29
`fix/brand-rollback-idempotente`](https://github.com/DaltonP93/WEB_SAA/pull/29)
(Draft, base `a4cccc1`), único PR abierto y dedicado a esta corrección.
**Protección de `main`:** sin ruleset ni revisión obligatoria (sigue bloqueante
para producción).

### 15.1 Hallazgo: CI rojo en el HEAD

El workflow "CI" sobre `a4cccc1`
([run 33459369884](https://github.com/DaltonP93/WEB_SAA/actions/runs/33459369884))
terminó en **failure**:

| Check | Resultado |
|---|---|
| Auditoría de dependencias | success |
| Detección de secretos | success |
| Typecheck, build y pruebas | **failure** |

Dentro de ese job, typecheck y los tres builds pasaron; falló el paso de pruebas
en `tests/migrations.test.ts > migraciones correctivas frente a ediciones del
cliente > el rollback devuelve exactamente el estado anterior`. Los checks
verdes históricos (secciones 5 y 13) se tomaron sobre `fd49743a`/`7eb570c`, no
sobre este HEAD.

### 15.2 Causa raíz

Las migraciones fusionadas en el PR #27 `20260827000000_brand_logo.ts` y
`20260828000000_brand_favicon.ts` **crean** la fila `settings.brand` cuando no
existe (`insert … onConflict.merge`), pero su `down()` **original** sólo la
**actualizaba** vaciando el campo; nunca la borraba. Sobre una base migrada **sin
sembrar** (la de la prueba), revertir la cadena dejaba un residuo `{ logoUrl:"", faviconUrl:"" }`
que en el estado anterior no estaba, y el snapshot lo detecta. Reproducido de
forma **determinística 3/3** sobre bases limpias; el `DUMP_SNAPSHOTS` confirma
que la única sección que difiere es `settings`, y la única clave nueva es
`brand`.

### 15.3 Primera solución descartada (heurística de contenido)

Un intento previo del PR #29 agregó una migración posterior
(`20260901000000_brand_rollback_idempotente.ts`) cuyo `down()` borraba la fila
`settings.brand` si su contenido "parecía" autogenerado (claves ⊆
`logoUrl`/`faviconUrl` con los valores por defecto). Se **descartó (NO-GO)** y se
eliminó del PR: una coincidencia de contenido **no prueba procedencia**. Una fila
legítima, preexistente, con exactamente
`{ logoUrl:"/logo-sanatorio.png", faviconUrl:"/favicon.png" }` es indistinguible
por contenido de una autogenerada, y la heurística la habría borrado. Se verificó
de forma reproducible contra `672ae96`: replicando su cadena de `down()` sobre una
fila preexistente idéntica a los defaults, la fila **se borra**. La regresión que
lo demuestra vive ahora en `tests/migrations-brand-rollback.test.ts` y falla
contra `672ae96`, pasando sólo con la solución por snapshot.

### 15.4 Corrección vigente (por snapshot; excepción autorizada y acotada)

Bajo una **autorización explícita y acotada del propietario** para editar
**exclusivamente** las dos migraciones ya fusionadas
`20260827000000_brand_logo.ts` y `20260828000000_brand_favicon.ts` (ninguna otra),
cada una ahora registra **procedencia**, no contenido:

- **Snapshot interno, antes de tocar la base.** Claves
  `snapshot_brand_logo_20260827000000` y `snapshot_brand_favicon_20260828000000`
  (prefijo `snapshot_`, `varchar(64)`, fuera de `PUBLIC_SETTING_KEYS` /
  `ADMIN_SETTING_KEYS`: no publicadas ni editables desde el CMS, igual que los 9
  `snapshot_*` que ya dejan las migraciones correctivas previas). Guarda: versión
  de formato, nombre de la migración, propiedad, si la fila existía, si tenía forma
  inesperada, si la propiedad existía, su **valor anterior exacto** (distinguiendo
  ausente / `null` / `""` / default / personalizado), si aplicó un cambio y qué
  valor aplicó. Se guarda **aunque no haga falta cambiar nada**, **no se
  sobrescribe** si ya existe, y se **elimina** recién tras un rollback exitoso. Si
  el snapshot no puede guardarse, `up()` no modifica `settings.brand` (la
  transacción de la migración revierte).
- **`down()` específico por propiedad.** Restaura desde el snapshot y sólo sobre lo
  que la propia migración escribió: si la propiedad conserva exactamente el valor
  que aplicó, restaura el valor anterior exacto (o elimina sólo esa propiedad si no
  existía); si fue personalizada después, la preserva. El favicon corre primero
  (LIFO) y **nunca borra la fila**; el logo, después de restaurar su propiedad,
  elimina la fila `settings.brand` **sólo** si el snapshot demuestra que no existía
  originalmente y ya no queda ninguna propiedad. Nunca borra una fila preexistente
  ni claves agregadas después.
- **Fail-closed en bases migradas antes de la corrección.** Si la migración figura
  aplicada pero su snapshot está ausente, es inválido o de una versión desconocida,
  `down()` **aborta antes de tocar datos** (no vacía la marca, no borra la fila) y
  remite a restaurar un backup verificado o a un procedimiento manual autorizado.
  **No hay fallback heurístico.** Este fallo seguro se propaga de punta a punta por
  el flujo local existente: `scripts/deploy/rollback-db.sh` aborta al fallar un
  `migrate:down` (sale 4 "ROLLBACK NO INICIADO" si es el primero, o va por
  restauración de dump si es intermedio), sin ningún cambio en los scripts de
  rollback. Un preflight dedicado en `rollback-guard.mjs` quedaría **redundante**
  dado ese comportamiento verificado; se documenta como mejora opcional futura, no
  necesaria.
- **No se editó ninguna otra migración fusionada**, no se borra `settings.brand`
  de forma incondicional, y se preservan marca sembrada (`name`/`tagline`),
  personalizaciones y claves adicionales. `up()`/`down()` son idempotentes y
  seguros ante fila ausente, JSON inválido y estructuras parciales.
- **Pruebas:** `tests/migrations-brand-rollback.test.ts` (23 casos) cubre fila
  inexistente, preexistente `{}`, propiedades inexistentes, `null`, `""`,
  preexistente idéntica a los defaults (la **regresión** principal), logo/favicon/
  ambos personalizados, claves adicionales, edición posterior de logo y de favicon,
  clave agregada tras el `up()`, snapshot ausente / inválido / de versión
  desconocida (fail-closed), ciclo aplicar→revertir→aplicar y desaparición de los
  snapshots tras el rollback. `tests/migrations.test.ts` **no se debilitó** y su
  aserción de rollback vuelve a verde.

### 15.5 Validación local (reproducible)

Entorno: **Node 20.20.2**, **pnpm 9.0.0**, **MySQL 8.4.9** local descartable
(`127.0.0.1:3306`, sin servicio Windows). El CI usa **MySQL 8.0** y es la
autoridad final.

| Validación | Comando | Resultado |
|---|---|---|
| Typecheck | `pnpm typecheck` | OK (api/web/admin) |
| Build API | `pnpm --filter @sa/api build` | OK |
| Build web | `pnpm --filter @sa/web build` | OK (prerender best-effort, omitido sin API viva) |
| Build admin | `pnpm --filter @sa/admin build` | OK |
| Suite de marca | `pnpm test tests/migrations-brand-rollback.test.ts` | **23/23** |
| Migraciones integrales ×3 sobre bases limpias | `pnpm test tests/migrations.test.ts` | **26/26** cada corrida |
| Secretos | `pnpm check:secrets` | OK (sin credenciales en el árbol) |
| Dependencias | `pnpm audit:prod` | OK (0 alto/crítico; 1 moderado preexistente, bajo el umbral) |

**Comparación reproducible de la suite completa** (mismo entorno Windows), para no
atribuir fallos a Windows sin evidencia:

| Árbol | Test Files | Tests |
|---|---|---|
| Base pristina `672ae96` (sin el fix) | 13 failed / 73 passed | 67 failed / **1458** passed / 5 skipped (1530) |
| Con el fix por snapshot | 13 failed / 73 passed | 67 failed / **1471** passed / 5 skipped (1543) |

Los **mismos 13 archivos** fallan en ambos árboles, con los **mismos 67 tests**,
todos por spawn de herramientas externas ausentes en la PowerShell de Windows
(`bash`/`npx`/`pnpm`/`stat`, y los de media que dependen de libvips/Unix). El fix
**no agrega ningún fallo**; suma +13 en verde (la aserción de `migrations.test.ts`
corregida +1 y la suite de marca ampliada +12). En el runner Ubuntu del CI esas 13
integraciones corren normalmente; el **conteo verde definitivo lo confirma el CI de
GitHub sobre el PR #29**.

### 15.6 Veredicto de la ronda (GO/NO-GO separado)

- **Diseño:** GO para revisión. Se corrigió la falla conceptual de la heurística
  con un enfoque por procedencia. **No se declara "riesgo bajo"**: el diseño debe
  pasar una auditoría independiente antes de merge.
- **CI:** verde localmente en todo lo que corre sin herramientas Unix; el conteo
  autoritativo depende del run de CI del PR #29. **No se declara CI verde sin ese
  run.**
- **Merge:** NO-GO hasta auditoría independiente y CI verde del PR.
- **Producción:** **NO-GO**, sin cambios. Esta ronda no toca los bloqueantes de las
  secciones 6 y 10 (secreto histórico, protección de `main`, dominio/DNS/TLS,
  backups/restore, monitoreo, contenido).

### 15.7 Riesgos residuales y observación fuera de alcance

- **Bases ya migradas sin snapshot:** su rollback por debajo de estas migraciones
  queda **bloqueado (fail-closed)** hasta restaurar un backup verificado o ejecutar
  un procedimiento manual autorizado. Es intencional: preferir bloquear a corromper
  la marca. No accedemos al VPS para verificar su estado.
- **Rollback sobre base sembrada:** si `settings.brand` trae `name`/`tagline`, esta
  corrección los preserva; el vaciado de `logoUrl`/`faviconUrl` sembrados que hacía
  el `down()` original quedó, además, gobernado por el snapshot (sólo se toca lo que
  la migración aplicó). Cambiar la semántica de restauración de assets sembrados
  excede esta corrección mínima y se deja como seguimiento.

### 15.8 Segunda auditoría independiente — validación estricta + preflight (2026-09-02)

Una auditoría independiente del PR #29 sobre `bc2439a` reprodujo **dos defectos
bloqueantes** de la corrección por snapshot y devolvió **NO-GO para merge**:

1. **`down()` confiaba en un snapshot mal validado.** El lector sólo comprobaba
   `formato` + tres booleanos y hacía un cast al tipo completo, así que un snapshot
   **parcial forjado** (sin `migracion`/`propiedad`/`formaInesperada`/`valorAnterior`)
   pasaba y `down()` podía **borrar una fila legítima** `settings.brand`.
2. **`up()` no validaba un snapshot preexistente corrupto:** lo conservaba pero igual
   modificaba `settings.brand`, dejando un estado sin restauración segura.

**Corrección (sin migración posterior ni heurística):**

- **Validación estricta por migración (estructura cerrada).** Cada migración valida
  el snapshot contra su contrato de formato 1 antes de cualquier escritura: exactamente
  los 9 campos permitidos (ni faltantes ni extra), `formato===1`, `migracion===MIGRACION`,
  `propiedad===PROP`, tipos booleanos exactos, `valorAplicado===DEFAULT` sii
  `aplicoCambio` y `===null` en caso contrario, y coherencia entre
  `filaExistia`/`formaInesperada`/`propiedadExistia`/`valorAnterior`/`aplicoCambio`
  (se rechaza toda combinación imposible). El objeto tipado se construye a partir de los
  valores ya validados — **nunca un cast** tras validar sólo algunos campos.
- **`up()` endurecido.** Sin snapshot: lo captura y aplica el default (como antes). Con
  snapshot preexistente: lo **valida estrictamente**; si es inválido/ajeno/contradictorio
  **lanza antes de tocar `brand`**; si es válido, es un **no-op idempotente** (no recalcula
  otro contrato ni pisa nada) que preserva personalizaciones posteriores.
- **`down()` endurecido.** Valida el snapshot por completo antes de modificar o borrar
  cualquier fila; ante error no toca `brand` ni elimina el snapshot; la coincidencia con
  el valor por defecto **no** se usa como prueba de procedencia (la da el snapshot
  validado), sólo como guarda extra contra pisar una personalización.
- **Preflight de rollback** (`scripts/deploy/brand-snapshot-preflight.mjs`, invocado por
  `rollback-db.sh` **después** de calcular `PENDIENTES` y **antes** del primer
  `migrate:down`). Sólo actúa si el rollback cruza `20260828…_brand_favicon` o
  `20260827…_brand_logo`; valida por adelantado los snapshots requeridos de las de marca
  incluidas y, si falta uno o es inválido, **aborta sin revertir ninguna migración**
  (exit 4, base intacta). Un rollback que no cruza esas migraciones no queda bloqueado.
  **No se salta con `ROLLBACK_ALLOW_AFTER_SEED`.** El mensaje aclara que hace falta un
  backup **anterior** a esas migraciones (o al deploy que las trajo) o un procedimiento
  manual autorizado: un backup tomado justo antes del rollback sólo recupera el estado
  actual. Esto es necesario porque el fail-closed dentro de cada `down()` llega tarde en
  una reversión múltiple (las migraciones más nuevas ya se habrían revertido).

**Pruebas nuevas.** `tests/migrations-brand-rollback-strict.test.ts` (27): defecto 1 y 2
para logo y favicon, y validación estricta campo por campo (cada campo faltante,
`migracion`/`propiedad` incorrectas, `formaInesperada` contradictoria, mezclas
`aplicoCambio`/`valorAplicado`, procedencias imposibles, clave extra), `up()` idempotente
con snapshot válido, y `down()` que no modifica nada ante snapshot inválido.
`tests/rollback-brand-preflight.test.ts` (8, sin base/bash): no cruza marca → permite;
snapshots válidos → permite; migración más nueva antes de favicon/logo sin snapshot →
bloquea; snapshot inválido → bloquea; uno de dos ausente → bloquea; error de lectura →
bloquea (fail-closed); mensaje correcto. `tests/rollback-db.test.ts` suma dos casos
end-to-end (bash): bloqueo con **cero `down()` ejecutados** y rollback que no cruza marca
no bloqueado. Todas las nuevas pruebas de validación estricta **fallan contra `bc2439a`**
(18/27 en el archivo estricto) y pasan sólo con esta corrección.

**Validación local** (Node 20.20.2, pnpm 9.0.0, MySQL 8.4.9; CI usa 8.0):
`typecheck` OK; builds api/web/admin OK; `check:secrets` OK; `audit:prod` OK (0 alto/
crítico; 5 moderados preexistentes, bajo el umbral); marca+estricto+preflight **58/58**;
`tests/migrations.test.ts` ×3 sobre bases limpias **26/26**; suite completa **1506✓ /
69✗ / 5 skip (1580)** vs `bc2439a` **1471✓ / 67✗ (1543)**: **+35 en verde**; los +2 fallos
nuevos son los dos casos **bash** del preflight en `rollback-db.test.ts`, ambientales de
Windows (`spawn bash ENOENT`, idénticos al resto de ese archivo, verdes en el runner
Ubuntu del CI). Mismos 13 archivos ambientales que el baseline. **Conteo verde autoritativo
= CI del PR.**

**GO/NO-GO (sin cambios respecto de la ronda anterior salvo el diseño):** diseño → GO para
nueva auditoría (no se declara "riesgo bajo"); CI → pendiente del run del PR; merge → NO-GO
hasta nueva auditoría independiente + CI verde; **producción → NO-GO**.

---

## 1. Resumen ejecutivo

El sitio público, el panel administrativo tipo CMS, el Page Builder, la biblioteca multimedia, los turnos, mensajes, usuarios, SEO, analítica, atribución, redirects, publicación programada, papelera, revisiones y newsletter básica ya están desarrollados y fusionados en `main`.

El CI posterior a los merges terminó correctamente sobre `f398fed` (código) y `fd49743a` (PR #25, run #66):

- **Typecheck, builds y pruebas:** correcto.
- **1497 pruebas en 82 archivos**, ejecutadas contra MySQL 8: correctas.
- **Prerender SEO real** con API y base activas: correcto.
- **Auditoría de dependencias:** sin vulnerabilidades altas o críticas de producción.
- **Árbol Git actual:** sin secretos detectados.

Sin embargo, el proyecto todavía está en **NO-GO para producción**: las credenciales históricas no fueron rotadas/purgadas y aún faltan gobierno de `main`, dominio, infraestructura, backups/restores, monitoreo, variables y contenido confirmados. El inventario sensible se mantiene fuera del repositorio público.

> El merge no produjo un despliegue. El workflow del repositorio valida código, pero no ejecuta SSH, rsync, migraciones ni reinicios sobre el VPS.

---

## 2. Estado confirmado del último merge

| Comprobación | Resultado |
|---|---|
| PR #23 (código) | Fusionado el 28/08/2026 · merge commit `f398fed11e9030fa7955e7f6bd8d3426739bfe28` |
| PR #24 (docs: este archivo) | Fusionado el 29/08/2026 · merge commit `94e2e0ee4fc9c762d54c9d0f10bad3d6ff7cd19a` |
| PR #25 (regla anti-ciclo/cierre docs) | Fusionado el 30/08/2026 · merge commit `fd49743a27543a5cd0c12e2839b6ba9760484d33` |
| `main` actual | `fd49743a27543a5cd0c12e2839b6ba9760484d33` |
| CI posterior al merge (`f398fed`, run #61) | **Success** |
| CI posterior al merge (`94e2e0e`, run #63) | **Success** |
| CI posterior al merge (`fd49743a`, run #66) | **Success (3/3)** |
| Conflictos | Ninguno |
| Reviews registradas en PR #23 / #24 | **0** |
| Deploy automático | No existe |

Los PR #23 y #24 se fusionaron sin una review registrada. Los checks automáticos estaban verdes, pero una suite verde no equivale a una revisión humana. La documentación del proyecto también registra que los PR #16, #17 y #18 se fusionaron sin review. PR #24 fue sólo documentación (este archivo): no cambió código, migraciones ni pruebas.

---

## 3. Rondas principales ya fusionadas

| PR | Trabajo principal | Estado |
|---|---|---|
| [#16](https://github.com/DaltonP93/WEB_SAA/pull/16) | Turnos: paginación por servidor, zona horaria institucional e idempotencia | Fusionado |
| [#17](https://github.com/DaltonP93/WEB_SAA/pull/17) | Multimedia: staging seguro, formato real, preservación de animación y logs sin datos personales | Fusionado |
| [#18](https://github.com/DaltonP93/WEB_SAA/pull/18) | Logos, selector multimedia, referencias y reordenamiento genérico | Fusionado |
| [#19](https://github.com/DaltonP93/WEB_SAA/pull/19) | Saneo SVG/PDF, Biopsias, usuarios y superficie administrativa | Fusionado |
| [#20](https://github.com/DaltonP93/WEB_SAA/pull/20) | Analítica, consentimiento, UTMs y CSP | Fusionado |
| [#21](https://github.com/DaltonP93/WEB_SAA/pull/21) | Reconciliación documental y verificación Search Console/Bing | Fusionado |
| [#22](https://github.com/DaltonP93/WEB_SAA/pull/22) | Redirects 301 administrables | Fusionado |
| [#23](https://github.com/DaltonP93/WEB_SAA/pull/23) | Papelera, publicación programada, revisiones, newsletter y dos rondas correctivas | Fusionado |
| [#24](https://github.com/DaltonP93/WEB_SAA/pull/24) | Documentación viva: estado ejecutivo, pendientes y go-live post PR #23 (`docs/ESTADO-PROYECTO.md`) | Fusionado |
| [#25](https://github.com/DaltonP93/WEB_SAA/pull/25) | Cierre documental y regla para evitar cadenas infinitas de PRs sólo documentales | Fusionado |

---

## 4. Funcionalidades terminadas

### 4.1 Sitio público

- Home institucional y páginas dinámicas por slug.
- Directorio y fichas de médicos.
- Especialidades, servicios y estudios.
- Formularios públicos de turnos y contacto.
- Canales de contacto, WhatsApp, teléfonos, correos, redes y horarios.
- Mapa, video, galerías, acordeones, sliders, estadísticas, pasos, logos, CTA y contenido enriquecido.
- Redirects 301 heredados y administrables.
- Páginas 404 y manejo de rutas antiguas.
- Diseño responsive y navegación accesible.
- CSP restrictiva y apertura controlada sólo para Google/Meta cuando corresponda.

### 4.2 Panel administrativo tipo CMS

- Autenticación JWT y roles `superadmin`/`editor`.
- Gestión de páginas y bloques sin tocar código.
- Gestión de médicos, especialidades, servicios y estudios.
- Menús, marca, tema, colores, ubicación y ajustes institucionales.
- Canales de contacto y horarios con estado activo/inactivo.
- Turnos y mensajes con bandejas, filtros, paginación y exportación CSV.
- Multimedia, usuarios, datos pendientes, confirmaciones y redirects.
- Newsletter: suscriptores, búsqueda, paginación, exportación y baja/reactivación.
- Avisos de errores accionables y confirmaciones mediante diálogos del panel.

### 4.3 Page Builder

- Más de veinte tipos de bloques institucionales.
- Drag-and-drop para ordenar bloques.
- Editor visual rich-text.
- Selector multimedia reutilizable para imágenes.
- Reordenamiento genérico y accesible de ítems para cards, accordion, slider, gallery, steps, stats y logos.
- Bloque `Logos` con `alt`, enlace, activo/inactivo, dimensiones y opacidad.
- URL manual conservada para recursos externos seguros.
- Advertencia de cambios sin guardar.
- Guardado atómico de metadatos y bloques mediante `/pages/:id/content`.

### 4.4 Páginas: publicación, papelera e historial

- Estados Borrador, Publicada y Programada.
- Programación interpretada en la zona horaria `America/Asuncion` por el servidor.
- Publicar limpia `publish_at`; despublicar vuelve a borrador y también limpia la agenda.
- Las páginas programadas no aparecen en lista pública, detalle ni sitemap antes de su fecha.
- Papelera recuperable mediante `deleted_at`.
- Borrado definitivo condicional y atómico sólo desde la papelera.
- Una página en la papelera no puede seguir editándose por otro endpoint.
- Historial de hasta 30 versiones por página.
- Archivado del estado anterior antes de guardar.
- Restauración reversible con confirmación y preservación fiel de `publish_at`.

### 4.5 Multimedia y seguridad de archivos

- Staging fuera de `/uploads` y verificado al arrancar.
- Movimiento final atómico y limpieza ante éxito o error.
- Formato detectado por bytes, no por extensión o MIME declarado.
- JPEG, PNG, WebP, GIF, SVG y PDF con contratos específicos.
- Alpha, cuadros, `delay` y `loop` preservados en animaciones.
- SVG saneado antes de guardar; rechazo de XXE y construcciones evasivas.
- PDF validado, reconstruido y limpiado de acciones/JavaScript/anotaciones conocidas.
- Nombres opacos con UUID.
- Límites de peso, píxeles y descompresión.
- Metadatos efectivos: MIME, tamaño, dimensiones y cuadros.
- Un archivo referenciado por bloques, branding, SEO o médicos no se puede borrar: responde 409.
- Logs sin rutas internas, SQL, contenido subido ni datos personales.

### 4.6 Turnos, mensajes y atribución

- Paginación real del servidor.
- Búsqueda, filtros, estados, fechas y orden.
- Filas anteriores no accionables durante transiciones de consulta.
- Corrección automática de la última página tras eliminar su única fila.
- Zona horaria institucional consistente.
- Idempotencia evaluada antes del CAPTCHA.
- Exportación CSV.
- Captura first-touch de `utm_*`, `gclid` y `fbclid`.
- Atribución saneada, guardada y visible en la bandeja/CSV.
- Datos personales y SQL excluidos de logs de error.

### 4.7 Usuarios y confirmaciones institucionales

- Validaciones inválidas responden 400 en lugar de 500.
- Email duplicado responde 409.
- ID inexistente responde 404.
- `password_hash` nunca se devuelve.
- No se puede borrar ni bajar de rol al último superadmin.
- El panel muestra los errores y deshabilita acciones imposibles.
- Confirmación de Biopsias por superadmin, registrando autor, fecha y alcance.
- Posibilidad de retirar la confirmación si cambia el servicio.
- La confirmación no se deduce automáticamente del texto de la página.

### 4.8 SEO y marketing básico

- Título y descripción por página.
- Open Graph y Twitter Cards.
- Canonical, `sitemap.xml` y `robots.txt` dinámicos.
- JSON-LD para contenido estructurado.
- Prerender real de `/estudios` durante build/CI.
- Tokens validados para Google Search Console y Bing.
- Google Analytics 4, Google Tag Manager y Meta Pixel configurables por ID.
- Consentimiento previo a cargar medición de terceros.
- CSP coherente en Nginx y en el HTML.
- Atribución de campañas propia mediante UTMs.

### 4.9 Newsletter básica

- Bloque de suscripción colocable desde el Page Builder.
- Honeypot y rate-limit.
- Idempotencia por correo.
- Evidencia de consentimiento: finalidad, versión y fecha del servidor.
- Token opaco de baja preparado y no expuesto en panel, CSV ni logs.
- `unsubscribed_at` al dar de baja y limpieza al reactivar.
- Panel con búsqueda, paginación y estados.
- CSV protegido contra inyección de fórmulas.
- Estados de carga, error y reintento.

> La newsletter registra suscriptores, pero todavía no envía campañas: no se integró Mailchimp, Brevo u otro proveedor.

### 4.10 Despliegue y operación

- `setup-vps.sh` para instalación inicial.
- `update-vps.sh` con instalación reproducible, backup previo, migraciones, builds, reinicios y health check.
- `rollback-vps.sh` con prevalidación, rollback de base antes de bajar código y recuperación automática.
- Protección contra volver migraciones después de reseed sin usar el dump correcto.
- Backups rotativos de base y recomendación de backup externo de uploads.
- `/api/health` diferencia API y base sin exponer credenciales.
- `/admin` permanece bloqueado hasta existir HTTPS válido.
- CI en cada PR y push a `main`.

---

## 5. Validación actual de `main`

El workflow posterior al merge terminó en **success** sobre el `main` actual `fd49743a` (PR #25; run #66). La auditoría sustantiva de preproducción del PR #26 quedó verificada sobre el HEAD funcional `7eb570c` (run #68): typecheck, los tres builds, la suite MySQL 8, el prerender real, secretos y dependencias terminaron correctamente. El commit posterior que sólo cierra este documento debe conservar esos mismos checks verdes dentro del mismo PR.

| Check | Resultado |
|---|---|
| Typecheck API/web/admin | OK |
| Build API | OK |
| Build web | OK |
| Build admin | OK |
| Suite MySQL 8 de `main@fd49743a` | **1497/1497 en 82 archivos** |
| Suite MySQL 8 del PR #26 (`7eb570c`) | **1516/1516 en 84 archivos** |
| Migraciones | Incluidas en la suite |
| Prerender con API y base reales | OK |
| Auditoría high/critical de producción | OK |
| `check-secrets` del árbol | OK |
| `gitleaks` del árbol actual | Sin hallazgos |
| `gitleaks` del historial | **Incidente abierto; inventario exacto privado** |

---

## 6. Pendientes obligatorios antes de producción

### 6.1 Resolver el secreto histórico — bloqueo NO-GO

El historial contiene material que debe tratarse como credencial comprometida. El inventario exacto —commits, rutas, alcance y rotaciones— es sensible y se conserva en el acta privada, no en este repositorio público. El árbol actual está limpio, pero esos antecedentes siguen recuperables desde Git. Un único hallazgo de una herramienta no demuestra que el inventario histórico esté completo. Antes del deploy se debe:

1. Confirmar dónde se utilizó esa credencial.
2. Rotarla en todos los entornos donde pudiera seguir vigente.
3. Decidir si se reescribirá el historial con `git filter-repo`.
4. Si se purga, coordinar el force-push y la resincronización de todos los clones.
5. Volver a ejecutar `gitleaks` sobre el historial completo.

Mientras no se resuelva, el estado recomendado es **NO-GO para producción**.

### 6.2 Dominio, DNS y HTTPS

- Confirmar el dominio definitivo.
- Apuntar los registros DNS al VPS.
- Emitir el certificado con Certbot.
- Verificar redirección HTTP → HTTPS.
- Verificar que `/admin` sólo quede accesible por HTTPS.

### 6.3 Variables de producción

Configurar en `api/.env`:

- `NODE_ENV=production`
- Base MySQL de producción y contraseña segura.
- `JWT_SECRET` aleatorio de al menos 32 caracteres.
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME` y `SEED_ADMIN_PASSWORD` para la primera instalación.
- `CORS_ORIGINS=https://<dominio>`
- `PUBLIC_BASE_URL=https://<dominio>`
- `PUBLIC_SITE_URL=https://<dominio>`
- `UPLOAD_DIR` y staging en el mismo filesystem y fuera del directorio servido.

`PUBLIC_SITE_URL` debe cambiarse sólo cuando dominio, DNS y HTTPS estén realmente funcionando, porque alimenta canonical, sitemap y prerender.

### 6.4 Servidor y acceso de despliegue

- VPS Ubuntu preparado y acceso SSH mediante llave.
- `.env.deploy` fuera de Git y con permisos 600.
- Huella del servidor conocida/verificada.
- MySQL, Node 20, pnpm 9, Nginx, PM2 y Certbot.
- Espacio suficiente para build, uploads, worktree de prevalidación y backups.
- Almacenamiento externo para backup de uploads.

### 6.5 Contenido institucional real

El sanatorio debe confirmar y cargar:

- Logo y branding definitivos.
- WhatsApp Turnos.
- WhatsApp Estudios.
- WhatsApp General.
- WhatsApp SAMAP.
- Teléfono de Emergencias.
- Correo de Gestión del Talento Humano.
- Teléfono de Recepción.
- Correo general.
- Horarios de atención; activar sólo los confirmados.
- Médicos, especialidades, servicios y estudios definitivos.
- Alcance, preparación, requisitos y plazos de Biopsias.
- Confirmación formal de Biopsias por un superadmin.

### 6.6 Credenciales y servicios opcionales recomendados

- Turnstile o reCAPTCHA: proveedor, site key y secret key.
- GA4, GTM o Meta Pixel, si se usará medición.
- Tokens de Search Console/Bing.
- Cuentas reales de usuarios del panel.
- Cambiar la contraseña del administrador sembrado y borrar `.deploy-credentials` tras leerla.

---

## 7. Pendientes de desarrollo o decisión de producto

Estos ítems no bloquean el funcionamiento básico del sitio, pero todavía no están desarrollados completamente:

| Pendiente | Qué debe definirse o construirse |
|---|---|
| Noticias/Blog | Decidir si se reactiva; fue retirado por decisión de producto |
| Roles granulares | Definir permisos por módulo además de `superadmin`/`editor` |
| Multi-idioma | Definir idiomas, traducción de bloques, slugs y SEO por idioma |
| Buscador público | Definir qué entidades y contenido se indexarán |
| Constructor de formularios | Definir tipos de campo, validaciones, destinos y consentimiento |
| Proveedor de newsletter | Integrar Brevo, Mailchimp u otro; plantillas, remitente, listas y enlace real de baja |
| Campañas Meta/Google/Instagram | Crear cuentas de negocio/apps, OAuth, client IDs/secrets y definir operaciones permitidas |
| CRM/automatización de leads | Decidir si turnos, mensajes y newsletter se sincronizan con un CRM |

---

## 8. Secuencia recomendada para el go-live

1. **Resolver el secreto histórico** y verificar credenciales rotadas.
2. Confirmar dominio, VPS y estrategia de DNS.
3. Preparar `.env.deploy` y validar acceso SSH.
4. Aprovisionar el servidor con `setup-vps.sh`.
5. Emitir HTTPS y comprobar que `/admin` se habilita solamente bajo TLS.
6. Configurar `PUBLIC_SITE_URL`, `PUBLIC_BASE_URL` y `CORS_ORIGINS` al dominio real.
7. Ejecutar migraciones y seed únicamente si la base es una instalación nueva.
8. Cambiar la contraseña inicial y crear usuarios reales.
9. Cargar contenido institucional y registrar la confirmación de Biopsias.
10. Activar CAPTCHA y analítica sólo con claves reales.
11. Ejecutar la batería post-deploy de la sección siguiente.
12. Aprobar GO sólo si salud, contenido, formularios, backups y rollback están comprobados.

---

## 9. Pruebas obligatorias después del despliegue

### Infraestructura

- [ ] `https://<dominio>/` carga correctamente.
- [ ] `https://<dominio>/admin/` muestra el login.
- [ ] HTTP redirige a HTTPS.
- [ ] `https://<dominio>/api/health` devuelve 200 y `{ok:true}`.
- [ ] PM2 muestra `sanatorio-api` online y con el `cwd` correcto.
- [ ] Nginx valida con `nginx -t`.
- [ ] Backup de base generado y comprobado con `gzip -t`.
- [ ] Backup externo de uploads configurado.

### Sitio y panel

- [ ] Login de superadmin y editor.
- [ ] Crear, editar, programar, despublicar y restaurar una página de prueba.
- [ ] Mover una página a papelera, recuperarla y comprobar que no aparece públicamente mientras está borrada.
- [ ] Restaurar una revisión y comprobar que el estado anterior queda recuperable.
- [ ] Subir PNG, SVG y PDF seguros; verificar dimensiones, saneo y descarga.
- [ ] Intentar borrar un medio referenciado y confirmar respuesta 409.
- [ ] Verificar médicos, especialidades, servicios, estudios, menús, horarios y canales.

### Formularios y marketing

- [ ] Enviar un turno y verlo en la bandeja.
- [ ] Confirmar/cancelar un turno y comprobar mensajes/estados.
- [ ] Enviar formulario de contacto.
- [ ] Probar CAPTCHA real y rate-limit.
- [ ] Llegar con UTMs y comprobar atribución en panel/CSV.
- [ ] Aceptar y rechazar consentimiento; verificar que GA/GTM/Meta sólo cargan al aceptar.
- [ ] Suscribirse a newsletter, dar de baja y reactivar.

### SEO

- [ ] Canonical usa el dominio definitivo.
- [ ] `sitemap.xml` usa el dominio definitivo y no incluye borradores, papelera ni páginas aún programadas.
- [ ] `robots.txt` responde correctamente.
- [ ] `/estudios` entrega el HTML prerenderizado esperado.
- [ ] Search Console/Bing reconocen los tokens configurados.
- [ ] JSON-LD pasa una validación estructurada.

### Recuperación

- [ ] Registrar el SHA anterior al deploy.
- [ ] Confirmar la ruta del dump previo.
- [ ] Ejecutar una prueba de rollback en staging.
- [ ] Verificar que API, web, admin y base vuelven juntos al estado anterior.

---

## 10. Decisiones requeridas del propietario

| Decisión | Prioridad |
|---|---|
| Rotar todos los accesos del inventario privado y purgar el historial | **Bloqueante** |
| Proteger `main` con ruleset, review y 3 checks requeridos | **Bloqueante** |
| Confirmar dominio definitivo | **Bloqueante** |
| Confirmar capacidad, aislamiento y acceso SSH por llave | **Bloqueante** |
| Demostrar backup+restore externo de DB y uploads | **Bloqueante** |
| Configurar monitoreo y alertas | **Bloqueante** |
| Aprobar contenido definitivo y Biopsias | Alta |
| Crear claves CAPTCHA | Alta |
| Definir IDs de analítica | Media |
| Elegir proveedor de newsletter | Media |
| Decidir Blog/Noticias | Media |
| Definir roles granulares, idiomas, buscador y formularios | Planificación futura |
| Crear cuentas de negocio/OAuth para campañas | Fase de marketing posterior |

---

## 11. Veredicto actual

### Desarrollo y CI

**GO.** El código fusionado en `main` compila, construye y supera la suite completa contra MySQL 8.

### Despliegue inmediato a producción

**NO-GO.** Primero deben cerrarse credenciales e historial, protección de
`main`, dominio/DNS/HTTPS, capacidad y aislamiento, variables, acceso SSH por
llave, backups/restores de DB+uploads, monitoreo y contenido real.

Procedimientos:
[`docs/PREPRODUCCION-Y-GO-LIVE.md`](PREPRODUCCION-Y-GO-LIVE.md) y
[`docs/SEGURIDAD-SECRETO-HISTORICO.md`](SEGURIDAD-SECRETO-HISTORICO.md).

### Próxima acción concreta

La siguiente etapa no es otra ronda amplia de desarrollo. Es una ronda controlada de **preproducción y go-live**:

1. cerrar el secreto histórico;
2. preparar dominio/VPS/entorno;
3. desplegar en staging o en una ventana controlada;
4. ejecutar todas las pruebas post-deploy;
5. aprobar o revertir según resultados.

---

## 12. Fuentes verificadas

- `main` y merges de los PR #23 y #24 en GitHub.
- CI post-merge sobre `f398fed11e9030fa7955e7f6bd8d3426739bfe28` (run #61), `94e2e0ee4fc9c762d54c9d0f10bad3d6ff7cd19a` (run #63) y `fd49743a27543a5cd0c12e2839b6ba9760484d33` (PR #25, run #66): **success**.
- `CLAUDE_CONTEXT.md`, secciones 14–18.8.
- `AGENTS.md`.
- `README.md`.
- `docs/DEPLOY.md`.
- `docs/CARGA-DE-DATOS.md`.
- `.github/workflows/ci.yml`.
- `api/.env.example` y `.env.deploy.example`.
- PR #26, auditoría de scripts y prerrequisitos de infraestructura.
- CI del PR #26 sobre `7eb570ccc36ff8859555e54087a7dc9f7ecaebdb` (run #68): **success (3/3)**.
- `docs/PREPRODUCCION-Y-GO-LIVE.md` y `docs/SEGURIDAD-SECRETO-HISTORICO.md`.

---

## 13. Auditoría de preproducción — PR #26

**PR:** [#26](https://github.com/DaltonP93/WEB_SAA/pull/26) (Draft)  
**Rama:** `codex/preproduccion-seguridad-infraestructura`  
**Base:** `main@fd49743a27543a5cd0c12e2839b6ba9760484d33`  
**HEAD funcional probado:** `7eb570ccc36ff8859555e54087a7dc9f7ecaebdb`  
**Alcance:** auditoría y blindaje de scripts de preproducción, despliegue y prerrequisitos; sin acceso ni cambios en producción.

### 13.1 Terminado

- runbook público y saneado de preproducción/go-live;
- procedimiento seguro de rotación/purga, sin valores ni inventario sensible;
- despliegue fijable a un SHA aprobado mediante `DEPLOY_TO`;
- backup de base obligatorio y verificado con `gzip -t` antes de migrar;
- UFW permite SSH/HTTP/HTTPS antes de habilitarse y ya no oculta fallos;
- timeout SSH local fail-closed con salida 124, sin quedar bloqueado esperando;
- contrato explícito de `UPLOAD_STAGING_DIR`, fuera de uploads y en el mismo filesystem;
- ejemplos de entorno y guía de despliegue reconciliados con el contrato efectivo;
- 14 pruebas nuevas de regresión para los contratos anteriores;
- Actions del workflow fijadas a commits inmutables y gitleaks verificado por SHA-256 antes de extraer;
- 2 pruebas nuevas que bloquean referencias flotantes y artefactos sin integridad.

No se agregaron migraciones ni dependencias. No se cambiaron datos, DNS, credenciales, infraestructura ni el historial Git.

### 13.2 Validación

| Check sobre `7eb570c` | Resultado |
|---|---|
| Typecheck API/web/admin | OK |
| Build API/web/admin | OK |
| Suite MySQL 8 | **1516/1516 en 84 archivos** |
| Prerender real con API y base | OK |
| Auditoría de dependencias | OK |
| Secretos del árbol e historial según política actual | Job OK; incidente histórico sigue abierto |
| CI run #68 (blindaje de deploy) | **3/3 success** |
| Cadena de suministro (HEAD posterior) | Actions por SHA + gitleaks SHA-256; CI obligatoria |

**Corrector:** el primer HEAD de la ronda falló en CI por una sintaxis inválida del bootstrap. La prueba nueva de `bash -n` detectó el defecto; se corrigió y la corrida siguiente quedó verde. El fallo no llegó a `main` ni a un servidor.

### 13.3 Auditoría de infraestructura

La auditoría confirmó que `main` no tiene branch protection ni rulesets activos. Tampoco hay evidencia versionada suficiente para declarar cerrados dominio/DNS/TLS, capacidad y aislamiento, acceso SSH nominal, restore externo de DB+uploads, monitoreo/alertas, contenido final ni guardia operativa. La cadena de suministro del workflow queda fijada en este PR; sus futuras actualizaciones deben pasar por otro PR revisado y CI verde.

### 13.4 Veredicto y siguiente acción

- **Código, CI y documentación de preproducción:** GO para revisión del PR #26.
- **Producción:** **NO-GO** hasta cerrar los bloqueantes externos y el incidente histórico.
- **Siguiente acción recomendada:** revisión registrada del PR #26, mantener los tres checks verdes y, tras fusionarlo, completar privadamente protección de `main`, rotación/purga, infraestructura, backups/restores, monitoreo y dominio antes de autorizar una ventana de preproducción.

---

## 14. Regla de mantenimiento para próximas rondas

En cada trabajo sustancial se debe actualizar este documento antes de cerrar el
PR. Como mínimo:

1. registrar el PR y su alcance en la tabla de rondas;
2. mover a “terminado” lo que realmente quedó implementado;
3. agregar los nuevos pendientes o decisiones del propietario;
4. actualizar el conteo real de pruebas y los checks ejecutados;
5. mantener explícitos los bloqueos de producción y seguridad;
6. al comenzar el siguiente PR sustantivo, registrar el PR anterior
   fusionado, sustituir el HEAD de `main` y registrar su CI post-merge.

### Cierre post-merge sin ciclos documentales

No se abrirá un PR exclusivamente para registrar el merge de otro PR
exclusivamente documental.

Después de fusionar un PR documental, el nuevo HEAD de `main`, su CI y ese PR
se registrarán al comienzo del siguiente PR sustantivo.

Todo PR que cambie código, contratos, migraciones, seguridad, despliegue,
pruebas o funcionalidades debe actualizar `docs/ESTADO-PROYECTO.md`
dentro del mismo PR.

Un PR sustantivo es aquel que modifica código, configuración, migraciones,
seguridad, despliegue, pruebas o funcionalidades del producto. Una corrección
puramente documental no debe generar otra corrección documental sólo para
registrar su propio merge.

`CLAUDE_CONTEXT.md` conserva el historial técnico detallado de cada ronda;
`docs/ESTADO-PROYECTO.md` es la vista ejecutiva y operativa vigente. Si ambos
se contradicen, la ronda no está documentalmente cerrada.
