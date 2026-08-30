# WEB_SAA — Estado completo posterior al merge y pendientes

**Repositorio:** [DaltonP93/WEB_SAA](https://github.com/DaltonP93/WEB_SAA)  
**Fecha de verificación:** 29 de agosto de 2026  
**Rama verificada:** `main`  
**HEAD de `main`:** `94e2e0ee4fc9c762d54c9d0f10bad3d6ff7cd19a`  
**Último cambio fusionado:** [PR #24](https://github.com/DaltonP93/WEB_SAA/pull/24) (sólo documentación: este archivo), sobre [PR #23](https://github.com/DaltonP93/WEB_SAA/pull/23), cuyo HEAD era `26c70abde2b26aa5476b254766353a55f56d5948` (merge de #23 en `main`: `f398fed11e9030fa7955e7f6bd8d3426739bfe28`)

> **Documento canónico y vivo.** Este archivo debe actualizarse en toda ronda
> que cambie funcionalidades, migraciones, seguridad, despliegue, conteo de
> pruebas o pendientes. La actualización debe incluirse en el mismo PR del
> cambio; después del merge se confirma el SHA de `main` y el CI post-merge.

---

## 1. Resumen ejecutivo

El sitio público, el panel administrativo tipo CMS, el Page Builder, la biblioteca multimedia, los turnos, mensajes, usuarios, SEO, analítica, atribución, redirects, publicación programada, papelera, revisiones y newsletter básica ya están desarrollados y fusionados en `main`.

El CI posterior al merge terminó correctamente sobre `f398fed`:

- **Typecheck, builds y pruebas:** correcto.
- **1497 pruebas en 82 archivos**, ejecutadas contra MySQL 8: correctas.
- **Prerender SEO real** con API y base activas: correcto.
- **Auditoría de dependencias:** sin vulnerabilidades altas o críticas de producción.
- **Árbol Git actual:** sin secretos detectados.

Sin embargo, el proyecto todavía está en **NO-GO para producción** por un secreto presente en el historial Git y por tareas de configuración, contenido y puesta en marcha que dependen del propietario y del sanatorio.

> El merge no produjo un despliegue. El workflow del repositorio valida código, pero no ejecuta SSH, rsync, migraciones ni reinicios sobre el VPS.

---

## 2. Estado confirmado del último merge

| Comprobación | Resultado |
|---|---|
| PR #23 (código) | Fusionado el 28/08/2026 · merge commit `f398fed11e9030fa7955e7f6bd8d3426739bfe28` |
| PR #24 (docs: este archivo) | Fusionado el 29/08/2026 · merge commit `94e2e0ee4fc9c762d54c9d0f10bad3d6ff7cd19a` |
| `main` actual | `94e2e0ee4fc9c762d54c9d0f10bad3d6ff7cd19a` |
| CI posterior al merge (`f398fed`, run #61) | **Success** |
| CI posterior al merge (`94e2e0e`, run #63) | **Success** |
| Conflictos | Ninguno |
| Reviews registradas en PR #23 / #24 | **0** |
| Deploy automático | No existe |

Los PR #23 y #24 se fusionaron sin una review registrada. Los checks automáticos estaban verdes, pero una suite verde no equivale a una revisión humana. La documentación del proyecto también registra que los PR #16, #17 y #18 se fusionaron sin review. PR #24 fue sólo documentación (este archivo): no cambió código, migraciones ni pruebas.

---

## 3. Rondas principales ya fusionadas

| PR | Trabajo principal | Estado |
|---|---|---|
| [#16](https://github.com/DaltonP93/WEB_SAA/pull/16) | Turnos: paginación por servidor, zona horaria institucional e idempotencia | Fusionado |
| [#17](https://github.com/DaltonP93/WEB_SAA/pull/17) | Multimedia: staging seguro, formato real, preservación de animación y logs sin datos personales | Fusionado |
| [#18](https://github.com/DaltonP93/WEB_SAA/pull/18) | Logos, selector multimedia, referencias y reordenamiento genérico | Fusionado |
| [#19](https://github.com/DaltonP93/WEB_SAA/pull/19) | Saneo SVG/PDF, Biopsias, usuarios y superficie administrativa | Fusionado |
| [#20](https://github.com/DaltonP93/WEB_SAA/pull/20) | Analítica, consentimiento, UTMs y CSP | Fusionado |
| [#21](https://github.com/DaltonP93/WEB_SAA/pull/21) | Reconciliación documental y verificación Search Console/Bing | Fusionado |
| [#22](https://github.com/DaltonP93/WEB_SAA/pull/22) | Redirects 301 administrables | Fusionado |
| [#23](https://github.com/DaltonP93/WEB_SAA/pull/23) | Papelera, publicación programada, revisiones, newsletter y dos rondas correctivas | Fusionado |
| [#24](https://github.com/DaltonP93/WEB_SAA/pull/24) | Documentación viva: estado ejecutivo, pendientes y go-live post PR #23 (`docs/ESTADO-PROYECTO.md`) | Fusionado |

---

## 4. Funcionalidades terminadas

### 4.1 Sitio público

- Home institucional y páginas dinámicas por slug.
- Directorio y fichas de médicos.
- Especialidades, servicios y estudios.
- Formularios públicos de turnos y contacto.
- Canales de contacto, WhatsApp, teléfonos, correos, redes y horarios.
- Mapa, video, galerías, acordeones, sliders, estadísticas, pasos, logos, CTA y contenido enriquecido.
- Redirects 301 heredados y administrables.
- Páginas 404 y manejo de rutas antiguas.
- Diseño responsive y navegación accesible.
- CSP restrictiva y apertura controlada sólo para Google/Meta cuando corresponda.

### 4.2 Panel administrativo tipo CMS

- Autenticación JWT y roles `superadmin`/`editor`.
- Gestión de páginas y bloques sin tocar código.
- Gestión de médicos, especialidades, servicios y estudios.
- Menús, marca, tema, colores, ubicación y ajustes institucionales.
- Canales de contacto y horarios con estado activo/inactivo.
- Turnos y mensajes con bandejas, filtros, paginación y exportación CSV.
- Multimedia, usuarios, datos pendientes, confirmaciones y redirects.
- Newsletter: suscriptores, búsqueda, paginación, exportación y baja/reactivación.
- Avisos de errores accionables y confirmaciones mediante diálogos del panel.

### 4.3 Page Builder

- Más de veinte tipos de bloques institucionales.
- Drag-and-drop para ordenar bloques.
- Editor visual rich-text.
- Selector multimedia reutilizable para imágenes.
- Reordenamiento genérico y accesible de ítems para cards, accordion, slider, gallery, steps, stats y logos.
- Bloque `Logos` con `alt`, enlace, activo/inactivo, dimensiones y opacidad.
- URL manual conservada para recursos externos seguros.
- Advertencia de cambios sin guardar.
- Guardado atómico de metadatos y bloques mediante `/pages/:id/content`.

### 4.4 Páginas: publicación, papelera e historial

- Estados Borrador, Publicada y Programada.
- Programación interpretada en la zona horaria `America/Asuncion` por el servidor.
- Publicar limpia `publish_at`; despublicar vuelve a borrador y también limpia la agenda.
- Las páginas programadas no aparecen en lista pública, detalle ni sitemap antes de su fecha.
- Papelera recuperable mediante `deleted_at`.
- Borrado definitivo condicional y atómico sólo desde la papelera.
- Una página en la papelera no puede seguir editándose por otro endpoint.
- Historial de hasta 30 versiones por página.
- Archivado del estado anterior antes de guardar.
- Restauración reversible con confirmación y preservación fiel de `publish_at`.

### 4.5 Multimedia y seguridad de archivos

- Staging fuera de `/uploads` y verificado al arrancar.
- Movimiento final atómico y limpieza ante éxito o error.
- Formato detectado por bytes, no por extensión o MIME declarado.
- JPEG, PNG, WebP, GIF, SVG y PDF con contratos específicos.
- Alpha, cuadros, `delay` y `loop` preservados en animaciones.
- SVG saneado antes de guardar; rechazo de XXE y construcciones evasivas.
- PDF validado, reconstruido y limpiado de acciones/JavaScript/anotaciones conocidas.
- Nombres opacos con UUID.
- Límites de peso, píxeles y descompresión.
- Metadatos efectivos: MIME, tamaño, dimensiones y cuadros.
- Un archivo referenciado por bloques, branding, SEO o médicos no se puede borrar: responde 409.
- Logs sin rutas internas, SQL, contenido subido ni datos personales.

### 4.6 Turnos, mensajes y atribución

- Paginación real del servidor.
- Búsqueda, filtros, estados, fechas y orden.
- Filas anteriores no accionables durante transiciones de consulta.
- Corrección automática de la última página tras eliminar su única fila.
- Zona horaria institucional consistente.
- Idempotencia evaluada antes del CAPTCHA.
- Exportación CSV.
- Captura first-touch de `utm_*`, `gclid` y `fbclid`.
- Atribución saneada, guardada y visible en la bandeja/CSV.
- Datos personales y SQL excluidos de logs de error.

### 4.7 Usuarios y confirmaciones institucionales

- Validaciones inválidas responden 400 en lugar de 500.
- Email duplicado responde 409.
- ID inexistente responde 404.
- `password_hash` nunca se devuelve.
- No se puede borrar ni bajar de rol al último superadmin.
- El panel muestra los errores y deshabilita acciones imposibles.
- Confirmación de Biopsias por superadmin, registrando autor, fecha y alcance.
- Posibilidad de retirar la confirmación si cambia el servicio.
- La confirmación no se deduce automáticamente del texto de la página.

### 4.8 SEO y marketing básico

- Título y descripción por página.
- Open Graph y Twitter Cards.
- Canonical, `sitemap.xml` y `robots.txt` dinámicos.
- JSON-LD para contenido estructurado.
- Prerender real de `/estudios` durante build/CI.
- Tokens validados para Google Search Console y Bing.
- Google Analytics 4, Google Tag Manager y Meta Pixel configurables por ID.
- Consentimiento previo a cargar medición de terceros.
- CSP coherente en Nginx y en el HTML.
- Atribución de campañas propia mediante UTMs.

### 4.9 Newsletter básica

- Bloque de suscripción colocable desde el Page Builder.
- Honeypot y rate-limit.
- Idempotencia por correo.
- Evidencia de consentimiento: finalidad, versión y fecha del servidor.
- Token opaco de baja preparado y no expuesto en panel, CSV ni logs.
- `unsubscribed_at` al dar de baja y limpieza al reactivar.
- Panel con búsqueda, paginación y estados.
- CSV protegido contra inyección de fórmulas.
- Estados de carga, error y reintento.

> La newsletter registra suscriptores, pero todavía no envía campañas: no se integró Mailchimp, Brevo u otro proveedor.

### 4.10 Despliegue y operación

- `setup-vps.sh` para instalación inicial.
- `update-vps.sh` con instalación reproducible, backup previo, migraciones, builds, reinicios y health check.
- `rollback-vps.sh` con prevalidación, rollback de base antes de bajar código y recuperación automática.
- Protección contra volver migraciones después de reseed sin usar el dump correcto.
- Backups rotativos de base y recomendación de backup externo de uploads.
- `/api/health` diferencia API y base sin exponer credenciales.
- `/admin` permanece bloqueado hasta existir HTTPS válido.
- CI en cada PR y push a `main`.

---

## 5. Validación actual de `main`

El workflow posterior al merge terminó en **success** tanto sobre `f398fed` (PR #23, código; run #61) como sobre el `main` actual `94e2e0e` (PR #24, sólo documentación; run #63). Las cifras de código y pruebas de abajo corresponden a `f398fed` y siguen vigentes en `94e2e0e`, porque PR #24 no tocó código ni pruebas.

| Check | Resultado |
|---|---|
| Typecheck API/web/admin | OK |
| Build API | OK |
| Build web | OK |
| Build admin | OK |
| Suite MySQL 8 | **1497/1497 en 82 archivos** |
| Migraciones | Incluidas en la suite |
| Prerender con API y base reales | OK |
| Auditoría high/critical de producción | OK |
| `check-secrets` del árbol | OK |
| `gitleaks` del árbol actual | Sin hallazgos |
| `gitleaks` del historial | **1 hallazgo conocido** |

---

## 6. Pendientes obligatorios antes de producción

### 6.1 Resolver el secreto histórico — bloqueo NO-GO

El historial contiene un valor detectado por `gitleaks`:

- Commit: `9ced09df45fcaeb63f9e10be9219401faab6434d`
- Archivo: `scripts/deploy/setup-vps.sh`
- Regla: `shell-default-credential`

El árbol actual está limpio, pero el secreto sigue recuperable desde el historial. Antes del deploy se debe:

1. Confirmar dónde se utilizó esa credencial.
2. Rotarla en todos los entornos donde pudiera seguir vigente.
3. Decidir si se reescribirá el historial con `git filter-repo`.
4. Si se purga, coordinar el force-push y la resincronización de todos los clones.
5. Volver a ejecutar `gitleaks` sobre el historial completo.

Mientras no se resuelva, el estado recomendado es **NO-GO para producción**.

### 6.2 Dominio, DNS y HTTPS

- Confirmar el dominio definitivo.
- Apuntar los registros DNS al VPS.
- Emitir el certificado con Certbot.
- Verificar redirección HTTP → HTTPS.
- Verificar que `/admin` sólo quede accesible por HTTPS.

### 6.3 Variables de producción

Configurar en `api/.env`:

- `NODE_ENV=production`
- Base MySQL de producción y contraseña segura.
- `JWT_SECRET` aleatorio de al menos 32 caracteres.
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME` y `SEED_ADMIN_PASSWORD` para la primera instalación.
- `CORS_ORIGINS=https://<dominio>`
- `PUBLIC_BASE_URL=https://<dominio>`
- `PUBLIC_SITE_URL=https://<dominio>`
- `UPLOAD_DIR` y staging en el mismo filesystem y fuera del directorio servido.

`PUBLIC_SITE_URL` debe cambiarse sólo cuando dominio, DNS y HTTPS estén realmente funcionando, porque alimenta canonical, sitemap y prerender.

### 6.4 Servidor y acceso de despliegue

- VPS Ubuntu preparado y acceso SSH mediante llave.
- `.env.deploy` fuera de Git y con permisos 600.
- Huella del servidor conocida/verificada.
- MySQL, Node 20, pnpm 9, Nginx, PM2 y Certbot.
- Espacio suficiente para build, uploads, worktree de prevalidación y backups.
- Almacenamiento externo para backup de uploads.

### 6.5 Contenido institucional real

El sanatorio debe confirmar y cargar:

- Logo y branding definitivos.
- WhatsApp Turnos.
- WhatsApp Estudios.
- WhatsApp General.
- WhatsApp SAMAP.
- Teléfono de Emergencias.
- Correo de Gestión del Talento Humano.
- Teléfono de Recepción.
- Correo general.
- Horarios de atención; activar sólo los confirmados.
- Médicos, especialidades, servicios y estudios definitivos.
- Alcance, preparación, requisitos y plazos de Biopsias.
- Confirmación formal de Biopsias por un superadmin.

### 6.6 Credenciales y servicios opcionales recomendados

- Turnstile o reCAPTCHA: proveedor, site key y secret key.
- GA4, GTM o Meta Pixel, si se usará medición.
- Tokens de Search Console/Bing.
- Cuentas reales de usuarios del panel.
- Cambiar la contraseña del administrador sembrado y borrar `.deploy-credentials` tras leerla.

---

## 7. Pendientes de desarrollo o decisión de producto

Estos ítems no bloquean el funcionamiento básico del sitio, pero todavía no están desarrollados completamente:

| Pendiente | Qué debe definirse o construirse |
|---|---|
| Noticias/Blog | Decidir si se reactiva; fue retirado por decisión de producto |
| Roles granulares | Definir permisos por módulo además de `superadmin`/`editor` |
| Multi-idioma | Definir idiomas, traducción de bloques, slugs y SEO por idioma |
| Buscador público | Definir qué entidades y contenido se indexarán |
| Constructor de formularios | Definir tipos de campo, validaciones, destinos y consentimiento |
| Proveedor de newsletter | Integrar Brevo, Mailchimp u otro; plantillas, remitente, listas y enlace real de baja |
| Campañas Meta/Google/Instagram | Crear cuentas de negocio/apps, OAuth, client IDs/secrets y definir operaciones permitidas |
| CRM/automatización de leads | Decidir si turnos, mensajes y newsletter se sincronizan con un CRM |

---

## 8. Secuencia recomendada para el go-live

1. **Resolver el secreto histórico** y verificar credenciales rotadas.
2. Confirmar dominio, VPS y estrategia de DNS.
3. Preparar `.env.deploy` y validar acceso SSH.
4. Aprovisionar el servidor con `setup-vps.sh`.
5. Emitir HTTPS y comprobar que `/admin` se habilita solamente bajo TLS.
6. Configurar `PUBLIC_SITE_URL`, `PUBLIC_BASE_URL` y `CORS_ORIGINS` al dominio real.
7. Ejecutar migraciones y seed únicamente si la base es una instalación nueva.
8. Cambiar la contraseña inicial y crear usuarios reales.
9. Cargar contenido institucional y registrar la confirmación de Biopsias.
10. Activar CAPTCHA y analítica sólo con claves reales.
11. Ejecutar la batería post-deploy de la sección siguiente.
12. Aprobar GO sólo si salud, contenido, formularios, backups y rollback están comprobados.

---

## 9. Pruebas obligatorias después del despliegue

### Infraestructura

- [ ] `https://<dominio>/` carga correctamente.
- [ ] `https://<dominio>/admin/` muestra el login.
- [ ] HTTP redirige a HTTPS.
- [ ] `https://<dominio>/api/health` devuelve 200 y `{ok:true}`.
- [ ] PM2 muestra `sanatorio-api` online y con el `cwd` correcto.
- [ ] Nginx valida con `nginx -t`.
- [ ] Backup de base generado y comprobado con `gzip -t`.
- [ ] Backup externo de uploads configurado.

### Sitio y panel

- [ ] Login de superadmin y editor.
- [ ] Crear, editar, programar, despublicar y restaurar una página de prueba.
- [ ] Mover una página a papelera, recuperarla y comprobar que no aparece públicamente mientras está borrada.
- [ ] Restaurar una revisión y comprobar que el estado anterior queda recuperable.
- [ ] Subir PNG, SVG y PDF seguros; verificar dimensiones, saneo y descarga.
- [ ] Intentar borrar un medio referenciado y confirmar respuesta 409.
- [ ] Verificar médicos, especialidades, servicios, estudios, menús, horarios y canales.

### Formularios y marketing

- [ ] Enviar un turno y verlo en la bandeja.
- [ ] Confirmar/cancelar un turno y comprobar mensajes/estados.
- [ ] Enviar formulario de contacto.
- [ ] Probar CAPTCHA real y rate-limit.
- [ ] Llegar con UTMs y comprobar atribución en panel/CSV.
- [ ] Aceptar y rechazar consentimiento; verificar que GA/GTM/Meta sólo cargan al aceptar.
- [ ] Suscribirse a newsletter, dar de baja y reactivar.

### SEO

- [ ] Canonical usa el dominio definitivo.
- [ ] `sitemap.xml` usa el dominio definitivo y no incluye borradores, papelera ni páginas aún programadas.
- [ ] `robots.txt` responde correctamente.
- [ ] `/estudios` entrega el HTML prerenderizado esperado.
- [ ] Search Console/Bing reconocen los tokens configurados.
- [ ] JSON-LD pasa una validación estructurada.

### Recuperación

- [ ] Registrar el SHA anterior al deploy.
- [ ] Confirmar la ruta del dump previo.
- [ ] Ejecutar una prueba de rollback en staging.
- [ ] Verificar que API, web, admin y base vuelven juntos al estado anterior.

---

## 10. Decisiones requeridas del propietario

| Decisión | Prioridad |
|---|---|
| Rotar y purgar el secreto de `9ced09d` | **Bloqueante** |
| Confirmar dominio definitivo | **Bloqueante** |
| Confirmar VPS y acceso SSH | **Bloqueante** |
| Aprobar contenido definitivo y Biopsias | Alta |
| Crear claves CAPTCHA | Alta |
| Definir IDs de analítica | Media |
| Elegir proveedor de newsletter | Media |
| Decidir Blog/Noticias | Media |
| Definir roles granulares, idiomas, buscador y formularios | Planificación futura |
| Crear cuentas de negocio/OAuth para campañas | Fase de marketing posterior |

---

## 11. Veredicto actual

### Desarrollo y CI

**GO.** El código fusionado en `main` compila, construye y supera la suite completa contra MySQL 8.

### Despliegue inmediato a producción

**NO-GO.** Primero deben resolverse el secreto histórico, dominio/DNS/HTTPS, variables del entorno, acceso al VPS, backups y contenido real.

### Próxima acción concreta

La siguiente etapa no es otra ronda amplia de desarrollo. Es una ronda controlada de **preproducción y go-live**:

1. cerrar el secreto histórico;
2. preparar dominio/VPS/entorno;
3. desplegar en staging o en una ventana controlada;
4. ejecutar todas las pruebas post-deploy;
5. aprobar o revertir según resultados.

---

## 12. Fuentes verificadas

- `main` y merges de los PR #23 y #24 en GitHub.
- CI post-merge sobre `f398fed11e9030fa7955e7f6bd8d3426739bfe28` (PR #23, run #61) y sobre `94e2e0ee4fc9c762d54c9d0f10bad3d6ff7cd19a` (PR #24, run #63): ambos **success**.
- `CLAUDE_CONTEXT.md`, secciones 14–18.8.
- `AGENTS.md`.
- `README.md`.
- `docs/DEPLOY.md`.
- `docs/CARGA-DE-DATOS.md`.
- `.github/workflows/ci.yml`.
- `api/.env.example` y `.env.deploy.example`.

---

## 13. Regla de mantenimiento para próximas rondas

En cada trabajo sustancial se debe actualizar este documento antes de cerrar el
PR. Como mínimo:

1. registrar el PR y su alcance en la tabla de rondas;
2. mover a “terminado” lo que realmente quedó implementado;
3. agregar los nuevos pendientes o decisiones del propietario;
4. actualizar el conteo real de pruebas y los checks ejecutados;
5. mantener explícitos los bloqueos de producción y seguridad;
6. al comenzar el siguiente PR sustantivo, registrar el PR anterior
   fusionado, sustituir el HEAD de `main` y registrar su CI post-merge.

### Cierre post-merge sin ciclos documentales

No se abrirá un PR exclusivamente para registrar el merge de otro PR
exclusivamente documental.

Después de fusionar un PR documental, el nuevo HEAD de `main`, su CI y ese PR
se registrarán al comienzo del siguiente PR sustantivo.

Todo PR que cambie código, contratos, migraciones, seguridad, despliegue,
pruebas o funcionalidades debe actualizar `docs/ESTADO-PROYECTO.md`
dentro del mismo PR.

Un PR sustantivo es aquel que modifica código, configuración, migraciones,
seguridad, despliegue, pruebas o funcionalidades del producto. Una corrección
puramente documental no debe generar otra corrección documental sólo para
registrar su propio merge.

`CLAUDE_CONTEXT.md` conserva el historial técnico detallado de cada ronda;
`docs/ESTADO-PROYECTO.md` es la vista ejecutiva y operativa vigente. Si ambos
se contradicen, la ronda no está documentalmente cerrada.
