"""
Deploy de fotos de doctores al VPS:
- Comprime assets-extracted/doctors-optimized en un tar.gz
- SFTP al VPS, descomprime en /var/www/sanatorio/api/uploads/doctors/
- Sube y corre el SQL upsert.sql

Las credenciales salen del entorno o de `.env.deploy` (ver
`.env.deploy.example`), nunca del código. El destino se puede cambiar con
SANATORIO_UPLOADS_DIR.
"""
import io
import os
import sys
import tarfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "deploy"))
from ssh_utils import connect  # noqa: E402

LOCAL_DIR = Path(__file__).resolve().parent.parent / "assets-extracted" / "doctors-optimized"
REMOTE_TGZ = "/tmp/doctors-photos.tar.gz"
REMOTE_SQL = "/tmp/doctors-upsert.sql"
APP_DIR = os.environ.get("SANATORIO_APP_DIR", "/var/www/sanatorio")
TARGET_DIR = os.environ.get("SANATORIO_UPLOADS_DIR", f"{APP_DIR}/api/uploads/doctors")

def main():
    if not LOCAL_DIR.exists():
        raise SystemExit(f"No existe {LOCAL_DIR}")

    print(f">>> empaquetando {LOCAL_DIR}")
    buf = io.BytesIO()
    photo_count = 0
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for jpg in LOCAL_DIR.glob("*.jpg"):
            tar.add(jpg, arcname=jpg.name)
            photo_count += 1
    buf.seek(0)
    size_mb = len(buf.getvalue()) / 1024 / 1024
    print(f">>> {photo_count} fotos en {size_mb:.1f} MB (tar.gz)")

    sql_path = LOCAL_DIR / "upsert.sql"
    if not sql_path.exists():
        raise SystemExit(f"No existe {sql_path}")

    c = connect()

    sftp = c.open_sftp()
    print(">>> subiendo tar.gz")
    with sftp.open(REMOTE_TGZ, "wb") as fp:
        fp.write(buf.getvalue())
    print(">>> subiendo SQL")
    sftp.put(str(sql_path), REMOTE_SQL)
    sftp.close()

    print(f">>> ejecutando despliegue remoto")
    cmds = f"""set -e
mkdir -p {TARGET_DIR}
tar -xzf {REMOTE_TGZ} -C {TARGET_DIR}
chown -R www-data:www-data {TARGET_DIR}
chmod 644 {TARGET_DIR}/*.jpg
ls {TARGET_DIR} | wc -l
echo '--- corriendo SQL upsert'
DB_PASS=$(grep '^DB_PASS=' {APP_DIR}/api/.env | cut -d= -f2-)
mysql -usanatorio -p"$DB_PASS" --default-character-set=utf8mb4 sanatorio < {REMOTE_SQL} 2>&1 | grep -v 'Using a password'
echo '--- doctor count post-upsert'
mysql -usanatorio -p"$DB_PASS" sanatorio -se 'SELECT COUNT(*) FROM doctors; SELECT COUNT(*) FROM specialties; SELECT COUNT(*) FROM doctor_specialty;' 2>&1 | grep -v 'Using a password'
rm -f {REMOTE_TGZ} {REMOTE_SQL}
"""
    chan = c.get_transport().open_session()
    chan.get_pty()
    chan.exec_command(cmds)
    out = b""
    while True:
        if chan.recv_ready():
            out += chan.recv(8192)
        if chan.exit_status_ready() and not chan.recv_ready():
            break
    rc = chan.recv_exit_status()
    print(out.decode("utf-8", errors="replace"))
    c.close()
    raise SystemExit(rc)

if __name__ == "__main__":
    main()
