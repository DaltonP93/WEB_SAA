#!/usr/bin/env bash
# ============================================================================
# Decide el estado de la base y escribe api/.env — en ese orden.
#
# `setup-vps.sh` hacía lo contrario: generaba una contraseña de admin y la
# escribía en `api/.env` como `SEED_ADMIN_PASSWORD` **antes** de consultar el
# estado de la base. En una actualización el seed no corre, así que esa
# contraseña no se aplicaba a ningún usuario: quedaba anotada en el `.env`
# —y en `.deploy-credentials`— una credencial que no abre nada, pisando la que
# sí servía.
#
# Acá el orden es el correcto:
#
#   1. se consulta `db-state.mjs`;
#   2. si hay conflicto se aborta sin escribir nada;
#   3. la contraseña del admin se genera **sólo** si el seed va a crear el
#      usuario. En una actualización se conserva la que ya estuviera; si no hay
#      ninguna, no se inventa y `SEED_ADMIN_PASSWORD` queda fuera del `.env`.
#
# Se ejecuta como script aparte para poder probarlo: correr `setup-vps.sh`
# entero exige root, apt y un VPS.
#
# Entradas (entorno): APP_DIR, REPO_ROOT, DB_HOST, DB_PORT, DB_NAME, DB_USER,
# DB_PASS, JWT_SECRET, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASS (opcional),
# SITE_ORIGIN, SEED_MARKER.
#
# Salida (stdout): líneas `CLAVE=valor` para que el llamador las evalúe.
# **Nunca** imprime la contraseña: el llamador la lee del `.env` que se acaba
# de escribir.
#
#   DB_STATE=nueva|actualizacion
#   WILL_SEED=0|1
#   ADMIN_PASS_GENERATED=0|1
#
# Códigos: 0 todo bien · 3 conflicto (la base tiene datos y falta el marker).
# ============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:?falta APP_DIR}"
REPO_ROOT="${REPO_ROOT:-$APP_DIR}"
ENV_FILE="${APP_DIR}/api/.env"
SEED_MARKER="${SEED_MARKER:-${APP_DIR}/.seeded}"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-sanatorio}"
DB_USER="${DB_USER:-sanatorio}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@sanatorio.local}"
ADMIN_NAME="${ADMIN_NAME:-Administrador}"
SITE_ORIGIN="${SITE_ORIGIN:-http://localhost}"

env_value() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | head -n1
}

# --- 1. Estado de la base, antes de tocar nada ------------------------------
set +e
DB_STATE="$(DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_USER="$DB_USER" DB_PASS="${DB_PASS:-}" \
  DB_NAME="$DB_NAME" SEED_MARKER="$SEED_MARKER" node "${REPO_ROOT}/scripts/deploy/db-state.mjs")"
DB_STATE_CODE=$?
set -e

if [ "$DB_STATE_CODE" -ne 0 ] || { [ "$DB_STATE" != "nueva" ] && [ "$DB_STATE" != "actualizacion" ]; }; then
  echo "ERROR: no se puede continuar (estado: ${DB_STATE:-desconocido}, código ${DB_STATE_CODE})." >&2
  echo "       No se escribió api/.env ni se generó ninguna credencial." >&2
  exit 3
fi

# --- 2. Credenciales, según lo que se vaya a hacer --------------------------
WILL_SEED=0
[ "$DB_STATE" = "nueva" ] && WILL_SEED=1

EXISTING_ADMIN_PASS="$(env_value SEED_ADMIN_PASSWORD)"
ADMIN_PASS_GENERATED=0

if [ -n "${ADMIN_PASS:-}" ]; then
  : # la pasó el operador por entorno: manda
elif [ -n "$EXISTING_ADMIN_PASS" ]; then
  # Es la que corresponde al usuario que existe en la base.
  ADMIN_PASS="$EXISTING_ADMIN_PASS"
elif [ "$WILL_SEED" = "1" ]; then
  # Recién acá se genera: el seed va a crear el usuario con esta contraseña.
  ADMIN_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 20)"
  ADMIN_PASS_GENERATED=1
else
  # Actualización sin contraseña conocida: no se inventa una que no abre nada.
  ADMIN_PASS=""
fi

# --- 3. .env ----------------------------------------------------------------
# Se conservan los secretos que ya existan: rotar el JWT desloguea a todos.
DB_PASS="${DB_PASS:-$(env_value DB_PASS)}"
JWT_SECRET="${JWT_SECRET:-$(env_value JWT_SECRET)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 48 | tr -d '/+=' | head -c 48)}"

mkdir -p "$(dirname "$ENV_FILE")"
umask 077
{
  cat <<EOF
PORT=4000
NODE_ENV=production

DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_USER=${DB_USER}
DB_PASS=${DB_PASS}
DB_NAME=${DB_NAME}

JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=7d

UPLOAD_DIR=${APP_DIR}/api/uploads
MAX_UPLOAD_MB=10

CORS_ORIGINS=${SITE_ORIGIN}
PUBLIC_BASE_URL=${SITE_ORIGIN}
PUBLIC_SITE_URL=${SITE_ORIGIN}

SEED_ADMIN_EMAIL=${ADMIN_EMAIL}
SEED_ADMIN_NAME=${ADMIN_NAME}
EOF
  # La línea sólo se escribe si hay una contraseña real detrás.
  if [ -n "$ADMIN_PASS" ]; then
    echo "SEED_ADMIN_PASSWORD=${ADMIN_PASS}"
  else
    echo "# SEED_ADMIN_PASSWORD: no se define. El usuario admin ya existe y su"
    echo "# contraseña no está en este servidor; cambiala desde el panel si se perdió."
  fi
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo "DB_STATE=${DB_STATE}"
echo "WILL_SEED=${WILL_SEED}"
echo "ADMIN_PASS_GENERATED=${ADMIN_PASS_GENERATED}"
