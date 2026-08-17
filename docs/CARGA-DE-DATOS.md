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

Cada canal aparece con su `key`, su `kind` y su `value`. **Un canal sin cargar
puede venir con `value` vacío o directamente no venir**: las dos cosas
significan lo mismo para el sitio, que lo muestra como *"A confirmar"*.

---

## 1 · Canales de contacto

Los ocho se cargan en la **misma pantalla**:

> **Panel → Contenido → Canales de contacto** (`/admin/contact-channels`)

Las filas ya existen con su etiqueta y su tipo: **no hay que crearlas**, sólo
completar el campo de valor de cada una y guardar. El tipo (`kind`) define qué
formato se acepta y no se cambia.

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
| **Pantalla** | Canales de contacto → fila **"Emergencias 24hs"** |
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
| **Verificar (sitio)** | La página de "Trabajá con nosotros". No aparece en el pie junto a los demás canales: está excluido a propósito para que no se confunda con contacto asistencial |

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

| Campo | Qué va | Ejemplo de formato |
|---|---|---|
| **Área** | El nombre del área tal como debe leerse | *Consultorios externos*, *Laboratorio* |
| **Días** | Texto libre, en el idioma del sitio | *Lunes a viernes*, *Sábados*, *Todos los días* |
| **Horario** | Texto libre | *07:00 a 19:00*, *24 horas* |
| **Nota** | Aclaración opcional | *Con turno previo* |
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

> ⚠️ **Cuidado con esto, porque falla en silencio.** Si un panel viejo, un script
> o una integración manda `contact.emergencyPhone` o `contact.gthEmail`, la API
> responde **`200 {ok:true}`** y **descarta el campo sin guardarlo**. No devuelve
> error. Quien lo escriba va a creer que guardó y el dato no va a estar en ningún
> lado.
>
> Lo mismo pasa con los otros campos retirados del mismo grupo: `phones`,
> `email`, `whatsapp` y `hours`.
>
> **La única forma correcta de cargar estos datos es Canales de contacto.**

Distinto es el caso de las **claves de settings retiradas** —`social` y
`scripts`—: esas sí responden **410 Gone** con un mensaje que explica el motivo.
Las redes se cargan como canales de contacto; `scripts` se retiró para no
inyectar JavaScript arbitrario en el sitio.

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
