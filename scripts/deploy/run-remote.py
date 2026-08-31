"""
Corre un comando en el VPS por SSH, streameando la salida.

Uso:
    python scripts/deploy/run-remote.py "bash /var/www/sanatorio/scripts/deploy/update-vps.sh"

Sin argumento corre el update estándar. Las credenciales salen del entorno o de
`.env.deploy` (ver `.env.deploy.example` y `scripts/deploy/ssh_utils.py`) —
nunca de la línea de comandos, para que no queden en `ps` ni en el historial.
"""

import sys
import time

from ssh_utils import connect

DEFAULT_CMD = "bash /var/www/sanatorio/scripts/deploy/update-vps.sh"

cmd = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CMD

client = connect()
print(">>> conectado, ejecutando comando", flush=True)
print(f">>> $ {cmd}", flush=True)
print("=" * 70, flush=True)

transport = client.get_transport()
chan = transport.open_session()
chan.get_pty()
chan.exec_command(cmd)

start = time.time()
timed_out = False
while True:
    if chan.recv_ready():
        data = chan.recv(8192)
        if data:
            sys.stdout.buffer.write(data)
            sys.stdout.flush()
    if chan.recv_stderr_ready():
        data = chan.recv_stderr(8192)
        if data:
            sys.stderr.buffer.write(data)
            sys.stderr.flush()
    if chan.exit_status_ready() and not chan.recv_ready() and not chan.recv_stderr_ready():
        break
    if time.time() - start > 1500:  # 25min hard timeout
        timed_out = True
        print(
            "\n>>> timeout local de 25min. El comando remoto puede seguir "
            "ejecutándose; verificá su estado antes de reintentar.",
            file=sys.stderr,
            flush=True,
        )
        break
    time.sleep(0.15)

if timed_out:
    # No llamar recv_exit_status(): si el remoto sigue vivo, bloquearía para
    # siempre y convertiría el timeout en una espera sin límite.
    chan.close()
    client.close()
    sys.exit(124)

exit_code = chan.recv_exit_status()
print("=" * 70, flush=True)
print(f">>> exit code: {exit_code}", flush=True)
client.close()
sys.exit(exit_code)
