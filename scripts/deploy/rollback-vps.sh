#!/usr/bin/env bash
# ============================================================================
# Rollback a una versión anterior — en el orden que sí funciona.
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
#   1. backup de la base (obligatorio, se aborta si falla);
#   2. revertir las migraciones nuevas CON EL CÓDIGO NUEVO todavía en disco;
#   3. recién ahí bajar el árbol al SHA anterior;
#   4. reinstalar, rebuild y reiniciar;
#   5. health check.
#
# Uso (como root, en el VPS):
#   ROLLBACK_TO=<sha-anterior> bash /var/www/sanatorio/scripts/deploy/rollback-vps.sh
#
# Variables:
#   ROLLBACK_TO   (obligatoria) SHA o tag al que se vuelve.
#   STEPS         cuántas migraciones revertir. Por defecto, las que el SHA
#                 destino no tiene. `STEPS=0` no revierte ninguna.
#   RESTORE_DUMP  ruta de un dump .sql.gz: en vez de revertir con `down()`,
#                 restaura ese dump. Es el camino obligatorio cuando la base se
#                 sembró después de migrar (ver rollback-guard.mjs).
# ============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/sanatorio}"
ROLLBACK_TO="${ROLLBACK_TO:-}"
STEPS="${STEPS:-}"
RESTORE_DUMP="${RESTORE_DUMP:-}"

log()  { echo -e "\033[1;34m==>\033[0m $*"; }
warn() { echo -e "\033[1;33m!!\033[0m $*"; }
die()  { echo -e "\033[1;31mERROR:\033[0m $*" >&2; exit 1; }

[ -n "$ROLLBACK_TO" ] || die "falta ROLLBACK_TO=<sha>. Es el commit al que querés volver."
[ -d "$APP_DIR/.git" ] || die "$APP_DIR no es un repo git."

cd "$APP_DIR"
CURRENT_SHA="$(git rev-parse HEAD)"
git fetch origin --tags
git cat-file -e "${ROLLBACK_TO}^{commit}" 2>/dev/null || die "el commit ${ROLLBACK_TO} no existe en este repo."

log "1/5  Backup de la base (antes de tocar nada)"
BACKUP_DIR="${APP_DIR}/.db-backups"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="${BACKUP_DIR}/pre-rollback-$(date +%Y%m%d-%H%M%S).sql.gz"
DB_NAME_ENV="$(sed -n 's/^DB_NAME=//p' "$APP_DIR/api/.env" | head -n1)"
DB_USER_ENV="$(sed -n 's/^DB_USER=//p' "$APP_DIR/api/.env" | head -n1)"
if MYSQL_PWD="$(sed -n 's/^DB_PASS=//p' "$APP_DIR/api/.env" | head -n1)" \
   mysqldump -u"$DB_USER_ENV" "$DB_NAME_ENV" 2>/dev/null | gzip > "$BACKUP_FILE"; then
  log "    backup en ${BACKUP_FILE}"
else
  rm -f "$BACKUP_FILE"
  die "no se pudo generar el backup: se aborta el rollback con el deploy actual intacto."
fi

if [ -n "$RESTORE_DUMP" ]; then
  # Camino explícito para las bases sembradas después de migrar: ahí el
  # `down()` de las migraciones que restauran por id de bloque no encuentra
  # nada que restaurar, y el dump es la única vuelta atrás real.
  log "2/5  Restaurando el dump ${RESTORE_DUMP} (en vez de revertir migraciones)"
  [ -f "$RESTORE_DUMP" ] || die "no existe el dump ${RESTORE_DUMP}"
  MYSQL_PWD="$(sed -n 's/^DB_PASS=//p' "$APP_DIR/api/.env" | head -n1)" \
    bash -c "gunzip < '$RESTORE_DUMP' | mysql -u'$DB_USER_ENV' '$DB_NAME_ENV'" \
    || die "falló la restauración del dump."
else
  # Cuántas migraciones tiene este árbol que el destino no tenga.
  if [ -z "$STEPS" ]; then
    STEPS="$(git diff --name-only --diff-filter=A "${ROLLBACK_TO}" HEAD -- api/migrations | grep -c '\.ts$' || true)"
  fi
  log "2/5  Revirtiendo ${STEPS} migración(es) CON EL CÓDIGO NUEVO todavía en disco"
  if [ "$STEPS" -gt 0 ]; then
    pnpm install --frozen-lockfile
    for _ in $(seq 1 "$STEPS"); do
      # Una por una: `migrate:rollback` revierte el batch entero, que puede
      # incluir migraciones que el SHA destino sí tiene.
      pnpm --filter @sa/api migrate:down \
        || die "no se pudo revertir. La base quedó como estaba y el backup está en ${BACKUP_FILE}. Si el rollback-guard bloqueó la vuelta atrás, usá RESTORE_DUMP=<dump>."
    done
  else
    log "    el SHA destino tiene las mismas migraciones: no hay nada que revertir"
  fi
fi

log "3/5  Bajando el árbol a ${ROLLBACK_TO} (desde ${CURRENT_SHA})"
git reset --hard "$ROLLBACK_TO"

log "4/5  Install + builds de la versión anterior"
pnpm install --frozen-lockfile
pnpm --filter @sa/api build
PUBLIC_SITE_URL="$(sed -n 's/^PUBLIC_SITE_URL=//p' "$APP_DIR/api/.env" | head -n1)" \
  pnpm --filter @sa/web build
pnpm --filter @sa/admin exec vite build --base=/admin/

log "5/5  Reload de Nginx + restart de PM2"
nginx -t && systemctl reload nginx
ENTRY="$APP_DIR/api/dist/src/index.js"
[ -f "$ENTRY" ] || ENTRY="$APP_DIR/api/dist/index.js"
pm2 delete sanatorio-api 2>/dev/null || true
pm2 start "$ENTRY" --name sanatorio-api --time --cwd "$APP_DIR/api"
pm2 save

HEALTH="000"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost/api/health" || echo "000")
  [ "$HEALTH" = "200" ] && break
done
if [ "$HEALTH" = "200" ]; then
  echo -e "\033[1;32m✅ Rollback completo: ${CURRENT_SHA} → ${ROLLBACK_TO}\033[0m"
else
  warn "el health check devolvió ${HEALTH}. Revisá: pm2 logs sanatorio-api"
  echo "  Backup previo al rollback: ${BACKUP_FILE}"
fi
