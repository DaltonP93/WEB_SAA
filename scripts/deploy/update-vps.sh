#!/usr/bin/env bash
# ============================================================================
# Update deploy — actualiza el VPS a la última versión del repo
# Pulla cambios, corre migrations nuevas si hay, rebuild y reinicia PM2.
# NO resembra la DB (no pisa contenido editado desde el admin).
#
# Uso (como root, en el VPS):
#   bash /var/www/sanatorio/scripts/deploy/update-vps.sh
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

cd "$APP_DIR"

log "1/6  git pull (rama ${BRANCH})"
PREVIOUS_SHA="$(git rev-parse HEAD)"
git fetch origin
git checkout "$BRANCH"
git reset --hard "origin/${BRANCH}"
log "    versión anterior: ${PREVIOUS_SHA} · versión nueva: $(git rev-parse HEAD)"

# Bash carga el script en memoria al inicio. Si el propio update-vps.sh
# cambió en este pull, hay que re-ejecutar la versión nueva — sino los
# fixes al script se aplicarían recién en el próximo deploy.
SELF="$APP_DIR/scripts/deploy/update-vps.sh"
if [ "${REEXECED:-0}" != "1" ] && [ -f "$SELF" ]; then
  CURRENT_HASH=$(sha256sum "$SELF" | awk '{print $1}')
  RUNNING_HASH=$(sha256sum "$0" 2>/dev/null | awk '{print $1}' || echo "")
  if [ -n "$RUNNING_HASH" ] && [ "$CURRENT_HASH" != "$RUNNING_HASH" ]; then
    log "    el script cambió en este pull → re-ejecutando versión nueva"
    REEXECED=1 exec bash "$SELF" "$@"
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
  log "    backup en ${BACKUP_FILE}"
  # Conservar sólo los 10 más recientes
  ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
else
  # Sin backup no se migra. Las migraciones tocan contenido que el sanatorio
  # editó desde el panel; si algo sale mal y no hay backup, no hay vuelta
  # atrás. Se aborta ANTES de migrar, con el deploy anterior intacto.
  rm -f "$BACKUP_FILE"
  echo "" >&2
  echo "  Causas habituales: credenciales de api/.env desactualizadas," >&2
  echo "  mysqldump no instalado, o disco lleno en ${BACKUP_DIR}." >&2
  echo "  Verificalo con:" >&2
  echo "    MYSQL_PWD=\"\$(grep -E '^DB_PASS=' $APP_DIR/api/.env | cut -d= -f2-)\" \\" >&2
  echo "      mysqldump -u${DB_USER_ENV} ${DB_NAME_ENV} > /dev/null" >&2
  echo "  Si el backup no es posible y aceptás el riesgo:" >&2
  echo "    SKIP_DB_BACKUP=1 bash \$0" >&2
  if [ "${SKIP_DB_BACKUP:-0}" = "1" ]; then
    echo -e "\033[1;33m⚠\033[0m SKIP_DB_BACKUP=1: se migra SIN backup, bajo tu responsabilidad." >&2
  else
    die "no se pudo generar el backup de la DB: se aborta antes de migrar (nada quedó a medias)."
  fi
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
