#!/usr/bin/env bash
# ============================================================================
# Revierte de la base exactamente lo que sobra para volver a una versión.
#
# Dos cosas que antes no eran ciertas:
#
# 1. **Cuántas revertir** se calculaba con `git diff` sobre `api/migrations`,
#    o sea contando archivos del código. Si el deploy quedó a medias —dos
#    migraciones nuevas, sólo una aplicada—, ese número no coincide con la
#    realidad y el rollback baja de más: una migración que el SHA destino sí
#    tiene y no había que tocar. Ahora la lista sale de `knex_migrations`
#    (`migrations-to-revert.mjs`).
#
# 2. **Qué pasa si falla una del medio.** El script decía "la base quedó como
#    estaba", y no: si la primera revirtió y la segunda falló, la base quedó a
#    mitad de camino. Ahora se restaura el backup automáticamente, y si eso
#    tampoco se puede, se sale con un código propio y un mensaje que dice
#    exactamente en qué estado quedó.
#
# Uso:
#   BACKUP_FILE=/ruta/backup.sql.gz DEST_MIGRATIONS="$(git ls-tree ...)" \
#     bash scripts/deploy/rollback-db.sh
#
# Variables:
#   DEST_MIGRATIONS / DEST_MIGRATIONS_DIR  migraciones del árbol destino.
#   BACKUP_FILE     dump previo, para restaurar si algo falla (obligatorio).
#   DOWN_CMD        cómo revertir una migración. Por defecto el script del
#                   paquete, que corre knex a través de tsx. Se separa por
#                   espacios y se ejecuta como arreglo (sin `eval`), así que no
#                   admite argumentos con espacios.
#   DB_HOST/PORT/USER/PASS/NAME  conexión (por defecto, api/.env).
#
# Códigos de salida:
#   0  se revirtió lo que había que revertir (o no había nada)
#   3  no se pudo calcular la lista, o trae un nombre que no es un nombre
#   4  el rollback se abortó y la base quedó como antes (backup restaurado, o
#      nunca se llegó a tocarla)
#   5  la base quedó en un estado intermedio y no se pudo restaurar
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_FILE="${BACKUP_FILE:-}"
# Al comando se le pasa el NOMBRE de la migración: `migrate:down [<name>]`
# revierte esa, no "la última aplicada". No son lo mismo cuando se fusionan dos
# ramas y los timestamps quedan fuera de orden.
DOWN_CMD="${DOWN_CMD:-pnpm --filter @sa/api migrate:down}"
# Se separa en palabras UNA sola vez, acá, y después se ejecuta como arreglo.
# Antes esto era `eval "$DOWN_CMD '$nombre'"`: el nombre de la migración —que
# sale de una tabla— se concatenaba en una línea que el shell volvía a parsear,
# así que un valor con comillas o `;` dejaba de ser un argumento y pasaba a ser
# otro comando. Como arreglo, el nombre es siempre un argumento.
read -r -a DOWN_ARGV <<< "$DOWN_CMD"

log()  { echo -e "\033[1;34m==>\033[0m $*"; }
warn() { echo -e "\033[1;33m!!\033[0m $*" >&2; }
die()  { echo -e "\033[1;31mERROR:\033[0m $*" >&2; exit "${2:-1}"; }

[ "${#DOWN_ARGV[@]}" -gt 0 ] || die "DOWN_CMD está vacío: no hay con qué revertir." 3

env_value() {
  [ -f "${ROOT}/api/.env" ] || return 0
  sed -n "s/^$1=//p" "${ROOT}/api/.env" | head -n1
}

DB_HOST="${DB_HOST:-$(env_value DB_HOST)}"; DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-$(env_value DB_PORT)}"; DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-$(env_value DB_USER)}"; DB_USER="${DB_USER:-sanatorio}"
DB_PASS="${DB_PASS:-$(env_value DB_PASS)}"
DB_NAME="${DB_NAME:-$(env_value DB_NAME)}"; DB_NAME="${DB_NAME:-sanatorio}"

# Un nombre de migración es un nombre de archivo, nada más.
#
# `knex_migrations` es una tabla escribible: quien pueda insertar una fila ahí
# decide qué texto llega a una línea de comando y a una consulta SQL. Comillas,
# espacios, saltos de línea, `;`, `$`, backticks o `..` no describen ninguna
# migración real de este repo, así que se rechazan de plano en vez de intentar
# escaparlos. `migrations-to-revert.mjs` ya valida en el origen —donde el valor
# todavía se ve entero, antes de viajar línea por línea—; acá se vuelve a
# validar porque este script se puede invocar con otra lista.
nombre_valido() {
  case "$1" in
    *..*) return 1 ;;
  esac
  [ "${#1}" -le 200 ] && [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]
}

# ¿La migración sigue registrada como aplicada?
#
#   0 = sí, sigue aplicada        1 = ya no está        2 = no se pudo saber
#
# Antes esto era una sola pregunta con `2>/dev/null || echo ""`, así que una
# conexión caída, un permiso denegado o un `knex_migrations` inexistente se
# leían exactamente igual que "la migración ya no está": el rollback las contaba
# como revertidas y seguía adelante. Un error de consulta no es una respuesta;
# tiene que abortar.
estado_migracion() {
  local salida rc err
  nombre_valido "$1" || { warn "nombre de migración inválido en la verificación."; return 2; }
  err="$(mktemp)"
  salida="$(MYSQL_PWD="${DB_PASS:-}" mysql -N -B -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" "$DB_NAME" \
    -e "SELECT COUNT(*) FROM knex_migrations WHERE name = '$1'" 2>"$err")"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    warn "no se pudo consultar knex_migrations para ${1} (mysql salió ${rc}): $(tr '\n' ' ' < "$err" | head -c 300)"
    rm -f "$err"
    return 2
  fi
  rm -f "$err"
  salida="$(printf '%s' "$salida" | tr -d '[:space:]')"
  case "$salida" in
    0) return 1 ;;
    ""|*[!0-9]*)
      warn "respuesta inesperada al verificar ${1}: '${salida}'"
      return 2
      ;;
    *) return 0 ;;
  esac
}

# Restaura un dump .sql.gz sobre la base configurada.
#
# `gzip -t` primero: un dump truncado o corrupto se detecta ANTES de tocar la
# base. Y la pipeline corre en este shell, que tiene `pipefail`; antes iba
# dentro de un `bash -c "…"` —un shell nuevo, sin pipefail, con las rutas
# interpoladas— donde el estado del pipe era el de `mysql`, que termina bien
# con una entrada vacía: un gzip roto se reportaba como restauración exitosa.
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
  gunzip -c -- "$dump" | MYSQL_PWD="${DB_PASS:-}" mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" "$DB_NAME"
}

# --- 1. Qué revertir, según la base ----------------------------------------
PENDIENTES="$(DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_USER="$DB_USER" DB_PASS="${DB_PASS:-}" \
  DB_NAME="$DB_NAME" node "${ROOT}/scripts/deploy/migrations-to-revert.mjs")" \
  || die "no se pudo calcular qué migraciones revertir." 3

if [ -z "$PENDIENTES" ]; then
  log "No hay migraciones aplicadas que el SHA destino no tenga: nada que revertir."
  exit 0
fi

# Antes de ejecutar nada: la lista entera tiene que ser de nombres. Si uno solo
# no lo es, no se revierte ninguno — un nombre manipulado invalida el cálculo
# completo, no sólo su propia línea.
while IFS= read -r nombre; do
  [ -n "$nombre" ] || continue
  nombre_valido "$nombre" \
    || die "knex_migrations trae un nombre que no es un nombre de migración: $(printf '%q' "$nombre"). No se revirtió nada." 3
done <<< "$PENDIENTES"

CANTIDAD="$(echo "$PENDIENTES" | grep -c . || true)"
log "Migraciones a revertir (${CANTIDAD}), de la más nueva a la más vieja:"
echo "$PENDIENTES" | sed 's/^/    · /'

# --- 1b. Preflight de procedencia de marca ---------------------------------
# Si el rollback cruza las migraciones de marca (favicon/logo), sus snapshots de
# procedencia tienen que existir y ser válidos ANTES de revertir nada: el
# fail-closed de cada down() llegaría tarde en un batch (las migraciones más
# nuevas ya se habrían revertido). No se salta con ROLLBACK_ALLOW_AFTER_SEED.
if ! printf '%s\n' "$PENDIENTES" | (cd "$ROOT" && DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" \
      DB_USER="$DB_USER" DB_PASS="${DB_PASS:-}" DB_NAME="$DB_NAME" \
      node "${ROOT}/scripts/deploy/brand-snapshot-preflight.mjs"); then
  die "el preflight de procedencia de marca bloqueó el rollback: no se revirtió ninguna migración y la base quedó intacta (ver el detalle de arriba)." 4
fi

# --- 2. Revertir, una por una ----------------------------------------------
# `migrate:rollback` revierte el batch entero, que puede incluir migraciones
# que el SHA destino sí tiene. Se va de a una.
REVERTIDAS=0
FALLO=""
# Qué falló, que no es lo mismo en los tres casos:
#   down            el comando de reversión falló → aborta antes de tocar la base
#   sigue_aplicada  terminó bien pero la migración sigue registrada
#   verificacion    terminó bien y no se pudo comprobar el resultado
FALLO_TIPO=""
while IFS= read -r nombre; do
  [ -n "$nombre" ] || continue
  log "    revirtiendo ${nombre}"
  # Las variables de conexión se exportan al comando: si no, knex las lee de
  # api/.env y podría revertir contra una base distinta de la que se consultó.
  # El nombre va como argumento del arreglo, nunca concatenado en una cadena.
  if ! (cd "$ROOT" && DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_USER="$DB_USER" \
        DB_PASS="${DB_PASS:-}" DB_NAME="$DB_NAME" "${DOWN_ARGV[@]}" "$nombre"); then
    FALLO="$nombre"
    FALLO_TIPO="down"
    break
  fi
  # Y se comprueba que la que se fue sea la que se pidió: un `down()` que
  # revierte otra deja la base peor que antes, en silencio.
  estado_migracion "$nombre"
  case "$?" in
    1) REVERTIDAS=$((REVERTIDAS + 1)) ;;
    0)
      warn "el down() de ${nombre} terminó sin error pero la migración sigue aplicada."
      FALLO="$nombre"
      FALLO_TIPO="sigue_aplicada"
      break
      ;;
    *)
      warn "el down() de ${nombre} terminó sin error y no se pudo verificar el resultado."
      FALLO="$nombre"
      FALLO_TIPO="verificacion"
      break
      ;;
  esac
done <<< "$PENDIENTES"

if [ -z "$FALLO" ]; then
  log "Listo: ${REVERTIDAS} migración(es) revertida(s)."
  exit 0
fi

# --- 3. Falló una del medio -------------------------------------------------
case "$FALLO_TIPO" in
  down)           DETALLE="falló el down() de ${FALLO}" ;;
  sigue_aplicada) DETALLE="el down() de ${FALLO} terminó sin error pero la migración sigue aplicada" ;;
  *)              DETALLE="el down() de ${FALLO} terminó sin error y no se pudo verificar el resultado" ;;
esac
warn "${DETALLE}."
warn "Migraciones ya revertidas antes de esto: ${REVERTIDAS}."

if [ "$REVERTIDAS" -eq 0 ] && [ "$FALLO_TIPO" = "down" ]; then
  # Dos condiciones, no una. Que no se haya revertido nada alcanza sólo si
  # además el fallo fue del propio `down()`, que aborta sin tocar la base: ahí
  # está intacta y restaurar un dump encima sería destruir por las dudas. Es lo
  # que pasa cuando `rollback-guard.mjs` bloquea el primer `down()` a propósito.
  #
  # Si el `down()` terminó BIEN y la migración sigue aplicada, o si no se pudo
  # verificar, la base pudo haber cambiado aunque el contador siga en cero. Esos
  # casos siguen de largo hasta la restauración.
  echo "" >&2
  echo "  ROLLBACK NO INICIADO" >&2
  echo "  Falló el primer down() (${FALLO}) y no se revirtió ninguna migración:" >&2
  echo "  la base quedó exactamente como estaba y no se tocó ningún dump." >&2
  echo "  Si lo bloqueó rollback-guard.mjs —la base se sembró después de" >&2
  echo "  migrar—, la vuelta atrás va por dump:" >&2
  echo "    RESTORE_DUMP=<dump> bash scripts/deploy/rollback-vps.sh" >&2
  exit 4
fi

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "" >&2
  echo "  REVERSIÓN PARCIAL Y SIN BACKUP" >&2
  echo "  ${DETALLE^}, después de revertir ${REVERTIDAS}." >&2
  echo "  No hay dump con el que volver atrás (BACKUP_FILE=${BACKUP_FILE:-vacío})." >&2
  echo "  La base está en un estado intermedio: restaurá un backup a mano" >&2
  echo "  antes de volver a levantar la aplicación." >&2
  exit 5
fi

warn "restaurando el backup ${BACKUP_FILE}"
if restaurar_dump "$BACKUP_FILE"; then
  echo "" >&2
  echo "  ROLLBACK ABORTADO, BASE RESTAURADA" >&2
  echo "  ${DETALLE^}, después de revertir ${REVERTIDAS}." >&2
  echo "  Se restauró ${BACKUP_FILE}: la base quedó como antes del rollback." >&2
  echo "  El código NO se bajó: seguís en la versión actual." >&2
  exit 4
fi

echo "" >&2
echo "  REVERSIÓN PARCIAL — LA RESTAURACIÓN TAMBIÉN FALLÓ" >&2
echo "  ${DETALLE^}, después de revertir ${REVERTIDAS}, y el dump" >&2
echo "  ${BACKUP_FILE} no se pudo restaurar." >&2
echo "  La base está en un estado intermedio. No levantes la aplicación:" >&2
echo "  restaurá el dump a mano y revisá el error de mysql de arriba." >&2
exit 5
