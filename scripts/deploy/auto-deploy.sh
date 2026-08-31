#!/usr/bin/env bash
# ============================================================================
# Auto-deploy — mantiene el VPS sincronizado con origin/main.
#
# Lo corre el timer de systemd `sanatorio-auto-deploy.timer` cada 5 minutos.
# Sólo hace algo si origin/main avanzó: en ese caso delega en update-vps.sh,
# que es quien tiene el contrato real de deploy (backup, migraciones, builds,
# health check). Este script no duplica nada de eso.
#
# Instalación (ver scripts/deploy/systemd/): este archivo se copia a
#   /usr/local/bin/sanatorio-auto-deploy.sh
# y NO se ejecuta desde el árbol del repo a propósito: update-vps.sh hace
# `git reset --hard`, que reescribiría este mismo archivo mientras bash lo está
# leyendo por offset (el problema que update-vps.sh resuelve copiándose a /tmp).
# Fuera del árbol, git no lo puede tocar y el problema no existe.
#
# No hay lock explícito: systemd no arranca una unidad `oneshot` que ya está
# activa, así que dos ejecuciones nunca se superponen.
# ============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/sanatorio}"
BRANCH="${BRANCH:-main}"
LOG="${AUTO_DEPLOY_LOG:-/var/log/sanatorio-auto-deploy.log}"

exec >>"$LOG" 2>&1

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(ts)] $*"; }

cd "$APP_DIR" || { log "ERROR: no existe $APP_DIR"; exit 1; }

if ! git fetch origin "$BRANCH" --quiet; then
  log "ERROR: git fetch origin $BRANCH falló (¿red o credenciales?). Se reintenta en el próximo tick."
  exit 1
fi

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/${BRANCH}")"

if [ "$LOCAL" = "$REMOTE" ]; then
  log "sin cambios (${LOCAL:0:7})"
  exit 0
fi

# El deploy sólo va hacia adelante, igual que update-vps.sh. Si main fue
# reescrito (force-push, revert de historia) esto NO se resuelve solo: hay que
# decidir a mano si corresponde un rollback-vps.sh.
if ! git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
  log "ERROR: origin/${BRANCH} (${REMOTE:0:7}) no desciende de HEAD (${LOCAL:0:7})."
  log "       Probable force-push o reescritura de historia. El auto-deploy NO actúa."
  log "       Resolver a mano: ver rollback-vps.sh / docs/DEPLOY.md §Rollback."
  exit 1
fi

log "origin/${BRANCH} avanzó: ${LOCAL:0:7} -> ${REMOTE:0:7} · deployando"

if bash "$APP_DIR/scripts/deploy/update-vps.sh"; then
  log "deploy OK · HEAD = $(git rev-parse HEAD)"
else
  CODE=$?
  log "ERROR: update-vps.sh salió con código ${CODE}. Revisar el log de arriba y 'pm2 logs sanatorio-api'."
  exit "$CODE"
fi
