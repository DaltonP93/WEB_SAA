# Preproducción, infraestructura y go-live seguro

> Auditoría pública y saneada preparada el 31/08/2026 sobre el `main`
> verificado. **No ejecuta despliegues, DNS, migraciones, rotaciones ni cambios
> en infraestructura.** Los hosts, IP, cuentas, fingerprints, capacidades
> actuales y evidencias sensibles se conservan fuera de Git.

## 1. Veredicto actual

**Desarrollo/CI: GO. Producción: NO-GO.**

Antes de producción faltan evidencias de:

1. rotación y purga coordinada de credenciales históricas;
2. protección efectiva de `main`;
3. dominio, DNS y TLS definitivos;
4. capacidad y aislamiento del servidor;
5. backup externo y restauración de base **y** archivos;
6. variables, monitoreo, CAPTCHA y contenido institucional final.

Ver el procedimiento de credenciales en
[SEGURIDAD-SECRETO-HISTORICO.md](SEGURIDAD-SECRETO-HISTORICO.md).

## 2. Alcance de la auditoría

Se revisaron scripts de bootstrap, update, rollback, entorno y SSH; guía de
deploy; workflow de CI; pruebas de migraciones/rollback/TLS/secretos; y estado
de gobierno del repositorio. No se accedió al servidor ni a credenciales.

### Cambios incluidos en esta ronda

| ID | Mejora |
|---|---|
| DEP-01 | `DEPLOY_TO` fija un SHA aprobado perteneciente a `main` |
| DEP-02 | backup obligatorio; eliminado el bypass para migrar sin respaldo |
| DEP-03 | `gzip -t` valida el dump antes de cualquier migración |
| NET-01 | UFW permite SSH/HTTP/HTTPS antes de habilitarse y no oculta errores |
| OPS-01 | timeout SSH local sale 124 sin bloquearse esperando al remoto |
| ENV-01 | `UPLOAD_STAGING_DIR` queda explícito, fuera de uploads |
| DOC-01 | dominio de ejemplos reemplazado por `sitio.example` |
| DOC-02 | variables de rutas no consumidas retiradas del ejemplo de deploy |
| SUP-01 | Actions fijadas por commit y gitleaks validado por SHA-256 antes de extraer |

### Pendientes que no resuelve el código

| Área | Pendiente |
|---|---|
| Seguridad | completar rotación y purga del historial |
| Gobierno | configurar ruleset y revisión obligatoria en `main` |
| Infraestructura | demostrar recursos, aislamiento, firewall y acceso por llave |
| DNS/TLS | confirmar dominio, apex/`www`, TTL, certificado y renovación |
| Backups | destino externo y restore ensayado de DB+uploads |
| Operación | monitoreo, alertas, logs, guardia y umbrales |

## 3. Matriz de prerrequisitos

Cada evidencia debe registrarse en el acta privada de la ventana. “Existe” sin
salida verificable no cuenta como completado.

| Área | Mínimo aceptable | Evidencia | Estado |
|---|---|---|---|
| Propiedad | cuentas, dominio y hosting bajo control institucional | responsables y recuperación | Pendiente |
| GitHub | PR, 1 aprobación, threads resueltos, 3 checks, sin force/delete | ruleset exportado | **Bloqueante** |
| Compute | Ubuntu 22/24, ≥2 vCPU, **≥4 GB RAM**, swap y ≥30 GB libres | versión, CPU, RAM y disco | **Bloqueante** |
| Red | IP estable; sólo puertos necesarios; DB no pública | firewall + prueba externa autorizada | Pendiente |
| SSH | llaves nominales, fingerprint independiente, password deshabilitado | doble sesión y config efectiva | **Bloqueante** |
| DNS | dominio final, apex/`www`, TTL y rollback definidos | consultas a autoritativos | **Bloqueante** |
| TLS | hosts cubiertos, renovación y alerta | dry-run + prueba externa | Pendiente |
| Base | MySQL 8, usuario mínimo, utf8mb4 | versión y grants saneados | Pendiente |
| Archivos | uploads persistentes; staging separado y mismo filesystem | dispositivos y permisos | Pendiente |
| Backup DB | cifrado, externo y con retención | dump, integridad y restore | **Bloqueante** |
| Backup uploads | snapshot externo coherente con el dump | restore de muestra | **Bloqueante** |
| Monitoreo | health, HTTP/TLS, disco, RAM, DB y proceso | alerta recibida | **Bloqueante** |
| Logs | rotación, acceso restringido, sin datos personales | política + muestra saneada | Pendiente |
| Formularios | CAPTCHA, rate-limit y destino real | envío de prueba | Pendiente |
| Contenido | branding, médicos, horarios, canales y aprobaciones | checklist institucional | Pendiente |
| Recuperación | rollback código+DB y restore de archivos | ensayo con RPO/RTO | **Bloqueante** |

## 4. Gobierno de GitHub

Configurar en `main`:

- pull request obligatorio;
- una revisión registrada, descartada si cambia el HEAD;
- conversaciones resueltas;
- checks requeridos:
  - `Typecheck, build y pruebas`;
  - `Detección de secretos`;
  - `Auditoría de dependencias`;
- sin bypass habitual de administradores;
- sin borrado ni force-push salvo la ventana coordinada de purga;
- secret scanning y push protection si están disponibles.
- actualizar los commits fijados de Actions y el checksum de gitleaks únicamente mediante PR revisado y CI verde.

El escaneo histórico puede ser informativo durante el incidente. Un job verde
no equivale por sí solo a historia limpia: se debe leer su resumen.

## 5. Acceso y variables

- `.env.deploy` local con permisos `0600`;
- llave cifrada y fingerprint verificado fuera de banda;
- `SANATORIO_SSH_ACCEPT_NEW=1` prohibido en producción;
- ningún secreto en el comando remoto, porque el ejecutor lo muestra;
- secretos distintos entre preproducción y producción.

Variables de producción mínimas:

| Variable | Contrato |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | aleatorio, único, ≥32 caracteres, fuera de Git |
| `DB_*` | cuenta de aplicación, no administrativa |
| `PUBLIC_SITE_URL` | origen HTTPS definitivo, nunca una IP |
| `PUBLIC_BASE_URL` | origen público vigente |
| `CORS_ORIGINS` | sólo orígenes HTTPS aprobados |
| `UPLOAD_DIR` | persistente |
| `UPLOAD_STAGING_DIR` | fuera de uploads, mismo filesystem |
| `SEED_ADMIN_PASSWORD` | sólo para seed inicial |
| `CAPTCHA_*` | reales antes de abrir formularios |

## 6. Preproducción por SHA

### 6.1 Congelar versión

1. Fusionar únicamente con revisión y CI verde.
2. Registrar `APPROVED_SHA` de `main`.
3. Registrar SHA anterior, dump, operador y ventana.
4. Confirmar que no avanzó el contenido durante el backup final.

### 6.2 Bootstrap

No ejecutar `curl | bash`. Descargar desde el SHA aprobado e inspeccionar:

```bash
APPROVED_SHA=<sha-aprobado-de-main>
curl -fsSLo /tmp/setup-vps.sh \
  "https://raw.githubusercontent.com/<organizacion>/<repositorio>/$APPROVED_SHA/scripts/deploy/setup-vps.sh"
bash -n /tmp/setup-vps.sh
less /tmp/setup-vps.sh
DEPLOY_TO="$APPROVED_SHA" DOMAIN="preprod.sitio.example" \
  bash /tmp/setup-vps.sh
```

`sitio.example` es un marcador. El setup debe abortar ante fallos de firewall,
dependencias, DB, TLS, migraciones, builds o health.

### 6.3 Update

```bash
APPROVED_SHA=<sha-aprobado-de-main>
python scripts/deploy/run-remote.py \
  "DEPLOY_TO=$APPROVED_SHA bash <ruta-app>/scripts/deploy/update-vps.sh"
```

`DEPLOY_TO` no es secreto. El script verifica pertenencia a `main`, avance y
backup legible. No existe bypass para migrar sin backup.

## 7. Verificación técnica

- `nginx -t`, proceso online y startup persistido;
- `/api/health` 200 con DB saludable;
- HTTP → HTTPS; admin nunca por texto plano;
- endpoints públicos críticos;
- canonical/sitemap/robots en dominio definitivo;
- permisos `0600` en archivos sensibles;
- uploads y staging separados en el mismo dispositivo;
- logs sin datos personales;
- renovación TLS ensayada.

## 8. Verificación funcional

Con datos sintéticos y sin pacientes reales:

- login y permisos de superadmin/editor;
- páginas: editar, programar, restaurar y papelera;
- multimedia segura e inválida; referencia 409;
- turno/contacto, CAPTCHA, rate-limit e idempotencia;
- newsletter: alta, baja, reactivación, búsqueda, página y CSV;
- UTM y consentimiento analítico;
- médicos, servicios, estudios, canales y horarios;
- sitemap excluye drafts, papelera y publicaciones futuras.

Registrar códigos HTTP, timestamps, SHA y responsable, sin información personal.

## 9. Backup y recuperación

Antes del GO:

1. dump de DB + `gzip -t`;
2. copia cifrada fuera del servidor;
3. snapshot de uploads asociado a la misma ventana;
4. restaurar DB+uploads en un entorno vacío;
5. ejecutar rollback a un SHA anterior;
6. medir RPO/RTO;
7. probar fallo de build y migración;
8. documentar autoridad de rollback y comunicación.

No usar `SKIP_DB_BACKUP`. `SKIP_PREVALIDACION=1` tampoco es aceptable en una
ventana planificada: falta de disco implica NO-GO.

## 10. Cutover y rollback

Sólo con GO firmado:

1. bajar TTL con anticipación;
2. congelar o sincronizar contenido;
3. backup final y validación;
4. desplegar el mismo SHA probado;
5. cambiar DNS y validar TLS;
6. smoke técnico/funcional;
7. observar métricas durante la ventana;
8. continuar o revertir.

Rollback inmediato ante health/DB inestable, permisos inseguros, contenido
corrupto, migración parcial, archivos inaccesibles, pérdida de formularios,
TLS/CORS/canonical incorrectos, agotamiento de recursos o backup no verificable.

## 11. Evidencia de GO

| Evidencia | Responsable | Fecha | Resultado |
|---|---|---|---|
| credenciales e historial | Seguridad/Propietario | — | Pendiente |
| ruleset de main | Propietario GitHub | — | Pendiente |
| dominio/DNS/TLS | Infraestructura | — | Pendiente |
| capacidad y aislamiento | Infraestructura | — | Pendiente |
| backup+restore DB/uploads | DBA/Infraestructura | — | Pendiente |
| deploy por SHA y rollback | Desarrollo/Infraestructura | — | Pendiente |
| smoke y pruebas funcionales | QA/Sanatorio | — | Pendiente |
| contenido y aprobaciones | Responsable institucional | — | Pendiente |
| monitoreo y guardia | Infraestructura | — | Pendiente |

Sin completar los bloqueantes, producción permanece **NO-GO**.
