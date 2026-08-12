"""
Conexión SSH para los scripts de deploy.

Las credenciales **nunca** se hardcodean ni se pasan por argumentos de línea de
comandos (los argumentos quedan visibles en `ps` y en el historial del shell):
salen del entorno o de un archivo `.env.deploy` local que está fuera de git.

Variables (ver `.env.deploy.example`):

  SANATORIO_SSH_HOST        host o IP del servidor                (obligatoria)
  SANATORIO_SSH_USER        usuario SSH                           (obligatoria)
  SANATORIO_SSH_PORT        puerto SSH                            (default 22)
  SANATORIO_SSH_KEY         ruta a la llave privada               (recomendado)
  SANATORIO_SSH_KEY_PASSPHRASE  passphrase de la llave            (opcional)
  SANATORIO_SSH_PASSWORD    contraseña, sólo si no hay llave      (desaconsejado)
  SANATORIO_SSH_KNOWN_HOSTS ruta al known_hosts                   (default ~/.ssh/known_hosts)
  SANATORIO_SSH_ACCEPT_NEW  "1" para aceptar un host desconocido la primera vez

Preferí siempre la llave SSH. La autenticación por contraseña queda soportada
sólo para no romper instalaciones viejas, y emite una advertencia.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env.deploy"


def _load_env_file() -> None:
    """Carga .env.deploy si existe (sin pisar variables ya definidas)."""
    if not ENV_FILE.exists():
        return
    for raw in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(
            f"ERROR: falta la variable de entorno {name}.\n"
            f"Copiá .env.deploy.example a .env.deploy y completalo, o exportá las variables."
        )
    return value


def connect():
    """Devuelve un paramiko.SSHClient conectado según el entorno."""
    _load_env_file()

    host = _require("SANATORIO_SSH_HOST")
    user = _require("SANATORIO_SSH_USER")
    port = int(os.environ.get("SANATORIO_SSH_PORT", "22"))
    key_path = os.environ.get("SANATORIO_SSH_KEY", "").strip()
    key_passphrase = os.environ.get("SANATORIO_SSH_KEY_PASSPHRASE") or None
    password = os.environ.get("SANATORIO_SSH_PASSWORD", "").strip()

    if not key_path and not password:
        raise SystemExit(
            "ERROR: definí SANATORIO_SSH_KEY (recomendado) o SANATORIO_SSH_PASSWORD."
        )

    client = paramiko.SSHClient()

    known_hosts = os.environ.get(
        "SANATORIO_SSH_KNOWN_HOSTS", str(Path.home() / ".ssh" / "known_hosts")
    )
    if Path(known_hosts).exists():
        client.load_host_keys(known_hosts)
    if os.environ.get("SANATORIO_SSH_ACCEPT_NEW") == "1":
        # Sólo para el primer contacto con un servidor nuevo; después la clave
        # queda en known_hosts y se vuelve a verificar en cada conexión.
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    else:
        client.set_missing_host_key_policy(paramiko.RejectPolicy())

    print(f">>> conectando a {user}@{host}:{port} ...", flush=True)
    try:
        if key_path:
            client.connect(
                hostname=host,
                port=port,
                username=user,
                key_filename=os.path.expanduser(key_path),
                passphrase=key_passphrase,
                timeout=30,
                banner_timeout=30,
                look_for_keys=False,
                allow_agent=False,
            )
        else:
            print(
                ">>> AVISO: autenticando por contraseña. Migrá a llave SSH "
                "(SANATORIO_SSH_KEY) y deshabilitá PasswordAuthentication en el servidor.",
                file=sys.stderr,
                flush=True,
            )
            client.connect(
                hostname=host,
                port=port,
                username=user,
                password=password,
                timeout=30,
                banner_timeout=30,
                look_for_keys=False,
                allow_agent=False,
            )
    except paramiko.SSHException as exc:
        # No incluimos credenciales en el mensaje de error.
        raise SystemExit(f"ERROR de conexión SSH a {user}@{host}:{port}: {exc}") from None

    return client
