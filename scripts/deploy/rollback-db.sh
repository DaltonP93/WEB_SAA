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
#                   paquete, que corre knex a través de tsx.
#   DB_HOST/PORT/USER/PASS/NAME  conexión (por defecto, api/.env).
#
# Códigos de salida:
#   0  se revirtió lo que había que revertir (o no había nada)
#   3  no se pudo calcular la lista
#   4  falló un `down()` y se restauró el backup: la base quedó como antes
#   5  falló un `down()` y la restauración TAMBIÉN falló: reversión parcial
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_FILE="${BACKUP_FILE:-}"
DOWN_CMD="${DOWN_CMD:-pnpm --filter @sa/api migrate:down}"

log()  { echo -e "\033[1;34m==>\033[0m $*"; }
warn() { echo -e "\033[1;33m!!\033[0m $*" >&2; }
die()  { echo -e "\033[1;31mERROR:\033[0m $*" >&2; exit "${2:-1}"; }

env_value() {
  [ -f "${ROOT}/api/.env" ] || return 0
  sed -n "s/^$1=//p" "${ROOT}/api/.env" | head -n1
}

DB_HOST="${DB_HOST:-$(env_value DB_HOST)}"; DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-$(env_value DB_PORT)}"; DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-$(env_value DB_USER)}"; DB_USER="${DB_USER:-sanatorio}"
DB_PASS="${DB_PASS:-$(env_value DB_PASS)}"
DB_NAME="${DB_NAME:-$(env_value DB_NAME)}"; DB_NAME="${DB_NAME:-sanatorio}"

# --- 1. Qué revertir, según la base ----------------------------------------
PENDIENTES="$(DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_USER="$DB_USER" DB_PASS="${DB_PASS:-}" \
  DB_NAME="$DB_NAME" node "${ROOT}/scripts/deploy/migrations-to-revert.mjs")" \
  || die "no se pudo calcular qué migraciones revertir." 3

if [ -z "$PENDIENTES" ]; then
  log "No hay migraciones aplicadas que el SHA destino no tenga: nada que revertir."
  exit 0
fi

CANTIDAD="$(echo "$PENDIENTES" | grep -c . || true)"
log "Migraciones a revertir (${CANTIDAD}), de la más nueva a la más vieja:"
echo "$PENDIENTES" | sed 's/^/    · /'

# --- 2. Revertir, una por una ----------------------------------------------
# `migrate:rollback` revierte el batch entero, que puede incluir migraciones
# que el SHA destino sí tiene. Se va de a una.
REVERTIDAS=0
FALLO=""
while IFS= read -r nombre; do
  [ -n "$nombre" ] || continue
  log "    revirtiendo ${nombre}"
  if ! (cd "$ROOT" && eval "$DOWN_CMD"); then
    FALLO="$nombre"
    break
  fi
  REVERTIDAS=$((REVERTIDAS + 1))
done <<< "$PENDIENTES"

if [ -z "$FALLO" ]; then
  log "Listo: ${REVERTIDAS} migración(es) revertida(s)."
  exit 0
fi

# --- 3. Falló una del medio -------------------------------------------------
warn "falló el down() de ${FALLO}."
warn "Ya se habían revertido ${REVERTIDAS}: la base NO quedó como estaba."

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "" >&2
  echo "  REVERSIÓN PARCIAL Y SIN BACKUP" >&2
  echo "  Se revirtieron ${REVERTIDAS} migración(es) y la siguiente falló." >&2
  echo "  No hay dump con el que volver atrás (BACKUP_FILE=${BACKUP_FILE:-vacío})." >&2
  echo "  La base está en un estado intermedio: restaurá un backup a mano" >&2
  echo "  antes de volver a levantar la aplicación." >&2
  exit 5
fi

warn "restaurando el backup ${BACKUP_FILE}"
# `pipefail` en el subshell: sin eso, un gzip corrupto se pierde porque el
# estado del pipe es el de `mysql`, que termina bien con una entrada vacía —y
# el script diría que restauró algo que nunca llegó a la base.
if MYSQL_PWD="${DB_PASS:-}" bash -c "set -o pipefail; gunzip -c '$BACKUP_FILE' | mysql -h'$DB_HOST' -P'$DB_PORT' -u'$DB_USER' '$DB_NAME'"; then
  echo "" >&2
  echo "  ROLLBACK ABORTADO, BASE RESTAURADA" >&2
  echo "  Falló el down() de ${FALLO} después de revertir ${REVERTIDAS}." >&2
  echo "  Se restauró ${BACKUP_FILE}: la base quedó como antes del rollback." >&2
  echo "  El código NO se bajó: seguís en la versión actual." >&2
  exit 4
fi

echo "" >&2
echo "  REVERSIÓN PARCIAL — LA RESTAURACIÓN TAMBIÉN FALLÓ" >&2
echo "  Se revirtieron ${REVERTIDAS} migración(es), falló ${FALLO} y el dump" >&2
echo "  ${BACKUP_FILE} no se pudo restaurar." >&2
echo "  La base está en un estado intermedio. No levantes la aplicación:" >&2
echo "  restaurá el dump a mano y revisá el error de mysql de arriba." >&2
exit 5
