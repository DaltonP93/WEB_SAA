# CLAUDE_CONTEXT.md

> Contexto técnico de desarrollo, escrito para que otra IA (ChatGPT u otro
> asistente) pueda retomar el trabajo sin leer todo el historial del repo.
> Formato ejecutivo. Se actualiza en cada tarea terminada o preparación de
> cambios para GitHub.

**Última actualización:** Logos, selector multimedia y reordenamiento genérico
del Page Builder (§15).
**Cubre hasta:** PR #17 fusionado. La ronda del §15 está **en Draft, sin fusionar**.
**Estado de `main`:** `git log --oneline -1 origin/main`.
**Estado de CI:** los tres checks se exigen en verde antes de cada merge. El
resultado vigente es el del último run sobre `origin/main`, no un SHA anotado acá.

> **Por qué acá no hay ningún SHA de `main`.** Este documento fijaba
> `**main actual:** <sha>` y quedaba obsoleto con cada commit — incluido el
> commit que lo actualizaba, que por definición cambiaba el SHA que acababa de
> escribir. Las referencias estables de este proyecto son los **números de PR**,
> que no cambian una vez asignados. Los SHA sólo se citan cuando identifican algo
> inmutable: un commit histórico concreto (`9ced09d`) o el HEAD exacto que validó
> una ronda ya cerrada.

### Historial de rondas

| Ronda | PR | Qué cerró |
|---|---|---|
| 1–5 | #1–#5 | Seguridad, XSS, fuente única de contacto, migraciones con rollback, CI |
| 6 | #6, #7 | Allowlist de ajustes, reseed seguro, rollback desde `knex_migrations` |
| 7 | #8 | Rollback atómico, dumps verificados, reintento del CAPTCHA |
| — | #9 | Registro del merge de #8 + análisis de la fase 8 (§6) |
| 8 | #10 | Deriva documental, autoreejecución del deploy (§7) |
| A-1 | #11 | Guía operativa de carga de datos (§8) |
| A-2 (prerrequisitos) | #12 | ✅ fusionado — campos retirados con 410, canales protegidos, defaults de creación (§9) |
| A-2 (blindaje) | #13 | ✅ fusionado — rollback de la nota de guardia blindado, 403 estable, catálogo sin deriva, contrato de `data-readiness` documentado (§10) |
| A-2 (pantalla) | #14 | ✅ fusionado — blindaje por campos mutables, catálogo de horarios de runtime, endpoint `data-readiness` y pantalla "Datos pendientes" (§11) |
| Turnos (registro y bandeja) | #15 | ✅ fusionado — el formulario registra antes de salir a WhatsApp, migración con clave de envío única, bandeja en el panel (§12) |
| Turnos (correctiva) | #16 | ✅ fusionado — paginación y orden por servidor, zona horaria institucional, idempotencia antes del CAPTCHA (§13) |
| Multimedia (pipeline) | #17 | ✅ fusionado — staging fuera de `/uploads`, formato detectado por bytes, transparencia y animación conservadas, metadatos en `media`, logs sin datos personales (§14) |
| Logos y Page Builder | Draft | PDF validado de verdad, animación completa, staging blindado al arrancar, selector multimedia, bloque `Logos` y reordenamiento genérico (§15) |

---

## 0. Mapa del proyecto (para orientarse rápido)

Monorepo **pnpm 9** (`pnpm-workspace.yaml`: `apps/*`, `api`, `shared`).

| Paquete | Stack | Rol |
|---|---|---|
| `api` | Node 20 · Express 4 · TypeScript · Knex · MySQL 8 · JWT | API pública + panel |
| `apps/web` | React 18 · Vite · Tailwind · TanStack Query · react-router-dom | Sitio público |
| `apps/admin` | React 18 · Vite | Panel de administración (`/admin`) |
| `shared/types` | TypeScript | Tipos y constantes compartidas |

**Pruebas:** 50 archivos en `tests/`, **1053 pruebas**, `vitest`. Las que tocan
base real se activan con `TEST_DATABASE=1` (si no, se saltan con `describe.skip`).

**CI** (`.github/workflows/ci.yml`), tres jobs, todos bloqueantes:
1. `Typecheck, build y pruebas` — typecheck, 3 builds, suite contra MySQL 8 (service container) y verificación real del prerender.
2. `Detección de secretos` — `scripts/check-secrets.mjs` + `gitleaks` sobre el árbol (bloqueante) y sobre el historial (informativo, con el resultado real a la vista).
3. `Auditoría de dependencias` — `pnpm audit --prod`.

### Convenciones del repo que no son obvias

Estas ya causaron errores antes. Respetarlas:

1. **Módulos duplicados byte a byte.** `api` no puede importar *valores* desde
   `shared/` por el `rootDir` de su `tsconfig`. Por eso existen pares idénticos
   —`institutional-red.ts`, `lucide-icons.ts`, `contact-values.ts`,
   `embed-hosts.ts`— en `shared/types/` y `api/src/`. **La identidad está
   verificada por pruebas**: si se edita uno hay que editar el otro.
2. **Orden de los alias de vitest/vite.** Los alias de subruta deben ir **antes**
   del alias raíz `@sa/shared` (el matching es por prefijo y gana el primero).
   Aplica a `vitest.config.ts`, `apps/web/vite.config.ts` y `apps/admin/vite.config.ts`.
3. **MariaDB vs MySQL 8 y las columnas JSON.** MariaDB (local) las devuelve como
   *string*; MySQL 8 (CI) ya *parseadas*. Usar siempre el helper `jsonColumn()`
   de `tests/helpers/db.ts`.
4. **Migraciones correctivas idempotentes por snapshot.** Guardan una fila
   `SNAPSHOT_KEY` en `settings`; el `up()` retorna temprano si ya existe y el
   `down()` restaura y borra la clave.
5. **knex se ejecuta a través de `tsx`.** El migrador hace `import()` en runtime
   y Node 20 no lee `.ts` sin ayuda. Nunca invocar knex directo.
6. **No editar migraciones ya fusionadas.** Corregir siempre con una migración nueva.
7. **Las rutas del panel que viajan por la API son internas, sin `/admin`.** El
   admin se sirve bajo `/admin` y su router arranca con
   `basename: import.meta.env.BASE_URL`, así que React Router antepone el prefijo
   solo. Un `route: "/admin/schedules"` en una respuesta produce un `<Link>` a
   `/admin/admin/schedules`: pantalla en blanco y ningún error. Las URLs
   `/admin/…` de `docs/CARGA-DE-DATOS.md` son otra cosa —direcciones para
   escribir en el navegador— y están bien así.
8. **El CRUD sólo escribe `updated_at` si la tabla lo pide.** `crudRouter` guarda
   las columnas del payload y nada más; `touchUpdatedAt: true` agrega la marca.
   Sin eso, `updated_at` queda congelado en el valor que puso la migración que
   creó la fila, y cualquier mecanismo que la use para detectar ediciones lee un
   dato inmóvil (pasó con el blindaje del rollback de la guardia, §11.1).

---

## 1. Problemas encontrados y cómo se resolvieron (ronda 7)

Los cinco eran defectos de **fail-open**: el sistema seguía adelante cuando no
podía demostrar que la operación había salido bien.

### 1.1 `update-vps.sh` ofrecía un rollback que rompe la base

**Problema.** El script de actualización aceptaba `ROLLBACK_TO` y lo resolvía con
`git reset --hard <sha-viejo>` en el paso 1, **antes de mirar la base**. Eso deja
el árbol en la versión vieja con la base en la nueva: `knex_migrations` queda con
migraciones registradas cuyo archivo ya no existe en disco, así que knex no puede
revertirlas — y el `down()` que hacía falta era justamente el de la versión
nueva, que ya se borró. Además el propio script cerraba el círculo: al fallar el
health check imprimía ese mismo comando bajo la etiqueta `Rollback:`.

**Solución.** Rechazo explícito antes de tocar nada, con **código de salida 2**, y
redirección a `scripts/deploy/rollback-vps.sh`. Se eliminó de los cuatro lugares
donde aparecía: encabezado, variable + implementación, mensaje de error del
health check y `docs/DEPLOY.md`.

**Prueba** (`tests/deploy-update-no-rollback.test.ts`): se monta un `APP_DIR` que
es un repo git real con dos commits y se ejecuta el script de verdad. Se verifica
que el HEAD no se movió, que el archivo que sólo existe en la versión desplegada
sigue en disco, que el working tree quedó limpio y que no se anunció ningún paso.
Incluye el caso inverso (sin `ROLLBACK_TO` el script sigue de largo) para que el
rechazo no se convierta en un abort permanente.

### 1.2 Un fallo posterior a revertir la base dejaba el servidor mezclado

**Problema.** Revertir la base es el punto sin retorno: a partir de ahí corre la
aplicación **nueva** contra una base **vieja**. Un fallo de checkout,
`pnpm install --frozen-lockfile`, cualquiera de los tres builds, `nginx -t` o el
restart de PM2 dejaba exactamente ese estado y el script terminaba con un error
genérico.

**Solución — dos defensas, no una:**

- **Prevalidación** (paso 1): la versión destino se instala y compila en un
  `git worktree` separado, con el deploy actual intacto. Si no pasa → **código 2**,
  sin haber tocado base ni árbol. Omitible con `SKIP_PREVALIDACION=1` (avisa por
  stderr), para servidores justos de disco.
- **Recuperación**: si aun así falla una etapa posterior, se restaura el backup,
  se vuelve a `CURRENT_SHA`, se reconstruye y se reinicia. **Código 7** si el
  estado anterior quedó recuperado entero; **código 8** si quedó incompleta,
  detallando qué se pudo (base / árbol / builds / servicio).

**Decisión de diseño relevante:** los helpers (`reconstruir`,
`reiniciar_servicio`, `restaurar_dump`, `recuperar`) se definen arriba del
archivo porque los usan tanto el flujo normal como la recuperación. Como
consecuencia **el orden del archivo ya no refleja el orden de ejecución**; por eso
el flujo real está delimitado por el marcador `# === FLUJO PRINCIPAL ===`, y las
pruebas de orden se miden sobre ese bloque.

**Prueba** (`tests/rollback-atomico.test.ts`): `APP_DIR` es un repo git real con
remoto, la base es MySQL real, y `pnpm`, `nginx`, `systemctl`, `pm2` y `curl` son
binarios falsos que fallan en la enésima invocación de un ámbito concreto
(`FALLAR_CMD` / `FALLAR_AMBITO` / `FALLAR_NRO`). Cada caso verifica **las tres
cosas a la vez**: SHA del árbol, filas de la base y con qué versión arrancó el
proceso (el stub de PM2 registra el contenido de `marca.txt` al arrancar).

### 1.3 Un dump corrupto se reportaba como restauración exitosa

**Problema.** La ruta `RESTORE_DUMP` ejecutaba:

```bash
bash -c "gunzip < '$RESTORE_DUMP' | mysql -u'$DB_USER_ENV' '$DB_NAME_ENV'"
```

Un shell **nuevo** (sin `pipefail`) y con las rutas **interpoladas** en la cadena.
El estado de la pipeline era el de `mysql`, que termina bien con una entrada
vacía: **un gzip roto pasaba por restauración exitosa** y el script seguía al
`git reset`.

**Solución.** `gzip -t` antes que cualquier otra cosa —antes del backup y del
`git reset`—, y la pipeline corre en el shell del script, que ya tiene `pipefail`,
con los valores pasados como argumentos. Mismo tratamiento en la restauración del
backup dentro de `rollback-db.sh`. Además el backup recién generado también se
verifica con `gzip -t`: un backup ilegible no sirve para la recuperación de 1.2.

**Hueco encontrado en la revisión posterior (commit `e8e1a92`).** `gzip -t` sólo
garantiza que el archivo se descomprime. Un `.sql.gz` válido con **SQL inválido**
pasa la verificación y rompe con la base ya abierta, dejando parte aplicada. Ahora
ese caso restaura el backup del paso 2 → **código 4** si la base volvió a como
estaba, **código 5** si tampoco se pudo.

### 1.4 La verificación de migraciones era fail-open

**Problema.** `sigue_aplicada()` consultaba así:

```bash
n="$(... mysql ... -e "SELECT COUNT(*) FROM knex_migrations WHERE name = '$1'" 2>/dev/null || echo "")"
[ "$n" != "0" ] && [ -n "$n" ]
```

Una conexión caída, un permiso denegado o un `knex_migrations` inexistente
producían el mismo resultado que un rollback exitoso: la salida vacía se leía como
"la migración ya no está". El script las contaba como revertidas, seguía con la
siguiente y terminaba diciendo `Listo`. `rollback-vps.sh` entonces bajaba el árbol
sobre una base cuyo estado real nunca se comprobó.

**Solución.**

- `estado_migracion()` distingue **tres** resultados: `0` sigue aplicada, `1` ya no
  está, `2` no se pudo saber. El caso 2 aborta.
- El atajo "no se revirtió nada, la base está intacta" ahora exige **dos**
  condiciones: contador en cero **y** que haya fallado el propio `down()`. Si el
  `down()` terminó bien y no se pudo verificar, la base pudo haber cambiado y se
  restaura.
- **Se eliminó `eval`.** `DOWN_CMD` se separa en palabras una sola vez
  (`read -r -a DOWN_ARGV`) y se ejecuta como arreglo, con el nombre de la
  migración siempre como argumento. *Contrato nuevo: `DOWN_CMD` no admite
  argumentos con espacios.*
- **Validación estricta de nombres** contra `^[A-Za-z0-9][A-Za-z0-9._-]*$`, sin
  `..`, máximo 200 caracteres. Se valida **en dos lugares a propósito**:
  `migrations-to-revert.mjs` (único punto donde un `\n` embebido todavía se ve
  entero — después la lista viaja línea por línea y `a\nb` sería indistinguible de
  dos migraciones válidas) y otra vez en `rollback-db.sh`, que puede recibir una
  lista de otro origen.

**Prueba** (`tests/rollback-db-failclosed.test.ts`): un `mysql` falso simula la
conexión caída **sólo** en la consulta de verificación (la que lleva `-e`) y
delega la restauración al cliente real, para poder observar que el script aborta
**y** restaura. Los nombres hostiles incluyen `x'; touch …; echo '.ts`, `$(…)`,
backticks, `../../../etc/passwd`, `…; rm -rf /`, salto de línea y espacios; se
comprueba que el archivo centinela nunca se crea y que el comando de reversión no
llegó a ejecutarse.

### 1.5 El reintento del CAPTCHA nunca se recuperaba

**Problema.** El evento `load` de un `<script>` significa que el cuerpo llegó y se
ejecutó, **no** que el proveedor haya publicado su API global. El componente lo
trataba como equivalente: resolvía la promesa con `load`, comprobaba
`window.turnstile` justo después y fallaba — pero en el caché quedaba una promesa
**resuelta**. Cada reintento recibía esa misma promesa, volvía a encontrar la API
ausente y volvía a fallar. El formulario quedaba inservible hasta recargar la
página. Borrar sólo la entrada del caché tampoco alcanzaba: el `<script>` seguía
en el documento y el reintento agregaba un **segundo** SDK.

**Solución.** La promesa se resuelve recién cuando aparece `window[global]`, con
un tope de **8 s** (`GLOBAL_TIMEOUT_MS`, exportado) y sondeo cada 50 ms. Si no
aparece, `descartar(src)` elimina **las dos cosas** —el elemento `<script>` y la
entrada de caché—, de modo que el reintento inserta exactamente una copia nueva.
Los errores del *desafío* (no de carga) siguen usando `reset()` sin volver a bajar
nada.

**Prueba:** monta `ContactForm`, cuenta los `<script>` del **DOM real** (el stub
los inserta de verdad, no en una lista paralela) y usa timers falsos para cruzar
el tope. Verifica recuperación estable: segundo intento, API disponible, token
válido, alerta ausente y botón habilitado — y que siga así pasado el tope, para no
aprobar en el estado transitorio entre dos fallos.

---

## 2. Archivos cambiados y por qué

### Código de producción

| Archivo | Cambio | Motivo |
|---|---|---|
| `scripts/deploy/update-vps.sh` | Rechaza `ROLLBACK_TO` (exit 2); se quitó la rama `git reset --hard "$ROLLBACK_TO"`; el mensaje del health check apunta a `rollback-vps.sh` | 1.1 |
| `scripts/deploy/rollback-vps.sh` | Reescrito: helpers reutilizables, prevalidación en worktree, `recuperar()`, `restaurar_dump()` con `gzip -t` + `pipefail`, marcador `FLUJO PRINCIPAL`, códigos 2/7/8, `-h`/`-P` en `mysqldump` | 1.2, 1.3 |
| `scripts/deploy/rollback-db.sh` | `estado_migracion()` en vez de `sigue_aplicada()`; `FALLO_TIPO`; sin `eval`; `nombre_valido()`; `restaurar_dump()` compartida | 1.3, 1.4 |
| `scripts/deploy/migrations-to-revert.mjs` | Valida todos los nombres de `knex_migrations` y aborta con exit 3 sin emitir nada | 1.4 |
| `apps/web/src/components/Captcha.tsx` | `loadProvider()` + `esperarApiGlobal()` + `descartar()`; el caché guarda `{promise, el}`; `GLOBAL_TIMEOUT_MS` exportado | 1.5 |
| `docs/DEPLOY.md` | Se quitó `update-vps.sh` como camino de rollback; el procedimiento pasó de 5 a 6 pasos (prevalidación) y se documentaron recuperación y códigos de salida | 1.1, 1.2 |

### Pruebas

| Archivo | Estado | Contenido |
|---|---|---|
| `tests/deploy-update-no-rollback.test.ts` | **nuevo** (11) | Rechazo de `ROLLBACK_TO` sobre el script real |
| `tests/rollback-atomico.test.ts` | **nuevo** (16) | Fallos forzados de install/build/nginx/PM2 y verificación de dumps |
| `tests/rollback-db-failclosed.test.ts` | **nuevo** (18) | Conexión caída en la verificación y nombres manipulados |
| `tests/captcha-widget.test.tsx` | 10 → 13 | Ver nota de reescritura abajo |
| `tests/rollback-db.test.ts` | 18 → 18 | Dos aserciones reancladas (ver abajo) |
| `tests/rollback-flow.test.ts` | 15 → 16 | Orden medido sobre `FLUJO PRINCIPAL` + caso de prevalidación |

### Nota importante sobre modificaciones a pruebas existentes

Se **reescribió exactamente una** prueba:
`si el script carga pero el proveedor no expone su API, el reintento no mete otro`.
Afirmaba que la promesa resuelta debía **reutilizarse** — es decir, fijaba
exactamente el comportamiento que 1.5 corrige. Se reemplazó por cuatro que
verifican la recuperación estable. **Ninguna otra prueba se eliminó ni se
debilitó.**

Tres aserciones se **reanclaron** sin bajar su exigencia:
- El orden de `rollback-vps.sh` se mide sobre el bloque `FLUJO PRINCIPAL` (buscar
  strings en todo el archivo medía el orden de las *definiciones*, no el de la
  *ejecución*).
- El bucle de reversión de `rollback-db.sh` se localiza por `REVERTIDAS=0` en vez
  de por el primer `while` (ahora el primero es el de validación de nombres).
- El bloque de códigos de `RB_CODE` se delimita con `4/6` en vez de `3/5` por la
  renumeración de pasos.

### Verificación de que las pruebas nuevas son regresiones reales

Se ejecutaron contra el código anterior restaurado desde git:

| Suite nueva | Falla con el código viejo |
|---|---|
| `rollback-db-failclosed` | **16 / 18** |
| `rollback-atomico` | **11 / 15** (antes del caso 1.3-bis) |
| CAPTCHA (bloque nuevo) | **4 / 4** |

Las que pasan en ambas versiones son **deliberadas**: son las que impiden que la
corrección se convierta en un freno permanente (camino feliz, dump válido,
conexión sana).

---

## 3. Estado actual y qué falta

### Estado: verde

| Comprobación | Resultado |
|---|---|
| Pruebas (Node 20 + MySQL/MariaDB, `TEST_DATABASE=1`) | **1053 / 1053** en 50 archivos |
| `pnpm typecheck` | OK |
| Builds `@sa/api` / `@sa/web` / `@sa/admin` | OK |
| Prerender real (`scripts/ci/verify-prerender.mjs`) | OK, exit 0 |
| `pnpm audit --prod` | *No known vulnerabilities found* |
| `node scripts/check-secrets.mjs` | Sin credenciales en el árbol |
| `gitleaks detect --no-git` (árbol) | *no leaks found* |
| **CI: 3 / 3 checks** | se exigen en verde antes de cada merge; el resultado vigente es el del último run |

> Los 1053 salen del baseline de **980 en 47 archivos** (PR #15 fusionado) más
> lo de la ronda del §13, medido con `vitest run --reporter=json`. **No se quitó
> ni se relajó ninguna prueba existente**; los ajustes se explican en el §13.6.

**Los PR #8 a #15 están fusionados a `main`**, todos por instrucción explícita
del propietario y con los tres checks en verde. Ninguno tiene nada pendiente: se
desarrollaron bajo la consigna "sin merge, sin deploy, sin Ready for review" y el
propietario levantó esa restricción caso por caso una vez verdes los checks.

**El deploy sigue sin hacerse**: fusionar a `main` no despliega nada por sí solo.
Verificado: `.github/workflows/` tiene un único workflow (`ci.yml`), disparado por
`push` a main y `pull_request`, con tres jobs de validación y **ningún** job de
deploy ni paso de ssh, rsync o scp. El despliegue se dispara a mano con
`scripts/deploy/update-vps.sh` en el VPS.

### Pendiente que requiere decisión humana (no tocar por cuenta propia)

1. **Secreto en el historial de git.** `gitleaks` reporta 1 hallazgo:
   `scripts/deploy/setup-vps.sh`, regla `shell-default-credential`, desde el commit
   `9ced09df`. El árbol actual está limpio; el valor sigue en la historia.
   Sacarlo exige reescribir el historial (`git filter-repo`) y coordinar con
   quienes tengan clones. **Sólo se informa: no se rotó ni se purgó nada.**
   Es una decisión del propietario del repositorio. **El NO-GO de producción se
   mantiene mientras esa decisión no se tome.**
2. **Logos y centro de campañas.** Explícitamente fuera de alcance desde la ronda 4
   y hasta nueva orden. **No trabajar en esto sin autorización separada.**
3. **Merge, deploy y Ready for review** de la ronda del §13, que está en Draft:
   los decide el propietario. Los PR #8 a #15 ya están fusionados y no tienen
   nada pendiente.
4. **Confirmación escrita del alcance de Biopsias.** Mientras no exista, la
   pantalla A-2 lo reporta como `review` por diseño y `overall` nunca llega a
   `complete`. No se deduce del texto de la página: eso convertiría "alguien
   editó" en "el sanatorio confirmó".

### Deuda técnica conocida (no bloqueante)

- Los bundles de `apps/web` y `apps/admin` superan 500 kB minificados; Vite lo
  avisa en cada build. Se podría hacer code-splitting con `manualChunks`.
- La prevalidación en worktree instala un `node_modules` aparte: cuesta disco y
  tiempo en el VPS. Mitigado con `SKIP_PREVALIDACION=1`, no eliminado.
- `esperarApiGlobal()` sigue sondeando hasta el tope aunque el componente se
  desmonte. No produce fugas observables (el flag `cancelled` bloquea los
  `setState`) y mantener la promesa en caché es deseable para un remontaje rápido.

### Restricciones permanentes del proyecto

Vienen de rondas anteriores y siguen vigentes:

- **No inventar** teléfonos, correos, horarios, prestaciones médicas ni datos
  institucionales. Si un dato no está confirmado, no se publica.
- **No mostrar secretos** en terminales, commits, logs ni respuestas.
- **No reescribir el historial remoto** ni cambiar credenciales del servidor sin
  autorización.
- **El rojo (`bg-accent`) es exclusivo de Emergencias**, verificado por allowlist
  de paleta, revalidación de salida y chequeo en tiempo de render.
- **No editar migraciones ya fusionadas.**

---

## 4. Cómo reproducir la validación completa

```bash
pnpm install --frozen-lockfile

# Suite completa (requiere MySQL 8 o MariaDB en 127.0.0.1:3306)
TEST_DATABASE=1 pnpm test

# Typecheck y los tres builds
pnpm typecheck
pnpm --filter @sa/api build
pnpm --filter @sa/web build
pnpm --filter @sa/admin build

# Prerender real: levanta la API contra una base migrada y sembrada
DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=root DB_PASS=root \
  PRERENDER_DB_NAME=sanatorio_prerender node scripts/ci/verify-prerender.mjs

# Seguridad
pnpm audit --prod
node scripts/check-secrets.mjs
gitleaks detect --no-git --source . --config .gitleaks.toml --redact
```

Suites individuales de la ronda del §10:

```bash
TEST_DATABASE=1 npx vitest run tests/rollback-nota-emergencias-blindado.test.ts
TEST_DATABASE=1 npx vitest run tests/canales-reservados.test.ts
npx vitest run tests/entity-manager-defaults.test.tsx           # jsdom
npx vitest run tests/docs-datos-pendientes-contrato.test.ts     # no necesita base
```

---

## 5. Referencia rápida: códigos de salida de los scripts de deploy

### `scripts/deploy/update-vps.sh`
| Código | Significado |
|---|---|
| 0 | Actualización completa y `/api/health` = 200 |
| 1 | Error de una etapa |
| **2** | Se pidió `ROLLBACK_TO`: este script no hace rollback, **nada se modificó** |

### `scripts/deploy/rollback-vps.sh`
| Código | Significado |
|---|---|
| 0 | Rollback completo y la aplicación responde |
| 1 | Error de uso o de una etapa previa (nada se tocó) |
| **2** | La versión destino no pasó la prevalidación (nada se tocó) |
| 4 | Se abortó y la base quedó como antes; el código NO se bajó |
| 5 | La base quedó en un estado intermedio y no se pudo restaurar |
| 6 | El rollback se aplicó pero el health check no dio 200 |
| **7** | Falló una etapa posterior a la base y se recuperó el estado anterior |
| **8** | Falló una etapa posterior a la base y la recuperación quedó incompleta |

### `scripts/deploy/rollback-db.sh`
| Código | Significado |
|---|---|
| 0 | Se revirtió lo que había que revertir (o no había nada) |
| 3 | No se pudo calcular la lista, o trae un nombre que no es un nombre |
| 4 | El rollback se abortó y la base quedó como antes |
| 5 | La base quedó en un estado intermedio y no se pudo restaurar |

---

## 6. Fase 8 — Análisis y planificación (Agente Analista, sin implementar)

> Salida del **Agente 1 (Analista)** de `AGENTS.md` §5, sobre `main = 2359a117`.
> **Nada de esto está implementado.** Es el insumo para decidir alcance antes de
> pasar al Agente 2 (Desarrollador). Lecturas previas obligatorias hechas:
> `AGENTS.md`, `shared/types/blocks.ts`, `api/migrations/20260516000001_init.ts`.

### 6.0 Hallazgo transversal: deriva documental en `AGENTS.md`

`AGENTS.md` es "lectura obligatoria" y quedó desactualizado en cuatro puntos que
afectan decisiones. Cualquier IA que abra el repo lee primero ese archivo:

| Línea | Dice | Realidad |
|---|---|---|
| `AGENTS.md:336` | `🔲 Tests automatizados (no hay; los agentes hacen smoke testing manual)` | Hay 603 pruebas y 3 jobs de CI bloqueantes |
| `AGENTS.md:58` | Publica un usuario y contraseña de seed literales | Desde la ronda 6 la contraseña se genera. **Corrección de la ronda 8:** acá se afirmaba que ese literal "es justo lo que `check-secrets` busca". Era falso — se comprobó ejecutando `check-secrets` y `gitleaks` con la credencial presente y los dos salieron en verde. Ver §7.1 |
| `AGENTS.md:364` | Describe `update-vps.sh` sin el rechazo de `ROLLBACK_TO` | La ronda 7 lo rechaza con código 2 |
| `AGENTS.md:342-399` | El runbook §9 no menciona `rollback-vps.sh` | Existe y es el único camino de rollback (códigos 0–8) |

### 6.1 Ola A — Cierre de preparación productiva

Inventario de lo que falta cargar y **desde dónde se carga cada cosa**:

| Dato | Dónde vive | Se carga desde | Estado |
|---|---|---|---|
| WhatsApp Turnos | `contact_channels.key='whatsapp-turnos'` | **Admin** → Canales de contacto | Vacío |
| WhatsApp Estudios | `contact_channels.key='whatsapp-estudios'` | **Admin** | Vacío |
| WhatsApp General | `contact_channels.key='whatsapp-general'` | **Admin** | Vacío |
| WhatsApp SAMAP | `contact_channels.key='whatsapp-samap'` | **Admin** | Vacío |
| Emergencias | `contact_channels.key='emergencias'` | **Admin** | Vacío |
| GTH (correo) | `contact_channels.key='gth'` | **Admin** | Vacío |
| Recepción / email general | `contact_channels.key='recepcion'`, `'email-general'` | **Admin** | Vacío |
| Horarios | Tabla `schedules` | **Admin** → Horarios | Sin filas activas |
| Biopsias (alcance) | Página `estudios-biopsias`, bloques `richText` | **Admin** → Page Builder | Texto genérico |
| `PUBLIC_SITE_URL` | `api/.env` del VPS | **Servidor**, no admin | Apunta a la IP del VPS |

**Trampa operativa.** `emergencyPhone` y `gthEmail` ya **no** están en
Configuración → Contacto: `20260816000000_fuente_unica_contacto.ts:41-54` los
movió a `contact_channels` y los dejó en `RETIRED_CONTACT_FIELDS`
(`api/src/routes/admin/settings.ts`).

> **Corrección de los prerrequisitos de A-2 (PR #12).** Cuando se escribió este
> análisis, la API **no** respondía 410 con esos campos: `sanitizeSettingValue()`
> los borraba del objeto y la respuesta seguía siendo `200 {ok:true}`. Quien los
> escribía recibía un "guardado" y el dato no quedaba en ningún lado. El PR #12
> lo corrigió: ahora los seis campos retirados se rechazan con **410 explícito**,
> en los dos endpoints y de forma atómica. Ver §9.1.

**`PUBLIC_SITE_URL` es el único que no es de admin** y el de mayor impacto SEO:
alimenta canonical y `sitemap.xml` (`api/src/app.ts:149`) y el prerender
(`apps/web/scripts/prerender.mjs:16`). Cambiarlo exige DNS + HTTPS confirmados y
**es decisión del propietario** (`AGENTS.md:338`).

Archivos relevantes: `api/migrations/20260813000000_contact_channels.ts:25-80`
(catálogo de las 8 claves) · `api/migrations/20260813000001_schedules.ts:31` ·
`shared/types/contact-values.ts` (validación por kind) ·
`apps/web/src/components/Layout.tsx:221,299,509` (consumo de Emergencias) ·
`api/.env.example:26`.

### 6.2 Ola B — Logos

El bloque **existe y es seguro** (la ronda 5 blindó `imageUrl` y `href`), pero
**no está listo para logos reales**.

```
shared/types/blocks.ts:230-233                            LogosProps
shared/types/blocks.ts:296                                registro
apps/web/src/blocks/Logos.tsx                             render + validación de URLs
apps/admin/src/components/BlockPropsEditor.tsx:181-188    editor de props
api/src/routes/admin/media.ts:23,26,94-106                uploads + optimización
api/migrations/20260812000000_web_minuta_ajustes.ts:832   única instancia (vacía), página convenios
```

**Dos caminos que no hay que confundir:** el logo institucional del header/footer
es `settings.brand.logoUrl` (`Layout.tsx:281,331`), no el bloque `logos`. Este
último es para convenios y aliados.

| # | Brecha | Severidad | Detalle |
|---|---|---|---|
| B1 | **SVG rechazado** | Alta | `media.ts:23` permite `.jpg .jpeg .png .webp .gif .pdf`. Los logos de marca se entregan casi siempre en SVG/EPS/AI |
| B2 | **Enlace sin nombre accesible** | Alta | `Logos.tsx:20` usa `alt={l.alt ?? ""}`; con `alt=""` dentro de un `<a>` el enlace queda sin nombre → falla WCAG 2.4.4 y 4.1.2 |
| B3 | **Sin tope de ancho** | Media | `h-12 w-auto` sin `max-w`: un logo apaisado desborda en móvil (`flex-wrap` no ayuda si un solo ítem supera el viewport) |
| B4 | **`opacity-80` sobre logos de terceros** | Media | Muchos manuales de marca prohíben alterar opacidad o color. Decisión del cliente, no técnica |
| B5 | **Sin reordenar** | Media | El editor `kind:"items"` sólo tiene "Quitar" (`BlockPropsEditor.tsx:265`): no hay ↑/↓ ni DnD |
| B6 | **Sin `width`/`height` ni `loading="lazy"`** | Baja | CLS y carga innecesaria |
| B7 | **Sin vigencia de convenio** | Baja | No se puede despublicar un convenio sin borrarlo |

### 6.3 Ola C — Centro de campañas (diseño, sin implementar)

**Restricción heredada, no negociable.** `settings.scripts` fue retirado con 410
y el mensaje ya fija el rumbo — `api/src/routes/admin/settings.ts:160`:
*"no se inyecta JavaScript arbitrario en el sitio. Las integraciones de medición
van a entrar por módulos propios."* (migración
`20260819000000_retirar_scripts.ts`). **Ninguna etapa puede reintroducir un campo
de texto libre ejecutable.**

Hoy no existe nada de medición: un grep de `consent|gtag|dataLayer|analytics|pixel`
sobre `apps/web/src`, `api/src` y `shared` sólo devuelve ese comentario.

| Etapa | Alcance | Riesgo | Depende de |
|---|---|---|---|
| **C1 · Medición y consentimiento** | Banner, estado persistido, *ningún* tag antes del opt-in. Preferencia fuerte: eventos **server-side** (Meta Conversions API / GA4 Measurement Protocol) en vez de píxeles en el cliente | Legal (datos de salud) | — |
| **C2 · OAuth de cuentas** | Meta Business y Google Ads. Tokens **cifrados at-rest**, refresh, scopes mínimos, un `redirect_uri` por entorno | Alto: custodia de tokens | C1 |
| **C3 · Métricas y reportes** | Sólo lectura. Caché con TTL, límites de cuota, degradación si la API de terceros cae | Bajo | C2 |
| **C4 · Creación/edición de campañas** | Escritura contra las APIs. Formularios tipados con Zod, sin HTML/JS libre | Alto: gasto real | C3 |
| **C5 · Presupuestos, permisos, auditoría, revocación** | Topes de gasto, rol `campaigns`, bitácora inmutable, revocación de tokens | — | C4 |

**Por qué server-side primero:** un píxel en el cliente obliga a abrir
`script-src` y `connect-src` de la CSP hacia Meta y Google
(`scripts/deploy/setup-vps.sh:240`), reabriendo buena parte de la superficie que
las rondas 3–6 cerraron. Con Conversions API la CSP no se toca.

**Advertencia de contexto:** es el sitio de un sanatorio. Enviar eventos de
navegación de páginas como `/estudios-biopsias` a plataformas publicitarias puede
constituir tratamiento de datos de salud. Necesita criterio legal **antes** de
escribir código.

**Credenciales e IDs que harán falta** — enumeración de *qué* se necesitará. Los
valores van a `api/.env` en el servidor, fuera de git; **no se cargan ni se
muestran en la terminal**:

- **Meta**: App ID · App Secret · Business Manager ID · Ad Account ID (`act_…`) ·
  Dataset/Pixel ID · System User token · versión de Graph API · dominio verificado.
- **Google**: Developer token de Google Ads · OAuth Client ID + Secret ·
  Customer ID (MCC y cuenta hija) · acciones de conversión · GA4 Measurement ID
  + API Secret si se usa Measurement Protocol.
- **Infra**: `redirect_uri` por entorno (requiere el dominio definitivo, o sea
  **depende de la Ola A**) y clave de cifrado para los tokens.

### 6.4 Ola D — Seguridad y operación

**El NO-GO de producción se mantiene** por el secreto histórico del commit
`9ced09d`. El procedimiento ya está escrito en `AGENTS.md:402-424` y lo ejecuta
el propietario, por separado: rotar la contraseña de root → revisar accesos SSH
(`last -F`, `/var/log/auth.log`, `authorized_keys`) → deshabilitar autenticación
por contraseña → purgar el historial de forma coordinada (`git filter-repo`/BFG,
todos re-clonan) → rotar de nuevo y revisar forks, CI y capturas.

Desde el repo sólo corresponde dejar el NO-GO visible en el `README`, para que no
viva únicamente en el §10 de un archivo largo.

### 6.5 Riesgos

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| R1 | Cambiar `PUBLIC_SITE_URL` sin DNS/HTTPS listos | Canonical y sitemap rotos, penalización SEO | Cambiar sólo tras confirmar DNS+TLS; verificar sitemap post-deploy |
| R2 | Aceptar SVG sin sanear | XSS almacenado (SVG ejecuta JS) | Sanear server-side y servir con CSP propia |
| R3 | Datos de contacto mal formados | `tel:`/`mailto:` rotos en producción | Ya cubierto por `contact-values.ts` en 3 capas |
| R4 | Píxeles publicitarios en páginas clínicas | Riesgo legal por datos de salud | C1 server-side + criterio legal previo |
| R5 | Tokens de Ads en texto plano | Compromiso de cuentas con gasto real | Cifrado at-rest + revocación (C5) |
| R6 | C4 sin topes de presupuesto | Gasto no controlado | No fusionar C4 sin C5 |
| R7 | Deriva de `AGENTS.md` | Cada IA nueva parte de premisas falsas | PR A-0 |
| R8 | Deploy con `--frozen-lockfile` | Falla si falta el lockfile commiteado | Ya documentado (`AGENTS.md:368`) |
| R9 | **1.9 GB de RAM en el VPS** | `vite build` ya mató PM2 una vez, con 19 días de caída (`AGENTS.md:388`) | La prevalidación en worktree de la ronda 7 **suma** presión: decidir explícitamente si en ese VPS se usa `SKIP_PREVALIDACION=1` |

### 6.6 Dependencias externas

| Dependencia | Bloquea | Quién la provee |
|---|---|---|
| Valores de contacto, horarios, alcance de Biopsias | Ola A | Cliente (sanatorio) |
| DNS + certificado del dominio definitivo | `PUBLIC_SITE_URL`, `redirect_uri` de OAuth | Propietario |
| Archivos de logos + autorización de uso | Ola B | Cliente / aseguradoras |
| Manual de marca de cada aseguradora | B4 (opacidad) | Cliente |
| Cuenta Meta Business + Ad Account | C2 | Propietario |
| Developer token de Google Ads (requiere aprobación) | C2 | Google, **con demora de días** |
| Criterio legal sobre datos de salud | C1 | Propietario |
| Rotación de credenciales del VPS | GO de producción | Propietario |

### 6.7 Decisiones que necesita tomar el propietario

1. **¿Se acepta SVG para logos?** Sí (con saneo server-side) / No (el cliente entrega PNG-WebP). — *bloquea B-1*
2. **¿Se mantiene `opacity-80` sobre los logos de terceros?** — *bloquea B-2*
3. **¿Los logos enlazan al sitio de la aseguradora?** Define si B2 es crítico o cosmético.
4. **¿Cuál es el dominio definitivo y cuándo estarán DNS+HTTPS?** — *bloquea A-3 y C2*
5. **¿Medición server-side únicamente, o se aceptan píxeles en el cliente?** — *define si se toca la CSP*
6. **¿Revisión legal antes de C1?** Recomendación: sí.
7. **¿Cuándo se ejecutan los pasos 1–5 de `AGENTS.md` §10?** — *bloquea el GO de producción*
8. **¿`SKIP_PREVALIDACION=1` en el VPS de 1.9 GB?** — *ver R9*

### 6.8 Roadmap en PRs pequeños y ordenados

Cada PR recorre el ciclo completo de `AGENTS.md` §5 (Analista → Desarrollador →
Tester → Corrector).

**Ola A — Preparación productiva** *(sin dependencias externas salvo A-3)*

| PR | Estado | Alcance | Pruebas requeridas |
|---|---|---|---|
| **A-0** | ✅ **completado** (PR #10) | Actualizar `AGENTS.md` (§8 pruebas, §9 rollback, quitar el literal de contraseña de §2) | `check-secrets` y `gitleaks` sobre el árbol; prueba que afirme que `AGENTS.md` no contiene credenciales literales |
| **A-1** | ✅ **completado** (PR #11) | `docs/CARGA-DE-DATOS.md`: guía de carga con la tabla de 6.1, incluida la trampa de `emergencyPhone`/`gthEmail` | Prueba de que cada clave documentada existe en el catálogo de `contact_channels` (evita que la guía se desincronice) |
| **A-2** (prerrequisitos) | ✅ **completado** (PR #12) | 410 en campos retirados, canales institucionales protegidos, defaults de creación explícitos | §9 |
| **A-2** (blindaje) | ✅ **completado** (Draft, §10) | Rollback de la nota de guardia blindado, 403 estable, catálogo sin deriva, contrato de `data-readiness` en `docs/DATOS-PENDIENTES-CONTRATO.md` | §10 |
| **A-2** (pantalla) | 🔲 **pendiente** — único ítem abierto de la Ola A sin bloqueo externo | Panel: pantalla "Datos pendientes" que liste qué falta leyendo el estado real | Las nueve del §8 de `docs/DATOS-PENDIENTES-CONTRATO.md` |
| **A-3** | 🔲 pendiente — **bloqueado** por dominio, DNS y HTTPS confirmados | `PUBLIC_SITE_URL` al dominio definitivo | Verificación post-deploy de `sitemap.xml` y canonical; `verify-prerender.mjs` |

> A-2 es el de mayor valor operativo: convierte "¿qué falta?" en algo que el
> sanatorio ve solo. Su contrato ya está escrito y atado a sus fuentes en
> `docs/DATOS-PENDIENTES-CONTRATO.md`; lo que falta es implementarlo.

**Ola B — Logos** *(tras las decisiones 1–3)*

| PR | Alcance | Pruebas requeridas |
|---|---|---|
| **B-1** | Habilitar la carga: decisión SVG, `max-w`, `loading="lazy"`, `width`/`height` | Si hay SVG: pruebas de saneo con SVG hostil (`<script>`, `onload`, `<foreignObject>`), en la línea de `tests/sanitize.test.ts`. Extender `tests/block-urls.test.tsx` con overflow |
| **B-2** | Accesibilidad y presentación: `alt` obligatorio cuando hay `href`, decisión sobre `opacity-80` | jsdom: logo con `href` y sin `alt` → o no se enlaza, o el `<a>` tiene nombre accesible. Nunca un `<a>` sin nombre |
| **B-3** | Reordenar ítems en `BlockPropsEditor` (↑/↓ o dnd-kit, ya presente en `apps/admin`) | Prueba de que reordenar persiste el orden en `props.logos` |

**Ola C — Centro de campañas** *(no empezar sin aprobación de alcance)*

| PR | Alcance | Pruebas requeridas |
|---|---|---|
| **C1a** | Modelo de consentimiento + banner. **Cero tags** | Sin consentimiento no se inserta ningún `<script>` ni sale ninguna request a terceros |
| **C1b** | Envío server-side de eventos, detrás de un flag apagado por defecto | Flag apagado → cero llamadas salientes; encendido sin credenciales → degrada sin romper |
| **C2** | OAuth + almacenamiento cifrado de tokens | El token nunca aparece en logs ni en respuestas de la API; la revocación borra de verdad; `gitleaks` |
| **C3** | Métricas de sólo lectura | API de terceros caída → el panel degrada, no rompe |
| **C4** | Creación/edición de campañas | Validación Zod exhaustiva; ningún campo acepta HTML/JS |
| **C5** | Presupuestos, permisos, auditoría, revocación | Usuario sin rol `campaigns` recibe 403; toda escritura deja registro de auditoría |

> **C4 no se fusiona sin C5.** Escribir campañas sin topes ni bitácora es gasto
> real sin control.

**Ola D — Seguridad** *(transversal, no bloquea a las demás)*

| PR | Alcance | Pruebas requeridas |
|---|---|---|
| **D-1** | Nota de NO-GO visible en `README.md` | Prueba de que la nota existe mientras el hallazgo histórico siga presente |
| **D-2** | *(sólo tras autorización)* purga del historial | Fuera del alcance de un PR: procedimiento coordinado del propietario |

### 6.9 Secuencia recomendada

**A-0 → A-1 → A-2** primero (A-0, A-1 y los dos PR previos de A-2 ya están
hechos; queda la pantalla): son baratos, no dependen de nadie externo y
desbloquean al cliente para que cargue datos. **B** en paralelo apenas se
respondan las decisiones 1–3. **A-3** cuando el dominio esté. **C** sólo después
de la revisión legal y con alcance aprobado por escrito.

**Estado de aprobación: pendiente.** No se trabaja en logos ni en campañas hasta
que el propietario apruebe el alcance.

---

## 7. Ronda 8 — Preparación previa a las Olas A–D

> Ronda correctiva **anterior** a empezar las olas del §6. No implementa logos ni
> campañas: corrige la documentación de la que parte cualquier IA y un defecto
> del deploy que apareció al analizar el §6.

### 7.1 La documentación mentía, y ninguna herramienta lo detectaba

`AGENTS.md` —el archivo que el propio repo declara "lectura obligatoria antes de
tocar este repo"— afirmaba cuatro cosas falsas:

| Decía | Realidad |
|---|---|
| `🔲 Tests automatizados (no hay; los agentes hacen smoke testing manual)` | 629 pruebas en 33 archivos y tres jobs de CI bloqueantes |
| Publicaba un par correo/contraseña de seed literal | Desde la ronda 6 la contraseña se genera |
| `update-vps.sh` "se re-ejecuta a sí mismo", y "hay que deployar dos veces" | Ver §7.2: la reejecución **nunca ocurría** |
| El runbook no mencionaba `rollback-vps.sh` | Existe desde la ronda 5, con códigos 0–8 |

**El hallazgo importante no es la línea, es que nadie la veía.** Se ejecutaron
`check-secrets` y `gitleaks` sobre el árbol con la credencial presente: **los dos
salían en verde**. Las dos herramientas buscan formas de *asignación*
(`PASSWORD="…"`, `VAR="${VAR:-…}"`), y una credencial escrita en prosa —entre
backticks, separada por una barra— no tiene esa forma. La línea sobrevivió siete
rondas de auditoría por eso.

Buscándola con un detector propio apareció **una segunda ocurrencia** que no
estaba en el encargo: la misma credencial en la tabla de servicios de
`README.md`, más un par `root`/`root` para phpMyAdmin.

`tests/docs-sin-credenciales.test.ts` cubre el hueco. Detecta dos formas —el par
`correo / valor` en prosa y la etiqueta pegada al valor (`Contraseña: \`x\``)— y
**se autoverifica**: incluye casos sintéticos que el detector debe marcar, para
que un detector roto no pase en verde dando una garantía que no da. Los falsos
positivos se descartan por forma (nombres de variable en mayúsculas,
expansiones `$VAR`, rutas, SHA, asignaciones), no por lista de excepciones.

### 7.2 La autoreejecución del deploy nunca ocurría

`update-vps.sh` hace `git reset --hard origin/main` en el paso 1, y ese reset
puede reescribir el archivo que se está ejecutando. El script intentaba
detectarlo así, **después** del reset:

```bash
CURRENT_HASH=$(sha256sum "$SELF" | awk '{print $1}')   # el archivo del repo
RUNNING_HASH=$(sha256sum "$0"    | awk '{print $1}')   # el script en ejecución
```

En un deploy normal el script se invoca por su ruta en el repo, así que `$0` y
`$SELF` **son el mismo archivo** — y para cuando se comparan, ya fue actualizado
por el reset. Los hashes daban iguales siempre: la reejecución no ocurría nunca.
El deploy terminaba corriendo la versión vieja del script y cualquier arreglo se
aplicaba recién en el deploy siguiente. `AGENTS.md` documentaba ese síntoma como
si fuera una limitación aceptada ("hay que deployar dos veces") en vez de un bug.

Debajo había un segundo problema, más silencioso: **bash no carga el script
entero en memoria, lo lee por offset mientras lo ejecuta**. Con el archivo
reescrito debajo, el intérprete seguía leyendo el contenido nuevo desde la
posición vieja, así que lo que se ejecutaba a partir del reset era una mezcla
arbitraria de las dos versiones.

**Corrección.** El script empieza copiándose a `/tmp` y reejecutándose desde la
copia, antes de tocar el repo:

- la copia inmuniza al intérprete de que el archivo cambie debajo;
- y `$0` pasa a conservar el contenido con el que arrancó el deploy, así que la
  comparación posterior contra el archivo del árbol **compara dos cosas
  distintas** y detecta el cambio de verdad.

`DEPLOY_REEXEC=1` viaja al proceso reejecutado y garantiza una sola reejecución.
La copia se borra al salir (`trap … EXIT`) y a mano antes del `exec`, porque
`exec` no dispara traps.

**Qué se repite, exactamente.** La reejecución está colocada **entre el paso 1 y
el paso 2**, así que lo único que vuelve a correr es el `git fetch` + `reset`, que
la segunda vez es un no-op. **El `pnpm install` y los tres builds corren una sola
vez.**

Esto no es un detalle: el VPS tiene 1.9 GB de RAM y ya hubo un incidente de 19
días de caída porque `vite build` tumbó el daemon de PM2 por presión de memoria
(`AGENTS.md` §9). Si la reejecución repitiera los builds, este arreglo duplicaría
el pico de memoria del deploy justo en el punto que ya falló una vez. No lo hace,
y `tests/deploy-update-reexec.test.ts` lo fija con una prueba que cuenta las
invocaciones — porque es la clase de propiedad que se rompe sin que nadie note al
mover un bloque de lugar.

`tests/deploy-update-reexec.test.ts` monta dos commits reales —el desplegado y el
que trae el script nuevo—, ejecuta el script real contra un repo git real con
binarios falsos, y verifica que el código de la versión nueva corre en la primera
ejecución, que la reejecución ocurre exactamente una vez y que no queda copia
temporal colgada.

### 7.3 Hallazgo registrado, no corregido: el procesamiento de medios miente sobre el tipo

**Hay que corregirlo antes de implementar logos (Ola B).** No se toca en esta
ronda porque cambiar el pipeline de medios sin la decisión de formatos del §6.7
sería trabajar dos veces.

`api/src/routes/admin/media.ts:100-108` optimiza así:

```ts
if (mime === "image/png" && metadata.hasAlpha) {
  // PNG comprimido: preserva transparencia
} else {
  // TODO lo demás → JPEG progresivo
}
```

El archivo se reescribe con bytes **JPEG**, pero conserva su nombre y extensión
originales, y la fila de `media` guarda `mime: req.file.mimetype` (línea 52), o
sea el tipo **original**. Un `.png` subido sin alfa queda como un archivo llamado
`.png`, declarado `image/png` en la base, con contenido JPEG.

Dos consecuencias, la primera bloqueante para logos:

1. **Se destruye la transparencia de WebP y GIF.** La condición que preserva el
   canal alfa exige `mime === "image/png"`. Un WebP con transparencia —o un GIF—
   cae en el `else` y se aplana contra un fondo sólido. Los logos de convenios
   son casi siempre transparentes: subir uno en WebP hoy lo arruina en silencio.
2. **La columna `mime` no es confiable.** Cualquier consumidor que confíe en el
   tipo declarado (un CDN, un proxy de imágenes, un `<picture>` con `type`, el
   nombre de archivo de una descarga) recibe un dato falso. Agrava el cuadro que
   `X-Content-Type-Options: nosniff` esté activo tanto en Nginx
   (`scripts/deploy/setup-vps.sh:233`) como en la API (`api/src/app.ts:66`):
   la política del sitio es explícitamente "no adivines el tipo", mientras el
   backend escribe un tipo que no corresponde a los bytes.

La corrección tiene que decidir, junto con la pregunta 1 del §6.7 (¿se acepta
SVG?), si el pipeline **convierte y renombra** —extensión, `url` y `mime`
coherentes con los bytes— o si **preserva el formato de origen** para las
imágenes con transparencia. Es trabajo de la Ola B, no de esta ronda.

---

## 8. Ola A-1 — Guía operativa de carga de datos

> Primera ola del roadmap del §6 que se implementa. Sólo documentación y
> pruebas: **no toca datos reales, seeds, logos, `media.ts` ni campañas.**

### 8.1 Qué se entregó

`docs/CARGA-DE-DATOS.md`: guía paso a paso, escrita **para quien administra el
sitio, no para quien lo programa**. Cubre los diez datos pendientes del §6.1 y
para cada uno documenta seis cosas: pantalla del panel, clave técnica, formato
válido, qué se ve mientras está vacío, cómo verificarlo por el endpoint público
y en el sitio, y la advertencia de no inventar nada.

Va en `docs/` —junto a `DEPLOY.md`— porque es documentación **operativa**, no de
planificación: `AGENTS.md` §6 prohíbe los archivos de planificación, no las
guías de operación.

`tests/docs-carga-de-datos.test.ts` ata la guía a sus fuentes: el catálogo de
canales, los rangos de dígitos de `contact-values.ts`, los textos de estado
vacío, las rutas del panel en `AdminLayout.tsx` y los endpoints de `public.ts`.
Una guía operativa desincronizada es peor que no tenerla —manda a alguien a una
pantalla que no existe justo cuando está intentando publicar un teléfono de
Emergencias—, así que si alguna fuente cambia, la guía falla en CI.

Incluye además pruebas de que la guía **no contiene ningún teléfono ni ninguna
dirección de correo**. Un "número de ejemplo" en una guía de carga es la forma
más fácil de que ese número termine copiado al panel.

### 8.2 Antecedente histórico: cómo se descubrió el descarte silencioso

> **Este apartado describe un estado que ya no existe.** Se conserva porque
> explica de dónde salió el 410 del §9.1, no porque quede algo por hacer. **El
> comportamiento vigente es el del §9.1: los seis campos retirados responden
> `410 Gone` en los dos endpoints.** Nada de lo que sigue es un pendiente.

El encargo de A-1 pedía documentar que `emergencyPhone` y `gthEmail`
"responden 410". En ese momento **no era así**, y la diferencia importaba:

- `RETIRED_SETTING_KEYS` = `["social", "scripts"]` → ya respondían `410 Gone`
  con un mensaje que explicaba el motivo.
- `emergencyPhone` y `gthEmail` estaban en `RETIRED_CONTACT_FIELDS`, que
  `sanitizeSettingValue()` **borraba del objeto** antes de guardar. La petición
  respondía **`200 {ok:true}`** y el campo se descartaba. Lo mismo con `phones`,
  `email`, `whatsapp` y `hours`.

Quien escribiera esos campos desde un panel viejo, un script o una integración
recibía un "guardado" y el dato no quedaba en ningún lado. A-1 lo documentó como
era, con la advertencia destacada, en vez de repetir la premisa del encargo.

Era la excepción a un principio que la propia ronda 6 había dejado escrito en ese
archivo —*nada se descarta en silencio*— dentro de una escritura que por lo demás
se aceptaba. Corregirlo cambiaba el contrato de la API y excedía el alcance de
A-1, así que quedó anotado como candidato para A-2. **Se implementó en el PR #12
y está cerrado** (§9.1).

### 8.3 Estado de la Ola A

| PR | Estado |
|---|---|
| **A-0** — `AGENTS.md` al día | ✅ completado (PR #10) |
| **A-1** — guía de carga | ✅ completado (PR #11) |
| **A-2** — prerrequisitos (410, canales protegidos, defaults) | ✅ completado (PR #12, §9) |
| **A-2** — blindaje del rollback, 403 estable, contrato escrito | ✅ completado (Draft, §10) |
| **A-2** — pantalla "Datos pendientes" en el panel | 🔲 **pendiente** (único ítem abierto sin bloqueo externo) |
| **A-3** — `PUBLIC_SITE_URL` al dominio | 🔲 **bloqueado** hasta confirmar dominio, DNS y HTTPS |

A-1 no desbloquea nada técnico: desbloquea al **sanatorio**, que ahora tiene por
escrito dónde cargar cada cosa. Los datos siguen sin cargarse y eso es correcto
mientras no lleguen confirmados.

---

## 9. Prerrequisitos de la Ola A-2 — ✅ PR #12 fusionado

> Ronda **previa** a construir la pantalla "Datos pendientes". La pantalla no se
> implementó acá: primero se cerraron cuatro defectos que la habrían hecho
> reportar un estado que no es el real. **Todo lo de esta sección está fusionado
> en `main`**; lo que sigue describe el comportamiento vigente, no un plan.

### 9.1 Los campos retirados de `contact` ahora dan 410

**Antes:** `sanitizeSettingValue()` borraba `phones`, `email`, `whatsapp`,
`hours`, `emergencyPhone` y `gthEmail` del objeto y la API respondía
`200 {ok:true}`. Quien los mandaba desde un panel viejo, un script o una
integración recibía "guardado" y el dato no quedaba en ningún lado — ni en
`settings`, ni en `contact_channels`, ni en un error.

Era el mismo fallo que la ronda 6 corrigió un nivel más arriba, para las claves
enteras, y contradecía el principio que esa ronda dejó escrito en el propio
archivo: *nada se descarta en silencio*.

**Ahora:** los dos caminos —`PUT /admin/settings/contact` y el `PUT` masivo con
`contact` adentro— rechazan con **410** antes de escribir. El rechazo es del PUT
completo: un payload mixto no guarda las claves válidas y descarta las otras.

Se saneó también el **GET**. Sin eso, una fila vieja con campos retirados los
devolvía al panel, el panel los reenviaba al guardar y cobraba un 410 imposible
de evitar desde la UI: la única salida habría sido editar la base a mano.

### 9.2 La nota no confirmada de la guardia

`schedules.emergencias` traía *"Guardia activa todos los días del año."* desde
`20260813000001`. Es una afirmación sobre la cobertura de la guardia que el
sanatorio nunca confirmó. No llegaba al público —el endpoint filtra por `active`
y por `hours` cargado— pero estaba a un clic: bastaba marcar la fila activa y
cargarle un horario.

`20260820000000_nota_emergencias_no_confirmada.ts` la retira **sólo** cuando se
puede afirmar que nadie tocó la fila: nota exacta, `active=false`, `days` y
`hours` vacíos. Cualquier otra combinación se registra en el snapshot con
`motivo: "editada"` y queda para revisión manual. El `down()` restaura la nota
**sólo si el campo sigue vacío**: si el sanatorio escribió la suya mientras
tanto, revertir no la pisa.

### 9.3 Los ocho canales institucionales están protegidos

No son datos cargados: son parte del producto. El encabezado busca `emergencias`
por su clave, el pie arma su lista excluyendo `emergencias` y `gth`, y varios
bloques declaran `keys: ["whatsapp-estudios", …]`. Borrar una fila o cambiarle la
clave **no deja un hueco visible**: deja el sitio buscando algo que ya no existe
y mostrando "A confirmar" para siempre, sin un error que lo delate.

La API responde **403** al `DELETE`, al cambio de `key` y al cambio de `kind` de
esas ocho filas. El resto —label, value, note, message, href, icon, active,
order— se edita con normalidad, y los canales que el sanatorio cree después
conservan CRUD completo. El panel refleja la restricción: sin botón *Eliminar*,
con `key` y `kind` bloqueados y con el motivo a la vista.

El guard vive en `crudRouter` (`guard.canDelete` / `guard.canUpdate`) y se
resuelve contra la **fila guardada**, no contra el payload.

### 9.4 El checkbox mentía en la creación

`EntityManager` dibujaba los checkbox con `checked={editing[f.key] ?? true}` y
"Nuevo" arrancaba con `{}`. En una fila nueva el checkbox salía **marcado**, pero
como nadie lo tocaba el campo no entraba en el payload y la base aplicaba su
propio default. En `schedules` ese default es `false`.

El síntoma para el sanatorio era de los peores: cargás un horario, la pantalla
muestra que está activo, guardás, y el sitio sigue diciendo "Horarios en proceso
de confirmación" sin ningún error.

Ahora hay `createDefaults` explícito por pantalla, y **tiene que coincidir con el
default de la columna**:

| Pantalla | Campo | Default de la columna | `createDefaults` |
|---|---|---|---|
| Horarios | `active` | `0` | `false` |
| Canales de contacto | `active` | `1` | `true` |
| Estudios | `published` | `0` | `false` |

**Estudios tenía el mismo defecto** y no estaba en el encargo: su columna
`published` también tiene default `0` y el checkbox salía marcado. Se corrigió por
ser idéntico, no por ampliar alcance.

### 9.5 Cómo se verificó el estado, y por qué importa

Las afirmaciones sobre el estado actual salen de **ejecutar la cadena completa de
migraciones** sobre MySQL y leer la base, no de leer la migración que creó cada
fila. La diferencia no es teórica: el label de `contact_channels.emergencias` es
**"Emergencias"**, no *"Emergencias 24hs"* como decía la migración que lo creó —
una posterior lo renombró, y la guía de A-1 había copiado el valor viejo.

---

## 10. Ronda correctiva previa a la pantalla A-2 — ✅ PR #13 fusionado

> **Estado: fusionado a `main`.** Se entregó en Draft y el propietario lo marcó
> *Ready for review* y lo fusionó él mismo. En esta ronda la pantalla "Datos
> pendientes" **todavía no se implementó**: acá se cerraron los defectos que la
> habrían hecho nacer sobre una base movediza y se dejó su contrato escrito. La
> implementación está en §11.

### 10.1 El rollback podía republicar la nota de la guardia

`20260820000000_nota_emergencias_no_confirmada.ts` (PR #12, ya fusionada) retiró
de `schedules.emergencias` la nota *"Guardia activa todos los días del año."* y
dejó un `down()` capaz de restaurarla. Ese `down()` comprueba **una sola** cosa
antes de escribir: que `note` esté vacío.

No alcanza, y el caso peligroso es el más natural de todos:

1. la migración limpia la nota y deja la fila inactiva, sin días ni horario;
2. semanas después el sanatorio carga el horario real de la guardia y **activa**
   la fila — sin escribir ninguna nota, porque no hace falta;
3. la fila pasa a ser publicable;
4. un rollback encuentra `note` vacío, cumple la única condición que ese `down()`
   mira, y **publica la afirmación no confirmada junto al horario real**.

Variantes equivalentes: se cargaron `days`, se activó la fila, se cambió el área,
o se borró y se recreó.

**Cómo se blindó sin editar la migración fusionada.** `20260820000000` puede
estar aplicada en producción: editar el archivo cambiaría una migración que la
base ya registró. En cambio, una migración **posterior** corre su `down()`
**antes** en un rollback. Eso alcanza:
`20260821000000_blindar_rollback_nota_emergencias.ts` mira si hay evidencia de
intervención y, si la hay, reescribe el snapshot viejo como `motivo: "editada"`
con `notaAnterior: null` y `neutralizadoPor`. Cuando el `down()` viejo corre, no
tiene nada que restaurar. **No toca ni un dato del sanatorio**: sólo el registro
interno que gobierna una restauración automática.

**La decisión de diseño que costó dos intentos.** El primer enfoque comparaba la
fila contra su estado *al instalar el blindaje*. Falla justo en el caso
peligroso: entre que la nota se limpió y que el blindaje se aplicó pueden haber
pasado semanas y varias ediciones, así que el diff da "sin cambios" precisamente
cuando el horario ya estaba cargado. Se reemplazó por un predicado **absoluto**
—`siguePudiendoRestaurarse()`: `note`, `days` y `hours` vacíos y la fila
inactiva—, que son las mismas condiciones que el `up()` viejo exigió para
limpiar. Para las ediciones que **no** cambian el estado publicable (renombrar el
área, borrar y recrear) se agregó `tocadaDespuesDe()`, que compara
`created_at`/`updated_at` contra el `createdAt` del snapshot viejo con 1 s de
margen — `TIMESTAMP` tiene precisión de segundo y la propia migración vieja
escribe `updated_at` al limpiar.

**El blindaje no es un bloqueo permanente.** Si nadie tocó la fila, revertir sigue
devolviendo exactamente el estado anterior: la reversibilidad documentada se
conserva.

`tests/rollback-nota-emergencias-blindado.test.ts` ejecuta el flujo **real entre
versiones**: cadena de migraciones hasta la vieja → edición del cliente → cadena
hasta la nueva → rollback de las dos. Once casos, uno por forma de intervención.

### 10.2 El 403 institucional dependía de un dato ajeno

Cambiar el `kind` de un canal reservado con **valor cargado** respondía **400**,
no 403: la validación semántica de la fila resultante corría antes que el guard y
se quejaba primero de que el valor guardado no correspondía al tipo pedido. Con
el canal **vacío** el mismo intento daba 403. El operador leía "payload inválido"
—un error de formato— por un cambio que no es inválido sino **prohibido**, y el
mensaje no mencionaba la restricción real.

El `PUT` de `crudRouter` quedó en cuatro fases explícitas:

1. **forma** del payload parcial (400 si no valida);
2. **guard** institucional contra la fila guardada (403);
3. **semántica** de la fila resultante = payload + lo ya guardado (400);
4. guardar.

Se agregó también `guard.canCreate`, que el `POST` invoca después del parseo.

Verificado como regresión real: con el orden anterior, seis de las pruebas nuevas
fallan con 400 donde exigen 403.

### 10.3 El catálogo institucional ya no está duplicado

Las ocho claves vivían **dos veces**: en `api/src/routes/admin/contact_channels.ts`
y en un `Set` local de `apps/admin/src/pages/ContactChannelsPage.tsx`. Dos listas
se desincronizan solas —basta agregar un canal en la API y olvidarlo en el
panel— y el síntoma es silencioso: el panel ofrece un botón *Eliminar* que la API
contesta con 403.

Se eliminó la copia del panel. Ahora `serialize` manda `reserved` y
`expectedKind` con cada fila, y el panel decide con eso. **La pantalla A-2 no
necesita una tercera lista.**

Dos huecos que quedaban abiertos:

- **Recrear una fila que falta.** Si la fila se perdió por fuera del panel (dump
  restaurado a medias, `DELETE` directo), se puede volver a crear —pero sólo con
  su `kind` esperado: el sitio la busca por su clave y espera ese tipo de enlace.
- **Reparar un `kind` incorrecto.** Antes el mismo formulario que informaba el
  problema lo bloqueaba. Ahora `canUpdate` impide **alejarse** del tipo esperado,
  no **acercarse** a él, y el panel desbloquea el `<select>` exactamente cuando
  está mal. Si además el valor guardado no corresponde, la semántica pide
  corregir los dos campos en la misma edición.

### 10.4 Cobertura DOM del panel

Pruebas nuevas con DOM real (`tests/entity-manager-defaults.test.tsx`):

- Estudios: el checkbox `published` arranca **desmarcado** y el `POST` lleva
  `published: false` explícito. Sin el `createDefaults`, esta última falla.
- Alta de canal: además de los `input`, el **`<select>` de `kind`** existe y es
  editable. No es redundante: un campo bloqueado **se reemplaza** por un
  `<input disabled>`, así que si la condición se equivocara el `select` no
  existiría y el canal nuevo nacería sin tipo.
- **Los ocho** canales institucionales —no sólo `emergencias`— reciben la misma
  protección visual, y una fila libre en la misma lista sí ofrece *Eliminar*.
- Los ocho, con el `kind` roto, desbloquean el `select` para repararlo. Con un
  `lockedFields` estático, esas ocho pruebas fallan.

### 10.5 Contrato de `GET /api/admin/data-readiness` (documentado, no implementado)

`docs/DATOS-PENDIENTES-CONTRATO.md` fija la especificación de la pantalla A-2
antes de escribirla. Va en `docs/` —como `DEPLOY.md` y `CARGA-DE-DATOS.md`—
porque es documentación operativa; `AGENTS.md` §6 prohíbe los archivos de
planificación, y además el propietario lo pidió explícitamente.

Lo esencial:

- autenticado (cuelga de `adminRouter`, que aplica `requireAuth`) y **de sólo
  lectura**: ni escribe, ni migra, ni repara;
- **no devuelve** teléfonos, correos, horarios, días, notas ni el contenido de
  ningún snapshot: sólo estados y claves;
- estados de sección `complete` / `pending` / `review` separados, porque "cargar
  un teléfono" y "confirmar el alcance de Biopsias" no pesan igual;
- por canal: `missing`, `wrong_kind`, `inactive`, `empty`, `invalid`, `complete`;
- reutiliza `RESERVED_CHANNELS` e `isValidChannelValue()` — nada se reimplementa;
- los horarios usan la condición real de publicación (`active = 1` y `hours` no
  vacío, la misma que `/api/public/schedules`) y **no dan el conjunto por
  completo porque exista una fila**: siempre devuelven `publishable` y `total`;
- Biopsias queda en `review` **mientras no exista una confirmación explícita**;
  no se deduce del texto de la página;
- avisa si el snapshot de Emergencias quedó en `motivo: "editada"`, **sin exponer
  su contenido**, y distingue los dos orígenes de ese estado.

`tests/docs-datos-pendientes-contrato.test.ts` ata el contrato a sus fuentes: si
`isValidChannelValue` cambia de nombre, si el endpoint público cambia su
condición de publicación o si la clave del snapshot se mueve, el documento falla
en CI en vez de envejecer en silencio.

### 10.6 Dos pruebas existentes que la migración nueva rompió, y por qué el ajuste no las relaja

Agregar una migración al final de la cadena rompió dos pruebas que contaban
`down()` a mano. **Las dos fallaban por medir mal, no por un defecto del código
nuevo**, y en los dos casos el arreglo las deja mirando lo que decían mirar.

- **`tests/migrations.test.ts`.** Su lista `CORRECTIVE` es la que determina
  cuántos `down()` ejecuta el rollback completo. Sin
  `20260821000000` en la lista, revertía siete migraciones donde ahora hay ocho y
  dejaba `20260814000000_contenido_no_confirmado` aplicada: el snapshot "después"
  traía las descripciones ya corregidas y el diff acusaba al rollback de no
  restaurar. Se agregó la migración a la lista. La aserción
  (`after` === `before`) no cambió.
- **`tests/migracion-nota-emergencias.test.ts`.** Hacía un único
  `db.migrate.down()`, que antes revertía la correctiva y ahora revierte el
  blindaje. Se reemplazó por `revertirCorrectiva()`, que revierte hasta que
  `knex_migrations` ya no registre la migración bajo prueba —así no vuelve a
  romperse con la próxima—. Las aserciones no cambiaron.

  Su `beforeEach` tenía además un defecto que sólo se hizo visible ahora:
  construía el estado "antes" **filtrando** la correctiva de la lista en vez de
  **cortar** la cadena. Con una migración posterior, eso aplicaba el blindaje
  *antes* que la correctiva —un orden que ninguna base real puede tener— y el
  blindaje registraba "la fila no estaba limpia" por una situación inventada por
  la prueba. Se cambió a `todas.slice(0, corte)`. El resultado es una cadena
  aplicada en orden real, no una condición más laxa.

### 10.7 Qué quedó pendiente al cerrar esta ronda

La pantalla "Datos pendientes" quedó con el contrato escrito y sin implementar.
Se implementó en la ronda siguiente (§11), que además corrigió tres defectos de
ésta detectados en la revisión de PR #13.

---

## 11. Ola A-2 — Pantalla "Datos pendientes" — ✅ PR #14 fusionado

> **Estado: fusionado a `main`.** Se entregó en Draft y el propietario lo marcó
> *Ready for review* y lo fusionó él mismo.

Parte de `main` con PR #13 ya fusionado. Antes de implementar la pantalla se
cierran tres defectos que la revisión de PR #13 encontró en la ronda anterior.

### 11.1 El blindaje del rollback no reaccionaba a una edición real

`20260821000000` reconocía la intervención del sanatorio por dos caminos: un
predicado sobre el estado publicable (`note`, `days`, `hours`, `active`) y, para
lo que ese predicado no ve —renombrar el área, borrar y recrear—, una comparación
de `created_at`/`updated_at`.

**El segundo camino no funcionaba.** `crudRouter` escribía sólo las columnas del
payload, así que un `PUT /api/admin/schedules/:id` que cambia `area` dejaba
`updated_at` como estaba. La fila seguía "limpia" para el predicado y sus marcas
de tiempo seguían siendo las de la migración: **cero evidencia**, y el rollback
republicaba la afirmación no confirmada sobre una fila ya editada. La prueba que
cubría el caso forzaba `updated_at` a una fecha futura desde SQL — demostraba que
el mecanismo reacciona a una marca movida, no que la marca se mueva al editar.

`20260822000000_blindaje_guardia_por_campos.ts` registra una **huella de todos
los campos mutables** (`id`, `area`, `service_slug`, `days`, `hours`, `note`,
`active`, `order`) y compara contra ella al revertir. Las marcas de tiempo siguen
en la huella pero como señal **adicional** y por igualdad exacta, no por orden.

**Las dos ventanas de edición.** Una huella tomada al instalar sólo ve lo que
pase después; la edición anterior ya está incorporada y comparar contra ella
daría "sin cambios" justo en el caso peligroso. Por eso el `up()` además compara
la fila contra el **estado de fábrica** —lo que dejó `20260813000001` con la nota
ya retirada por `20260820000000`— y guarda `deFabricaAlInstalar`. Las dos
ventanas juntas cubren toda la vida de la fila y ninguna mira el reloj.

Como es posterior, su `down()` corre **antes** que los dos blindajes viejos y
desarma el snapshot que gobierna la restauración (`motivo: "editada"`,
`notaAnterior: null`, `neutralizadoPor`). Falla cerrado: sin snapshot legible
también desarma.

`tests/rollback-guardia-campos.test.ts` (22 pruebas) **se autentica contra la API
real y manda el mismo PUT que manda el panel**. No escribe ninguna marca de
tiempo para simular una edición; en un caso hace lo contrario —restaurarlas
después de editar— para comprobar que la detección no depende de ellas.
Verificado como regresión real: con el `down()` nuevo neutralizado, 9 de esas
pruebas fallan y la nota legacy reaparece.

**Corrección de fondo, además del blindaje:** `crudRouter` acepta
`touchUpdatedAt` y `schedules` lo activa, así que un PUT del panel mueve la marca.
El blindaje **no depende** de esa corrección.

### 11.2 El contrato devolvía rutas con el prefijo del panel

`docs/DATOS-PENDIENTES-CONTRATO.md` ilustraba `route: "/admin/schedules"`. El
admin corre con `basename` = `import.meta.env.BASE_URL` (`/admin`), así que React
Router antepone el prefijo solo: un `<Link to="/admin/schedules">` apunta a
`/admin/admin/schedules`, que no existe. El operador llega a una pantalla en
blanco y a ningún error que lo delate.

Las `route` pasaron a ser internas: `/contact-channels`, `/schedules`,
`/pages` o `/pages/:id`, `/datos-pendientes`. **`docs/CARGA-DE-DATOS.md` no se
tocó**: allá `/admin/…` son URLs que una persona escribe en el navegador y están
bien. Son dos espacios de nombres distintos; lo que estaba mal era mezclarlos.

Biopsias enlaza directo al Page Builder (`/pages/<id>`) cuando la página existe;
si no existe cae a `/pages` —`/pages/undefined` sería una pantalla rota— y sigue
en `review`.

### 11.3 Faltaba una fuente de runtime de los horarios requeridos

Para reportar que **falta** una fila hay que saber cuáles tendrían que estar:
enumerar `schedules` sólo dice qué hay, y una fila perdida desaparecía del informe
en vez de aparecer como problema.

`api/src/institutional-schedules.ts` declara `RESERVED_SCHEDULES` con las siete
áreas y su nombre por defecto. **No se lee la migración desde código
productivo**: una migración es un archivo histórico. La garantía contra la deriva
es `tests/horarios-catalogo.test.ts`, que compara el catálogo contra las filas que
deja la cadena **completa** de migraciones y exige igualdad exacta en los dos
sentidos.

### 11.4 `GET /api/admin/data-readiness`

`api/src/routes/admin/data_readiness.ts`, bajo `adminRouter` (que aplica
`requireAuth`). Estrictamente de sólo lectura: ni escribe, ni migra, ni repara,
ni toca marcas de tiempo — hay una prueba que vuelca las tablas antes y después y
las compara.

- Reutiliza `RESERVED_CHANNELS` e `isValidChannelValue()` de la API, y
  `RESERVED_SCHEDULES`. Agregar una clave a cualquiera de los dos catálogos la
  incorpora sin tocar este archivo (probado).
- No devuelve `value`, `href`, `hours`, `days`, `note` ni contenido de snapshots.
- `overall` y `summary` se calculan en el servidor: `review` > `pending` >
  `complete`.
- Biopsias es `review` mientras no haya confirmación explícita. No se lee el
  contenido de la página, sólo si existe.
- El aviso del snapshot de Emergencias dice **dónde mirar, nunca qué decía**, y
  distingue los dos orígenes de `motivo: "editada"`. Lectura defensiva: un
  snapshot ilegible no rompe ni inventa un aviso.

**`summary` es nuevo y `generatedAt` se eliminó.** El resumen
(`resolved`/`pending`/`review`/`total`) existe para que la tarjeta del Dashboard
no derive el número desde `sections`: serían dos definiciones del mismo criterio
y bastaría tocar una para que la tarjeta y la pantalla dijeran cosas distintas.
`total` es siempre **16** —8 canales + 7 horarios + 1 revisión de Biopsias—; se
cuenta el catálogo, no las filas, o borrar una fila mejoraría el informe. Un
horario con `hours` cargado e inactivo cuenta como **resuelto**: el dato está y no
publicarlo es una decisión tomada. `generatedAt` no lo consumía nadie y convivía
mal con la promesa de idempotencia; sin él, dos llamadas devuelven un JSON
idéntico byte a byte y eso también se prueba.

### 11.5 La pantalla del panel

- Ruta `/datos-pendientes` (o sea `/admin/datos-pendientes` en el navegador) y
  entrada "Datos pendientes" en el menú, sección *Operación*.
- Secciones de Canales, Horarios y Biopsias con enlace a donde se resuelve cada
  caso, estados de carga y de error con reintento.
- Los tres estados se distinguen **por texto además de por color**: "Completo",
  "Falta cargar", "Requiere revisión". Un lector que no distingue colores tiene
  que poder leerlo.
- Tarjeta en el Dashboard que consume `summary`. Hay una prueba que le manda un
  `summary` que no coincide con `sections` y exige que muestre el `summary`: si
  alguien reintrodujera el cálculo en el panel, falla.
- **No imprime ningún valor institucional.** `tests/data-readiness-panel.test.tsx`
  le da una respuesta contaminada —teléfonos, correos y horarios metidos en campos
  que la pantalla no lee— y comprueba que ninguno llega al DOM, por literal y por
  forma.

### 11.6 Ajustes a pruebas existentes (ninguna aserción se relajó)

- **`tests/migrations.test.ts`**: se agregó `20260822000000` a `CORRECTIVE`, que
  es lo que determina cuántos `down()` ejecuta el rollback completo.
- **`tests/rollback-nota-emergencias-blindado.test.ts`**: contaba `down()` a mano
  y asumía que `20260821000000` era la última migración del repo. Dejó de serlo.
  Se reemplazó por `revertirHasta(nombre)`, que revierte hasta que
  `knex_migrations` ya no la registre, y la aserción sobre `neutralizadoPor` pasó
  a `/^snapshot_blindaje/`: cuál de los dos blindajes desarma la restauración es
  un detalle interno, y anclarla a uno la rompería con el siguiente.
- **`vitest.config.ts`**: alias de `lucide-react` a `apps/web/node_modules`, que
  faltaba (sólo estaba la subruta `dynamicIconImports`). Sin él, ninguna prueba
  podía importar el Dashboard.

### 11.7 Validación

| Comprobación | Resultado |
|---|---|
| Suite completa (Node 20 + MariaDB local, `TEST_DATABASE=1`) | **899 / 899** en 44 archivos |
| `pnpm typecheck` | OK |
| Builds `@sa/api` / `@sa/web` / `@sa/admin` | OK |
| `node scripts/ci/verify-prerender.mjs` | OK, exit 0 |
| `pnpm audit --prod` | *No known vulnerabilities found* |
| `node scripts/check-secrets.mjs` | sin credenciales en el árbol |
| `gitleaks detect --no-git` (8.28.0) | *no leaks found* |

**Baseline medido sobre `main` (PR #13 fusionado): 804 pruebas en 40 archivos.**
El cuerpo de PR #13 decía 803; el número correcto, medido con
`vitest run --reporter=json` sobre el árbol limpio, es 804. Los +95 de esta ronda
son: `rollback-guardia-campos` 22, `data-readiness` 34,
`data-readiness-panel` 17 y `horarios-catalogo` 7 (archivos nuevos), más
`docs-datos-pendientes-contrato` de 17 a 32.

CI corre la suite contra **MySQL 8**; el número local se obtuvo contra MariaDB.

### 11.8 Qué quedó pendiente al cerrar esta ronda

Se cerró en las rondas siguientes (§12 y §13). Lo que sigue abierto está en
§13.8.

---

## 12. Turnos — registro y bandeja — ✅ PR #15 fusionado

Salió de una auditoría de finalización funcional, que encontró la cadena de
Turnos **rota en las dos puntas**: `AppointmentForm.tsx` abría `wa.me` y nunca
llamaba a la API, mientras `POST /api/public/appointments` guardaba nombre,
teléfono, correo y mensaje en una tabla que `GET /api/admin/appointments`
exponía y que **ningún archivo del panel leía**. Una superficie pública que
aceptaba datos personales de pacientes y que nadie podía ver.

WhatsApp sigue siendo el canal con el que se coordina. Lo que se agregó es el
registro:

- el formulario pide nombre, teléfono, correo y **aceptación explícita** del
  uso de los datos, con honeypot y el mismo CAPTCHA que `ContactForm`;
- primero el `201`, después la salida a WhatsApp — y la salida es una
  navegación en la misma pestaña, porque después de un `await` el navegador
  bloquea `window.open()` como popup;
- si el registro falla, el formulario **no pierde nada** y ofrece "Continuar
  sólo por WhatsApp" aclarando que así no queda registrado;
- `20260823000000_turnos_registro.ts` agregó `submission_key` con índice único,
  `consent_at` y `updated_at`;
- `AppointmentsPage` con `DataTable`, `ConfirmDialog` y CSV; ruta `/turnos`,
  entrada en *Operación* con contador y tarjeta en el Dashboard.

**La revisión de GitHub llegó después del merge y encontró tres defectos**, que
cierra la ronda del §13.

---

## 13. Turnos — correctiva de paginación, zona horaria e idempotencia

> **Estado: Draft, sin fusionar.** Sin merge, sin deploy y sin *Ready for
> review* por instrucción explícita del propietario.

Parte de `main` con PR #15 ya fusionado. **Alcance exclusivo de estos tres
defectos** más el blindaje de `ReadinessCard` y el aislamiento de las pruebas de
deploy: no toca multimedia, logos, Page Builder, Biopsias ni usuarios.

### 13.1 La bandeja buscaba dentro de 200 filas, no dentro de las solicitudes

La API aceptaba `q`, `limit` y `offset` y `AppointmentsPage` **nunca los
mandaba**: pedía las primeras 200 filas y hacía todo lo demás en el navegador.
Con 250 solicitudes, buscar a quien estuviera más abajo devolvía "sin
resultados" —y el operador no tenía cómo saber que el dato existía—, el
contador decía cuántas había recibido en vez de cuántas hay, y a esa fila no se
llegaba desde ninguna página: no se la podía confirmar ni eliminar.

`DataTable` acepta ahora un `server` **opcional**: cuando viene, no filtra, no
ordena y no pagina por su cuenta. Los CRUD que cargan la tabla entera —Médicos,
Especialidades, Servicios— siguen exactamente igual.

- `q` con debounce de 300 ms: sin él cada tecla dispara una consulta y las
  respuestas pueden llegar desordenadas —la de "Bru" después de la de "Bruno"—.
- Cambiar búsqueda o filtros **vuelve a la página 0**: la página 7 de otro
  conjunto no existe, y quedarse ahí muestra una tabla vacía sobre un total que
  dice que hay resultados.
- El orden usa una **allowlist** (`ORDENABLES`): el valor entra en el `ORDER
  BY`, así que aceptar cualquier string sería dejar decidir al cliente qué se
  ejecuta. Hay desempate por `id` para que el orden sea estable entre páginas.
- El contador y los badges leen el `total` del servidor, no `rows.length`.

### 13.2 El CSV exportaba la página, no el resultado

Se agregó `GET /api/admin/appointments/export`, autenticado, que devuelve
**todo** lo que coincide con los filtros. Se arma en el servidor porque es el
único lado con el resultado entero sin recorrer páginas, y porque el archivo
tiene que salir con `Cache-Control: no-store`: lleva nombres, teléfonos y
correos.

Las celdas se neutralizan (`celdaCsv`): Excel y LibreOffice evalúan como
fórmula lo que empieza con `=`, `+`, `-`, `@` o un control, y ese contenido lo
escribe cualquiera que complete el formulario público.

**Y morgan dejó de loguear la query string.** `morgan("dev")` registraba la URL
completa, así que lo que el operador escribe para buscar —el apellido, el
teléfono o el correo de un paciente— terminaba en los logs del servidor sin que
nadie lo hubiera decidido. Se conservan los nombres de los parámetros y se
descartan los valores.

### 13.3 La hora dependía de cómo estuviera configurado el VPS

`<input type="datetime-local">` manda una hora de pared sin offset, y
`new Date(valor)` la resolvía con la zona del proceso: un servidor en UTC
guardaba las 10:30 UTC —las 07:30 de Asunción— para quien eligió las 10:30 de
la mañana. La fila quedaba con una hora plausible y equivocada, y lo mismo
pasaba con los límites de los filtros por fecha.

`api/src/timezone.ts` es la fuente única, con `America/Asuncion`. **Zona IANA y
no un offset fijo**: un `-03:00` escrito a mano es una afirmación sobre el
pasado y el futuro, y Paraguay tuvo horario de verano hasta 2024.

- El `to` de los filtros es "**menor que el inicio del día siguiente**" y no
  `23:59:59.999`: así no hay que razonar sobre la precisión de la columna.
- El día siguiente se calcula sumando **al calendario**, no 24 h al instante:
  en un cambio de horario el día dura 23 o 25 horas.
- `correspondeA()` rechaza fechas que no existen: `Date.UTC` normaliza en
  silencio y `"2020-13-40"` devolvía un límite perfectamente válido para una
  fecha inventada.
- El panel formatea con la misma zona (`apps/admin/src/lib/fecha.ts`), y el
  texto de WhatsApp reformatea la cadena elegida sin pasar por `Date`.

`tests/turnos-zona-horaria.test.ts` **ejecuta las conversiones en procesos con
`TZ=UTC` y `TZ=America/New_York`** —no simula la diferencia, la provoca— y
comprueba que el instante guardado, lo que se muestra y los límites diarios
sean idénticos.

### 13.4 El CAPTCHA se verificaba antes de la idempotencia

El token es de un solo uso. Verificarlo antes de mirar la clave de envío rompía
justo el caso para el que la clave existe: la fila se escribe, la respuesta se
pierde, y el reintento llega con un token consumido → **400 sobre una solicitud
ya guardada**. La persona veía un error, reintentaba, y veía el mismo error.

El handler quedó en este orden, que es el contrato: honeypot → forma del
payload → normalización de la fecha → búsqueda de la clave → devolver si el
contenido coincide → **409** si la misma clave trae otro contenido →
referencias y CAPTCHA sólo para una clave nueva → insertar → volver a comparar
en la carrera del índice único.

Mover la verificación no relaja nada: una clave que no existe sigue exigiendo
CAPTCHA válido. Lo que sí había que impedir es lo contrario —que reutilizar una
clave con otros datos devolviera éxito sobre una solicitud ajena—, y de ahí el
409. La comparación cubre nombre, teléfono, correo, especialidad, médico, fecha
normalizada y mensaje; **no** el CAPTCHA, el honeypot ni las marcas de tiempo,
que cambian entre intentos legítimos.

### 13.5 `ReadinessCard` rompía todo el Dashboard

`q.data.summary.resolved` sobre una respuesta malformada lanza durante el
render, y React desmonta el árbol entero: se caía el Dashboard completo por un
endpoint secundario. Ahora hay un type guard y la tarjeta desaparece sola.

### 13.6 Ajustes a pruebas existentes (ninguna aserción se relajó)

- **`tests/deploy-update-reexec.test.ts` y `deploy-update-no-rollback.test.ts`**:
  los dos ejecutan `update-vps.sh`, que hace `mktemp` en `$TMPDIR` con el
  prefijo `update-vps-`; y los escenarios del segundo se creaban **con ese
  mismo prefijo**. En paralelo, cada uno veía los temporales del otro y la
  comprobación "la copia no puede quedar colgada" fallaba sin que nada
  estuviera mal. Ahora cada archivo tiene su propio `TMPDIR` y lo limpia. **No
  se tocó `update-vps.sh`.**
- **`tests/turnos-api.test.ts`**: la prueba del reintento tras un timeout
  mandaba un `message` distinto con la misma clave. Bajo el contrato nuevo eso
  es un 409, que es lo correcto; el reintento real manda lo mismo. Se corrigió
  el escenario, no la aserción.
- **`tests/turnos-panel.test.tsx`**: la búsqueda y la exportación pasaron a
  comprobar que viajan al servidor, porque ya no ocurren en el navegador.

### 13.7 Validación

| Comprobación | Resultado |
|---|---|
| Suite completa (Node 20 + MariaDB local, `TEST_DATABASE=1`) | **1053 / 1053** en 50 archivos |
| `pnpm typecheck` | OK |
| Builds `@sa/api` / `@sa/web` / `@sa/admin` | OK |
| `node scripts/ci/verify-prerender.mjs` | OK, exit 0 |
| `pnpm audit --prod` | *No known vulnerabilities found* |
| `node scripts/check-secrets.mjs` | sin credenciales en el árbol |
| `gitleaks detect --no-git` (8.28.0) | *no leaks found* |

Baseline sobre `main` (PR #15 fusionado): **980 en 47 archivos**. CI corre la
suite contra **MySQL 8**; el número local se obtuvo contra MariaDB.

### 13.8 Cierre

PR #16 fusionado. Los tres checks cerraron en verde sobre `4560252`.

---

## 14. Multimedia: staging, formato real y logs sin datos personales — ✅ PR #17 fusionado

Parte de `main` = `fc69871` (merge del PR #16), verificado como HEAD real antes
de ramificar.

Dos cosas distintas en la misma ronda: cerrar los tres residuos que la revisión
de GitHub dejó sobre el PR #16, y rehacer el pipeline de Multimedia antes de
que el sanatorio cargue logos.

### 14.1 Los logs llevaban datos de pacientes

Morgan ya ocultaba los valores de query desde el PR #16, pero `http.ts` seguía
registrando `req.originalUrl` completo y **el objeto de error entero**. La
tercera fuga es la que no se ve: cuando una consulta falla, mysql2 adjunta al
error la sentencia **con los bindings ya sustituidos**. Un `SELECT` fallido
sobre la bandeja escribía en el log el `like '%<apellido>%'` que el operador
acababa de tipear; un `INSERT` fallido sobre `appointments` escribía nombre,
teléfono, correo y mensaje del paciente.

`api/src/log-seguro.ts` es la fuente única:

| Función | Qué conserva | Qué descarta |
|---|---|---|
| `rutaSinValores` | ruta y **nombres** de parámetros (`?q,status=…`) | todos los valores |
| `rutaSegura` | método + lo anterior | — |
| `errorSeguro` | `name`, `code`, `errno`, `cause.code`, `archivo:línea` | `message`, `sql`, `sqlMessage`, `sqlState`, bindings |
| `lineaDeError` | las dos combinadas | — |

Excepción única: el `message` de un `HttpError` **sí** se registra, porque son
literales escritos en este repositorio. Lo sostiene una prueba que recorre los
routers y falla si alguien empieza a construirlos con una plantilla. La regla es
sobre el sitio de la llamada; una constante de módulo armada desde configuración
(el tope de peso) no ve nunca una petición.

También pasaron por `errorSeguro` los logs de `db.ts` (el mensaje crudo de
`ER_ACCESS_DENIED_ERROR` trae usuario y host) y de `captcha.ts`.

El módulo no importa nada del proyecto: lo usan `http.ts` —que define
`HttpError`— y `app.ts`, y un import cruzado sería un ciclo. Por eso
`HttpError` se reconoce por su `name`.

**La prueba no simula el error**: renombra `specialties` de verdad, hace la
búsqueda real con un nombre, un teléfono y un correo reconocibles, y verifica
que ninguno aparezca. Captura `process.stdout` además de `console` — morgan
escribe directo al stdout, y era el camino por el que el dato se escapaba una
vez por petición en vez de una vez por error.

### 14.2 Filas de la consulta anterior, accionables

`placeholderData` evita que la tabla parpadee vacía al cambiar de página, y a
cambio deja a la vista filas que **no pertenecen al filtro nuevo**. Sus botones
seguían funcionando: confirmar "la primera de la lista" durante la transición
actuaba sobre la solicitud vieja.

`DataTable` acepta `stale`. Cuando está: `aria-busy` en la tabla y las acciones
dentro de un `fieldset[disabled]`. El `actions` render prop recibe además
`{ disabled }` — el `fieldset` es la garantía en el navegador, pasar el flag
explícito es lo que hace la desactivación observable sin depender de cuánto del
HTML implemente jsdom.

### 14.3 La última página después de eliminar

Con 21 solicitudes y páginas de 20, borrar la única fila de la página 2 dejaba
un `offset` que ya no existe: la API contestaba bien (`items: []`, total 20) y
el panel mostraba una tabla vacía sobre un contador que decía 20. No se salía
sin recargar. Ahora un efecto sobre el `total` del servidor vuelve a la última
página válida, con `Math.max(0, …)` porque con total 0 la cuenta da −1.

### 14.4 El pipeline de Multimedia

Lo que había: multer escribía directo en `UPLOAD_DIR` —lo que sirve
`/uploads`— y se validaba después; se confiaba en `originalname` y
`file.mimetype`; todo lo que no fuera PNG con alpha se convertía a JPEG **sin
cambiar extensión ni MIME**; el GIF animado quedaba en su primer cuadro; los
nombres eran `Date.now()-<nombre>`; y un INSERT fallido dejaba el archivo.

`api/src/imagenes.ts` decide, `routes/admin/media.ts` orquesta:

1. **Staging primero.** Directorio **hermano** de `UPLOAD_DIR`
   (`UPLOAD_STAGING_DIR`), que `/uploads` no puede servir por ningún camino, y
   en el mismo sistema de archivos para que el `rename` final sea atómico.
   Se limpia en el `finally` **antes de responder** —el 201 significa que ya no
   queda nada—, más `res.once("close")` para la petición que se corta antes de
   llegar al handler, más un barrido de huérfanos al arrancar.
2. **El formato lo dicen los bytes**: firma del archivo y, además, lo que
   decodificó libvips. Si no coinciden, se rechaza.
3. **Cada formato sale como sí mismo.** JPEG→`.jpg` sin EXIF; PNG conserva
   alpha; WebP conserva alpha **y** animación; GIF conserva todos los cuadros;
   el PDF se valida por firma y no pasa por libvips (abrir un PDF es ejecutar un
   intérprete sobre un archivo que subió cualquiera).
4. **Se relee el resultado** antes de darlo por bueno: formato y cantidad de
   cuadros. Si una versión de libvips dejara de escribir GIF animado, el archivo
   se rechaza en vez de guardarse aplastado con el nombre del original.
5. **Nombres `crypto.randomUUID()`**: no colisionan y no filtran el nombre del
   archivo en la computadora de quien sube.
6. **Límites**: peso, `limitInputPixels` (30 MP, aplicado antes de reservar
   memoria), guarda contra descompresión desproporcionada, y mínimo por lado
   (16 px) **y** por área (1024 px²) — 400×80 entra, 1×1 no. La regla anterior
   pedía 200 px en ambos ejes, que es una regla de foto de perfil aplicada a
   logos.
7. **Nada a medias**: INSERT fallido → se borra el archivo público.

Sharp 0.35.3 con libvips 8.18.3 y cgif: reescribir con `{ animated: true }`
conserva las páginas y el alpha por cuadro, y el redimensionado de animados
también. **Sin cambios en la dependencia nativa**: `sharp@^0.35.0` ya estaba.

### 14.5 Migración `20260824000000_media_metadatos`

`media` gana `width`, `height` y `frames`, las tres anulables: un PDF no tiene
ninguna, y las filas anteriores se subieron con el pipeline viejo — no se puede
afirmar su tamaño sin reabrir cada archivo, y esta migración no toca archivos.
`animated` no es columna: se deriva de `frames > 1`; guardar las dos permite que
se contradigan. No se editó `20260516000001_init.ts`.

### 14.6 Panel

`accept` enumera los cinco formatos reales; se quitó la recomendación de SVG
(la API lo rechaza y el panel lo decía al revés); los límites que muestra son
1600 px y 10 MB, no los 2400 px que anunciaba; se puede cargar el `alt`; la
grilla muestra formato, tamaño, dimensiones y cuadros **efectivos** del
servidor, con `width`/`height`/`loading="lazy"` en cada `<img>`; el preview crea
**una** URL de objeto por archivo y la revoca al cambiar o cancelar; eliminar
pasa por `ConfirmDialog`; y no se dice "optimizado" de un PDF, que se guarda
tal cual. Una prueba compara los números del panel con los de `imagenes.ts` y
falla si se separan.

### 14.7 Validación

| Comprobación | Resultado |
|---|---|
| Suite completa (Node 20 + MariaDB local, `TEST_DATABASE=1`) | **1128 / 1128** en 53 archivos |
| `pnpm typecheck` | OK |
| Builds `@sa/api` / `@sa/web` / `@sa/admin` | OK |
| `node scripts/ci/verify-prerender.mjs` | OK, exit 0 |
| `pnpm audit --prod` | *No known vulnerabilities found* |
| `node scripts/check-secrets.mjs` | sin credenciales en el árbol |
| `gitleaks detect --no-git` (8.28.0) | *no leaks found* |

Baseline sobre `main` (PR #16 fusionado): **1053 en 50 archivos**. CI corre la
suite contra **MySQL 8**; el número local se obtuvo contra MariaDB.

Cada corrección se verificó **reintroduciendo el defecto** y comprobando que la
prueba correspondiente falla: sin `{ animated: true }` caen 3 pruebas de
cuadros; convirtiendo WebP a JPEG caen 2; con el `originalUrl` completo en
morgan y el error crudo en `http.ts` cae la de logs; sin `stale` caen 6 del
panel; sin la vuelta a la última página cae la de borrado.

### 14.8 Nota sobre `vitest.config.ts`

Dos alias nuevos, por el mismo motivo que los que ya había: `sharp` (más
`server.deps.external`, porque carga un `.node` compilado) y `react-hot-toast`.
El segundo importa: sin él, un `vi.mock("react-hot-toast")` escrito en un
archivo de la raíz **no se aplicaba** —el paquete sólo existe en
`apps/admin/node_modules`— y la prueba corría contra el toast real sin observar
nada. El mock que ya existía en `turnos-panel.test.tsx` estaba en esa situación.
### 14.9 Cierre

PR #17 fusionado. Los tres checks cerraron en verde sobre `a5404ca`.

---

## 15. Logos, selector multimedia y reordenamiento genérico — ✅ PR #18 fusionado

Parte de `main` = `7a91e1f` (merge del PR #17), verificado como HEAD real antes
de ramificar.

Cierra lo que quedaba del contrato de Multimedia y agrega las tres piezas de
edición que faltaban para que el sanatorio pueda cargar logos sin ayuda.

### 15.1 El PDF se validaba por cinco bytes

Un archivo se aceptaba como PDF sólo porque empezaba con `%PDF-`. Cualquier
cosa con esos cinco bytes delante entraba a la biblioteca, se guardaba con
`mime: application/pdf` y quedaba publicada en una URL. Y la prueba que decía
cubrirlo usaba un fixture escrito a mano —`"%PDF-1.4\n1 0 obj..."`— que ningún
lector de PDF puede abrir: afirmaba "un PDF de verdad se acepta" sobre algo que
no era un PDF.

Se comprobó primero que **ningún contrato vigente use PDF**: ningún tipo de
bloque lo acepta, ninguna página lo enlaza. Las dos salidas que dejaba el
encargo eran validar de verdad o retirar el soporte. Se eligió validar, porque
la biblioteca es de uso general y un sanatorio publica protocolos y formularios;
retirarlo habría hecho que esta ronda *quitara* una capacidad.

`pdf-lib` (nueva dependencia de `api/`, `pnpm audit --prod` limpio) parsea el
documento y se exige un catálogo legible con al menos una página.
`throwOnInvalidObject: true` endurece el parseo **y lo silencia**: sin esa
opción pdf-lib escribe por consola avisos con posiciones y fragmentos del
archivo, que es justo lo que los logs no pueden llevar.

**Validado no es saneado**, y la documentación lo dice así. Los bytes se
guardan como llegaron; no se les quita JavaScript embebido, acciones de
apertura, adjuntos ni formularios. Por eso los PDFs **no aparecen en los
selectores de imágenes** y no pasan por libvips.

### 15.2 La animación conservaba cuadros pero no tiempo

El pipeline comprobaba cuadros y transparencia. Una animación no es sólo
"estos cuadros": es estos cuadros **a esta velocidad** y repitiéndose **esta
cantidad de veces**. Un logo que conserva sus tres cuadros pero los pasa al
doble de velocidad, o que da vueltas para siempre cuando estaba pensado para
tres pasadas, es un archivo distinto del que subieron.

Medido sobre sharp 0.35.3 / libvips 8.18.3: `delay` y `loop` viajan solos hasta
la salida al leer con `{ animated: true }`, incluso a través de un `resize`. Se
pasan **explícitos igual**, porque esa conservación no está en el contrato
público de sharp — una actualización que dejara de arrastrarlos no rompería
ninguna promesa suya y acá se traduciría en logos que cambian de velocidad sin
que nadie tocara nada. Además `verificar()` los relee del archivo final y
rechaza si no coinciden, con 10 ms de tolerancia (la resolución del propio
formato GIF).

Las fixtures tienen cuadros de **duraciones distintas entre sí**: con
duraciones iguales, un codificador que las normalizara a un único valor pasaría
igual.

### 15.3 El staging se comprueba al arrancar

Todo el contrato de subidas descansa sobre dos supuestos de configuración: que
staging no esté debajo de `UPLOAD_DIR` —o `express.static` lo serviría y lo
subido quedaría publicado antes de validarse— y que compartan sistema de
archivos —o el `rename` falla con `EXDEV` y habría que copiar, que no es
atómico.

Los dos dependen de variables de entorno del VPS. Un `.env` equivocado no rompe
nada visible: la API arranca, las subidas funcionan, y la garantía no existe.
`api/src/staging.ts` resuelve las rutas con `realpath` —un enlace simbólico
pasaría las comprobaciones mirando rutas que no son las que el sistema usa— y
lanza `ConfiguracionInsegura` al arrancar.

`borrarTemporal` dejó de ser `.catch(() => {})`: un staging que deja de poder
borrarse se llenaba en silencio. Ahora registra el fallo con el logger seguro —
el nombre del temporal, que es un UUID nuestro, y el código del error; nunca la
ruta absoluta ni el nombre original del archivo.

### 15.4 Selector multimedia reutilizable

Los campos de imagen del Page Builder eran una caja de texto: había que ir a
Multimedia, copiar la URL a mano y pegarla. De ahí salen dos cosas que no se
ven hasta que el sitio está publicado — una URL con un carácter de más, y un
`<img>` sin `width`/`height` que hace saltar la página, porque quien pega una
URL no copia también las dimensiones.

`MediaPicker` devuelve las cuatro juntas: URL, alt, ancho y alto, de lo que el
pipeline midió sobre el archivo real. Filtra por el `mime` **efectivo** del
servidor, así que no ofrece PDFs. La URL manual sigue existiendo: hay imágenes
institucionales alojadas fuera y quitarla rompería bloques que ya la usan.

`PATCH /api/admin/media/:id` edita **sólo** el `alt` — lo único que tiene
sentido corregir después de subir; el resto lo determinó el pipeline a partir
de los bytes y editarlo sería volver a que la fila y el archivo se contradigan.

### 15.5 El bloque `Logos`

| Antes | Ahora |
|---|---|
| `opacity-80` fijo en la clase | configurable 20–100, con default 80 |
| sin `width`/`height` → la fila salta al cargar | dimensiones del archivo, validadas |
| sin activo/inactivo → para sacar un convenio había que borrarlo | `active`, con default "se muestra" |
| `rel="noreferrer"` | `rel="noopener noreferrer"` |
| un logo enlazado sin `alt` era un enlace anónimo | sin `alt` no se publica el enlace |
| sin `max-w-full` ni `object-contain` | los dos |

**Compatibilidad**: los bloques guardados traen `imageUrl`, `alt` y `href`.
Todo lo agregado es opcional y los defaults reproducen exactamente lo anterior.
Un bloque viejo no cambia hasta que alguien lo edite. Las pruebas de "legacy"
usan sólo esas tres claves a propósito.

El caso del enlace sin `alt` es el único donde se pierde algo: un `<a>` con una
imagen sin texto se anuncia como "enlace" y nada más, y en una fila de doce
logos son doce enlaces indistinguibles. Se prefiere perder el destino
—recuperable editando— antes que publicar navegación que nadie puede usar.

### 15.6 Reordenamiento genérico

El orden de un array `kind: "items"` es el orden en que se publica, y la única
forma de cambiarlo era borrar los ítems de abajo y volver a escribirlos. Afecta
por igual a **cards, accordion, slider, gallery, steps, stats y logos**: siete
bloques con el mismo problema y ninguna razón para resolverlo siete veces.

Vive en `BlockPropsEditor`, así que un bloque futuro que declare ese tipo de
campo lo recibe sin código propio — hay una prueba parametrizada sobre los
siete que lo comprueba, y falla si aparece un octavo sin cobertura.

Subir/Bajar y no arrastrar: dos botones funcionan con teclado, con lector de
pantalla y en un teléfono, sin necesitar una alternativa aparte. `mover()`
devuelve un array nuevo y **mueve las mismas referencias**, así que un ítem
conserva todo lo que tenga adentro, incluidas claves que el editor no declara.

### 15.7 Borrar no rompe contenido

Borrar un archivo referenciado no falla: rompe la página que lo usa y se nota
recién cuando alguien la visita. Se consulta el **esquema efectivo** —los
bloques viven en su propia tabla `blocks` con `props` JSON, no en una columna
de `pages`— y se responde 409 diciendo dónde y cuántas veces, con la ruta del
panel a la que ir. Nunca el contenido institucional de esos bloques.

Ubicaciones cubiertas: `blocks.props`, `settings["brand"].logoUrl`,
`settings["seo"].ogImage` y `doctors.photo_url`. No hay más columnas de imagen
en el esquema. El recorrido es sobre el árbol entero de `props` y no sobre
claves conocidas: una clave nueva en un bloque futuro quedaría fuera y el
borrado volvería a romper contenido sin avisar.

### 15.8 Validación

| Comprobación | Resultado |
|---|---|
| Suite completa (Node 20 + MariaDB local, `TEST_DATABASE=1`) | **1232 / 1232** en 58 archivos |
| `pnpm typecheck` | OK |
| Builds `@sa/api` / `@sa/web` / `@sa/admin` | OK |
| `node scripts/ci/verify-prerender.mjs` | OK, exit 0 |
| `pnpm audit --prod` | *No known vulnerabilities found* |
| `node scripts/check-secrets.mjs` | sin credenciales en el árbol |
| `gitleaks detect --no-git` (8.28.0) | *no leaks found* |

Baseline sobre `main` (PR #17 fusionado): **1128 en 53 archivos**.

Dos pruebas existentes cambiaron de valor esperado, ninguna se relajó:

- `block-urls`: `rel` pasó de `noreferrer` a `noopener noreferrer` — se afirma
  más, no menos.
- `media-pipeline`: el fixture de PDF pasó a generarse con `pdf-lib`. El
  anterior no era un PDF, que es el defecto que esta ronda corrige.

Cada corrección se verificó **reintroduciendo el defecto**: la detección por
cinco bytes hace caer 5 pruebas de PDF; normalizar `delay`/`loop` hace caer 4
de animación; la opacidad fija y el enlace anónimo hacen caer 6 de `Logos`;
mostrar los inactivos, 3; y que `mover` mute el array, 5 del Page Builder.

### 15.9 Qué falta

> Los cuatro primeros ítems de esta tabla se cerraron en la **§16**. Se deja la
> tabla como estaba porque es el registro de qué faltaba al terminar esa ronda,
> no el estado de hoy.

| Ítem | Estado |
|---|---|
| SVG: saneo específico antes de aceptarlo | 🔲 desarrollo pendiente; hoy rechazado y así lo dice el panel |
| Saneo de PDF (no sólo validación) | 🔲 desarrollo pendiente; hoy se valida y se documenta que no se sanea |
| Confirmación escrita del alcance de Biopsias | 🔲 decisión del sanatorio + contrato por aprobar |
| Usuarios: `safeParse` → 400, proteger el último superadmin | 🔲 desarrollo pendiente |
| A-3 (`PUBLIC_SITE_URL` al dominio definitivo) | 🔲 **configuración de producción**, más adelante |
| Purga del secreto histórico (`9ced09d`) | 🔲 **decisión del propietario** — NO-GO de producción vigente; sólo se informa |
| Campañas Meta / Google / Instagram | 🔲 otra fase completa; hoy no existe nada |

### 15.10 Sobre la revisión

Los PR #16 y #17 se fusionaron **sin ninguna review registrada en GitHub**.
Cero hilos abiertos no es lo mismo que revisado: significa que nadie miró. Este
PR queda en Draft y se reporta como listo para revisión; antes de fusionarlo
corresponde solicitar una revisión real y esperar que aparezca registrada,
además de los tres checks en verde.

### 15.11 Cierre

PR #18 fusionado en `a4f17a0`. **Sin ninguna review registrada en GitHub**, igual
que #16 y #17.

---

## 16. Saneo real de SVG y PDF, confirmación de Biopsias y blindaje de Usuarios — ✅ PR #19 fusionado

Parte de `main` = `a4f17a0` (merge del PR #18), verificado como HEAD real antes
de ramificar.

Cierra los **cuatro** ítems de desarrollo que quedaban en la tabla §15.9. Los
tres restantes de esa tabla no son desarrollo y siguen abiertos por decisión del
propietario; están en §16.8 con el motivo.

El hilo común de la ronda: cuatro lugares donde el proyecto decía menos de lo
que podía o afirmaba algo que no había comprobado.

### 16.1 El SVG estaba rechazado, y era la postura correcta

Un SVG no es una imagen: es un documento XML que el navegador ejecuta. Puede
traer `<script>`, manejadores `onload`, `<foreignObject>` con HTML adentro,
animaciones SMIL que reescriben atributos en tiempo de ejecución, `@import` a un
servidor ajeno y referencias externas que filtran quién está mirando la página.
Sin saneo, la única postura honesta era rechazarlo, y así lo decía el panel.

Ahora hay saneo (`api/src/svg.ts`) y se acepta. Con `sanitize-html`, que ya
sanea el HTML del panel: parsea el documento y descarta todo lo que no esté
explícitamente permitido. Un filtro por expresiones regulares no da esa
garantía — `<scr<script>ipt>` alcanza para burlarlo.

Tres decisiones que no son obvias:

**`lowerCaseAttributeNames: false`.** En SVG los nombres de atributo distinguen
mayúsculas. `viewBox` en minúsculas no existe, y un logo sin `viewBox` deja de
escalar.

**Se rechaza antes de parsear** lo que un parser no debería ni ver: `<!DOCTYPE`,
`<!ENTITY` y `<?xml-stylesheet?>`. Las entidades externas son XXE, que lee
archivos del servidor. Un SVG exportado por cualquier herramienta de diseño no
trae nada de eso.

**Se guardan los bytes saneados, no el original.** Guardar el original y confiar
en que el saneo lo revisó deja el archivo peligroso en el disco esperando a que
alguien lo sirva por otra vía.

Queda una defensa más por debajo: la CSP de la API es `default-src 'none'`, así
que un SVG abierto directamente en `/uploads` no puede ejecutar nada aunque el
saneo fallara. Se sanea igual: una sola capa no es una garantía.

#### El agujero que encontró la prueba de `<SCRIPT>`

`lowerCaseTags: false` es obligatorio —`linearGradient`, `clipPath`,
`feGaussianBlur` y `textPath` dejan de existir en minúsculas— pero
`sanitize-html` compara los nombres tal cual vienen. `<SCRIPT>` no coincidía con
`script`, así que **no entraba en `nonTextTags`**: se descartaba la etiqueta y su
contenido quedaba como texto suelto dentro del SVG. El saneador informaba éxito
y el código seguía en el archivo publicado.

Se probó renombrar la etiqueta a su forma canónica desde `transformTags` —que
corre antes de decidir si está permitida— y funciona a medias: `sanitize-html`
recuerda el renombre por profundidad y no lo limpia al cerrar, así que el
siguiente hermano al mismo nivel cerraba con la etiqueta ajena. Un `<rect/>`
salía como `<rect></script>`. Producir XML mal formado para tapar un agujero es
cambiar un problema por otro.

Se rechaza el archivo, y no por comodidad: SVG es XML y sus nombres de elemento
distinguen mayúsculas, así que `<SCRIPT>` **no es** el elemento script de SVG ni
ninguna otra cosa válida. Su presencia no es un descuido de formato.

#### Las dimensiones se leen, no se rasterizan

Sharp podría abrir el SVG y decir cuánto mide, pero abrirlo es correr librsvg
sobre un archivo que subió alguien: otro parser más sobre entrada no confiable,
para averiguar dos números que están escritos en el propio archivo. Se leen del
texto ya saneado. `width="50%"` no se convierte en `50`: un porcentaje no dice
cuánto mide, y decirlo sería inventar un dato.

### 16.2 El PDF se validaba y no se saneaba, y así estaba documentado

La ronda anterior cambió la detección por cinco bytes por una validación
estructural real, y dejó escrito —correctamente— que **validar no es sanear**.
Los bytes se guardaban como llegaban. Un PDF perfectamente válido puede traer
`/OpenAction`, que se ejecuta **al abrirlo**, sin que nadie haga clic; `/AA`,
que se dispara al imprimir o al cerrar; `/Names /JavaScript`; adjuntos; y
anotaciones con `/Launch`, que abren un programa.

`api/src/pdf.ts` los quita. Dos cosas se midieron en vez de suponerlas, y las
dos cambiaron el diseño:

**Borrar la referencia no borra el objeto.** Quitar `/OpenAction` del catálogo
quita el *puntero*, pero pdf-lib escribe igual el objeto huérfano: `save()`
serializa todos los objetos registrados, los apunte alguien o no. Medido: tras
borrar la referencia, la cadena del payload seguía en los bytes. Un lector que
siga el catálogo nunca lo ejecutaría, y llamar "saneado" a un archivo que
todavía contiene el código sería exactamente la clase de media verdad que este
proyecto no publica. El documento se **reconstruye** con `copyPages`, que copia
sólo lo que las páginas necesitan.

**El orden importa.** Cortar `/Annots` *después* de `copyPages` no sirve: la
anotación ya viajó al documento nuevo y queda registrada como huérfana. La
prueba del `/Launch` lo demostró — la ruta del programa a lanzar seguía en los
bytes de salida. Se corta del documento de origen y antes de copiar. Efecto
lateral bueno: `quitado` describe lo que traía **el original**.

Una entrada vacía se borra pero **no se informa como quitada**: una página
creada por cualquier biblioteca trae `/Annots []`, y contarla haría que un PDF
limpio informara "se le quitó una anotación". Un informe que dice de más sobre
un archivo inocente vale tan poco como uno que calla sobre uno peligroso.

**Qué sigue sin afirmar.** No inspecciona los flujos de contenido de cada
página. Es una limpieza de las vías conocidas de ejecución sobre un documento
que además pasó una validación estructural: sustancialmente más que antes, y no
una desinfección demostrable. Hay una prueba que fija esa frontera, para que si
alguna vez se amplía se note dónde.

**Tres pruebas de PDF cambiaron de valor esperado, ninguna se relajó.** Exigían
`guardado.equals(pdf)` —igualdad byte a byte—, y esa igualdad era justamente lo
que impedía quitarle las acciones al documento. Ahora exigen algo más fuerte: que
el documento siga abriéndose, que conserve sus páginas y que la carga útil no
esté en los bytes.

### 16.3 Biopsias: faltaba el lugar donde el sanatorio dice que sí

La pantalla de "Datos pendientes" marcaba Biopsias como `review` de forma
incondicional, y estaba bien. Que el texto de la página sea largo, o que ya no
traiga la nota de "a confirmar", no significa que el sanatorio haya confirmado el
alcance, los requisitos y los plazos. Una heurística sobre el texto convertiría
"alguien editó la página" en "el alcance está confirmado", que es exactamente la
afirmación que no se puede hacer sin autorización.

Lo que faltaba no era la heurística: era **el lugar donde el sanatorio dice que
sí**. `api/src/routes/admin/data_confirmations.ts` es ese lugar. Registra que una
persona con autoridad afirmó algo, con su nombre, la fecha y el alcance que
afirmó. No valida el contenido de la página, no lo corrige y no lo publica.

- **`scope` es obligatorio** (mínimo 10 caracteres). Sin él la confirmación
  diría "está bien" sin decir qué está bien, que no sirve de constancia ni para
  el sanatorio ni para quien tenga que revisarlo después.
- **`confirmedAt` lo pone el servidor.** Una fecha que manda quien confirma
  podría fechar la confirmación en cualquier momento.
- **Confirmar y desconfirmar exigen `superadmin`; leer, no.** Un editor puede
  escribir el texto de la página; declarar que ese texto está confirmado es otra
  cosa.
- **Se guarda en `settings` con una clave que no está en `ADMIN_SETTING_KEYS`**,
  así que el editor genérico de Configuración no la puede tocar: se cambia por el
  endpoint o no se cambia.
- **Una fila ilegible no cuenta como confirmación.** Darla por buena sería el
  error que este módulo existe para no cometer.
- **Se puede retirar.** Una confirmación puede dejar de ser cierta: cambian los
  plazos, se deja de hacer un estudio. Sin forma de retirarla, la única salida
  sería editar la base a mano.

`data_readiness.ts` pasa a leer esa confirmación. La prueba que impide que
vuelva la heurística edita la página de Biopsias hasta dejarla completa —un
texto largo, sin ninguna marca de "a confirmar", justo lo que un detector de
contenido tomaría por bueno— y exige que el estado siga en `review`.

**El contenido lo carga el sanatorio.** Este endpoint no inventa qué biopsias se
hacen ni con qué plazos: recibe lo que le dicen y lo guarda.

### 16.4 Usuarios: dos formas de quedarse afuera del panel para siempre

1. **Borrar al último superadmin.** El rol `editor` no puede administrar
   usuarios: sin ningún superadmin, nadie puede crear uno. La única salida es
   entrar a MySQL a mano en el VPS, que es exactamente el tipo de intervención
   que este panel existe para no necesitar.
2. **Bajarle el rol al último superadmin.** El mismo agujero por otra puerta: la
   versión anterior protegía el borrado —y sólo el propio— pero dejaba que un
   `PUT` con `role: "editor"` produjera el mismo resultado.

Las dos se cierran contando cuántos superadmin quedarían **después** de la
operación, no antes. Y se prueban contra la base, no contra el código: cada caso
termina comprobando que todavía queda alguien que puede administrar usuarios.

Lo demás que respondía mal:

| Antes | Ahora |
|---|---|
| `schema.parse()` → `ZodError` → **500 "error interno"** | `safeParse` → **400** con los campos que fallan |
| email repetido → choque contra el índice único → **500** | **409** "ya existe un usuario con ese email" |
| `PUT` a un id inexistente → 0 filas y `{ ok: true }` | **404** |
| `update({})` con un `PUT` sin cambios → SQL inválido | devuelve la fila tal como está |
| `DELETE` de un id no numérico llegaba a la base | **400** |

`password_hash` no sale nunca: `CAMPOS` enumera lo que se devuelve. Un hash
bcrypt es atacable sin conexión; publicarlo en una respuesta del panel lo copia
a la caché del navegador y a cualquier captura de pantalla de soporte.

### 16.5 El panel dejó de contradecir al servidor

`MediaPage` decía "SVG no se acepta", que era cierto mientras no hubo saneo.
Dejar el aviso viejo mandaría al operador a convertir sus logos a PNG sin
motivo. Ahora ofrece `.svg` en el `accept`, lo recomienda para logos y **avisa
que se sanea**: no puede prometer que el archivo se guarda tal cual, porque no
es así.

Una prueba nueva lee `FORMATOS` de `api/src/imagenes.ts` y exige que el `accept`
del panel los contenga a todos. Cuando las dos listas se separan, el panel miente
en una de las dos direcciones: ofrece algo que después se rechaza, o esconde algo
que sí se acepta.

### 16.6 El fallo del rollback bajo carga

En una corrida completa, `tests/rollback-atomico.test.ts` falló con
`Command failed: git -C /tmp/… commit -qm …` y **nada más**: `execFileSync`
descarta el stderr al lanzar. En aislamiento pasa, y volvió a pasar en la corrida
completa final.

No se marcó como intermitente y no se relajó nada. El helper `git` del escenario
pasó a `spawnSync` y ahora incluye el stderr, el stdout y el código de salida en
el error. Diagnosticar un fallo que sólo aparece bajo carga con el motivo borrado
es imposible; si vuelve a pasar, el próximo mensaje va a decir por qué.

### 16.7 Validación

| Comprobación | Resultado |
|---|---|
| `TEST_DATABASE=1 pnpm test` | **1362 pruebas en 64 archivos, todas en verde** |
| `pnpm typecheck` | OK |
| Builds `@sa/api` / `@sa/web` / `@sa/admin` | OK |
| `node scripts/ci/verify-prerender.mjs` | OK, exit 0 |
| `pnpm audit --prod` | *No known vulnerabilities found* |
| `node scripts/check-secrets.mjs` | sin credenciales en el árbol |

Baseline sobre `main` (PR #18 fusionado): **1232 en 58 archivos**.

Cada corrección se verificó **reintroduciendo el defecto**. Trece defectos, cada
uno detectado por al menos una prueba:

| Defecto reintroducido | Pruebas que caen |
|---|---|
| SVG: sin rechazo de grafías evasivas | 5 |
| SVG: `nonTextTags` por defecto | 3 |
| SVG: `lowerCaseAttributeNames: true` | 2 |
| PDF: cortar `/Annots` después de copiar | 1 |
| PDF: informar como quitada una entrada vacía | 1 |
| PDF: editar en vez de reconstruir | 5 |
| Biopsias: deducir el estado del contenido | 7 |
| Biopsias: confirmar sin exigir `superadmin` | 1 |
| Biopsias: aceptar la fecha del cliente | 1 |
| Usuarios: sin guardia al bajar el último rol | 1 |
| Usuarios: `parse()` en vez de `safeParse()` | 6 |
| Usuarios: devolver `password_hash` | 1 |
| Panel: volver al contrato viejo de SVG | 3 |

La primera pasada dejó uno sin detectar —`nonTextTags` por defecto— porque la
lista del proyecto se solapa con la de la biblioteca (`script`, `style`) en los
casos que ya estaban probados. Lo que la lista propia agrega es que
`<foreignObject>`, `<a>` y `<use>` se vayan **con su contenido**: medido, sin
ella el texto de adentro sobrevive dentro del `<svg>` publicado. Se agregó esa
prueba y el defecto pasó a detectarse.

### 16.8 Qué falta, y por qué no se hizo acá

| Ítem | Estado |
|---|---|
| A-3 (`PUBLIC_SITE_URL` al dominio definitivo) | 🔲 **configuración de producción**. El encargo prohíbe expresamente tocar `PUBLIC_SITE_URL` y DNS, y el dominio no está confirmado |
| Purga del secreto histórico (`9ced09d`) | 🔲 **decisión del propietario** — NO-GO de producción vigente; sólo se informa. Reescribir el historial es destructivo e irreversible |
| Campañas Meta / Google / Instagram | 🔲 otra fase completa. Requiere registro de aplicación OAuth, client IDs y cuentas de negocio que hoy no existen; andamiar contra nada sería inventar |

### 16.9 Sobre la revisión

Los PR #16, #17 y **#18** se fusionaron sin ninguna review registrada en GitHub.
Cero hilos abiertos no es lo mismo que revisado: significa que nadie miró. Este
PR queda en Draft y se reporta como listo para revisión; antes de fusionarlo
corresponde solicitar una revisión real y esperar que aparezca registrada,
además de los tres checks en verde.

### 16.10 El panel expone lo que la API ya garantizaba

Las cuatro correcciones anteriores dejaron contratos correctos, probados contra
la base… y **sin superficie en el panel**. Una función que sólo se puede
ejercer desde una terminal no está entregada, y una guarda que actúa en
silencio no protege a nadie de la confusión.

Tres huecos, encontrados releyendo lo que esta misma ronda había producido.

#### El mecanismo de confirmación no tenía interfaz

Cero referencias a `data-confirmations` en `apps/admin`. `DataReadinessPage`
recibía el campo `confirmation` y lo ignoraba, y la guía de carga terminaba
explicándole a un administrador de sanatorio cómo mandar un `PUT` con curl.

`ConfirmacionDato.tsx` lo resuelve: muestra quién confirmó, cuándo y **qué**
—sin el alcance, la constancia no dice qué se afirmó—, y ofrece el formulario a
quien puede usarlo. Un editor ve el estado y a quién pedírselo: ofrecerle el
formulario sería invitarlo a escribir el alcance entero para recibir un 403 al
guardar.

Apareció un borde real al construirlo: **si la página de Biopsias no existe, el
endpoint de confirmaciones igual acepta el `PUT`** —no mira páginas, y no
debería—. Sin distinguir los dos casos, el panel habría ofrecido el formulario,
guardado con éxito y el ítem habría seguido en `review`. Un éxito que no cambia
nada es peor que un botón ausente. La sección informa ahora `confirmable`, y el
panel ofrece confirmar sólo cuando hay algo que confirmar.

#### Las guardas de Usuarios eran invisibles

La mutación de borrado **no tenía `onError`**. El 409 que impide cerrar el panel
para siempre llegaba, se descartaba, y desde el otro lado se veía un clic que no
hacía nada. La protección más importante del módulo era invisible justo en el
momento en que actuaba — y ninguna prueba de API puede detectarlo, porque el
servidor hizo exactamente lo correcto.

Era además la única pantalla que seguía usando el `confirm()` del navegador,
contra el estándar del proyecto que ya usan Médicos, Páginas, Turnos y
Multimedia, y preguntaba "¿Eliminar?" sin decir a quién. Ahora usa el diálogo
del panel con el nombre y el email adentro, deshabilita los dos casos que la API
rechaza —borrarse a uno mismo, borrar al último superadmin— con el motivo en el
`title`, avisa cuando queda un solo superadmin y valida el formulario con los
mismos mínimos que aplica el servidor.

#### El panel no sabía quién había entrado

Nada de lo anterior es posible sin conocer el rol. `useSesion()` lee
`GET /auth/me` — que ya existía y ninguna pantalla consultaba.

**No es una autorización.** Lo que decide quién puede hacer qué sigue siendo
`requireRole` en la API: cualquiera puede editar `localStorage`. Esto sólo evita
ofrecer lo que no se va a poder hacer. Se consulta contra el servidor en vez de
decodificar el token porque el rol de una sesión abierta puede haber cambiado
desde que se emitió: un superadmin bajado a editor sigue con su token viejo en
la pestaña. Y ante la duda —mientras carga, o si falla— **no** se ofrece la
acción: mostrar el botón y que el servidor conteste 403 es peor que no
mostrarlo, porque el operador ya escribió el texto cuando se entera.

#### Corrector

Catorce defectos reintroducidos, catorce detectados:

| Defecto reintroducido | Pruebas que caen |
|---|---|
| Usuarios: borrado sin `onError` | 1 |
| Usuarios: guardar sin `onError` | 1 |
| Usuarios: vuelve el `confirm()` del navegador | 5 |
| Usuarios: se ofrece borrarse a uno mismo y al último superadmin | 2 |
| Usuarios: sin aviso de que queda un solo superadmin | 1 |
| Usuarios: el formulario deja mandar cualquier cosa | 2 |
| Confirmación: el formulario se le ofrece a cualquiera | 3 |
| Confirmación: el panel manda la fecha y el autor | 2 |
| Confirmación: registrar sin `onError` | 1 |
| Confirmación: se puede confirmar sin escribir el alcance | 1 |
| Confirmación: no se muestra qué se confirmó | 1 |
| Confirmación: la fecha se imprime como ISO crudo | 1 |
| Confirmación: se ofrece confirmar sin página que confirmar | 1 |
| API: la sección deja de informar `confirmable` | 1 |

El último dio **0 fallos en la primera pasada y no era cierto**: MariaDB se
había caído en el contenedor, las pruebas de base se saltaron solas y el
corrector leyó ese cero como "no detectado". Levantada la base, el defecto se
detecta. Vale como recordatorio de que una suite que se **saltea** no es una
suite que **pasa**, y de que un corrector que no distingue las dos cosas puede
dar por buena una prueba que nunca corrió.

---

## 17. Marketing — analítica, consentimiento y atribución — ✅ PR #20 fusionado

Ramificó de `main` = `a4f17a0` (merge del PR #18) como **round 1 de marketing**,
en paralelo al PR #19 (saneo SVG/PDF + Biopsias + Usuarios). El #19 se fusionó
primero; al fusionar el #20 el merge tomó, para los dos archivos de documentación
en conflicto, sólo el lado de marketing y descartó lo del #19 (§16 y sus bullets
en `AGENTS.md`, más el conteo real de pruebas). Esta sección quedó como §17 —tras
la §16 del #19— al reconciliar esa documentación en un cambio posterior sobre
`main`.

Tres piezas que el sitio no tenía y que son el cimiento de cualquier marketing
sin depender de terceros para lo básico. El orden importa: **el consentimiento
gobierna la analítica**, y la atribución es de primera parte, así que va por otra
puerta.

### 17.1 El proyecto ya había reservado este lugar

`settings.ts` retiró en su momento la clave `scripts` —un textarea de JavaScript
arbitrario— con un mensaje explícito: *"Meta Pixel, Google Ads y Analytics van a
entrar por módulos propios, no por un textarea de JS arbitrario."* Este round es
ese módulo. La diferencia no es cosmética: un `<script>` pegado hace cualquier
cosa; un **ID** sólo puede ser un ID, y se valida por formato antes de que el
front lo ponga en el `src` de un script.

### 17.2 Consentimiento primero

`apps/web/src/lib/consent.ts` + `ConsentBanner`. Nada de medición de terceros
carga hasta que la persona acepta. La decisión se guarda versionada en
`localStorage` (subir `CONSENT_VERSION` invalida los "sí" viejos cuando cambia
el alcance). `null` = no decidió (se muestra el aviso, no se mide); `false` =
rechazó (no se muestra, no se mide); `true` = mide. "Rechazar" tiene el mismo
peso visual que "Aceptar": un consentimiento que se arranca escondiendo el "no"
no es consentimiento.

### 17.3 Medición por ID, con doble condición

`analytics` es una clave administrable nueva (`{ ga4, gtm, metaPixel }`), cada
ID validado por formato en `api/src/marketing.ts` (`G-…`, `GTM-…`, dígitos;
vacío = apagado). El loader (`apps/web/src/lib/analytics.ts`) inyecta el SDK
oficial **sólo si** hay ID configurado **y** hay consentimiento; es idempotente
(no duplica scripts en un cambio de ruta) y **revalida el ID** aunque la API ya
lo haya validado, porque un valor con forma inválida terminaría en un `src` y no
se confía en una sola capa.

**CSP:** `script-src`/`connect-src` de las **dos** CSP del sitio —Nginx
(`setup-vps.sh`) y la `<meta>` de `apps/web/index.html`— ya incluyen los hosts de
Google (GA4/GTM) y Meta. Se abrieron **a pedido explícito del propietario**
después de la primera entrega del round, que las había dejado sin tocar por la
regla de no modificar el VPS. `tests/analytics-csp.test.ts` fija que los hosts
estén en ambas, que las dos coincidan y que `default-src`/`object-src` sigan
cerrados —abrir de más al tocar una CSP es el descuido clásico—. Los hosts no
cargan nada por sí mismos: sin ID configurado no hay script que los use. El
despliegue toma esa CSP; si por algo la desplegada no la tuviera, el navegador
bloquea el script y la analítica no mide, sin romper la página.

### 17.4 Atribución de conversiones

Migración nueva y reversible (`20260825000000_attribution.ts`): columna
`attribution` JSON anulable en `appointments` y `contact_messages`. El front
(`apps/web/src/lib/attribution.ts`) captura `utm_*`/`gclid`/`fbclid` en la
primera vista de la sesión (first-touch, no se pisa) y los adjunta al turno o
mensaje. La API los sanea por **allowlist** —sólo esas claves, sin HTML, cortas—
y los guarda; la bandeja de Turnos los muestra en la columna *Origen* y el CSV
los exporta.

**No requiere consentimiento, y es correcto:** no es rastreo de terceros, es
dato de primera parte que no sale del navegador hasta que la persona **envía** un
formulario, y entonces viaja sólo a la API del sanatorio, con la solicitud que
esa persona quiso hacer. No es dato personal —es de dónde vino el clic, no quién
lo dio— así que puede vivir junto a la conversión y mostrarse en el panel. Y
**nunca va a los logs**: el `catch` del insert ya sólo conserva el código del
motor.

### 17.5 Validación y corrector

Suite completa en verde (el número exacto, en la sección de validación del PR).
Cada corrección se verificó **reintroduciendo el defecto**: 16 defectos, 16
detectados —ga4 en minúsculas, atribución sin allowlist, no recortar `<`/`>`,
`leerAtribucion` sin sanear, settings sin validar (bulk y por clave), public sin
exponer/guardar, panel/CSV sin atribución, id inválido al `src`, loader no
idempotente, first-touch pisado, landing sin campaña, banner que no distingue
`null` de decisión, consentimiento sin versión—.

La primera pasada dejó uno sin detectar: la validación del endpoint
`PUT /settings/:key` para `analytics` no estaba cubierta (la prueba usaba sólo el
PUT masivo). Se agregó el caso y pasó a detectarse. Dos guardas existentes
—`settings-allowlist` y `single-source`— cambiaron de valor esperado para
incluir `analytics`; ninguna se relajó (la de `single-source` ahora además exige
que la analítica salga vacía por defecto).

### 17.6 Qué NO abarca este round

Campañas (crear/gestionar anuncios en Meta/Google/Instagram) siguen bloqueadas:
requieren registro de app OAuth y cuentas de negocio que no existen. Esto es
**medición**, no **pauta**. No se tocó `PUBLIC_SITE_URL`, DNS ni el historial
Git. De `setup-vps.sh` se editó **sólo** la línea de la CSP —a pedido explícito
del propietario— para permitir los hosts de analítica; no se tocó nada del
aprovisionamiento, credenciales, TLS ni despliegue.

---

## 18. Backlog desarrollable — cinco mejoras sin producción (PRs #21–#23)

Los ítems de *alcance claro* del runbook de puesta en producción: mejoras que se
podían construir **sin** desplegar, sin DNS ni credenciales, sin inventar. Cada
una es migración reversible + API + panel + pruebas obligatorias + corrector, y
salió como PR Draft independiente sobre `main`. Antes de todo, una corrección:
el merge del PR #20 había descartado la documentación del #19 (§16 y sus
bullets), y se reconcilió sobre `main` con el conteo real de pruebas.

### 18.1 Verificación de propiedad (Search Console / Bing)

`api/src/seo.ts`, dentro de la clave `seo` (`verification.google`/`bing`). El
token se valida por **forma** (allowlist `[A-Za-z0-9_-]`, 8–100), igual criterio
que los IDs de medición: un valor con comillas o `<>` podría romper el atributo
`content` del `<meta>`. Dos caminos: escritura todo-o-nada (400 que dice qué
token falla) y lectura que salva cada token válido por su cuenta. `App.tsx`
dibuja el `<meta name="google-site-verification">` / `msvalidate.01` sólo si hay
token. (PR #21, fusionado.)

### 18.2 Redirects 301 administrables

`api/src/redirects.ts` + tabla `redirects`. Las rutas viejas salen del código a
una tabla editable desde el panel. **Garantía dura contra open redirect**: el
destino tiene que ser una ruta interna del mismo sitio (`/algo`, nunca `//host`,
`\host` ni `https://…`), validado al guardar, al aplicar y al cargar la caché.
El middleware lee de una **caché en memoria** (no consulta la base por request);
arranca con las cuatro legacy del portal —a prueba de base caída— y se refresca
al arrancar y tras cada cambio. `legacy-redirects.ts` queda como la definición
canónica de esa lista, que `tests/sitemap.test.ts` mantiene en sincronía con el
front y el Nginx. (PR #22, fusionado.)

### 18.3 Papelera y publicación programada de páginas

`deleted_at` y `publish_at` (DATETIME, no TIMESTAMP: sin el corte de 2038) en
`pages`. Borrar es **recuperable** (papelera); el borrado definitivo sólo sale
de la papelera y ahí sí arrastra los bloques. `publish_at` oculta una página
publicada hasta su fecha, decidido **al leer** (`publish_at <= NOW()`, con el
reloj de la base), sin cron. El criterio de "página pública" —publicada, no
borrada, no agendada— vive en `api/src/pages-visibilidad.ts` y lo comparten la
lista pública, el detalle por slug y el sitemap, para que no diverjan.

### 18.4 Historial de versiones de páginas

Tabla `page_revisions`. Cada `PUT /pages/:id/blocks` archiva —en la misma
transacción que guarda— una foto (título, estado, SEO, bloques + autor), podada
a las últimas 30 por página. `POST …/revisions/:id/restore` aplica una versión
y **archiva otra** (restaurar es reversible). El `slug` no se restaura: es la
identidad y la URL. El historial se va con la página en el borrado definitivo
(cascade).

### 18.5 Newsletter propia + export de leads

Tabla `newsletter_subscribers` + bloque `newsletter`. Captura de correos **sin
proveedor externo**: `POST /public/newsletter` con honeypot + rate-limit
(un correo suelto no justifica CAPTCHA), **idempotente** (`onConflict(email)
.ignore()`: reenviar no duplica ni revela si ya estaba), atribución saneada por
la allowlist de marketing, y el correo nunca va a logs. El panel lista, exporta
CSV (celda a prueba de inyección de fórmulas) y da de baja. El bloque se coloca
donde el editor quiera —no se fuerza el formulario en ninguna página—.

### 18.6 Qué quedó afuera (decisión de producto, no se inventa)

Reactivar Noticias/Blog, roles y permisos granulares, y multi-idioma / buscador
público / constructor de formularios: cada uno necesita definir alcance (qué
puede cada rol, qué idiomas, qué se indexa, qué campos) antes de construir. Se
dejan explícitamente pendientes de una decisión del propietario en vez de
inventar una.

### 18.7 Ronda correctiva del PR #23 (mismo PR, se mantiene en Draft)

Siete correcciones sobre lo de §18.3–§18.5, sin abrir otro PR ni tocar el
historial Git. Reemplazan el comportamiento que describen esas subsecciones.

- **Historial realmente recuperable + guardado atómico (§18.4 corregido).** El
  problema: `PUT /pages/:id/blocks` archivaba *después* de reemplazar, así que la
  **primera** edición de una página preexistente perdía su contenido original —lo
  que archivaba era el nuevo—. Ahora el archivado es **antes de reemplazar**
  (`archivarActual` corre primero dentro de la transacción), de modo que la
  primera edición ya deja recuperable el estado original, y restaurar archiva
  primero el estado actual (restaurar es reversible). Nuevo endpoint transaccional
  `PUT /pages/:id/content` que recibe **metadatos + bloques** y los guarda en una
  sola operación: valida los bloques *antes* de la transacción, y dentro hace
  cargar-fila-viva → archivar → actualizar meta → reemplazar bloques; si algo
  falla revierte entero (nunca metadatos nuevos con bloques a medias). La foto
  sale de una sola lectura (título/estado/SEO/`publish_at`/bloques coherentes). El
  Page Builder usa `/content`; `/blocks` se conserva por compatibilidad con el
  mismo contrato. Poda a 30 intacta.
- **Restauración segura en el panel.** `PageBuilderPage` restaura con
  `ConfirmDialog`; si hay cambios locales sin guardar, el diálogo **advierte que
  se descartarán**. Guardar y Restaurar quedan deshabilitados mientras una
  operación está en curso; al terminar se refrescan página/bloques/historial y se
  limpia `dirty`. Un guardado que la API rechaza (p. ej. la página se movió a la
  papelera en otra pestaña) muestra un error accionable, no un clic mudo.
- **Publicación programada desde borrador.** "Programar" desde un borrador manda
  `status:published` + `publish_at` futuro en **una** operación; el sitio no la
  muestra hasta la fecha (lista, detalle y sitemap), y aparece sola cuando pasa.
  El panel distingue Borrador / Publicada / Programada y rechaza fechas pasadas
  con aviso (para publicar ya, "Publicar").
- **Papelera consistente en todos los endpoints.** `cargarPaginaViva` rechaza con
  404 cualquier edición (metadatos, `/content`, `/blocks`) sobre una fila con
  `deleted_at`. El borrado definitivo es un **DELETE condicional atómico**
  (`whereNotNull("deleted_at").del()`, 404 si no afecta filas), sin la ventana de
  "consultar y después borrar".
- **Newsletter mínima operable, sin proveedor externo.** `source` alineado a la
  ruta real (columna `varchar(512)`, sin truncar a 64); el bloque usa `useId()`
  para que dos formularios en una página no compartan el id del input; estados de
  carga/error/reintento en el bloque y en la bandeja. **Evidencia de
  consentimiento**: texto de finalidad explícito, `consent_at`/`consent_version`
  puestos por el servidor. **Baja pública** por token opaco (`unsubscribe_token`,
  `randomBytes` base64url) que no borra la fila (marca inactivo, conserva
  evidencia) y responde siempre 200 (sin enumeración). La bandeja pagina y busca;
  el CSV lleva estado + consentimiento y **no** el token; ni correo ni token van a
  logs. Mensaje de éxito preciso ("Registramos tu solicitud para recibir
  novedades"): no afirma que exista envío automático. **No** se integró
  Mailchimp/Brevo/Meta ni ningún proveedor: no hay cuenta ni credenciales.
- **Cobertura DOM real del panel** (no una respuesta de API haciéndose pasar por
  cobertura de pantalla): `tests/page-builder-panel.test.tsx` (restaurar con
  cambios sin guardar, botones bloqueados durante la operación diferida, guardado
  404 accionable por `/content`), `tests/pages-list-panel.test.tsx` (distinguir los
  tres estados, programar un borrador, rechazar fecha pasada),
  `tests/newsletter-block.test.tsx` (dos bloques con id distinto, error + reintento)
  y `tests/newsletter-panel.test.tsx` (carga, error+reintento, paginación,
  búsqueda, export, baja sin borrar).

**Corrector — cada defecto se reintrodujo temporalmente y la prueba lo detectó
(RED), luego se revirtió:** (1) archivar después del primer guardado → la versión
A no queda en el historial; (2) guardado dividido que deja los metadatos a medias
→ el título cambia pese al bloque inválido; (3) programar sin cambiar el draft →
`status` no queda `published`; (4) permitir guardar bloques de una página en la
papelera → 200 en vez de 404; (5) restaurar sin confirmación → no aparece el
aviso de descarte; (6) `source` limitado a 64 → la ruta larga se trunca; (7) id
fijo `nl-email` → los dos inputs comparten id; (8) ausencia de
consentimiento/baja → `consent_at` nulo / la baja no marca inactivo.

**Validación:** suite completa **1486/1486 en 80 archivos** (MariaDB local;
`typecheck` limpio; `build` de API/web/admin; prerender real de `/estudios` con
JSON-LD contra la API viva; migraciones up/down/up 33↔33 reversibles;
`audit:prod` sin vulnerabilidades; `check:secrets` limpio; `gitleaks` sobre el
árbol sin hallazgos). CI corre la suite contra **MySQL 8**.

> **El historial Git NO está limpio.** `gitleaks` sobre el historial completo
> sigue reportando **1 hallazgo**: `scripts/deploy/setup-vps.sh`
> (`shell-default-credential`) introducido en el commit `9ced09d`. No se rota ni
> se purga acá —reescribir la historia y rotar la credencial es decisión del
> propietario del repo—. **El NO-GO de producción sigue vigente** hasta que el
> propietario resuelva la rotación/purga.

### 18.8 Segunda ronda correctiva del PR #23 (mismo PR, se mantiene en Draft)

Ajustes finos sobre §18.7, sin abrir otro PR ni tocar el historial Git.

- **Bandeja de newsletter sin filas anteriores accionables.** Mientras la
  consulta cambia —paso de página, búsqueda o refetch tras una mutación— se
  muestran las filas de la respuesta anterior (`keepPreviousData`). Ahora, con
  `query.isFetching || query.isPlaceholderData`, la tabla se marca `aria-busy`,
  se deshabilitan Dar de baja / Reactivar / Eliminar y Anterior / Siguiente, y se
  indica visualmente ("· actualizando…", opacidad). Así no se muta ni se borra una
  fila que quizá ya no corresponde a lo que se está por mostrar.
- **Offset corregido tras mutaciones.** Si una baja, eliminación o cambio del
  total deja el offset fuera de rango, un `useEffect` vuelve a la última página
  válida (sólo con datos frescos, no el placeholder) en vez de mostrar una tabla
  vacía con un rango imposible. Cubre eliminar la única fila de la última página.
- **Semántica de publicación explícita.** *Publicar* = `published` +
  `publish_at: NULL`; *Despublicar* = `draft` + `publish_at: NULL` (un borrador
  que conservara una agenda vieja se re-publicaría oculto; limpiar la fecha evita
  ese estado confuso); *Programar* = `published` + fecha futura; *Quitar
  programación* = `publish_at: NULL` dejando `published`. La decisión de "fecha
  futura" **vive en el backend**: nuevo `POST /admin/pages/:id/schedule` que
  interpreta la hora de pared en `America/Asuncion` (`instanteDesdeHoraLocal`) y
  rechaza el pasado, en vez de validar con `new Date(...)` en la zona accidental
  del navegador. El panel manda la hora de pared cruda; la comparación contra
  `Date.now()` es entre instantes absolutos, independiente de zonas.
- **Restauración fiel de `publish_at`.** El snapshot guarda `publish_at` como
  texto ISO con `Z` (de `JSON.stringify(Date)`). Escribir ese string crudo en la
  columna `DATETIME` es frágil: con la zona del proceso distinta de UTC corre el
  instante, y MySQL 8 estricto puede rechazar el `T`/`Z`. Se normaliza a `Date` al
  restaurar, así el instante restaurado es idéntico al archivado (probado con la
  zona del proceso en `America/New_York`, verificando el instante exacto y la
  visibilidad pública antes/después de la fecha).
- **Alcance de la baja pública, aclarado.** El token y el endpoint quedan
  **preparados**, no descritos como un flujo de baja plenamente operable: el
  enlace se incorporará cuando exista un proveedor de envío. El token no se expone
  en el panel, el CSV ni los logs. El texto de consentimiento y su versión tienen
  **una sola fuente** (`@sa/shared/consent`), consumida por el bloque público y el
  servidor; una prueba falla si el texto visible y la versión registrada divergen.
  Se agregó `unsubscribed_at` (puesto por el servidor al dar de baja, limpiado al
  reactivar), incluido en la bandeja y el CSV, **nunca** el token.

**Corrector:** cada defecto se reintrodujo y la prueba lo detectó (RED), luego se
revirtió: (1) acciones habilitadas sobre el placeholder; (2) offset inválido tras
eliminar; (3) Publicar conservando `publish_at`; (4) fecha validada en la zona del
navegador; (5) restauración que corre/rompe `publish_at` (bajo `TZ` ≠ UTC el ISO
crudo hace fallar el restore); (6) textos de consentimiento divergentes; (7) baja
sin `unsubscribed_at`.

**Validación:** suite completa **1497/1497 en 82 archivos** (MariaDB local;
`typecheck` limpio; `build` de API/web/admin; prerender real de `/estudios` con
JSON-LD contra la API viva; migraciones up/down/up 33↔33 reversibles con la
columna `unsubscribed_at`; `audit:prod` sin vulnerabilidades; `check:secrets`
limpio; `gitleaks` sobre el árbol sin hallazgos). CI corre la suite contra
**MySQL 8**. El hallazgo histórico `9ced09d` **sigue vigente** (ver el aviso de
arriba): no se rota ni se purga, y no se afirma que el historial esté limpio.

## 19. Ronda correctiva — rollback de `settings.brand` por snapshot (2026-09-02)

**Contexto.** `main` en `a4cccc1` (merge PR #28). PR Draft [#29
`fix/brand-rollback-idempotente`](https://github.com/DaltonP93/WEB_SAA/pull/29),
único abierto. El CI del HEAD
([run 33459369884](https://github.com/DaltonP93/WEB_SAA/actions/runs/33459369884))
falló en `tests/migrations.test.ts > … el rollback devuelve exactamente el estado
anterior`. Typecheck y builds verdes; "Detección de secretos" y "Auditoría de
dependencias" verdes.

**Causa.** `20260827000000_brand_logo.ts` y `20260828000000_brand_favicon.ts`
(PR #27) crean `settings.brand` cuando no existe, pero su `down()` original sólo
vaciaba el campo — nunca borraba la fila. Sobre una base migrada sin sembrar (la
de la prueba), el rollback dejaba el residuo `{ logoUrl:"", faviconUrl:"" }` y el
snapshot lo detecta. Determinístico 3/3; `DUMP_SNAPSHOTS` muestra que la única
sección que difiere es `settings` y la única clave nueva es `brand`.

**Solución descartada (heurística).** Un intento previo del PR #29 agregó una
migración posterior (`20260901000000_brand_rollback_idempotente.ts`) que borraba
la fila si su contenido coincidía con los defaults. Se **descartó**: coincidir con
los defaults no prueba procedencia; una fila legítima preexistente idéntica a
`{ logoUrl:"/logo-sanatorio.png", faviconUrl:"/favicon.png" }` sería borrada.
Verificado de forma reproducible contra `672ae96` (la fila se borra). Migración
eliminada del PR.

**Solución vigente (snapshot; excepción autorizada).** Bajo autorización explícita
y acotada del propietario para editar **sólo** esas dos migraciones ya fusionadas,
cada una registra un snapshot interno de procedencia **antes** de tocar la base
(`snapshot_brand_logo_20260827000000` / `snapshot_brand_favicon_20260828000000`,
prefijo `snapshot_`, `varchar(64)`, no publicados ni editables desde el CMS). El
snapshot guarda si la fila y la propiedad existían, el valor anterior exacto
(ausente / `null` / `""` / default / personalizado) y si se aplicó un cambio; se
guarda aunque no cambie nada, no se sobrescribe, y se elimina tras un rollback
exitoso; si no puede guardarse, `up()` no toca la marca. `down()` restaura desde el
snapshot y sólo lo que la migración escribió (favicon primero y nunca borra la
fila; logo elimina la fila sólo si el snapshot prueba que no existía y no queda
propiedad). **Fail-closed:** aplicada sin snapshot válido ⇒ `down()` aborta sin
tocar datos y remite a backup verificado / procedimiento manual; sin fallback
heurístico. El flujo local ya lo propaga: `rollback-db.sh` aborta al fallar un
`migrate:down` (no se tocan los scripts de rollback). Pruebas en
`tests/migrations-brand-rollback.test.ts` (23), incluida la regresión que falla
contra `672ae96`; `tests/migrations.test.ts` no se debilita y vuelve a verde.

**Validación local.** Node 20.20.2, pnpm 9.0.0, MySQL 8.4.9 (local; CI usa 8.0,
autoritativo). `typecheck` OK; builds api/web/admin OK; suite de marca 23/23;
`tests/migrations.test.ts` ×3 sobre bases limpias 26/26 cada corrida;
`check:secrets` OK; `audit:prod` OK (0 alto/crítico). Suite completa con el fix
1471✓/67✗/5 skip (1543) vs baseline `672ae96` 1458✓/67✗/5 skip (1530): **+13 en
verde, 0 fallos nuevos**. Los 67 restantes son ambientales de Windows
(`bash`/`npx`/`pnpm`/`stat` no en PATH; media/libvips), **idénticos** en ambos
árboles (comparación reproducible); el CI Ubuntu del PR es la verificación del
conteo verde.

**Producción.** NO-GO sin cambios (bloqueantes externos intactos).

**Segunda auditoría (sobre `bc2439a`) — validación estricta + preflight.** La
auditoría independiente devolvió NO-GO para merge por dos defectos: (1) el lector
de snapshot era laxo —sólo `formato` + tres booleanos y un cast al tipo completo—,
así un snapshot **parcial forjado** podía hacer que `down()` **borre una fila
legítima** `settings.brand`; (2) `up()` no validaba un snapshot preexistente
corrupto: lo conservaba pero igual modificaba `brand`. Corrección sin migración
posterior ni heurística: **validación estricta de estructura cerrada + coherencia**
por migración (9 campos exactos, `formato`/`migracion`/`propiedad`, tipos booleanos,
`valorAplicado` atado a `aplicoCambio`, combinaciones de procedencia imposibles
rechazadas; se construye el objeto tipado desde los valores validados, nunca un
cast); `up()` que **lanza** ante snapshot preexistente inválido y es **no-op
idempotente** si es válido (preserva personalizaciones); `down()` que valida por
completo antes de tocar o borrar filas y no usa la coincidencia con el default como
prueba de procedencia. **Preflight** `scripts/deploy/brand-snapshot-preflight.mjs`
(lo invoca `rollback-db.sh` tras calcular `PENDIENTES` y antes del primer
`migrate:down`): si el rollback cruza favicon/logo, valida sus snapshots por
adelantado y **aborta sin revertir nada** (exit 4) si falta o es inválido; no se
salta con `ROLLBACK_ALLOW_AFTER_SEED`; el mensaje pide un backup **anterior** a esas
migraciones (uno reciente sólo recupera el estado actual). Necesario porque el
fail-closed de cada `down()` llega tarde en una reversión múltiple. Pruebas:
`tests/migrations-brand-rollback-strict.test.ts` (27; 18/27 fallan contra
`bc2439a`), `tests/rollback-brand-preflight.test.ts` (8, sin base/bash) y 2 casos
bash end-to-end en `tests/rollback-db.test.ts` (cero `down()` al bloquear; no
bloquea si no cruza marca). Validación local: typecheck/builds/secrets/`audit:prod`
OK (0 alto/crítico); marca+estricto+preflight 58/58; migraciones ×3 26/26; suite
completa **1506✓/69✗/5 skip (1580)** vs `bc2439a` 1471✓/67✗ (1543): +35 verdes, los
+2 fallos son los dos casos **bash** del preflight (ambientales de Windows, verdes
en CI). Mismos 13 archivos ambientales. Conteo verde autoritativo = CI del PR.
Producción sigue NO-GO.
