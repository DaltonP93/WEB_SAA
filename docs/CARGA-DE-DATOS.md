# Carga de datos reales — guía operativa

Guía paso a paso para cargar desde el panel los datos que el sanatorio todavía
no confirmó. **Está escrita para quien administra el sitio, no para quien lo
programa**: cada dato dice en qué pantalla se carga, qué formato acepta, qué se
ve mientras está vacío y cómo comprobar que quedó publicado.

> ## Regla que no se negocia
>
> **No se inventa ningún dato.** Ni un número "provisorio", ni un horario
> "aproximado", ni el alcance "probable" de un estudio. Este es el sitio de un
> sanatorio: un teléfono equivocado en Emergencias o un horario que no se cumple
> tienen consecuencias sobre personas, no sobre una métrica.
>
> El sitio está construido para tolerar el vacío: cada dato sin cargar muestra un
> texto de "a confirmar" y **no genera enlace**. Un campo vacío es un estado
> correcto y previsto. Un campo con un dato falso, no.
>
> Si un dato no llegó confirmado por escrito del sanatorio, **se deja vacío**.

---

## Antes de empezar

| | |
|---|---|
| **Panel** | `https://<dominio>/admin` |
| **Credenciales** | Las del usuario administrador. No están en este repositorio (ver `README.md`). |
| **Endpoints públicos para verificar** | `/api/public/contact-channels` y `/api/public/schedules` |

Después de guardar, el sitio público toma el cambio **al refrescar la página**:
no hace falta ningún build ni deploy. Si no se ve, refrescá con `Ctrl+Shift+R`
(el navegador puede tener la respuesta anterior en caché).

### Cómo verificar cualquier canal por el endpoint

```bash
curl -s https://<dominio>/api/public/contact-channels | python3 -m json.tool
```

Cada canal aparece con su `key`, su `kind` y su `value`. Hay que distinguir tres
estados, porque **no significan lo mismo**:

| Estado del canal | Endpoint público | Qué ve el visitante |
|---|---|---|
| **Activo y con valor** | Aparece con su `value` | El dato, con su enlace |
| **Activo y vacío** | Aparece con `value` vacío | *"A confirmar"*, sin enlace |
| **Inactivo** | **No aparece** | Nada: el canal no se publica |
| **Ausente** (fila borrada) | **No aparece** | Nada, y el sitio queda buscando una clave que ya no existe |

O sea: *"A confirmar"* es lo que muestra un canal **activo y vacío**. Un canal
inactivo o ausente sencillamente no se publica — no deja ese texto ni ningún
otro rastro. Por eso los ocho canales institucionales vienen activos de fábrica:
para que su ausencia de dato sea visible como "a confirmar" en vez de
desaparecer en silencio.

El endpoint `/api/public/schedules` funciona igual, con una condición más: sólo
devuelve las filas **activas y con horario cargado**.

---

## 1 · Canales de contacto

Los ocho se cargan en la **misma pantalla**:

> **Panel → Contenido → Canales de contacto** (`/admin/contact-channels`)

Las filas ya existen con su etiqueta y su tipo: **no hay que crearlas**, sólo
completar el campo de valor de cada una y guardar.

> **Estos ocho canales están protegidos.** No tienen botón *Eliminar*, y su
> clave y su tipo aparecen bloqueados en el formulario. No es una restricción
> arbitraria: el sitio los busca por su clave —el encabezado busca
> `emergencias`, varios bloques declaran `whatsapp-estudios`— y borrarlos o
> renombrarlos no deja un hueco visible, deja el sitio buscando algo que ya no
> existe. Si querés que uno no aparezca, **desmarcá *Activo*** en vez de
> borrarlo.
>
> Todo lo demás se edita con normalidad: nombre visible, valor, descripción,
> mensaje, icono, activo y orden. Y los canales que crees vos después se pueden
> editar y borrar sin restricciones.

### Formatos aceptados, por tipo

| Tipo | Formato válido | Se rechaza |
|---|---|---|
| `whatsapp` | Número internacional, **8 a 15 dígitos**. Se admiten `+`, espacios, guiones, puntos y paréntesis: se ignoran al armar el enlace | Menos de 8 dígitos; letras |
| `phone` | Teléfono, **6 a 15 dígitos**, con o sin `+` y con los mismos separadores | Menos de 6 dígitos; letras |
| `email` | Dirección de correo con forma válida | Espacios; sin `@`; sin dominio |

La validación corre en **tres capas** —al guardar, al publicar y al dibujar el
enlace—, así que un valor mal formado no llega al sitio: simplemente no se genera
el enlace y queda *"A confirmar"*. Si guardaste y sigue diciendo "A confirmar",
revisá el formato antes que ninguna otra cosa.

### 1.1 · WhatsApp Turnos

| | |
|---|---|
| **Pantalla** | Canales de contacto → fila **"Turnos y consultas"** |
| **Clave técnica** | `whatsapp-turnos` |
| **Tipo** | `whatsapp` — 8 a 15 dígitos |
| **Para qué es** | Consultorios externos y especialidades |
| **Vacío se ve** | *"A confirmar"*, sin enlace, en el bloque de canales y en la página de Turnos |
| **Verificar (API)** | `curl -s .../api/public/contact-channels \| grep -A3 whatsapp-turnos` |
| **Verificar (sitio)** | Abrir `/turnos` y `/contacto`: el botón de WhatsApp tiene que abrir `wa.me` con el número cargado |

### 1.2 · WhatsApp Estudios

| | |
|---|---|
| **Pantalla** | Canales de contacto → fila **"Estudios y laboratorio"** |
| **Clave técnica** | `whatsapp-estudios` |
| **Tipo** | `whatsapp` — 8 a 15 dígitos |
| **Para qué es** | Imágenes, cardiológicos, laboratorio y biopsias |
| **Vacío se ve** | *"A confirmar"* en el bloque de canales de las páginas de estudios |
| **Verificar (API)** | Buscar `whatsapp-estudios` en `/api/public/contact-channels` |
| **Verificar (sitio)** | `/estudios-biopsias`, cuyo bloque *"Consultanos"* muestra este canal junto con Recepción y el correo general |

### 1.3 · WhatsApp General

| | |
|---|---|
| **Pantalla** | Canales de contacto → fila **"WhatsApp general"** |
| **Clave técnica** | `whatsapp-general` |
| **Tipo** | `whatsapp` — 8 a 15 dígitos |
| **Para qué es** | Consultas administrativas |
| **Vacío se ve** | *"A confirmar"* en el bloque de canales |
| **Verificar (API)** | Buscar `whatsapp-general` |
| **Verificar (sitio)** | `/contacto` |

### 1.4 · WhatsApp SAMAP

| | |
|---|---|
| **Pantalla** | Canales de contacto → fila **"SAMAP y convenios"** |
| **Clave técnica** | `whatsapp-samap` |
| **Tipo** | `whatsapp` — 8 a 15 dígitos |
| **Para qué es** | Planes, coberturas y facturación |
| **Vacío se ve** | *"A confirmar"* en el bloque de canales |
| **Verificar (API)** | Buscar `whatsapp-samap` |
| **Verificar (sitio)** | `/convenios`, cuyo bloque *"Consultá por tu cobertura"* muestra este canal junto con Recepción |

### 1.5 · Teléfono de Emergencias

> **El más sensible de todos.** Es el número que una persona va a marcar en una
> urgencia. No se carga sin confirmación escrita, y conviene llamarlo una vez
> después de cargarlo.

| | |
|---|---|
| **Pantalla** | Canales de contacto → fila **"Emergencias"** |
| **Clave técnica** | `emergencias` |
| **Tipo** | `phone` — 6 a 15 dígitos |
| **Vacío se ve** | El botón rojo de Emergencias sigue apareciendo en el encabezado y el pie, pero **lleva a la página `/emergencias` en vez de marcar**, y no muestra número |
| **Verificar (API)** | Buscar `emergencias` en `/api/public/contact-channels` |
| **Verificar (sitio)** | En cualquier página: el botón rojo del encabezado tiene que mostrar el número y abrir `tel:`. También aparece en el pie y en el `telephone` de los datos estructurados de la home |

Es además el único canal que puede usar el color rojo. El rojo está reservado a
Emergencias en todo el sitio y esa regla está verificada por pruebas: no se
cambia desde el panel.

### 1.6 · Correo de GTH

| | |
|---|---|
| **Pantalla** | Canales de contacto → fila **"Trabajá con nosotros (GTH)"** |
| **Clave técnica** | `gth` |
| **Tipo** | `email` |
| **Para qué es** | Recepción de currículums |
| **Vacío se ve** | *"A confirmar"*, sin enlace `mailto:` |
| **Verificar (API)** | Buscar `gth` |
| **Verificar (sitio)** | La página de "Trabajá con nosotros". En el pie **se muestra por separado**: la lista de canales del pie excluye `gth` y `emergencias` por sus claves, y cada uno se dibuja en su propio lugar — Emergencias como botón destacado y GTH en su sección, para que un correo de recursos humanos no se lea como un canal de atención asistencial |

### 1.7 · Recepción

| | |
|---|---|
| **Pantalla** | Canales de contacto → fila **"Recepción"** |
| **Clave técnica** | `recepcion` |
| **Tipo** | `phone` — 6 a 15 dígitos |
| **Para qué es** | Atención administrativa |
| **Vacío se ve** | *"A confirmar"*, sin enlace `tel:` |
| **Verificar (API)** | Buscar `recepcion` |
| **Verificar (sitio)** | `/contacto` y el pie. Si Emergencias está vacío, este número es el que usan los datos estructurados de la home |

### 1.8 · Correo general

| | |
|---|---|
| **Pantalla** | Canales de contacto → fila **"Correo general"** |
| **Clave técnica** | `email-general` |
| **Tipo** | `email` |
| **Vacío se ve** | *"A confirmar"*, sin enlace `mailto:` |
| **Verificar (API)** | Buscar `email-general` |
| **Verificar (sitio)** | `/contacto` y el pie |

---

## 2 · Horarios

> **Panel → Contenido → Horarios** (`/admin/schedules`)

A diferencia de los canales, acá **sí se crean filas**: una por área o tipo de
atención.

> **Esta tabla no trae ejemplos de días ni de horarios a propósito.** Un ejemplo
> de horario en una guía de carga es exactamente lo que termina copiado al panel
> y publicado como si fuera real. Los valores salen de lo que el sanatorio
> confirme por escrito, y de ningún otro lado.

| Campo | Qué va | Ejemplo de formato |
|---|---|---|
| **Área** | El nombre del área tal como debe leerse | — |
| **Días** | Texto libre, exactamente como lo confirmó el sanatorio | — |
| **Horario** | Texto libre, exactamente como lo confirmó el sanatorio | — |
| **Nota** | Aclaración opcional | — |
| **Servicio** | Slug opcional del servicio, para enlazar desde su página | `estudios-laboratorio` |
| **Activo** | **Arranca apagado**. Una fila sólo se publica cuando se marca activa | — |
| **Orden** | Número; define el orden de aparición | — |

**Vacío se ve:** mientras no haya **ninguna fila activa**, el bloque de horarios
muestra *"Horarios en proceso de confirmación"*. No hay horarios de ejemplo en
ninguna parte del sitio: si aparece uno, es porque alguien lo cargó.

**Verificar (API):** `curl -s https://<dominio>/api/public/schedules` — sólo
devuelve las filas activas.

**Verificar (sitio):** la página `/horarios`, y cualquier página que tenga el
bloque de horarios.

> El campo **Activo** es la red de seguridad: permite cargar un horario a medias,
> revisarlo con el sanatorio y recién después publicarlo. Usalo. Cargar y activar
> en el mismo paso es la forma más fácil de publicar algo sin confirmar.

---

## 3 · Alcance definitivo de Biopsias

Este no es un campo: es **contenido de una página**.

| | |
|---|---|
| **Pantalla** | Panel → Contenido → **Páginas** (`/admin/pages`) → *Biopsias* → editar bloques |
| **Clave técnica** | Página con slug `estudios-biopsias`, bloque de tipo `richText` |
| **URL pública** | `/estudios-biopsias` |
| **Formato** | Texto con formato desde el editor. Sin HTML pegado de otro lado |
| **Vacío se ve** | Hoy la página tiene un texto genérico y una nota en cursiva que avisa que el alcance, los requisitos, la preparación y los plazos **se publican una vez confirmados** |

**Qué hay que confirmar antes de escribirlo**: alcance real del servicio, qué
estudios incluye, requisitos previos, preparación del paciente y plazos de
entrega de resultados.

**Al reemplazar el texto, borrá también la nota en cursiva de "a confirmar".** Si
queda, el sitio dice al mismo tiempo que el alcance está definido y que no lo
está.

**Verificar (API):** `curl -s https://<dominio>/api/public/pages/estudios-biopsias`
**Verificar (sitio):** abrir `/estudios-biopsias`.

---

## 4 · Cosas que no se cargan desde el panel

### 4.1 · `emergencyPhone` y `gthEmail` ya no existen en Ajustes

Hasta la migración `20260816000000` estos dos vivían en
**Ajustes → Contacto**. Ahora **no**: son campos retirados y sus valores viven en
`contact_channels`, en las filas `emergencias` y `gth` (§1.5 y §1.6).

> **Si algo intenta escribirlos, la API los rechaza con `410 Gone`** y un
> mensaje que explica dónde va el dato. El rechazo alcanza a los seis campos del
> grupo —`phones`, `email`, `whatsapp`, `hours`, `emergencyPhone` y `gthEmail`—
> y es del pedido **completo**: si el mismo envío traía además datos válidos,
> tampoco se guardan. Así no queda medio formulario aplicado.
>
> **La única forma correcta de cargar estos datos es Canales de contacto.**

> Hasta el PR #12 esto fallaba **en silencio**: la API respondía `200 {ok:true}`
> y descartaba el campo sin guardarlo. Quien lo escribía creía haber guardado y
> el dato no quedaba en ningún lado. Si tenés una integración vieja que escribe
> ahí y "venía funcionando", nunca funcionó: ahora al menos vas a ver el error.

Las **claves de settings retiradas** —`social` y `scripts`— responden **410**
por el mismo motivo. Las redes se cargan como canales de contacto; `scripts` se
retiró para no inyectar JavaScript arbitrario en el sitio.

### 4.2 · `PUBLIC_SITE_URL` no se toca desde el panel

Es una variable de entorno del servidor, en `api/.env`. Define la URL base de:

- el `canonical` de todas las páginas,
- el `sitemap.xml`,
- y el prerender de `/estudios` que se genera durante el deploy.

**Hoy apunta a la IP del VPS, no al dominio.** Cambiarla es la tarea **A-3** y
está **bloqueada** hasta que estén confirmados los tres:

1. el dominio definitivo,
2. el DNS apuntando al servidor,
3. el certificado HTTPS emitido y funcionando.

Cambiarla antes deja los `canonical` y el `sitemap.xml` apuntando a un sitio que
todavía no responde, que es peor para el posicionamiento que dejarla como está.
**Es una decisión del propietario del proyecto**, no del equipo de contenido.

### 4.3 · Analítica y marketing (Ajustes → Analítica y marketing)

Se cargan **identificadores**, no código. En **Ajustes → Analítica y marketing**
hay tres campos:

| Campo | Qué pegar | De dónde sale |
|---|---|---|
| Google Analytics 4 | `G-XXXXXXXXXX` | Admin de GA4 → Flujo de datos |
| Google Tag Manager | `GTM-XXXXXXX` | Contenedor de GTM |
| Meta (Facebook) Pixel | sólo números | Administrador de eventos de Meta |

Lo que quede vacío se ignora. El panel valida el formato: si pegás otra cosa
—por ejemplo el bloque `<script>` que te da Google en vez del ID—, lo rechaza.

**Dos cosas tienen que pasar para que mida de verdad:**

1. **Consentimiento del visitante.** La medición no carga hasta que la persona
   acepta el aviso de cookies. Si nadie configuró ningún ID, el aviso ni
   aparece.
2. **La CSP ya está abierta para estos hosts.** El sitio bloquea por seguridad
   los scripts de otros dominios, pero los de Google (GA4/GTM) y Meta Pixel ya
   están declarados en la `Content-Security-Policy` —tanto en la de Nginx
   (`scripts/deploy/setup-vps.sh`) como en la `<meta>` de `apps/web/index.html`—.
   No hay que tocar nada más: alcanza con cargar el ID y que el visitante
   acepte. (Esos hosts no cargan nada por sí mismos: sin un ID configurado no
   hay ningún script que los use.) Un despliegue nuevo toma esa CSP
   automáticamente.

**De dónde vino cada turno o mensaje.** Cuando alguien llega desde una campaña
con parámetros `utm_*` en la URL, esos datos se guardan y aparecen en la columna
*Origen* de la bandeja de Turnos y en el CSV que se exporta. No hace falta
configurar nada: funciona siempre, y no es rastreo —es dato que viaja sólo si la
persona envía el formulario, y sólo al sanatorio—.

---

## 5 · Lista de control

Para revisar de un vistazo qué falta:

- [ ] `whatsapp-turnos` — WhatsApp Turnos
- [ ] `whatsapp-estudios` — WhatsApp Estudios
- [ ] `whatsapp-general` — WhatsApp General
- [ ] `whatsapp-samap` — WhatsApp SAMAP
- [ ] `emergencias` — teléfono de Emergencias **(prioridad)**
- [ ] `gth` — correo de GTH
- [ ] `recepcion` — teléfono de Recepción
- [ ] `email-general` — correo general
- [ ] Horarios — al menos un área activa
- [ ] Biopsias — alcance definitivo y nota de "a confirmar" retirada

Ninguno de estos ítems bloquea a los demás: se pueden cargar en cualquier orden,
a medida que el sanatorio los confirme.
