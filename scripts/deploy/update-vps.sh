#!/usr/bin/env bash
# ============================================================================
# Update deploy — actualiza el VPS a un commit aprobado de main.
# Resuelve DEPLOY_TO (o el HEAD remoto si no se pasa), corre migraciones nuevas,
# rebuild y reinicia PM2.
# NO resembra la DB (no pisa contenido editado desde el admin).
#
# Uso seguro (como root, en el VPS):
#   DEPLOY_TO=<sha-aprobado> bash /var/www/sanatorio/scripts/deploy/update-vps.sh
#
# Este script sólo va HACIA ADELANTE. La vuelta atrás vive en
# scripts/deploy/rollback-vps.sh, que es el único que la hace en el orden que
# funciona: revierte las migraciones con el código nuevo todavía en disco y
# recién después baja el árbol (docs/DEPLOY.md §Rollback). Bajar el código
# primero deja en `knex_migrations` migraciones aplicadas cuyo archivo ya no
# existe: knex no las puede revertir, y el `down()` que hacía falta era el de
# la versión nueva.
# ============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/sanatorio}"
BRANCH="${BRANCH:-main}"
DEPLOY_TO="${DEPLOY_TO:-}"

log() { echo -e "\033[1;34m==>\033[0m $*"; }
die() { echo -e "\033[1;31mERROR:\033[0m $*" >&2; exit 1; }

# Antes de tocar nada. Este script llegó a aceptar ROLLBACK_TO y hacía
# `git reset --hard` a esa versión antes de mirar la base: el árbol quedaba
# viejo con la base adelantada y sin forma de revertirla. Aceptarlo en silencio
# —o ignorarlo— es peor que rechazarlo, así que se rechaza y se dice a dónde ir.
if [ -n "${ROLLBACK_TO:-}" ]; then
  echo -e "\033[1;31mERROR:\033[0m update-vps.sh no hace rollback: sólo actualiza hacia adelante." >&2
  echo "  Nada se modificó." >&2
  echo "  Para volver a ${ROLLBACK_TO}, el script que revierte la base primero:" >&2
  echo "    ROLLBACK_TO=${ROLLBACK_TO} bash ${APP_DIR}/scripts/deploy/rollback-vps.sh" >&2
  echo "  Detalle del procedimiento en docs/DEPLOY.md §Rollback." >&2
  exit 2
fi

[ -d "$APP_DIR/.git" ] || die "$APP_DIR no es un repo git. ¿Corriste setup-vps.sh primero?"

SELF="$APP_DIR/scripts/deploy/update-vps.sh"

# Correr desde una copia propia, no desde el archivo del repo.
#
# bash NO carga el script entero en memoria: lo lee por offset a medida que lo
# ejecuta. El `git reset` del paso 1 reescribe este mismo archivo, así que el
# intérprete pasaba a leer el contenido NUEVO desde la posición VIEJA y lo que
# corría a partir de ahí era una mezcla de las dos versiones.
#
# Con la copia también queda resuelto el otro problema: `$0` conserva el
# contenido con el que arrancó este deploy. Antes la detección de "el script
# cambió" comparaba `sha256sum "$0"` contra `sha256sum "$SELF"` DESPUÉS del
# reset, y en un deploy normal esos dos caminos son el MISMO archivo ya
# actualizado: los hashes daban iguales siempre, la reejecución no ocurría nunca
# y el deploy terminaba corriendo la versión vieja del script.
if [ -z "${DEPLOY_SELF_COPY:-}" ]; then
  # Si el script llegó por una tubería (`… | bash`) no hay archivo que copiar, y
  # tampoco habría forma de compararlo después. Se pide la ruta explícita en vez
  # de fallar con un error de `cat`.
  [ -r "$0" ] || die "no se puede leer el propio script ('$0'). Ejecutalo por su ruta: bash ${SELF}"
  DEPLOY_SELF_COPY="$(mktemp "${TMPDIR:-/tmp}/update-vps-XXXXXX.sh")" \
    || die "no se pudo crear el temporal para la copia del script (¿${TMPDIR:-/tmp} lleno o de sólo lectura?). Nada se modificó."
  cat "$0" > "$DEPLOY_SELF_COPY" \
    || die "no se pudo copiar el script a ${DEPLOY_SELF_COPY}. Nada se modificó."
  export DEPLOY_SELF_COPY
  exec bash "$DEPLOY_SELF_COPY" "$@"
fi
# Este proceso ya corre desde la copia: se limpia al salir. En el camino de
# reejecución se borra a mano, porque `exec` no dispara las traps.
trap 'rm -f "${DEPLOY_SELF_COPY:-}"' EXIT

cd "$APP_DIR"

log "1/6  Resolver versión aprobada (rama ${BRANCH})"
PREVIOUS_SHA="$(git rev-parse HEAD)"
git fetch origin
TARGET_REF="${DEPLOY_TO:-origin/${BRANCH}}"
TARGET_SHA="$(git rev-parse --verify "${TARGET_REF}^{commit}")" \
  || die "DEPLOY_TO no identifica un commit disponible: ${TARGET_REF}"
git merge-base --is-ancestor "$TARGET_SHA" "origin/${BRANCH}" \
  || die "DEPLOY_TO no pertenece a origin/${BRANCH}: se rechaza una versión no aprobada."
git merge-base --is-ancestor "$PREVIOUS_SHA" "$TARGET_SHA" \
  || die "DEPLOY_TO implicaría retroceder o cambiar de historia. Usá rollback-vps.sh."
git checkout "$BRANCH"
git reset --hard "$TARGET_SHA"
log "    versión anterior: ${PREVIOUS_SHA} · versión aprobada: ${TARGET_SHA}"

# ¿El propio update-vps.sh cambió en este pull? Se compara la copia con la que
# arrancó el deploy —el contenido de ANTES del reset— contra el archivo que
# quedó en el árbol. Si difieren, se reejecuta la versión nueva para que el
# arreglo del script se aplique en ESTE deploy y no en el siguiente.
#
# La reejecución es una sola, siempre: `DEPLOY_REEXEC=1` viaja al proceso nuevo
# y le impide volver a entrar acá, así que no hay forma de armar un bucle aunque
# las dos versiones sigan difiriendo.
if [ "${DEPLOY_REEXEC:-0}" != "1" ] && [ -f "$SELF" ]; then
  HASH_EN_USO="$(sha256sum "$DEPLOY_SELF_COPY" | awk '{print $1}')"
  HASH_EN_DISCO="$(sha256sum "$SELF" | awk '{print $1}')"
  if [ "$HASH_EN_USO" != "$HASH_EN_DISCO" ]; then
    log "    el script cambió en este pull → re-ejecutando la versión nueva"
    rm -f "$DEPLOY_SELF_COPY"
    # DEPLOY_SELF_COPY vacío: la versión nueva saca su propia copia.
    DEPLOY_REEXEC=1 DEPLOY_SELF_COPY= exec bash "$SELF" "$@"
  fi
fi

log "2/6  pnpm install (congelado)"
# Sin fallback: un install no congelado deja el servidor con dependencias
# distintas a las que se auditaron y buildearon en CI.
pnpm install --frozen-lockfile \
  || die "pnpm install --frozen-lockfile falló. Commiteá el pnpm-lock.yaml actualizado y volvé a deployar (no se instala sin lockfile congelado)."

log "3/6  Backup de la DB antes de migrar"
BACKUP_DIR="${APP_DIR}/.db-backups"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="${BACKUP_DIR}/sanatorio-$(date +%Y%m%d-%H%M%S).sql.gz"
DB_NAME_ENV="$(grep -E '^DB_NAME=' "$APP_DIR/api/.env" | cut -d= -f2- || echo sanatorio)"
DB_USER_ENV="$(grep -E '^DB_USER=' "$APP_DIR/api/.env" | cut -d= -f2- || echo sanatorio)"
if MYSQL_PWD="$(grep -E '^DB_PASS=' "$APP_DIR/api/.env" | cut -d= -f2-)" \
   mysqldump -u"$DB_USER_ENV" "$DB_NAME_ENV" 2>/dev/null | gzip > "$BACKUP_FILE"; then
  if ! gzip -t "$BACKUP_FILE"; then
    rm -f "$BACKUP_FILE"
    die "el backup se creó pero gzip no puede leerlo: se aborta antes de migrar."
  fi
  log "    backup verificado en ${BACKUP_FILE}"
  # Conservar sólo los 10 más recientes después de verificar el nuevo.
  ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
else
  # Sin backup válido no se migra. No existe bypass: un update planificado que
  # no puede respaldar la base no cumple el contrato de producción.
  rm -f "$BACKUP_FILE"
  echo "" >&2
  echo "  Causas habituales: credenciales de api/.env desactualizadas," >&2
  echo "  mysqldump no instalado, o disco lleno en ${BACKUP_DIR}." >&2
  die "no se pudo generar el backup de la DB: se aborta antes de migrar."
fi

log "4/6  Migraciones de DB (idempotente)"
pnpm db:migrate

log "5/6  Builds"
pnpm --filter @sa/api build
# El build de web incluye un paso de prerender (SEO) que lee datos de la API
# corriendo en :4000. PUBLIC_SITE_URL se toma de api/.env si está.
PUBLIC_SITE_URL="$(grep -E '^PUBLIC_SITE_URL=' "$APP_DIR/api/.env" 2>/dev/null | cut -d= -f2- || true)" \
  pnpm --filter @sa/web build
pnpm --filter @sa/admin exec vite build --base=/admin/

log "6/6  Reload Nginx + restart PM2"
nginx -t && systemctl reload nginx
# Resolver entry según donde tsc haya emitido
ENTRY="$APP_DIR/api/dist/src/index.js"
[ -f "$ENTRY" ] || ENTRY="$APP_DIR/api/dist/index.js"
# IMPORTANTE: --cwd para que dotenv encuentre api/.env
pm2 delete sanatorio-api 2>/dev/null || true
pm2 start "$ENTRY" --name sanatorio-api --time --cwd "$APP_DIR/api"
pm2 save

# Health check con reintentos: la API tarda un momento en levantar.
HEALTH="000"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost/api/health" || echo "000")
  [ "$HEALTH" = "200" ] && break
done

if [ "$HEALTH" = "200" ]; then
  echo -e "\033[1;32m✅ Update OK · /api/health = 200\033[0m"
else
  echo -e "\033[1;31m✗ Healthcheck devolvió ${HEALTH} tras 20s\033[0m" >&2
  echo "  Logs:      pm2 logs sanatorio-api --lines 50 --nostream" >&2
  echo "  Detalle:   curl -s http://localhost/api/health" >&2
  echo "  Rollback:  ROLLBACK_TO=${PREVIOUS_SHA} bash ${APP_DIR}/scripts/deploy/rollback-vps.sh" >&2
  exit 1
fi
