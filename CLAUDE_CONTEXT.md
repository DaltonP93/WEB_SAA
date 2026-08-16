# CLAUDE_CONTEXT.md

> Contexto técnico de desarrollo, escrito para que otra IA (ChatGPT u otro
> asistente) pueda retomar el trabajo sin leer todo el historial del repo.
> Formato ejecutivo. Se actualiza en cada tarea terminada o preparación de
> cambios para GitHub.

**Última actualización:** ronda correctiva 7 · **PR #8 fusionado a `main`**
**`main` actual:** `2359a11796ba8fd86baf385923a2d7740be28bdc` (merge commit de PR #8)
**Base de la ronda:** `main` = `809059141786cd25fd0b0107368ec9956de37187`
**Rama de trabajo:** `claude/audit-fixes-ronda7` (fusionada; ya no se desarrolla ahí)
**CI:** 3/3 checks en verde sobre `a1762f0` antes del merge.

---

## 0. Mapa del proyecto (para orientarse rápido)

Monorepo **pnpm 9** (`pnpm-workspace.yaml`: `apps/*`, `api`, `shared`).

| Paquete | Stack | Rol |
|---|---|---|
| `api` | Node 20 · Express 4 · TypeScript · Knex · MySQL 8 · JWT | API pública + panel |
| `apps/web` | React 18 · Vite · Tailwind · TanStack Query · react-router-dom | Sitio público |
| `apps/admin` | React 18 · Vite | Panel de administración (`/admin`) |
| `shared/types` | TypeScript | Tipos y constantes compartidas |

**Pruebas:** 31 archivos en `tests/`, **603 pruebas**, `vitest`. Las que tocan
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
| Pruebas (Node 20 + MySQL 8, `TEST_DATABASE=1`) | **603 / 603** en 31 archivos |
| `pnpm typecheck` | OK |
| Builds `@sa/api` / `@sa/web` / `@sa/admin` | OK |
| Prerender real (`scripts/ci/verify-prerender.mjs`) | OK, exit 0 |
| `pnpm audit --prod` | *No known vulnerabilities found* |
| `node scripts/check-secrets.mjs` | Sin credenciales en el árbol |
| `gitleaks detect --no-git` (árbol) | *no leaks found* |
| **CI: 3 / 3 checks** | **verde** sobre `a1762f0` |

**PR #8 fusionado a `main`** el 2026-08-16, por instrucción explícita del
propietario: https://github.com/DaltonP93/WEB_SAA/pull/8
Merge commit: `2359a11796ba8fd86baf385923a2d7740be28bdc`.

La ronda 7 se había desarrollado bajo la consigna "sin merge, sin deploy, sin
Ready for review"; el propietario levantó esa restricción y autorizó el merge una
vez verdes los tres checks. **El deploy sigue sin hacerse**: fusionar a `main` no
despliega nada por sí solo (no hay CD automático; el despliegue se dispara a mano
con `scripts/deploy/update-vps.sh` en el VPS).

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
| `AGENTS.md:58` | Publica un usuario y contraseña de seed literales | Desde la ronda 6 la contraseña se genera; ese literal es justo lo que `check-secrets` busca |
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
(`api/src/routes/admin/settings.ts:139-150`). Quien los busque donde estaban no
los encuentra y la API responde 410. Sin una guía de carga esto genera un ticket
garantizado.

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

| PR | Alcance | Pruebas requeridas |
|---|---|---|
| **A-0** | Actualizar `AGENTS.md` (§8 pruebas, §9 rollback, quitar el literal de contraseña de §2) | `check-secrets` y `gitleaks` sobre el árbol; prueba que afirme que `AGENTS.md` no contiene credenciales literales |
| **A-1** | `docs/CARGA-DE-DATOS.md`: guía de carga con la tabla de 6.1, incluida la trampa de `emergencyPhone`/`gthEmail` | Prueba de que cada clave documentada existe en el catálogo de `contact_channels` (evita que la guía se desincronice) |
| **A-2** | Panel: pantalla "Datos pendientes" que liste qué falta leyendo el estado real | Integración: base sin canales → lista los 8; con uno cargado → lista 7 |
| **A-3** | `PUBLIC_SITE_URL` al dominio definitivo | Verificación post-deploy de `sitemap.xml` y canonical; `verify-prerender.mjs` |

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
