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
# Sólo en una instalación NUEVA. Los seeds borran usuarios, ajustes, médicos,
# especialidades, servicios, estudios, páginas y bloques antes de insertar.
pnpm db:seed
```

> **`db:seed` no se corre sobre una base con contenido.** `setup-vps.sh` lo
> comprueba solo (`scripts/deploy/db-state.mjs`) y aborta si la base tiene
> datos y falta el marker `.seeded`. A mano, verificá antes:
>
> ```bash
> node scripts/deploy/db-state.mjs   # nueva | actualizacion | conflicto
> ```

Build:

```bash
pnpm build
```

Esto genera:
- `api/dist/` — backend compilado
- `apps/web/dist/` — sitio público estático
- `apps/admin/dist/` — panel admin estático

## 3. PM2 para la API

El entry compilado es `api/dist/src/index.js` —`tsc` conserva la carpeta
`src/`— y hace falta `--cwd` para que dotenv encuentre `api/.env`:

```bash
cd /var/www/sanatorio
pm2 start api/dist/src/index.js --name sanatorio-api --time --cwd /var/www/sanatorio/api
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
1. `git fetch` + `reset --hard origin/main`. **Sólo va hacia adelante**: si se le
   pasa `ROLLBACK_TO`, el script aborta antes de tocar nada (código 2) y remite a
   `rollback-vps.sh`. Ver [Rollback](#rollback).
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
   error e imprime el comando de `rollback-vps.sh`.

### Rollback

```bash
ROLLBACK_TO=<sha-anterior> bash /var/www/sanatorio/scripts/deploy/rollback-vps.sh
```

**El orden importa, y es al revés de lo que parece.** Primero se revierten las
migraciones y después se baja el código:

1. prevalidación: la versión destino se instala y compila en un `git worktree`
   aparte, con el deploy actual intacto. Si no pasa, se aborta acá;
2. backup de la base (si falla, se aborta y el deploy actual queda intacto);
3. `down()` de las migraciones nuevas **con el código nuevo todavía en disco**,
   o restauración del dump indicado (verificado antes con `gzip -t`);
4. recién ahí `git reset --hard <sha-anterior>`;
5. install y builds;
6. Nginx, PM2 y health check.

Revertir la base (paso 3) es el punto sin retorno: a partir de ahí la aplicación
que corre es la nueva contra una base vieja. Si falla algo de los pasos 4 a 6, el
script **recupera** el estado anterior —restaura el backup, vuelve al SHA que
estaba, reconstruye y reinicia— en vez de dejar el servidor mezclado.

La prevalidación del paso 1 necesita disco y tiempo para un `node_modules`
aparte. En un servidor justo de espacio se puede omitir con
`SKIP_PREVALIDACION=1`, a cambio de que un build roto se descubra recién con la
base ya revertida (ahí entra la recuperación).

Códigos de salida de `rollback-vps.sh`:

| código | significado |
|---|---|
| 0 | rollback completo y la aplicación responde |
| 1 | error de uso o de una etapa previa (nada se tocó) |
| 2 | la versión destino no pasó la prevalidación (nada se tocó) |
| 4 | se abortó y la base quedó como antes; el código NO se bajó |
| 5 | la base quedó en un estado intermedio y no se pudo restaurar |
| 6 | el rollback se aplicó pero el health check no dio 200 |
| 7 | falló una etapa posterior a la base y se recuperó el estado anterior |
| 8 | falló una etapa posterior a la base y la recuperación quedó incompleta |

Bajar el código primero no funciona: knex decide qué revertir leyendo
`knex_migrations` y buscando el archivo en disco. Después del checkout, las
migraciones nuevas están registradas en la base y sus archivos ya no existen,
así que el rollback falla —y el `down()` que hacía falta era justamente el del
código nuevo, que es el único que sabe deshacer su propio `up()`—.

#### Cuándo el `down()` no alcanza

Si la base se **sembró después** de que corriera una migración, la vuelta atrás
va por dump, no por `down()`. Los seeds borran páginas y bloques y los vuelven
a crear con ids nuevos; las migraciones `20260815` y `20260817` guardan su
snapshot indexado por id de bloque, así que su `down()` no encontraría ninguna
fila y se marcaría como revertido sin restaurar nada.

Eso no queda librado a que alguien lo recuerde: `migrate:rollback` y
`migrate:down` pasan por `scripts/deploy/rollback-guard.mjs`, que compara la
marca `settings.seed_generation` contra la fecha de cada snapshot y **bloquea**
el rollback con el comando del dump si detecta ese caso. Para ese escenario:

```bash
ROLLBACK_TO=<sha-anterior> \
RESTORE_DUMP=/var/www/sanatorio/.db-backups/sanatorio-<fecha>.sql.gz \
  bash /var/www/sanatorio/scripts/deploy/rollback-vps.sh
```

O, restaurando el dump a mano:

```bash
gunzip < /var/www/sanatorio/.db-backups/sanatorio-<fecha>.sql.gz \
  | mysql -u sanatorio -p sanatorio
```

En un entorno de desarrollo, donde perder el contenido es justamente lo que se
busca, la barrera se levanta con `ROLLBACK_ALLOW_AFTER_SEED=1` (es lo que hace
`pnpm --filter @sa/api db:reset`).

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

> El panel `/admin` **no se publica sin HTTPS, y no hay forma de saltearlo**.
> `setup-vps.sh` escribe la configuración de Nginx con `/admin` en 403 y recién
> lo abre cuando se cumplen las tres condiciones, en este orden: certbot emitió
> el certificado, existe un server TLS en 443 y `nginx -t` valida la
> configuración con el panel habilitado. Si alguna falla, el snippet vuelve a
> 403 y el deploy termina sin panel. Por HTTP, certbot deja un 301 a HTTPS, así
> que `/admin` sobre texto plano responde siempre 301 o 403 — nunca el panel.

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
