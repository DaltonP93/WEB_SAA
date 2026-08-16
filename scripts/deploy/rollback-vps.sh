#!/usr/bin/env bash
# ============================================================================
# Rollback a una versión anterior — en el orden que sí funciona, y sin dejar
# el servidor a mitad de camino si algo falla.
#
# El procedimiento anterior (docs/DEPLOY.md) decía: primero bajar el código con
# ROLLBACK_TO y después revertir las migraciones. Eso no puede funcionar:
#
#   · knex decide qué revertir leyendo la tabla `knex_migrations` y buscando
#     el ARCHIVO correspondiente en disco. Después del checkout al SHA
#     anterior, los archivos de las migraciones nuevas ya no están: knex las
#     ve registradas y sin archivo, y el rollback falla —o peor, no hace nada—.
#   · y aunque no fallara, el `down()` que hay que ejecutar es el del código
#     NUEVO: es el único que sabe deshacer lo que hizo su `up()`.
#
# El orden correcto, que es el que implementa este script:
#
#   1. prevalidar la versión destino en un worktree aparte;
#   2. backup de la base (obligatorio, se aborta si falla);
#   3. revertir las migraciones nuevas CON EL CÓDIGO NUEVO todavía en disco
#      (o restaurar un dump verificado);
#   4. recién ahí bajar el árbol al SHA anterior;
#   5. reinstalar y rebuild;
#   6. Nginx, PM2 y health check.
#
# Revertir la base es el punto sin retorno: a partir del paso 3 la aplicación
# que está corriendo es la nueva contra una base vieja. Antes, un fallo de
# checkout, install, build, Nginx o PM2 dejaba exactamente ese estado y el
# script terminaba con un error genérico. Ahora hay dos defensas:
#
#   · PREVALIDACIÓN (paso 1): la versión destino se instala y compila en un
#     `git worktree` separado, con el deploy actual intacto. Casi todo lo que
#     puede fallar después —lockfile que no congela, build roto, dependencia
#     que ya no existe— se ve acá, antes de tocar la base.
#   · RECUPERACIÓN: si aun así falla una etapa posterior al paso 3, se
#     restaura el backup, se vuelve a CURRENT_SHA, se reconstruye y se
#     reinicia. El servidor queda como estaba y el código de salida lo dice.
#
# Uso (como root, en el VPS):
#   ROLLBACK_TO=<sha-anterior> bash /var/www/sanatorio/scripts/deploy/rollback-vps.sh
#
# Variables:
#   ROLLBACK_TO   (obligatoria) SHA o tag al que se vuelve.
#   RESTORE_DUMP  ruta de un dump .sql.gz: en vez de revertir con `down()`,
#                 restaura ese dump. Es el camino obligatorio cuando la base se
#                 sembró después de migrar (ver rollback-guard.mjs).
#   SKIP_PREVALIDACION=1  omite el worktree del paso 1. Más rápido y con menos
#                 disco, pero un build roto se descubre recién con la base ya
#                 revertida (ahí entra la recuperación).
#
# Códigos de salida:
#   0  rollback completo y la aplicación responde
#   1  error de uso o de una etapa previa (nada se tocó)
#   2  la versión destino no pasó la prevalidación (nada se tocó)
#   4  falló un `down()` y se restauró el backup: el código NO se bajó
#   5  reversión parcial y el backup tampoco se pudo restaurar
#   6  el rollback se aplicó pero el health check no dio 200
#   7  falló una etapa posterior a la base y se recuperó el estado anterior
#   8  falló una etapa posterior a la base y la recuperación TAMBIÉN falló
# ============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/sanatorio}"
ROLLBACK_TO="${ROLLBACK_TO:-}"
RESTORE_DUMP="${RESTORE_DUMP:-}"

log()  { echo -e "\033[1;34m==>\033[0m $*"; }
warn() { echo -e "\033[1;33m!!\033[0m $*" >&2; }
die()  { echo -e "\033[1;31mERROR:\033[0m $1" >&2; exit "${2:-1}"; }

env_value() {
  [ -f "$APP_DIR/api/.env" ] || return 0
  sed -n "s/^$1=//p" "$APP_DIR/api/.env" | head -n1
}

# ─── helpers ────────────────────────────────────────────────────────────────
# Definidos acá arriba porque los usan tanto el flujo normal como la
# recuperación. El orden en que aparecen en el archivo no es el orden en que se
# ejecutan: eso lo define el bloque FLUJO PRINCIPAL, más abajo.

# Instala y construye las tres aplicaciones en el directorio que se le pase.
# Se usa dos veces: sobre el worktree de prevalidación y sobre APP_DIR.
reconstruir() {
  local dir="$1"
  ( cd "$dir" \
    && pnpm install --frozen-lockfile \
    && pnpm --filter @sa/api build \
    && PUBLIC_SITE_URL="$(env_value PUBLIC_SITE_URL)" pnpm --filter @sa/web build \
    && pnpm --filter @sa/admin exec vite build --base=/admin/ )
}

# Recarga Nginx y deja PM2 corriendo la aplicación del directorio que se le pase.
reiniciar_servicio() {
  local dir="$1" entry
  entry="$dir/api/dist/src/index.js"
  [ -f "$entry" ] || entry="$dir/api/dist/index.js"
  { nginx -t && systemctl reload nginx; } || return 1
  pm2 delete sanatorio-api 2>/dev/null || true
  pm2 start "$entry" --name sanatorio-api --time --cwd "$dir/api" || return 1
  pm2 save || return 1
}

# Restaura un dump .sql.gz sobre la base de api/.env.
#
# `gzip -t` primero: un dump truncado o corrupto se detecta ANTES de abrir la
# base, no a mitad de la restauración. Y la pipeline corre en este shell, que
# tiene `pipefail`; antes iba dentro de un `bash -c "gunzip < '…' | mysql …"`
# —un shell nuevo, sin pipefail, con las rutas interpoladas en la cadena— donde
# el estado del pipe era el de `mysql`, que termina bien con una entrada vacía:
# un gzip roto se reportaba como restauración exitosa. Los valores van como
# argumentos, no concatenados en un texto que otro shell vuelve a parsear.
restaurar_dump() {
  local dump="$1"
  if [ ! -f "$dump" ]; then
    warn "no existe el dump ${dump}"
    return 1
  fi
  if ! gzip -t -- "$dump" 2>/dev/null; then
    warn "el dump ${dump} está corrupto o truncado (gzip -t falló): no se restauró nada."
    return 1
  fi
  gunzip -c -- "$dump" \
    | MYSQL_PWD="$(env_value DB_PASS)" mysql -h"$DB_HOST_ENV" -P"$DB_PORT_ENV" -u"$DB_USER_ENV" "$DB_NAME_ENV"
}

# Vuelve el servidor al estado anterior al rollback y termina el script.
#
# Se llama sólo después del paso 3: de ahí en adelante la base ya cambió, así
# que abandonar con un error deja la aplicación nueva contra una base vieja.
recuperar() {
  local motivo="$1"
  local base_ok=1 arbol_ok=1 build_ok=1 servicio_ok=1
  echo "" >&2
  warn "falló ${motivo}, con la base ya revertida."
  warn "Recuperando el estado anterior al rollback."

  log "R1/4  Restaurando la base desde ${BACKUP_FILE}"
  restaurar_dump "$BACKUP_FILE" || base_ok=0

  log "R2/4  Volviendo el árbol a ${CURRENT_SHA}"
  git -C "$APP_DIR" reset --hard "$CURRENT_SHA" || arbol_ok=0

  log "R3/4  Reinstalando y reconstruyendo ${CURRENT_SHA}"
  reconstruir "$APP_DIR" || build_ok=0

  log "R4/4  Reiniciando el servicio"
  reiniciar_servicio "$APP_DIR" || servicio_ok=0

  if [ "$base_ok" = 1 ] && [ "$arbol_ok" = 1 ] && [ "$build_ok" = 1 ] && [ "$servicio_ok" = 1 ]; then
    echo "" >&2
    echo "  ROLLBACK ABORTADO — ESTADO ANTERIOR RECUPERADO" >&2
    echo "  Motivo: falló ${motivo}." >&2
    echo "  Base restaurada desde ${BACKUP_FILE}, árbol de vuelta en ${CURRENT_SHA}," >&2
    echo "  reconstruido y reiniciado: el servidor quedó como antes del rollback." >&2
    echo "  NO se volvió a ${ROLLBACK_TO}. Revisá el error de arriba." >&2
    exit 7
  fi

  echo "" >&2
  echo "  RECUPERACIÓN INCOMPLETA — HACE FALTA INTERVENIR A MANO" >&2
  echo "  Motivo original: falló ${motivo}." >&2
  echo "  base:     $([ "$base_ok" = 1 ]     && echo "restaurada desde ${BACKUP_FILE}" || echo "NO se pudo restaurar")" >&2
  echo "  árbol:    $([ "$arbol_ok" = 1 ]    && echo "de vuelta en ${CURRENT_SHA}"     || echo "NO se pudo volver a ${CURRENT_SHA}")" >&2
  echo "  builds:   $([ "$build_ok" = 1 ]    && echo "reconstruidos"                   || echo "FALLARON")" >&2
  echo "  servicio: $([ "$servicio_ok" = 1 ] && echo "reiniciado"                      || echo "NO se pudo reiniciar")" >&2
  echo "  No levantes la aplicación hasta resolver lo que quedó en rojo." >&2
  exit 8
}

# === FLUJO PRINCIPAL ========================================================

[ -n "$ROLLBACK_TO" ] || die "falta ROLLBACK_TO=<sha>. Es el commit al que querés volver."
[ -d "$APP_DIR/.git" ] || die "$APP_DIR no es un repo git."

cd "$APP_DIR"
CURRENT_SHA="$(git rev-parse HEAD)"
git fetch origin --tags
git cat-file -e "${ROLLBACK_TO}^{commit}" 2>/dev/null || die "el commit ${ROLLBACK_TO} no existe en este repo."
# Volver "atrás" a algo que no es ancestro no es un rollback: es un checkout a
# otra rama, con migraciones que este árbol nunca aplicó.
git merge-base --is-ancestor "$ROLLBACK_TO" HEAD \
  || die "${ROLLBACK_TO} no es un ancestro de HEAD ($(git rev-parse --short HEAD)). Un rollback sólo va hacia atrás en la misma historia."

DB_NAME_ENV="$(env_value DB_NAME)"; DB_NAME_ENV="${DB_NAME_ENV:-sanatorio}"
DB_USER_ENV="$(env_value DB_USER)"; DB_USER_ENV="${DB_USER_ENV:-sanatorio}"
DB_HOST_ENV="$(env_value DB_HOST)"; DB_HOST_ENV="${DB_HOST_ENV:-127.0.0.1}"
DB_PORT_ENV="$(env_value DB_PORT)"; DB_PORT_ENV="${DB_PORT_ENV:-3306}"

# El dump se valida acá, antes de cualquier otra cosa. Un archivo corrupto o
# truncado no puede descubrirse a mitad de la restauración, con la base ya
# abierta y el árbol a punto de bajarse: ahí no hay a dónde volver.
if [ -n "$RESTORE_DUMP" ]; then
  [ -f "$RESTORE_DUMP" ] || die "no existe el dump ${RESTORE_DUMP}"
  gzip -t -- "$RESTORE_DUMP" 2>/dev/null \
    || die "el dump ${RESTORE_DUMP} está corrupto o truncado (gzip -t falló). No se tocó nada: el deploy actual (${CURRENT_SHA}) sigue en pie."
  log "     dump ${RESTORE_DUMP} verificado con gzip -t"
fi

log "1/6  Prevalidando ${ROLLBACK_TO} en un worktree aparte"
VALIDATE_DIR=""
limpiar_worktree() {
  [ -n "$VALIDATE_DIR" ] || return 0
  git -C "$APP_DIR" worktree remove --force "$VALIDATE_DIR" 2>/dev/null || rm -rf "$VALIDATE_DIR"
  git -C "$APP_DIR" worktree prune 2>/dev/null || true
  VALIDATE_DIR=""
}
if [ "${SKIP_PREVALIDACION:-0}" = "1" ]; then
  warn "SKIP_PREVALIDACION=1: no se prevalida. Un build roto se va a ver recién con la base ya revertida."
else
  VALIDATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rollback-validate-XXXXXX")"
  # `git worktree add` quiere el directorio inexistente; mktemp -d ya lo creó.
  rmdir "$VALIDATE_DIR"
  trap 'limpiar_worktree' EXIT
  git -C "$APP_DIR" worktree add --detach "$VALIDATE_DIR" "$ROLLBACK_TO" >/dev/null \
    || die "no se pudo crear el worktree de prevalidación para ${ROLLBACK_TO}." 2
  if ! reconstruir "$VALIDATE_DIR"; then
    limpiar_worktree
    echo "" >&2
    echo "  LA VERSIÓN DESTINO NO PASÓ LA PREVALIDACIÓN" >&2
    echo "  ${ROLLBACK_TO} no completó install + builds en un worktree limpio." >&2
    echo "  NO se tocó la base ni el árbol: el deploy actual (${CURRENT_SHA}) sigue" >&2
    echo "  corriendo. Revisá el error de arriba antes de reintentar." >&2
    exit 2
  fi
  limpiar_worktree
  trap - EXIT
  log "     ${ROLLBACK_TO} instala y compila: se puede seguir."
fi

log "2/6  Backup de la base (antes de tocarla)"
BACKUP_DIR="${APP_DIR}/.db-backups"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="${BACKUP_DIR}/pre-rollback-$(date +%Y%m%d-%H%M%S).sql.gz"
if MYSQL_PWD="$(env_value DB_PASS)" \
   mysqldump -h"$DB_HOST_ENV" -P"$DB_PORT_ENV" -u"$DB_USER_ENV" "$DB_NAME_ENV" 2>/dev/null | gzip > "$BACKUP_FILE"; then
  log "     backup en ${BACKUP_FILE}"
else
  rm -f "$BACKUP_FILE"
  die "no se pudo generar el backup: se aborta el rollback con el deploy actual intacto."
fi
# Un backup que no se puede leer no es un backup: sin él, la recuperación de
# los pasos 4 a 6 no tendría con qué volver la base.
gzip -t -- "$BACKUP_FILE" 2>/dev/null \
  || die "el backup recién generado no pasa gzip -t. Se aborta con el deploy actual intacto (${CURRENT_SHA})."

if [ -n "$RESTORE_DUMP" ]; then
  # Camino explícito para las bases sembradas después de migrar: ahí el
  # `down()` de las migraciones que restauran por id de bloque no encuentra
  # nada que restaurar, y el dump es la única vuelta atrás real.
  log "3/6  Restaurando el dump ${RESTORE_DUMP} (en vez de revertir migraciones)"
  if ! restaurar_dump "$RESTORE_DUMP"; then
    # El `gzip -t` de más arriba ya descartó los dumps ilegibles, así que llegar
    # hasta acá significa que mysql cortó con la base abierta: puede haber
    # quedado parte del dump aplicada. No se puede dejar así, y hay un backup
    # recién tomado y verificado del paso 2.
    warn "falló la restauración de ${RESTORE_DUMP} con la base ya abierta."
    if restaurar_dump "$BACKUP_FILE"; then
      die "falló la restauración de ${RESTORE_DUMP} y se restauró el backup ${BACKUP_FILE}: la base quedó como antes y el código NO se bajó (seguís en ${CURRENT_SHA})." 4
    fi
    die "falló la restauración de ${RESTORE_DUMP} y el backup ${BACKUP_FILE} tampoco se pudo restaurar. La base quedó en un estado intermedio: NO levantes la aplicación hasta resolverlo." 5
  fi
else
  # Qué revertir sale de `knex_migrations`, no de contar archivos del repo:
  # si el deploy quedó a medias, esos dos números no coinciden.
  log "3/6  Revirtiendo lo aplicado que ${ROLLBACK_TO} no tiene, con el código nuevo en disco"
  pnpm install --frozen-lockfile
  set +e
  BACKUP_FILE="$BACKUP_FILE" \
    DEST_MIGRATIONS="$(git ls-tree --name-only "$ROLLBACK_TO" -- api/migrations/)" \
    bash scripts/deploy/rollback-db.sh
  RB_CODE=$?
  set -e
  case "$RB_CODE" in
    0) ;;
    4)
      # Falló un down() y el backup volvió: el código sigue en la versión
      # actual, así que la aplicación queda consistente. No se sigue.
      die "el rollback de la base se abortó y se restauró el backup. El código NO se bajó: seguís en ${CURRENT_SHA}." 4
      ;;
    5)
      die "REVERSIÓN PARCIAL de la base y el backup no se pudo restaurar. NO se bajó el código y NO se reinició la aplicación: revisá el detalle de arriba antes de seguir. Backup: ${BACKUP_FILE}" 5
      ;;
    *)
      die "no se pudo revertir la base (código ${RB_CODE}). El código sigue en ${CURRENT_SHA} y el backup está en ${BACKUP_FILE}." "$RB_CODE"
      ;;
  esac
fi

# --- Desde acá la base ya cambió: cada fallo pasa por `recuperar` -----------

log "4/6  Bajando el árbol a ${ROLLBACK_TO} (desde ${CURRENT_SHA})"
git reset --hard "$ROLLBACK_TO" || recuperar "el checkout a ${ROLLBACK_TO}"

log "5/6  Install + builds de la versión anterior"
reconstruir "$APP_DIR" || recuperar "el install/build de ${ROLLBACK_TO}"

log "6/6  Reload de Nginx + restart de PM2"
reiniciar_servicio "$APP_DIR" || recuperar "el reinicio de Nginx/PM2 con ${ROLLBACK_TO}"

HEALTH="000"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost/api/health" || echo "000")
  [ "$HEALTH" = "200" ] && break
done
if [ "$HEALTH" = "200" ]; then
  echo -e "\033[1;32m✅ Rollback completo: ${CURRENT_SHA} → ${ROLLBACK_TO}\033[0m"
else
  # Acá el rollback sí se aplicó entero —árbol, base y servicio en la versión
  # destino— y lo que no responde es la aplicación vieja. Recuperar hacia
  # adelante sería volver a la versión de la que se está huyendo, así que se
  # informa y decide una persona.
  warn "el health check devolvió ${HEALTH}: la aplicación NO está respondiendo."
  echo "  El código ya está en ${ROLLBACK_TO} y la base revertida." >&2
  echo "  Revisá: pm2 logs sanatorio-api" >&2
  echo "  Backup previo al rollback: ${BACKUP_FILE}" >&2
  exit 6
fi
