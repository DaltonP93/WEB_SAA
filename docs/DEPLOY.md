# Deploy — Sanatorio Adventista V2

Guía para llevar el proyecto desde local al servidor propio del usuario.

## Prerrequisitos en el servidor

- Node 20 LTS, pnpm 9
- MySQL 8 (o MariaDB 10.6+)
- Nginx
- PM2 (`npm i -g pm2`)
- Dominio apuntando al servidor (A record)
- Certificado SSL (Let's Encrypt con certbot)

## 1. Configurar MySQL

```sql
CREATE DATABASE sanatorio CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'sanatorio'@'localhost' IDENTIFIED BY 'PASSWORD_SEGURO';
GRANT ALL PRIVILEGES ON sanatorio.* TO 'sanatorio'@'localhost';
FLUSH PRIVILEGES;
```

## 2. Clonar y construir

```bash
cd /var/www
git clone <repo> sanatorio
cd sanatorio
pnpm install --frozen-lockfile
```

Configurar `api/.env`:

```bash
cp api/.env.example api/.env
# editar: DB_*, JWT_SECRET (cambiar!), CORS_ORIGINS=https://sanatorioadventista.com.py
nano api/.env
```

Migrar y sembrar:

```bash
pnpm db:migrate
pnpm db:seed
```

Build:

```bash
pnpm build
```

Esto genera:
- `api/dist/` — backend compilado
- `apps/web/dist/` — sitio público estático
- `apps/admin/dist/` — panel admin estático

## 3. PM2 para la API

```bash
cd /var/www/sanatorio
pm2 start api/dist/index.js --name sanatorio-api --time
pm2 save
pm2 startup  # seguir instrucciones
```

## 4. Nginx

`/etc/nginx/sites-available/sanatorio`:

```nginx
server {
  listen 80;
  server_name sanatorioadventista.com.py www.sanatorioadventista.com.py;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name sanatorioadventista.com.py www.sanatorioadventista.com.py;

  ssl_certificate     /etc/letsencrypt/live/sanatorioadventista.com.py/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/sanatorioadventista.com.py/privkey.pem;

  client_max_body_size 20M;

  # API
  location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Uploads (servidos por la API)
  location /uploads/ {
    proxy_pass http://127.0.0.1:4000;
  }

  # Panel admin
  location /admin/ {
    alias /var/www/sanatorio/apps/admin/dist/;
    try_files $uri $uri/ /admin/index.html;
  }

  # Sitio público
  location / {
    root /var/www/sanatorio/apps/web/dist;
    try_files $uri $uri/ /index.html;
  }
}
```

Activar y recargar:

```bash
ln -s /etc/nginx/sites-available/sanatorio /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

> **Nota** — si el panel admin queda bajo `/admin/`, hay que construirlo con `vite build --base=/admin/`. Editar `apps/admin/vite.config.ts` para agregar `base: "/admin/"` en producción, o usar `vite build --base=/admin/` en el script `build`.

## 5. SSL con Let's Encrypt

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d sanatorioadventista.com.py -d www.sanatorioadventista.com.py
```

## 6. Backups

Cron diario de MySQL:

```bash
0 3 * * * MYSQL_PWD="$(grep '^DB_PASS=' /var/www/sanatorio/api/.env | cut -d= -f2-)" mysqldump -u sanatorio sanatorio | gzip > /var/backups/sanatorio_$(date +\%F).sql.gz
```

Backup de `api/uploads/` (rsync semanal a almacenamiento externo).

## 7. Actualizaciones

Todo el ciclo está en `scripts/deploy/update-vps.sh`, que además saca un backup
de la base antes de migrar y falla si el health check no da 200:

```bash
# Desde tu máquina (credenciales en .env.deploy, ver .env.deploy.example)
python scripts/deploy/run-remote.py "bash /var/www/sanatorio/scripts/deploy/update-vps.sh"

# O directamente en el servidor
bash /var/www/sanatorio/scripts/deploy/update-vps.sh
```

Pasos que ejecuta:

0. Requisito: **Node 20+**. Las migraciones corren con `tsx` (dependencia del
   workspace), así que no dependen de que Node sepa cargar TypeScript.
1. `git fetch` + `reset --hard origin/main` (o al SHA de `ROLLBACK_TO`).
2. `pnpm install --frozen-lockfile` — **sin fallback**: si el lockfile no
   coincide, el deploy se detiene en vez de instalar otra cosa.
3. `mysqldump | gzip` a `/var/www/sanatorio/.db-backups/` (guarda los 10 últimos).
   **Si el backup falla, el deploy se aborta antes de migrar**: las migraciones
   tocan contenido editado desde el panel y sin backup no habría vuelta atrás.
   Para forzarlo igual (bajo tu responsabilidad): `SKIP_DB_BACKUP=1`.
4. `pnpm db:migrate`.
5. Builds de api, web (con prerender SEO) y admin.
6. Reload de Nginx + restart de PM2 (`sanatorio-api`).
7. Health check con reintentos: si `/api/health` no da 200 en 20s, sale con
   error e imprime el comando de rollback.

### Rollback

```bash
# 1. Volver el código a la versión anterior (el script imprime el SHA previo)
ROLLBACK_TO=<sha-anterior> bash /var/www/sanatorio/scripts/deploy/update-vps.sh

# 2. Si la versión nueva agregó migraciones, revertirlas de a una.
#    Siempre por el script del paquete: corre knex a través de tsx. Invocar
#    knex directo falla en Node 20 con "Unknown file extension .ts", porque el
#    migrador hace import() en runtime y sólo Node >= 22.18 lee TypeScript solo.
cd /var/www/sanatorio
pnpm --filter @sa/api migrate:rollback   # revierte el último batch
# o, para ir de a una migración:
pnpm --filter @sa/api exec tsx ./node_modules/knex/bin/cli.js \
  --knexfile knexfile.ts migrate:down

# 3. Si hace falta restaurar datos, usar el backup previo al deploy
gunzip < /var/www/sanatorio/.db-backups/sanatorio-<fecha>.sql.gz \
  | mysql -u sanatorio -p sanatorio
```

Las migraciones de contenido guardan el estado anterior en la tabla `settings`
(`minuta_blocks_backup_*` y `snapshot_*`), así que su `down()` restaura las
páginas tal como estaban. Esas claves son internas: `GET /api/public/settings`
no las publica, y el seed no las borra —si se perdieran, el `down()` se
quedaría sin con qué restaurar—.

Las migraciones correctivas son además idempotentes por snapshot: si ya
corrieron, un segundo `up()` no vuelve a tocar contenido, así que no pisan lo
que el sanatorio haya editado desde el panel después del deploy.

### Verificación anti-spam (CAPTCHA)

Está integrada de punta a punta pero **desactivada**: hace falta que el
sanatorio cree las claves. Mientras las tres variables estén vacías, el
formulario de contacto funciona igual y no se carga ningún script de terceros.

Para activarla, en `api/.env`:

```bash
CAPTCHA_PROVIDER=turnstile        # o recaptcha
CAPTCHA_SITE_KEY=<clave pública>
CAPTCHA_SECRET_KEY=<clave-secreta>
```

Las tres van juntas. Con sólo una parte cargada la API avisa en el arranque:
con site key y sin secreto el visitante resuelve el desafío pero el servidor no
valida nada; con secreto y sin site key el formulario se vuelve imposible de
enviar. En ninguno de esos casos se rompe el arranque: la verificación queda
desactivada y los envíos siguen pasando.

La clave secreta nunca sale del servidor: `/api/public/settings` sólo publica
`{ provider, siteKey }`.

### Verificación de salud

```bash
curl -s http://<host>/api/health        # 200 = API y base OK · 503 = base caída
```

`/api/health` devuelve el estado por componente (`api`, `database`) sin exponer
credenciales ni datos de conexión.

## 8. Verificación post-deploy

- [ ] `https://sanatorioadventista.com.py/` carga el home
- [ ] `https://sanatorioadventista.com.py/admin/` muestra el login
- [ ] `https://sanatorioadventista.com.py/api/health` devuelve `{ok:true}`
- [ ] Cambiar la contraseña del admin sembrado y crear usuarios reales
- [ ] Borrar `/var/www/sanatorio/.deploy-credentials` después de leerlo
- [ ] Subir el logo definitivo y configurar branding completo
- [ ] Cargar **Canales de contacto** (WhatsApp por tipo de atención, Emergencias, GTH)
- [ ] Cargar **Horarios de atención** y activarlos (hasta entonces el sitio dice "en proceso de confirmación")
- [ ] Crear contenido inicial (médicos) desde el admin

> El panel `/admin` **no se publica sin HTTPS**: `setup-vps.sh` sólo lo expone
> si se pasa `DOMAIN` (y emite el certificado con certbot). Para publicarlo sin
> TLS hay que pedirlo explícitamente con `ADMIN_ALLOW_INSECURE_HTTP=1`, lo que
> deja las credenciales del admin viajando en texto plano.

## Variables de entorno producción

| Variable | Valor sugerido |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `DB_HOST` | `127.0.0.1` |
| `DB_USER` | `sanatorio` |
| `DB_NAME` | `sanatorio` |
| `JWT_SECRET` | `<random ≥32 chars>` — la API no arranca en producción con el valor de ejemplo |
| `SEED_ADMIN_PASSWORD` | obligatoria al sembrar con `NODE_ENV=production` |
| `PUBLIC_FORMS_RATE_MAX` | `10` envíos por IP en `PUBLIC_FORMS_RATE_WINDOW_MS` |
| `CAPTCHA_PROVIDER` | opcional: `turnstile` o `recaptcha`; vacío = verificación desactivada |
| `CAPTCHA_SITE_KEY` | clave pública del proveedor; la usa el widget del formulario |
| `CAPTCHA_SECRET_KEY` | clave secreta; sólo la usa la API para validar el token |
| `CORS_ORIGINS` | `https://sanatorioadventista.com.py` |
| `PUBLIC_BASE_URL` | `https://sanatorioadventista.com.py` |
| `UPLOAD_DIR` | `/var/www/sanatorio/api/uploads` |
