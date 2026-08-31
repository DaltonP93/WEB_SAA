#!/usr/bin/env bash
# ============================================================================
# Bootstrap deploy para Sanatorio Adventista V2 — VPS Ubuntu 22/24
#
# Uso seguro (como root, desde un commit aprobado de main):
#   APPROVED_SHA=<sha-aprobado>
#   curl -fsSLo /tmp/setup-vps.sh \
#     "https://raw.githubusercontent.com/DaltonP93/WEB_SAA/$APPROVED_SHA/scripts/deploy/setup-vps.sh"
#   bash -n /tmp/setup-vps.sh
#   DEPLOY_TO="$APPROVED_SHA" bash /tmp/setup-vps.sh
#
# No ejecutar con `curl | bash`: impide revisar el script y sigue un HEAD
# móvil. El procedimiento completo está en docs/PREPRODUCCION-Y-GO-LIVE.md.
#
# Variables opcionales:
#   REPO_URL   repo a clonar (default: DaltonP93/WEB_SAA)
#   DEPLOY_TO  SHA aprobado de main. Si se omite, usa origin/$BRANCH.
#   DOMAIN     dominio para HTTPS con Let's Encrypt.
#              Sin dominio el panel /admin NO se publica: el login viajaría
#              en texto plano y eso no tiene excepción en este proyecto.
#   ADMIN_EMAIL / ADMIN_PASS  credenciales del superadmin sembrado. Si no se
#              pasa ADMIN_PASS se genera una aleatoria y se guarda en un
#              archivo sólo-root; nunca se imprime en pantalla.
#
# Deja corriendo:
#   - MySQL 8 con DB sanatorio
#   - API Node bajo PM2 (puerto 4000)
#   - Nginx sirviendo el sitio público en :80 y /admin
# ============================================================================
set -euo pipefail

# --- Configuración --------------------------------------------------------
REPO_URL="${REPO_URL:-https://github.com/DaltonP93/WEB_SAA.git}"
APP_DIR="${APP_DIR:-/var/www/sanatorio}"
BRANCH="${BRANCH:-main}"
DEPLOY_TO="${DEPLOY_TO:-}"

DB_NAME="sanatorio"
DB_USER="sanatorio"

# Valores que ya existan en api/.env: una segunda corrida no los regenera.
# Rotar el JWT_SECRET desloguea a todo el mundo, y regenerar la contraseña del
# admin sin volver a sembrar deja anotada una contraseña que no existe.
ENV_FILE="${APP_DIR}/api/.env"
env_value() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | head -n1
}

DB_PASS="${DB_PASS:-$(env_value DB_PASS)}"
DB_PASS="${DB_PASS:-$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)}"
JWT_SECRET="${JWT_SECRET:-$(env_value JWT_SECRET)}"

ADMIN_EMAIL="${ADMIN_EMAIL:-admin@sanatorio.local}"
# La contraseña del admin NO se decide acá.
#
# Generarla antes de saber si va a haber seed dejaba anotada —en `.env` y en
# `.deploy-credentials`— una credencial que no correspondía a ningún usuario.
# Lo resuelve `prepare-env.sh`, después de consultar el estado de la base:
# sólo se genera si el seed va a crear el usuario.
ADMIN_NAME="${ADMIN_NAME:-Administrador}"
CREDENTIALS_FILE="${APP_DIR}/.deploy-credentials"

SERVER_IP="${SERVER_IP:-$(curl -s4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')}"
# Con DOMAIN se configura HTTPS (certbot) y el panel /admin queda publicado
# sólo sobre TLS. Sin certificado emitido y verificado, /admin responde 403.
# No hay variable para saltear esto: el panel nunca transmite credenciales sin
# TLS, ni siquiera "temporalmente".
DOMAIN="${DOMAIN:-}"
SERVER_NAME="${DOMAIN:-_}"
# URL canónica del sitio. Con dominio siempre es HTTPS: certbot deja el 301 de
# HTTP a HTTPS, así que publicar http:// como base generaría un salto extra en
# cada enlace y un canonical que no coincide con la URL servida.
if [ -n "$DOMAIN" ]; then
  SITE_ORIGIN="https://${DOMAIN}"
else
  SITE_ORIGIN="http://${SERVER_IP}"
fi

log()  { echo -e "\033[1;34m==>\033[0m $*"; }
warn() { echo -e "\033[1;33m!!\033[0m $*"; }
die()  { echo -e "\033[1;31mERROR:\033[0m $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Este script necesita root. Probá: sudo bash $0"

# DB_PASS se interpola dentro de SQL. El valor generado usa sólo caracteres
# seguros; si el operador lo aporta, se rechazan delimitadores que cambiarían
# la sentencia o romperían el archivo .env.
if [[ "$DB_PASS" == *"'"* || "$DB_PASS" == *\ -----------------------------------------------------------
log "1/9  Actualizando sistema"
export DEBIAN_FRONTEND=noninteractive
apt update -qq
apt upgrade -y -qq

# --- 2. Dependencias base -------------------------------------------------
log "2/9  Instalando dependencias base (git, nginx, mysql, ufw, openssl)"
apt install -y -qq curl ca-certificates gnupg git nginx mysql-server ufw openssl

# --- 3. Node 20 + pnpm + pm2 ----------------------------------------------
log "3/9  Instalando Node 20, pnpm y PM2"
if ! command -v node >/dev/null || [[ "$(node -v)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y -qq nodejs
fi
npm install -g pnpm@9 pm2 >/dev/null 2>&1
log "    Node $(node -v) · pnpm $(pnpm -v) · pm2 $(pm2 -v)"

# --- 4. MySQL -------------------------------------------------------------
log "4/9  Configurando MySQL"
systemctl enable --now mysql
mysql --protocol=socket -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

# --- 5. Clonar / actualizar repo ------------------------------------------
log "5/9  Clonando repo en ${APP_DIR}"
mkdir -p "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch origin
  git checkout "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
  git fetch origin
fi

TARGET_REF="${DEPLOY_TO:-origin/${BRANCH}}"
TARGET_SHA="$(git rev-parse --verify "${TARGET_REF}^{commit}")" \
  || die "DEPLOY_TO no identifica un commit disponible: ${TARGET_REF}"
git merge-base --is-ancestor "$TARGET_SHA" "origin/${BRANCH}" \
  || die "DEPLOY_TO no pertenece a origin/${BRANCH}: se rechaza una versión no aprobada."
git reset --hard "$TARGET_SHA"
log "    versión fijada: ${TARGET_SHA}"

# --- 6. Instalar dependencias ---------------------------------------------
log "6/9  Instalando dependencias"
cd "$APP_DIR"
# Falla ruidosamente: un install no congelado deja el server con dependencias
# distintas a las auditadas.
pnpm install --frozen-lockfile || die "pnpm install --frozen-lockfile falló. Revisá que pnpm-lock.yaml esté commiteado y actualizado; no se instala sin lockfile congelado."

# --- 7. Estado de la base, .env, migrar, sembrar, build --------------------
#
# El orden importa y es este:
#
#   1. se consulta el estado de la base (`db-state.mjs`), ANTES de migrar y
#      antes de escribir una sola credencial. La decisión de sembrar mira la
#      base, no un archivo: los seeds arrancan borrando usuarios, ajustes,
#      médicos, especialidades, servicios, estudios, páginas y bloques, y un
#      marker perdido se llevaba puesto todo lo cargado desde el panel;
#   2. recién con esa respuesta se decide la contraseña del admin y se escribe
#      `api/.env`. Generarla antes dejaba anotada una credencial que no
#      correspondía a ningún usuario cuando el seed no llegaba a correr.
#
# Las dos cosas viven en `prepare-env.sh` para poder probarlas sin un VPS.
log "7/9  Estado de la base + api/.env"
SEED_MARKER="${APP_DIR}/.seeded"
set +e
PREPARE_OUT="$(APP_DIR="$APP_DIR" REPO_ROOT="$APP_DIR" \
  DB_HOST=127.0.0.1 DB_PORT=3306 DB_NAME="$DB_NAME" DB_USER="$DB_USER" DB_PASS="$DB_PASS" \
  JWT_SECRET="$JWT_SECRET" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_NAME="$ADMIN_NAME" \
  ADMIN_PASS="${ADMIN_PASS:-}" SITE_ORIGIN="$SITE_ORIGIN" SEED_MARKER="$SEED_MARKER" \
  bash scripts/deploy/prepare-env.sh)"
PREPARE_CODE=$?
set -e
[ "$PREPARE_CODE" -eq 0 ] || die "no se sigue: la base tiene contenido y no se puede confirmar que sea seguro sembrar (código ${PREPARE_CODE}). El detalle está arriba. No se escribió ninguna credencial."
# Sólo tres líneas `CLAVE=valor`; la contraseña no viaja por stdout.
eval "$PREPARE_OUT"

case "$DB_STATE" in
  nueva)         log "    Base vacía → se migra y se siembra" ;;
  actualizacion) log "    Base ya instalada → se migra, NO se siembra" ;;
esac

pnpm db:migrate

if [ "$WILL_SEED" = "1" ]; then
  log "    Sembrando DB"
  pnpm db:seed
  touch "$SEED_MARKER"
  ADMIN_SEEDED=1
else
  ADMIN_SEEDED=0
fi
# La contraseña se lee del `.env` que acaba de escribir `prepare-env.sh`: no
# se pasa por stdout ni por el entorno del log.
ADMIN_PASS="$(env_value SEED_ADMIN_PASSWORD)"

log "    Building API"
pnpm --filter @sa/api build

log "    Building web (raíz /) + prerender SEO"
PUBLIC_SITE_URL="${PUBLIC_SITE_URL:-$SITE_ORIGIN}" pnpm --filter @sa/web build

log "    Building admin (raíz /admin/)"
pnpm --filter @sa/admin exec vite build --base=/admin/

mkdir -p "${APP_DIR}/api/uploads"
chown -R www-data:www-data "${APP_DIR}/api/uploads" || true

# --- 8. Nginx -------------------------------------------------------------
log "8/9  Configurando Nginx"
# El panel se sirve desde un snippet aparte que arranca cerrado. Se abre
# recién después de que el certificado exista, `nginx -t` pase y el servidor
# HTTPS esté escuchando. Antes, la primera configuración ya publicaba /admin
# por HTTP y sólo se cerraba si certbot fallaba: durante esa ventana el panel
# estaba accesible sin TLS.
mkdir -p /etc/nginx/snippets
ADMIN_SNIPPET=/etc/nginx/snippets/sanatorio-admin.conf

write_admin_closed() {
  cat > "$ADMIN_SNIPPET" <<'ADMINCLOSED'
  # Cerrado hasta que haya TLS verificado. Lo reescribe setup-vps.sh.
  location ^~ /admin {
    default_type text/plain;
    return 403 'El panel admin requiere HTTPS. Configura DOMAIN y volve a correr setup-vps.sh.';
  }
ADMINCLOSED
}

write_admin_open() {
  cat > "$ADMIN_SNIPPET" <<ADMINOPEN
  # Panel admin (^~ para que /admin/assets/*.js no caigan en la regex global).
  # Habilitado sólo con TLS verificado; en HTTP certbot deja el 301 a HTTPS.
  location ^~ /admin {
    alias ${APP_DIR}/apps/admin/dist;
    try_files \$uri \$uri/ /admin/index.html;
  }
ADMINOPEN
}

write_admin_closed

cat > /etc/nginx/sites-available/sanatorio <<NGINX
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name ${SERVER_NAME};
  client_max_body_size 20M;

  # Cabeceras de seguridad. La CSP real vive acá (el <meta> del HTML es un
  # respaldo y no puede declarar frame-ancestors).
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
  # frame-src/script-src incluyen los hosts del desafío anti-spam. Sólo se
  # usan si el sanatorio configura CAPTCHA_PROVIDER y las claves; sin eso el
  # front no carga ningún script de terceros.
  # Los hosts de analítica (googletagmanager / google-analytics / connect.facebook /
  # facebook) están en script-src y connect-src para que la medición opt-in
  # (GA4, GTM, Meta Pixel) pueda cargar cuando el sanatorio configura un ID y el
  # visitante acepta. No cargan nada por sí mismos: sin ID configurado no hay
  # ningún script que los use. Tienen que coincidir con la CSP <meta> de
  # apps/web/index.html (la prueba video-embed-csp fija el frame-src; estos dos
  # se mantienen a mano). Ver docs/CARGA-DE-DATOS.md §4.3.
  add_header Content-Security-Policy "default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self' https://challenges.cloudflare.com https://www.google.com https://www.gstatic.com https://www.googletagmanager.com https://connect.facebook.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' https://challenges.cloudflare.com https://www.googletagmanager.com https://www.google-analytics.com https://analytics.google.com https://region1.google-analytics.com https://connect.facebook.net https://www.facebook.com; form-action 'self'; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.google.com https://google.com https://maps.google.com https://www.google.com.py https://google.com.py https://challenges.cloudflare.com; frame-ancestors 'none'" always;

  # API (^~ para que gane prioridad sobre la regex de assets estáticos)
  location ^~ /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
  }

  # Uploads servidos por la API (^~ obligatorio para imágenes)
  location ^~ /uploads/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host \$host;
    proxy_http_version 1.1;
    expires 30d;
    add_header Cache-Control "public";
  }

  # SEO endpoints servidos por la API
  location = /robots.txt    { proxy_pass http://127.0.0.1:4000; }
  location = /sitemap.xml   { proxy_pass http://127.0.0.1:4000; }

  # Portal del paciente: las rutas viejas redirigen de verdad (301), no con
  # JavaScript. La misma lista vive en api/src/legacy-redirects.ts.
  location = /portal-resultados-diagnostico   { return 301 /portal-paciente; }
  location = /portal-resultados-laboratorio   { return 301 /portal-paciente; }
  location = /portal-presupuestos-cirugia     { return 301 /portal-paciente; }
  location = /portal-facturacion-electronica  { return 301 /portal-paciente; }

  include /etc/nginx/snippets/sanatorio-admin.conf;

  # Sitio público (catch-all)
  location / {
    root ${APP_DIR}/apps/web/dist;
    try_files \$uri \$uri/ /index.html;
  }

  # Cache de assets estáticos del sitio público (sólo extensiones, no /uploads/)
  location ~* \.(?:css|js|woff2?|ttf|otf|eot|svg|webp|ico)\$ {
    root ${APP_DIR}/apps/web/dist;
    try_files \$uri =404;
    expires 30d;
    add_header Cache-Control "public, immutable";
  }
}
NGINX

ln -sf /etc/nginx/sites-available/sanatorio /etc/nginx/sites-enabled/sanatorio
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

TLS_OK=0
if [ -n "$DOMAIN" ]; then
  log "    Emitiendo certificado TLS para ${DOMAIN} (Let's Encrypt)"
  apt install -y -qq certbot python3-certbot-nginx
  # --redirect: certbot deja el server HTTP devolviendo 301 a HTTPS, así que
  # /admin por HTTP nunca sirve el panel aunque el snippet esté abierto.
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
       -m "${CERTBOT_EMAIL:-$ADMIN_EMAIL}" --redirect; then
    log "    Certificado emitido. Verificando antes de publicar /admin"
    # Tres condiciones, en este orden, antes de abrir el panel:
    #   1. el certificado existe en disco;
    #   2. hay un server TLS escuchando en 443;
    #   3. `nginx -t` valida la configuración con el snippet abierto.
    # Si alguna falla, el snippet se queda en 403 y el deploy sigue sin panel.
    if [ ! -s "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
      warn "certbot dijo OK pero no hay fullchain.pem: /admin queda cerrado."
    elif ! grep -q "listen.*443" /etc/nginx/sites-available/sanatorio; then
      warn "no hay server TLS en la configuración: /admin queda cerrado."
    else
      write_admin_open
      if nginx -t && systemctl reload nginx; then
        # Última comprobación: que 443 esté realmente aceptando conexiones.
        if curl -sk --max-time 10 -o /dev/null "https://${DOMAIN}/api/health"; then
          TLS_OK=1
          log "    HTTPS activo: /admin publicado sólo sobre TLS"
        else
          warn "HTTPS no respondió: se vuelve a cerrar /admin."
          write_admin_closed
          nginx -t && systemctl reload nginx
        fi
      else
        warn "nginx -t falló con /admin habilitado: se revierte a 403."
        write_admin_closed
        nginx -t && systemctl reload nginx
      fi
    fi
  else
    # El snippet nunca se abrió, así que no hay nada que cerrar: /admin siguió
    # en 403 durante todo el proceso.
    warn "certbot falló: el sitio queda en HTTP y /admin sigue cerrado (403)."
    warn "Cuando ${DOMAIN} resuelva a este servidor, volvé a correr setup-vps.sh."
  fi
fi

# --- 9. PM2 + firewall ----------------------------------------------------
log "9/9  Arrancando API con PM2 y configurando firewall"
cd "${APP_DIR}/api"
pm2 delete sanatorio-api 2>/dev/null || true
# tsc emite a dist/src/index.js cuando rootDir=. y se incluyen migrations/seeds
ENTRY="dist/src/index.js"
[ -f "$ENTRY" ] || ENTRY="dist/index.js"
pm2 start "$ENTRY" --name sanatorio-api --time --cwd "${APP_DIR}/api"
pm2 save
# Auto-start al reboot
pm2 startup systemd -u root --hp /root 2>&1 | grep -E "^sudo " | bash || true

# Abrir SSH antes de habilitar UFW: hacerlo al revés puede cortar la sesión que
# está ejecutando el bootstrap. Ningún fallo se oculta; una regla incierta es
# motivo para abortar antes del health check.
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp  >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

# --- Health check ---------------------------------------------------------
sleep 2
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost/api/health" || echo "000")

echo ""
echo "========================================================"
if [ "$HEALTH" = "200" ]; then
  echo -e "\033[1;32m✅ Deploy completo y funcionando\033[0m"
else
  echo -e "\033[1;33m⚠ Deploy completo pero healthcheck devolvió ${HEALTH}\033[0m"
  echo "  Revisá:  pm2 logs sanatorio-api"
fi
echo "========================================================"
if [ -n "$DOMAIN" ] && [ "$TLS_OK" != "1" ]; then
  # Imprimir una URL http:// del panel como si fuera el resultado esperado
  # invita a entrar y loguearse sin cifrado.
  echo -e "\033[1;31m✗ TLS no quedó configurado para ${DOMAIN}\033[0m"
  echo "  El sitio responde en http://${SERVER_IP} pero NO es la URL definitiva."
  echo "  El panel /admin está cerrado (403) hasta que haya certificado."
  echo "  Cuando ${DOMAIN} resuelva a este servidor, volvé a correr setup-vps.sh."
elif [ -z "$DOMAIN" ]; then
  echo "Sitio público:   ${SITE_ORIGIN}"
  echo "Panel admin:     cerrado (403). Requiere DOMAIN + certificado TLS."
  echo "API health:      ${SITE_ORIGIN}/api/health"
else
  echo "Sitio público:   ${SITE_ORIGIN}"
  echo "Panel admin:     ${SITE_ORIGIN}/admin"
  echo "API health:      ${SITE_ORIGIN}/api/health"
fi
echo ""
# Las credenciales NO se imprimen: quedarían en la terminal, en el historial y
# en los logs de quien haya lanzado el deploy.
#
# Y sólo se escribe el archivo si el usuario admin se creó de verdad en esta
# corrida. Antes se generaba una contraseña nueva en cada ejecución y se
# escribía acá aunque el seed no hubiera corrido: el archivo terminaba con una
# contraseña que no existía en la base, y pisaba la que sí servía.
if [ "$ADMIN_SEEDED" = "1" ]; then
  umask 077
  cat > "$CREDENTIALS_FILE" <<CREDS
# Generado por setup-vps.sh el $(date -Iseconds). Archivo sólo-root.
# Cambiá la contraseña del admin al primer login y después borrá este archivo.
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASS}
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
CREDS
  chmod 600 "$CREDENTIALS_FILE"

  echo "Credenciales del admin y de la DB: ${CREDENTIALS_FILE} (chmod 600, sólo root)"
  echo "  → leelas con: cat ${CREDENTIALS_FILE}"
  echo "  → cambiá la contraseña del admin al primer login y borrá el archivo"
else
  echo "No se sembró la base, así que el usuario admin no se tocó:"
  echo "  la contraseña sigue siendo la de la instalación anterior."
  if [ -n "$ADMIN_PASS" ]; then
    echo "  Está en ${CREDENTIALS_FILE} (si el archivo sigue existiendo) y en ${ENV_FILE}."
  else
    # No había `.env` previo del que leerla y tampoco se sembró: nadie en este
    # servidor la conoce, y no se inventa una que no abriría nada.
    echo "  Este servidor no la tiene guardada; cambiala desde el panel si se perdió."
  fi
fi
echo ""
echo "La contraseña de la DB y el JWT_SECRET viven en ${APP_DIR}/api/.env (chmod 600)."
echo "  Si ya existían, se conservaron: rotarlos desloguearía a todo el mundo."
echo "========================================================"
echo ""
echo "Próximos comandos útiles:"
echo "  pm2 logs sanatorio-api      → ver logs"
echo "  pm2 restart sanatorio-api   → reiniciar API"
echo "  systemctl reload nginx      → recargar Nginx"
echo "  bash ${APP_DIR}/scripts/deploy/update-vps.sh → actualizar a la última versión del repo"
echo "========================================================"
\n'* || "$DB_PASS" == *\ -----------------------------------------------------------
log "1/9  Actualizando sistema"
export DEBIAN_FRONTEND=noninteractive
apt update -qq
apt upgrade -y -qq

# --- 2. Dependencias base -------------------------------------------------
log "2/9  Instalando dependencias base (git, nginx, mysql, ufw, openssl)"
apt install -y -qq curl ca-certificates gnupg git nginx mysql-server ufw openssl

# --- 3. Node 20 + pnpm + pm2 ----------------------------------------------
log "3/9  Instalando Node 20, pnpm y PM2"
if ! command -v node >/dev/null || [[ "$(node -v)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y -qq nodejs
fi
npm install -g pnpm@9 pm2 >/dev/null 2>&1
log "    Node $(node -v) · pnpm $(pnpm -v) · pm2 $(pm2 -v)"

# --- 4. MySQL -------------------------------------------------------------
log "4/9  Configurando MySQL"
systemctl enable --now mysql
mysql --protocol=socket -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

# --- 5. Clonar / actualizar repo ------------------------------------------
log "5/9  Clonando repo en ${APP_DIR}"
mkdir -p "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch origin
  git checkout "$BRANCH"
  git reset --hard "origin/${BRANCH}"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

# --- 6. Instalar dependencias ---------------------------------------------
log "6/9  Instalando dependencias"
cd "$APP_DIR"
# Falla ruidosamente: un install no congelado deja el server con dependencias
# distintas a las auditadas.
pnpm install --frozen-lockfile || die "pnpm install --frozen-lockfile falló. Revisá que pnpm-lock.yaml esté commiteado y actualizado; no se instala sin lockfile congelado."

# --- 7. Estado de la base, .env, migrar, sembrar, build --------------------
#
# El orden importa y es este:
#
#   1. se consulta el estado de la base (`db-state.mjs`), ANTES de migrar y
#      antes de escribir una sola credencial. La decisión de sembrar mira la
#      base, no un archivo: los seeds arrancan borrando usuarios, ajustes,
#      médicos, especialidades, servicios, estudios, páginas y bloques, y un
#      marker perdido se llevaba puesto todo lo cargado desde el panel;
#   2. recién con esa respuesta se decide la contraseña del admin y se escribe
#      `api/.env`. Generarla antes dejaba anotada una credencial que no
#      correspondía a ningún usuario cuando el seed no llegaba a correr.
#
# Las dos cosas viven en `prepare-env.sh` para poder probarlas sin un VPS.
log "7/9  Estado de la base + api/.env"
SEED_MARKER="${APP_DIR}/.seeded"
set +e
PREPARE_OUT="$(APP_DIR="$APP_DIR" REPO_ROOT="$APP_DIR" \
  DB_HOST=127.0.0.1 DB_PORT=3306 DB_NAME="$DB_NAME" DB_USER="$DB_USER" DB_PASS="$DB_PASS" \
  JWT_SECRET="$JWT_SECRET" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_NAME="$ADMIN_NAME" \
  ADMIN_PASS="${ADMIN_PASS:-}" SITE_ORIGIN="$SITE_ORIGIN" SEED_MARKER="$SEED_MARKER" \
  bash scripts/deploy/prepare-env.sh)"
PREPARE_CODE=$?
set -e
[ "$PREPARE_CODE" -eq 0 ] || die "no se sigue: la base tiene contenido y no se puede confirmar que sea seguro sembrar (código ${PREPARE_CODE}). El detalle está arriba. No se escribió ninguna credencial."
# Sólo tres líneas `CLAVE=valor`; la contraseña no viaja por stdout.
eval "$PREPARE_OUT"

case "$DB_STATE" in
  nueva)         log "    Base vacía → se migra y se siembra" ;;
  actualizacion) log "    Base ya instalada → se migra, NO se siembra" ;;
esac

pnpm db:migrate

if [ "$WILL_SEED" = "1" ]; then
  log "    Sembrando DB"
  pnpm db:seed
  touch "$SEED_MARKER"
  ADMIN_SEEDED=1
else
  ADMIN_SEEDED=0
fi
# La contraseña se lee del `.env` que acaba de escribir `prepare-env.sh`: no
# se pasa por stdout ni por el entorno del log.
ADMIN_PASS="$(env_value SEED_ADMIN_PASSWORD)"

log "    Building API"
pnpm --filter @sa/api build

log "    Building web (raíz /) + prerender SEO"
PUBLIC_SITE_URL="${PUBLIC_SITE_URL:-$SITE_ORIGIN}" pnpm --filter @sa/web build

log "    Building admin (raíz /admin/)"
pnpm --filter @sa/admin exec vite build --base=/admin/

mkdir -p "${APP_DIR}/api/uploads"
chown -R www-data:www-data "${APP_DIR}/api/uploads" || true

# --- 8. Nginx -------------------------------------------------------------
log "8/9  Configurando Nginx"
# El panel se sirve desde un snippet aparte que arranca cerrado. Se abre
# recién después de que el certificado exista, `nginx -t` pase y el servidor
# HTTPS esté escuchando. Antes, la primera configuración ya publicaba /admin
# por HTTP y sólo se cerraba si certbot fallaba: durante esa ventana el panel
# estaba accesible sin TLS.
mkdir -p /etc/nginx/snippets
ADMIN_SNIPPET=/etc/nginx/snippets/sanatorio-admin.conf

write_admin_closed() {
  cat > "$ADMIN_SNIPPET" <<'ADMINCLOSED'
  # Cerrado hasta que haya TLS verificado. Lo reescribe setup-vps.sh.
  location ^~ /admin {
    default_type text/plain;
    return 403 'El panel admin requiere HTTPS. Configura DOMAIN y volve a correr setup-vps.sh.';
  }
ADMINCLOSED
}

write_admin_open() {
  cat > "$ADMIN_SNIPPET" <<ADMINOPEN
  # Panel admin (^~ para que /admin/assets/*.js no caigan en la regex global).
  # Habilitado sólo con TLS verificado; en HTTP certbot deja el 301 a HTTPS.
  location ^~ /admin {
    alias ${APP_DIR}/apps/admin/dist;
    try_files \$uri \$uri/ /admin/index.html;
  }
ADMINOPEN
}

write_admin_closed

cat > /etc/nginx/sites-available/sanatorio <<NGINX
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name ${SERVER_NAME};
  client_max_body_size 20M;

  # Cabeceras de seguridad. La CSP real vive acá (el <meta> del HTML es un
  # respaldo y no puede declarar frame-ancestors).
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
  # frame-src/script-src incluyen los hosts del desafío anti-spam. Sólo se
  # usan si el sanatorio configura CAPTCHA_PROVIDER y las claves; sin eso el
  # front no carga ningún script de terceros.
  # Los hosts de analítica (googletagmanager / google-analytics / connect.facebook /
  # facebook) están en script-src y connect-src para que la medición opt-in
  # (GA4, GTM, Meta Pixel) pueda cargar cuando el sanatorio configura un ID y el
  # visitante acepta. No cargan nada por sí mismos: sin ID configurado no hay
  # ningún script que los use. Tienen que coincidir con la CSP <meta> de
  # apps/web/index.html (la prueba video-embed-csp fija el frame-src; estos dos
  # se mantienen a mano). Ver docs/CARGA-DE-DATOS.md §4.3.
  add_header Content-Security-Policy "default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self' https://challenges.cloudflare.com https://www.google.com https://www.gstatic.com https://www.googletagmanager.com https://connect.facebook.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' https://challenges.cloudflare.com https://www.googletagmanager.com https://www.google-analytics.com https://analytics.google.com https://region1.google-analytics.com https://connect.facebook.net https://www.facebook.com; form-action 'self'; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.google.com https://google.com https://maps.google.com https://www.google.com.py https://google.com.py https://challenges.cloudflare.com; frame-ancestors 'none'" always;

  # API (^~ para que gane prioridad sobre la regex de assets estáticos)
  location ^~ /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
  }

  # Uploads servidos por la API (^~ obligatorio para imágenes)
  location ^~ /uploads/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host \$host;
    proxy_http_version 1.1;
    expires 30d;
    add_header Cache-Control "public";
  }

  # SEO endpoints servidos por la API
  location = /robots.txt    { proxy_pass http://127.0.0.1:4000; }
  location = /sitemap.xml   { proxy_pass http://127.0.0.1:4000; }

  # Portal del paciente: las rutas viejas redirigen de verdad (301), no con
  # JavaScript. La misma lista vive en api/src/legacy-redirects.ts.
  location = /portal-resultados-diagnostico   { return 301 /portal-paciente; }
  location = /portal-resultados-laboratorio   { return 301 /portal-paciente; }
  location = /portal-presupuestos-cirugia     { return 301 /portal-paciente; }
  location = /portal-facturacion-electronica  { return 301 /portal-paciente; }

  include /etc/nginx/snippets/sanatorio-admin.conf;

  # Sitio público (catch-all)
  location / {
    root ${APP_DIR}/apps/web/dist;
    try_files \$uri \$uri/ /index.html;
  }

  # Cache de assets estáticos del sitio público (sólo extensiones, no /uploads/)
  location ~* \.(?:css|js|woff2?|ttf|otf|eot|svg|webp|ico)\$ {
    root ${APP_DIR}/apps/web/dist;
    try_files \$uri =404;
    expires 30d;
    add_header Cache-Control "public, immutable";
  }
}
NGINX

ln -sf /etc/nginx/sites-available/sanatorio /etc/nginx/sites-enabled/sanatorio
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

TLS_OK=0
if [ -n "$DOMAIN" ]; then
  log "    Emitiendo certificado TLS para ${DOMAIN} (Let's Encrypt)"
  apt install -y -qq certbot python3-certbot-nginx
  # --redirect: certbot deja el server HTTP devolviendo 301 a HTTPS, así que
  # /admin por HTTP nunca sirve el panel aunque el snippet esté abierto.
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
       -m "${CERTBOT_EMAIL:-$ADMIN_EMAIL}" --redirect; then
    log "    Certificado emitido. Verificando antes de publicar /admin"
    # Tres condiciones, en este orden, antes de abrir el panel:
    #   1. el certificado existe en disco;
    #   2. hay un server TLS escuchando en 443;
    #   3. `nginx -t` valida la configuración con el snippet abierto.
    # Si alguna falla, el snippet se queda en 403 y el deploy sigue sin panel.
    if [ ! -s "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
      warn "certbot dijo OK pero no hay fullchain.pem: /admin queda cerrado."
    elif ! grep -q "listen.*443" /etc/nginx/sites-available/sanatorio; then
      warn "no hay server TLS en la configuración: /admin queda cerrado."
    else
      write_admin_open
      if nginx -t && systemctl reload nginx; then
        # Última comprobación: que 443 esté realmente aceptando conexiones.
        if curl -sk --max-time 10 -o /dev/null "https://${DOMAIN}/api/health"; then
          TLS_OK=1
          log "    HTTPS activo: /admin publicado sólo sobre TLS"
        else
          warn "HTTPS no respondió: se vuelve a cerrar /admin."
          write_admin_closed
          nginx -t && systemctl reload nginx
        fi
      else
        warn "nginx -t falló con /admin habilitado: se revierte a 403."
        write_admin_closed
        nginx -t && systemctl reload nginx
      fi
    fi
  else
    # El snippet nunca se abrió, así que no hay nada que cerrar: /admin siguió
    # en 403 durante todo el proceso.
    warn "certbot falló: el sitio queda en HTTP y /admin sigue cerrado (403)."
    warn "Cuando ${DOMAIN} resuelva a este servidor, volvé a correr setup-vps.sh."
  fi
fi

# --- 9. PM2 + firewall ----------------------------------------------------
log "9/9  Arrancando API con PM2 y configurando firewall"
cd "${APP_DIR}/api"
pm2 delete sanatorio-api 2>/dev/null || true
# tsc emite a dist/src/index.js cuando rootDir=. y se incluyen migrations/seeds
ENTRY="dist/src/index.js"
[ -f "$ENTRY" ] || ENTRY="dist/index.js"
pm2 start "$ENTRY" --name sanatorio-api --time --cwd "${APP_DIR}/api"
pm2 save
# Auto-start al reboot
pm2 startup systemd -u root --hp /root 2>&1 | grep -E "^sudo " | bash || true

ufw --force enable >/dev/null 2>&1 || true
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80/tcp  >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true

# --- Health check ---------------------------------------------------------
sleep 2
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost/api/health" || echo "000")

echo ""
echo "========================================================"
if [ "$HEALTH" = "200" ]; then
  echo -e "\033[1;32m✅ Deploy completo y funcionando\033[0m"
else
  echo -e "\033[1;33m⚠ Deploy completo pero healthcheck devolvió ${HEALTH}\033[0m"
  echo "  Revisá:  pm2 logs sanatorio-api"
fi
echo "========================================================"
if [ -n "$DOMAIN" ] && [ "$TLS_OK" != "1" ]; then
  # Imprimir una URL http:// del panel como si fuera el resultado esperado
  # invita a entrar y loguearse sin cifrado.
  echo -e "\033[1;31m✗ TLS no quedó configurado para ${DOMAIN}\033[0m"
  echo "  El sitio responde en http://${SERVER_IP} pero NO es la URL definitiva."
  echo "  El panel /admin está cerrado (403) hasta que haya certificado."
  echo "  Cuando ${DOMAIN} resuelva a este servidor, volvé a correr setup-vps.sh."
elif [ -z "$DOMAIN" ]; then
  echo "Sitio público:   ${SITE_ORIGIN}"
  echo "Panel admin:     cerrado (403). Requiere DOMAIN + certificado TLS."
  echo "API health:      ${SITE_ORIGIN}/api/health"
else
  echo "Sitio público:   ${SITE_ORIGIN}"
  echo "Panel admin:     ${SITE_ORIGIN}/admin"
  echo "API health:      ${SITE_ORIGIN}/api/health"
fi
echo ""
# Las credenciales NO se imprimen: quedarían en la terminal, en el historial y
# en los logs de quien haya lanzado el deploy.
#
# Y sólo se escribe el archivo si el usuario admin se creó de verdad en esta
# corrida. Antes se generaba una contraseña nueva en cada ejecución y se
# escribía acá aunque el seed no hubiera corrido: el archivo terminaba con una
# contraseña que no existía en la base, y pisaba la que sí servía.
if [ "$ADMIN_SEEDED" = "1" ]; then
  umask 077
  cat > "$CREDENTIALS_FILE" <<CREDS
# Generado por setup-vps.sh el $(date -Iseconds). Archivo sólo-root.
# Cambiá la contraseña del admin al primer login y después borrá este archivo.
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASS}
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
CREDS
  chmod 600 "$CREDENTIALS_FILE"

  echo "Credenciales del admin y de la DB: ${CREDENTIALS_FILE} (chmod 600, sólo root)"
  echo "  → leelas con: cat ${CREDENTIALS_FILE}"
  echo "  → cambiá la contraseña del admin al primer login y borrá el archivo"
else
  echo "No se sembró la base, así que el usuario admin no se tocó:"
  echo "  la contraseña sigue siendo la de la instalación anterior."
  if [ -n "$ADMIN_PASS" ]; then
    echo "  Está en ${CREDENTIALS_FILE} (si el archivo sigue existiendo) y en ${ENV_FILE}."
  else
    # No había `.env` previo del que leerla y tampoco se sembró: nadie en este
    # servidor la conoce, y no se inventa una que no abriría nada.
    echo "  Este servidor no la tiene guardada; cambiala desde el panel si se perdió."
  fi
fi
echo ""
echo "La contraseña de la DB y el JWT_SECRET viven en ${APP_DIR}/api/.env (chmod 600)."
echo "  Si ya existían, se conservaron: rotarlos desloguearía a todo el mundo."
echo "========================================================"
echo ""
echo "Próximos comandos útiles:"
echo "  pm2 logs sanatorio-api      → ver logs"
echo "  pm2 restart sanatorio-api   → reiniciar API"
echo "  systemctl reload nginx      → recargar Nginx"
echo "  bash ${APP_DIR}/scripts/deploy/update-vps.sh → actualizar a la última versión del repo"
echo "========================================================"
\r'* || "$DB_PASS" == *\\* ]]; then
  die "DB_PASS contiene comillas, barra inversa o saltos de línea; generá una credencial compatible y no la pongas en el comando."
fi

# --- 1. Sistema -----------------------------------------------------------
log "1/9  Actualizando sistema"
export DEBIAN_FRONTEND=noninteractive
apt update -qq
apt upgrade -y -qq

# --- 2. Dependencias base -------------------------------------------------
log "2/9  Instalando dependencias base (git, nginx, mysql, ufw, openssl)"
apt install -y -qq curl ca-certificates gnupg git nginx mysql-server ufw openssl

# --- 3. Node 20 + pnpm + pm2 ----------------------------------------------
log "3/9  Instalando Node 20, pnpm y PM2"
if ! command -v node >/dev/null || [[ "$(node -v)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y -qq nodejs
fi
npm install -g pnpm@9 pm2 >/dev/null 2>&1
log "    Node $(node -v) · pnpm $(pnpm -v) · pm2 $(pm2 -v)"

# --- 4. MySQL -------------------------------------------------------------
log "4/9  Configurando MySQL"
systemctl enable --now mysql
mysql --protocol=socket -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

# --- 5. Clonar / actualizar repo ------------------------------------------
log "5/9  Clonando repo en ${APP_DIR}"
mkdir -p "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch origin
  git checkout "$BRANCH"
  git reset --hard "origin/${BRANCH}"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

# --- 6. Instalar dependencias ---------------------------------------------
log "6/9  Instalando dependencias"
cd "$APP_DIR"
# Falla ruidosamente: un install no congelado deja el server con dependencias
# distintas a las auditadas.
pnpm install --frozen-lockfile || die "pnpm install --frozen-lockfile falló. Revisá que pnpm-lock.yaml esté commiteado y actualizado; no se instala sin lockfile congelado."

# --- 7. Estado de la base, .env, migrar, sembrar, build --------------------
#
# El orden importa y es este:
#
#   1. se consulta el estado de la base (`db-state.mjs`), ANTES de migrar y
#      antes de escribir una sola credencial. La decisión de sembrar mira la
#      base, no un archivo: los seeds arrancan borrando usuarios, ajustes,
#      médicos, especialidades, servicios, estudios, páginas y bloques, y un
#      marker perdido se llevaba puesto todo lo cargado desde el panel;
#   2. recién con esa respuesta se decide la contraseña del admin y se escribe
#      `api/.env`. Generarla antes dejaba anotada una credencial que no
#      correspondía a ningún usuario cuando el seed no llegaba a correr.
#
# Las dos cosas viven en `prepare-env.sh` para poder probarlas sin un VPS.
log "7/9  Estado de la base + api/.env"
SEED_MARKER="${APP_DIR}/.seeded"
set +e
PREPARE_OUT="$(APP_DIR="$APP_DIR" REPO_ROOT="$APP_DIR" \
  DB_HOST=127.0.0.1 DB_PORT=3306 DB_NAME="$DB_NAME" DB_USER="$DB_USER" DB_PASS="$DB_PASS" \
  JWT_SECRET="$JWT_SECRET" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_NAME="$ADMIN_NAME" \
  ADMIN_PASS="${ADMIN_PASS:-}" SITE_ORIGIN="$SITE_ORIGIN" SEED_MARKER="$SEED_MARKER" \
  bash scripts/deploy/prepare-env.sh)"
PREPARE_CODE=$?
set -e
[ "$PREPARE_CODE" -eq 0 ] || die "no se sigue: la base tiene contenido y no se puede confirmar que sea seguro sembrar (código ${PREPARE_CODE}). El detalle está arriba. No se escribió ninguna credencial."
# Sólo tres líneas `CLAVE=valor`; la contraseña no viaja por stdout.
eval "$PREPARE_OUT"

case "$DB_STATE" in
  nueva)         log "    Base vacía → se migra y se siembra" ;;
  actualizacion) log "    Base ya instalada → se migra, NO se siembra" ;;
esac

pnpm db:migrate

if [ "$WILL_SEED" = "1" ]; then
  log "    Sembrando DB"
  pnpm db:seed
  touch "$SEED_MARKER"
  ADMIN_SEEDED=1
else
  ADMIN_SEEDED=0
fi
# La contraseña se lee del `.env` que acaba de escribir `prepare-env.sh`: no
# se pasa por stdout ni por el entorno del log.
ADMIN_PASS="$(env_value SEED_ADMIN_PASSWORD)"

log "    Building API"
pnpm --filter @sa/api build

log "    Building web (raíz /) + prerender SEO"
PUBLIC_SITE_URL="${PUBLIC_SITE_URL:-$SITE_ORIGIN}" pnpm --filter @sa/web build

log "    Building admin (raíz /admin/)"
pnpm --filter @sa/admin exec vite build --base=/admin/

mkdir -p "${APP_DIR}/api/uploads"
chown -R www-data:www-data "${APP_DIR}/api/uploads" || true

# --- 8. Nginx -------------------------------------------------------------
log "8/9  Configurando Nginx"
# El panel se sirve desde un snippet aparte que arranca cerrado. Se abre
# recién después de que el certificado exista, `nginx -t` pase y el servidor
# HTTPS esté escuchando. Antes, la primera configuración ya publicaba /admin
# por HTTP y sólo se cerraba si certbot fallaba: durante esa ventana el panel
# estaba accesible sin TLS.
mkdir -p /etc/nginx/snippets
ADMIN_SNIPPET=/etc/nginx/snippets/sanatorio-admin.conf

write_admin_closed() {
  cat > "$ADMIN_SNIPPET" <<'ADMINCLOSED'
  # Cerrado hasta que haya TLS verificado. Lo reescribe setup-vps.sh.
  location ^~ /admin {
    default_type text/plain;
    return 403 'El panel admin requiere HTTPS. Configura DOMAIN y volve a correr setup-vps.sh.';
  }
ADMINCLOSED
}

write_admin_open() {
  cat > "$ADMIN_SNIPPET" <<ADMINOPEN
  # Panel admin (^~ para que /admin/assets/*.js no caigan en la regex global).
  # Habilitado sólo con TLS verificado; en HTTP certbot deja el 301 a HTTPS.
  location ^~ /admin {
    alias ${APP_DIR}/apps/admin/dist;
    try_files \$uri \$uri/ /admin/index.html;
  }
ADMINOPEN
}

write_admin_closed

cat > /etc/nginx/sites-available/sanatorio <<NGINX
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name ${SERVER_NAME};
  client_max_body_size 20M;

  # Cabeceras de seguridad. La CSP real vive acá (el <meta> del HTML es un
  # respaldo y no puede declarar frame-ancestors).
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
  # frame-src/script-src incluyen los hosts del desafío anti-spam. Sólo se
  # usan si el sanatorio configura CAPTCHA_PROVIDER y las claves; sin eso el
  # front no carga ningún script de terceros.
  # Los hosts de analítica (googletagmanager / google-analytics / connect.facebook /
  # facebook) están en script-src y connect-src para que la medición opt-in
  # (GA4, GTM, Meta Pixel) pueda cargar cuando el sanatorio configura un ID y el
  # visitante acepta. No cargan nada por sí mismos: sin ID configurado no hay
  # ningún script que los use. Tienen que coincidir con la CSP <meta> de
  # apps/web/index.html (la prueba video-embed-csp fija el frame-src; estos dos
  # se mantienen a mano). Ver docs/CARGA-DE-DATOS.md §4.3.
  add_header Content-Security-Policy "default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self' https://challenges.cloudflare.com https://www.google.com https://www.gstatic.com https://www.googletagmanager.com https://connect.facebook.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' https://challenges.cloudflare.com https://www.googletagmanager.com https://www.google-analytics.com https://analytics.google.com https://region1.google-analytics.com https://connect.facebook.net https://www.facebook.com; form-action 'self'; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.google.com https://google.com https://maps.google.com https://www.google.com.py https://google.com.py https://challenges.cloudflare.com; frame-ancestors 'none'" always;

  # API (^~ para que gane prioridad sobre la regex de assets estáticos)
  location ^~ /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
  }

  # Uploads servidos por la API (^~ obligatorio para imágenes)
  location ^~ /uploads/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host \$host;
    proxy_http_version 1.1;
    expires 30d;
    add_header Cache-Control "public";
  }

  # SEO endpoints servidos por la API
  location = /robots.txt    { proxy_pass http://127.0.0.1:4000; }
  location = /sitemap.xml   { proxy_pass http://127.0.0.1:4000; }

  # Portal del paciente: las rutas viejas redirigen de verdad (301), no con
  # JavaScript. La misma lista vive en api/src/legacy-redirects.ts.
  location = /portal-resultados-diagnostico   { return 301 /portal-paciente; }
  location = /portal-resultados-laboratorio   { return 301 /portal-paciente; }
  location = /portal-presupuestos-cirugia     { return 301 /portal-paciente; }
  location = /portal-facturacion-electronica  { return 301 /portal-paciente; }

  include /etc/nginx/snippets/sanatorio-admin.conf;

  # Sitio público (catch-all)
  location / {
    root ${APP_DIR}/apps/web/dist;
    try_files \$uri \$uri/ /index.html;
  }

  # Cache de assets estáticos del sitio público (sólo extensiones, no /uploads/)
  location ~* \.(?:css|js|woff2?|ttf|otf|eot|svg|webp|ico)\$ {
    root ${APP_DIR}/apps/web/dist;
    try_files \$uri =404;
    expires 30d;
    add_header Cache-Control "public, immutable";
  }
}
NGINX

ln -sf /etc/nginx/sites-available/sanatorio /etc/nginx/sites-enabled/sanatorio
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

TLS_OK=0
if [ -n "$DOMAIN" ]; then
  log "    Emitiendo certificado TLS para ${DOMAIN} (Let's Encrypt)"
  apt install -y -qq certbot python3-certbot-nginx
  # --redirect: certbot deja el server HTTP devolviendo 301 a HTTPS, así que
  # /admin por HTTP nunca sirve el panel aunque el snippet esté abierto.
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
       -m "${CERTBOT_EMAIL:-$ADMIN_EMAIL}" --redirect; then
    log "    Certificado emitido. Verificando antes de publicar /admin"
    # Tres condiciones, en este orden, antes de abrir el panel:
    #   1. el certificado existe en disco;
    #   2. hay un server TLS escuchando en 443;
    #   3. `nginx -t` valida la configuración con el snippet abierto.
    # Si alguna falla, el snippet se queda en 403 y el deploy sigue sin panel.
    if [ ! -s "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
      warn "certbot dijo OK pero no hay fullchain.pem: /admin queda cerrado."
    elif ! grep -q "listen.*443" /etc/nginx/sites-available/sanatorio; then
      warn "no hay server TLS en la configuración: /admin queda cerrado."
    else
      write_admin_open
      if nginx -t && systemctl reload nginx; then
        # Última comprobación: que 443 esté realmente aceptando conexiones.
        if curl -sk --max-time 10 -o /dev/null "https://${DOMAIN}/api/health"; then
          TLS_OK=1
          log "    HTTPS activo: /admin publicado sólo sobre TLS"
        else
          warn "HTTPS no respondió: se vuelve a cerrar /admin."
          write_admin_closed
          nginx -t && systemctl reload nginx
        fi
      else
        warn "nginx -t falló con /admin habilitado: se revierte a 403."
        write_admin_closed
        nginx -t && systemctl reload nginx
      fi
    fi
  else
    # El snippet nunca se abrió, así que no hay nada que cerrar: /admin siguió
    # en 403 durante todo el proceso.
    warn "certbot falló: el sitio queda en HTTP y /admin sigue cerrado (403)."
    warn "Cuando ${DOMAIN} resuelva a este servidor, volvé a correr setup-vps.sh."
  fi
fi

# --- 9. PM2 + firewall ----------------------------------------------------
log "9/9  Arrancando API con PM2 y configurando firewall"
cd "${APP_DIR}/api"
pm2 delete sanatorio-api 2>/dev/null || true
# tsc emite a dist/src/index.js cuando rootDir=. y se incluyen migrations/seeds
ENTRY="dist/src/index.js"
[ -f "$ENTRY" ] || ENTRY="dist/index.js"
pm2 start "$ENTRY" --name sanatorio-api --time --cwd "${APP_DIR}/api"
pm2 save
# Auto-start al reboot
pm2 startup systemd -u root --hp /root 2>&1 | grep -E "^sudo " | bash || true

ufw --force enable >/dev/null 2>&1 || true
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80/tcp  >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true

# --- Health check ---------------------------------------------------------
sleep 2
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost/api/health" || echo "000")

echo ""
echo "========================================================"
if [ "$HEALTH" = "200" ]; then
  echo -e "\033[1;32m✅ Deploy completo y funcionando\033[0m"
else
  echo -e "\033[1;33m⚠ Deploy completo pero healthcheck devolvió ${HEALTH}\033[0m"
  echo "  Revisá:  pm2 logs sanatorio-api"
fi
echo "========================================================"
if [ -n "$DOMAIN" ] && [ "$TLS_OK" != "1" ]; then
  # Imprimir una URL http:// del panel como si fuera el resultado esperado
  # invita a entrar y loguearse sin cifrado.
  echo -e "\033[1;31m✗ TLS no quedó configurado para ${DOMAIN}\033[0m"
  echo "  El sitio responde en http://${SERVER_IP} pero NO es la URL definitiva."
  echo "  El panel /admin está cerrado (403) hasta que haya certificado."
  echo "  Cuando ${DOMAIN} resuelva a este servidor, volvé a correr setup-vps.sh."
elif [ -z "$DOMAIN" ]; then
  echo "Sitio público:   ${SITE_ORIGIN}"
  echo "Panel admin:     cerrado (403). Requiere DOMAIN + certificado TLS."
  echo "API health:      ${SITE_ORIGIN}/api/health"
else
  echo "Sitio público:   ${SITE_ORIGIN}"
  echo "Panel admin:     ${SITE_ORIGIN}/admin"
  echo "API health:      ${SITE_ORIGIN}/api/health"
fi
echo ""
# Las credenciales NO se imprimen: quedarían en la terminal, en el historial y
# en los logs de quien haya lanzado el deploy.
#
# Y sólo se escribe el archivo si el usuario admin se creó de verdad en esta
# corrida. Antes se generaba una contraseña nueva en cada ejecución y se
# escribía acá aunque el seed no hubiera corrido: el archivo terminaba con una
# contraseña que no existía en la base, y pisaba la que sí servía.
if [ "$ADMIN_SEEDED" = "1" ]; then
  umask 077
  cat > "$CREDENTIALS_FILE" <<CREDS
# Generado por setup-vps.sh el $(date -Iseconds). Archivo sólo-root.
# Cambiá la contraseña del admin al primer login y después borrá este archivo.
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASS}
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
CREDS
  chmod 600 "$CREDENTIALS_FILE"

  echo "Credenciales del admin y de la DB: ${CREDENTIALS_FILE} (chmod 600, sólo root)"
  echo "  → leelas con: cat ${CREDENTIALS_FILE}"
  echo "  → cambiá la contraseña del admin al primer login y borrá el archivo"
else
  echo "No se sembró la base, así que el usuario admin no se tocó:"
  echo "  la contraseña sigue siendo la de la instalación anterior."
  if [ -n "$ADMIN_PASS" ]; then
    echo "  Está en ${CREDENTIALS_FILE} (si el archivo sigue existiendo) y en ${ENV_FILE}."
  else
    # No había `.env` previo del que leerla y tampoco se sembró: nadie en este
    # servidor la conoce, y no se inventa una que no abriría nada.
    echo "  Este servidor no la tiene guardada; cambiala desde el panel si se perdió."
  fi
fi
echo ""
echo "La contraseña de la DB y el JWT_SECRET viven en ${APP_DIR}/api/.env (chmod 600)."
echo "  Si ya existían, se conservaron: rotarlos desloguearía a todo el mundo."
echo "========================================================"
echo ""
echo "Próximos comandos útiles:"
echo "  pm2 logs sanatorio-api      → ver logs"
echo "  pm2 restart sanatorio-api   → reiniciar API"
echo "  systemctl reload nginx      → recargar Nginx"
echo "  bash ${APP_DIR}/scripts/deploy/update-vps.sh → actualizar a la última versión del repo"
echo "========================================================"
