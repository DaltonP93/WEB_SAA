# CLAUDE_CONTEXT.md

> Contexto técnico de desarrollo, escrito para que otra IA (ChatGPT u otro
> asistente) pueda retomar el trabajo sin leer todo el historial del repo.
> Formato ejecutivo. Se actualiza en cada tarea terminada o preparación de
> cambios para GitHub.

**Última actualización:** prerrequisitos de la Ola A-2.
**Cubre hasta:** PR #11 fusionado.
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
| A-2 (prerrequisitos) | #12 | Campos retirados con 410, canales protegidos, defaults de creación (§9) |

---

## 0. Mapa del proyecto (para orientarse rápido)

Monorepo **pnpm 9** (`pnpm-workspace.yaml`: `apps/*`, `api`, `shared`).

| Paquete | Stack | Rol |
|---|---|---|
| `api` | Node 20 · Express 4 · TypeScript · Knex · MySQL 8 · JWT | API pública + panel |
| `apps/web` | React 18 · Vite · Tailwind · TanStack Query · react-router-dom | Sitio público |
| `apps/admin` | React 18 · Vite | Panel de administración (`/admin`) |
| `shared/types` | TypeScript | Tipos y constantes compartidas |

**Pruebas:** 38 archivos en `tests/`, **731 pruebas**, `vitest`. Las que tocan
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
| Pruebas (Node 20 + MySQL 8, `TEST_DATABASE=1`) | **731 / 731** en 38 archivos |
| `pnpm typecheck` | OK |
| Builds `@sa/api` / `@sa/web` / `@sa/admin` | OK |
| Prerender real (`scripts/ci/verify-prerender.mjs`) | OK, exit 0 |
| `pnpm audit --prod` | *No known vulnerabilities found* |
| `node scripts/check-secrets.mjs` | Sin credenciales en el árbol |
| `gitleaks detect --no-git` (árbol) | *no leaks found* |
| **CI: 3 / 3 checks** | **verde** sobre `a1762f0` |

**PR #8 y PR #9 fusionados a `main`**, ambos por instrucción explícita del
propietario y con los tres checks en verde:

- **[PR #8](https://github.com/DaltonP93/WEB_SAA/pull/8)** — la ronda 7. Se había
  desarrollado bajo la consigna "sin merge, sin deploy, sin Ready for review"; el
  propietario levantó esa restricción una vez verdes los checks.
- **[PR #9](https://github.com/DaltonP93/WEB_SAA/pull/9)** — registro de ese merge
  y análisis de la fase 8, que es la §6 de este documento.

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
   Es una decisión del propietario del repositorio.
2. **Logos y centro de campañas.** Explícitamente fuera de alcance desde la ronda 4
   y hasta nueva orden. **No trabajar en esto sin autorización separada.**
3. **Merge, deploy y Ready for review** de PR #8: los decide el propietario.

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

Suites individuales de esta ronda:

```bash
npx vitest run tests/deploy-update-no-rollback.test.ts          # no necesita base
TEST_DATABASE=1 npx vitest run tests/rollback-db-failclosed.test.ts
TEST_DATABASE=1 npx vitest run tests/rollback-atomico.test.ts
npx vitest run tests/captcha-widget.test.tsx                    # jsdom
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
| **A-1** | ✅ **completado** *(este PR)* | `docs/CARGA-DE-DATOS.md`: guía de carga con la tabla de 6.1, incluida la trampa de `emergencyPhone`/`gthEmail` | Prueba de que cada clave documentada existe en el catálogo de `contact_channels` (evita que la guía se desincronice) |
| **A-2** | 🔲 pendiente | Panel: pantalla "Datos pendientes" que liste qué falta leyendo el estado real | Integración: base sin canales → lista los 8; con uno cargado → lista 7 |
| **A-3** | 🔲 pendiente — **bloqueado** por dominio, DNS y HTTPS confirmados | `PUBLIC_SITE_URL` al dominio definitivo | Verificación post-deploy de `sitemap.xml` y canonical; `verify-prerender.mjs` |

> A-2 es el de mayor valor operativo: convierte "¿qué falta?" en algo que el
> sanatorio ve solo.

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

**A-0 → A-1 → A-2** primero: son baratos, no dependen de nadie externo y
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

### 8.2 Hallazgo: `emergencyPhone` y `gthEmail` no responden 410

El encargo de esta ronda pedía documentar que esos dos campos "responden 410".
**No es así, y la diferencia importa.**

- `RETIRED_SETTING_KEYS` = `["social", "scripts"]` → **sí** responden `410 Gone`
  con un mensaje que explica el motivo (`settings.ts:61-62`).
- `emergencyPhone` y `gthEmail` están en `RETIRED_CONTACT_FIELDS`, que
  `sanitizeSettingValue()` **borra del objeto** antes de guardar
  (`settings.ts:188`). La petición responde **`200 {ok:true}`** y el campo se
  descarta. Lo mismo con `phones`, `email`, `whatsapp` y `hours`.

Quien escriba esos campos desde un panel viejo, un script o una integración va a
recibir un "guardado" y el dato no va a estar en ningún lado. La guía lo
documenta como es, con la advertencia destacada.

**Vale la pena revisarlo.** La ronda 6 estableció el principio de que nada se
descarta en silencio —el comentario está en `settings.ts:78-79`, justo arriba
del bloque que rechaza claves no administrables— y estos seis campos son
exactamente la excepción a ese principio, dentro de una escritura que por lo
demás se acepta. Corregirlo sería hacer que un `contact` con campos retirados
responda 410 como el resto. **No se hizo en esta ronda** porque cambia el
contrato de la API y excede el alcance de A-1; queda como candidato para A-2.

### 8.3 Estado de la Ola A

| PR | Estado |
|---|---|
| **A-0** — `AGENTS.md` al día | ✅ completado (PR #10) |
| **A-1** — guía de carga | ✅ completado (este PR) |
| **A-2** — pantalla "Datos pendientes" en el panel | 🔲 pendiente |
| **A-3** — `PUBLIC_SITE_URL` al dominio | 🔲 **bloqueado** hasta confirmar dominio, DNS y HTTPS |

A-1 no desbloquea nada técnico: desbloquea al **sanatorio**, que ahora tiene por
escrito dónde cargar cada cosa. Los datos siguen sin cargarse y eso es correcto
mientras no lleguen confirmados.

---

## 9. Prerrequisitos de la Ola A-2

> Ronda **previa** a construir la pantalla "Datos pendientes". La pantalla no se
> implementa acá: primero se cierran cuatro defectos que la habrían hecho
> reportar un estado que no es el real.

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
