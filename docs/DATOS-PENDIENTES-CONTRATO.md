# Contrato de `GET /api/admin/data-readiness`

Especificación de la pantalla **Datos pendientes** (Ola A-2). **Este documento no
describe código existente**: el endpoint todavía no está implementado. Se escribe
antes para que la implementación no tenga que inventar decisiones que ya tienen
respuesta en el proyecto —el catálogo institucional, la validación de valores,
la condición real de publicación de un horario— y para dejar por escrito qué
**no** puede devolver.

Referencia operativa complementaria: [`CARGA-DE-DATOS.md`](./CARGA-DE-DATOS.md),
que explica al administrador cómo cargar cada dato. Este archivo explica al
programador cómo se calcula si falta.

---

## 1 · Qué resuelve

Hoy saber qué falta cargar exige abrir cinco pantallas y comparar contra la guía.
El panel no lo dice en ningún lado: un canal vacío se ve igual que uno cargado
hasta que se entra a editarlo, y un horario cargado pero inactivo se ve
**exactamente igual** que uno publicado.

La pantalla A-2 responde una sola pregunta: *¿qué falta para que el sitio deje de
mostrar "a confirmar"?* — y lleva a la pantalla donde se carga cada cosa.

---

## 2 · Forma del endpoint

| | |
|---|---|
| **Método y ruta** | `GET /api/admin/data-readiness` |
| **Autenticación** | Obligatoria. Cuelga de `adminRouter`, que ya aplica `requireAuth` |
| **Efectos** | **Ninguno.** Sólo lectura: ni escribe, ni migra, ni repara |
| **Idempotencia** | Total. Dos llamadas seguidas devuelven lo mismo |
| **Caché** | Sin caché del lado del servidor. El panel lo pide con TanStack Query como cualquier otro recurso |

Es de sólo lectura por diseño, no por omisión. Un endpoint que además "arregla lo
que puede" convierte un diagnóstico en una escritura que nadie pidió, y sobre
datos institucionales eso es exactamente lo que este proyecto viene evitando.

### 2.1 · Qué no puede devolver

Esta es la parte no negociable del contrato.

**Nunca** viajan en la respuesta:

- teléfonos ni números de WhatsApp (`contact_channels.value`, `href`);
- direcciones de correo;
- horarios ni días (`schedules.hours`, `schedules.days`);
- notas de horarios (`schedules.note`) — incluida la nota de Emergencias;
- el contenido de ningún snapshot de migración (`settings.snapshot_*`).

La respuesta lleva **estados y claves**, no datos. Un panel que sirve para saber
qué falta no necesita ver lo que ya está: repetir el dato acá lo pone en un
segundo lugar —caché del navegador, logs, capturas de pantalla de soporte— sin
ninguna necesidad.

El `label` de un canal y el `area` de un horario sí viajan, porque son el nombre
de la fila y no el dato pendiente. `value`, `hours`, `days` y `note` sólo viajan
como **estado derivado** (`empty`, `complete`, …), nunca como contenido.

---

## 3 · Vocabulario de estados

### 3.1 · Estado de sección y estado global: tres valores

| Estado | Significa | Qué se hace |
|---|---|---|
| `complete` | No falta nada que cargar | Nada |
| `pending` | Falta un dato, y se carga desde el panel | Ir a la pantalla y cargarlo |
| `review` | Hay algo que **una persona tiene que decidir** | No se resuelve escribiendo un campo |

`pending` y `review` se separan a propósito. Mezclarlos daría una lista donde
"cargar el teléfono de Recepción" y "confirmar el alcance de Biopsias" pesan
igual, y no pesan igual: lo primero es un trámite, lo segundo es una afirmación
institucional que alguien tiene que autorizar por escrito.

### 3.2 · Estado por canal: seis valores

Se calculan **en este orden**; el primero que aplica gana.

| Estado | Condición | Sección |
|---|---|---|
| `missing` | No existe la fila con esa `key` | `review` |
| `wrong_kind` | Existe pero su `kind` ≠ el esperado del catálogo | `review` |
| `inactive` | `active = 0` | `pending` |
| `empty` | `value` vacío (o sólo espacios) | `pending` |
| `invalid` | `isValidChannelValue(kind, value)` da `false` | `review` |
| `complete` | Activa, con valor, y el valor valida contra su `kind` | — |

Por qué cada uno cae donde cae:

- **`missing` y `wrong_kind` son `review`**, no `pending`. Una fila institucional
  no desaparece ni cambia de tipo desde el panel: la API responde 403. Si el
  endpoint las ve así, alguien escribió directo en la base o restauró un dump a
  medias. Eso no se arregla cargando un teléfono. La pantalla tiene que llevar a
  Canales, donde el formulario ya sabe recrear la fila con su tipo esperado y
  desbloquea el campo `kind` justamente cuando está mal.
- **`inactive` es `pending` en canales.** Los ocho institucionales vienen activos
  de fábrica para que su falta de dato se vea como *"A confirmar"* en vez de
  desaparecer. Uno inactivo no se publica **y tampoco avisa**: es el peor de los
  dos mundos y hay que reportarlo.
- **`invalid` es `review`.** Hay un dato cargado y no sirve: no es "falta
  cargarlo", es "lo que hay está mal". La salida pública ya lo descarta
  (`publicChannelValues`), así que el visitante ve "A confirmar" mientras el
  panel muestra un valor lleno. Sin este estado, esa contradicción no aparece en
  ningún lado.

### 3.3 · Estado por horario: cuatro valores

| Estado | Condición | Sección |
|---|---|---|
| `missing` | No existe la fila con esa `key` | `review` |
| `empty` | `hours` vacío (con `active` en cualquier valor) | `pending` |
| `inactive` | `hours` cargado pero `active = 0` | — (no bloquea) |
| `complete` | `active = 1` y `hours` cargado | — |

**`inactive` no se comporta igual que en canales, y la asimetría es
deliberada.** Un horario con horas cargadas y desactivado es una decisión: el
sanatorio cargó el dato y eligió no publicarlo. Un canal institucional
desactivado no es una decisión equivalente, porque su estado de fábrica es
activo. Reportar el horario inactivo como pendiente convertiría una decisión
tomada en una tarea eterna.

---

## 4 · Secciones

### 4.1 · Canales de contacto

Fuente: tabla `contact_channels`, cruzada contra **el catálogo institucional que
ya existe** en `api/src/routes/admin/contact_channels.ts` (`RESERVED_CHANNELS`,
`isReservedChannel`).

> **No se crea una tercera lista de las ocho claves.** Ya hubo dos —API y panel— y
> se desincronizaron: el panel ofrecía "Eliminar" en filas que la API rechaza con
> 403. La copia del panel se eliminó y las filas viajan con `reserved` y
> `expectedKind`. Esta pantalla se suma a ese esquema; no lo revierte.
> `tests/canales-reservados.test.ts` falla si aparece una copia nueva.

La validación del valor usa `isValidChannelValue()` de `api/src/contact-values.ts`
—la misma función que valida al guardar y la misma que filtra la salida
pública—. Reimplementar el criterio acá haría que la pantalla dijera "completo"
sobre un valor que el sitio descarta.

Los canales sociales (`facebook`, `instagram`, `youtube`, `linkedin`) **no entran
en el conteo**: son opcionales y vienen inactivos a propósito. Se pueden listar
aparte como informativos, nunca como pendientes.

### 4.2 · Horarios

Fuente: tabla `schedules`, las siete áreas que crea `20260813000001_schedules.ts`.

La condición de "publicable" no se inventa: es **la misma que aplica
`GET /api/public/schedules`** — `active = 1` y `hours` no vacío. Cualquier otra
definición haría que la pantalla afirmara que un horario está publicado cuando el
sitio no lo muestra.

> **El conjunto no se da por completo porque exista una fila publicable.** La
> sección devuelve siempre `publishable` y `total`, y su `status` es `complete`
> sólo cuando **ninguna** fila quedó en `empty`. Un único horario cargado con
> seis áreas vacías es `pending` con `publishable: 1, total: 7`, no "completo".

### 4.3 · Alcance de Biopsias

No es un campo: es el cuerpo de una página (`pages.slug = "estudios-biopsias"`,
bloque `richText`).

Su estado es **siempre `review` mientras no exista una confirmación explícita**.
No se deduce del contenido: que el texto sea largo, o que ya no contenga la nota
en cursiva de "a confirmar", no significa que el sanatorio haya confirmado el
alcance, los requisitos, la preparación y los plazos. Una heurística sobre el
texto convertiría "alguien editó la página" en "el alcance está confirmado", que
es precisamente la afirmación que no se puede hacer sin autorización.

Cuando exista un mecanismo de confirmación explícita —una marca que el
propietario active a conciencia—, este ítem pasa a leerlo. Hasta entonces
devuelve `review` con el motivo, y la pantalla lo muestra como una decisión
pendiente del sanatorio, no como una tarea del administrador.

---

## 5 · Avisos

Los avisos son transversales: no pertenecen a una sección y no bloquean el
`overall`. Van en `warnings[]`.

### 5.1 · Snapshot de la nota de Emergencias

Se lee `settings` en la clave `snapshot_nota_emergencias_20260820000000`.

Si su `motivo` es `"editada"`, se emite un aviso. **El contenido del snapshot no
se expone jamás** —ni `notaAnterior`, ni ningún fragmento—: es justamente el
texto no confirmado que se retiró del sitio, y publicarlo en una respuesta de la
API lo devolvería a circulación por la puerta de atrás.

Hay dos orígenes distintos para ese `"editada"` y el aviso los distingue:

| Situación | Cómo se reconoce | Qué significa |
|---|---|---|
| La migración `20260820000000` encontró la fila ya editada y **no la tocó** | `motivo: "editada"` y `notaAnterior` **no** es `null` | Hay una nota sobre la fila de Emergencias que nadie revisó. Requiere lectura manual en Horarios |
| Un rollback desarmó la restauración automática | `motivo: "editada"`, `notaAnterior: null` y existe `neutralizadoPor` | La nota está limpia y siguió limpia. No hay nada que revisar en la fila; el aviso es informativo |

El aviso lleva `code`, `severity` y un `message` en español que dice **dónde
mirar**, nunca **qué decía**.

### 5.2 · Otros avisos previstos

- Filas de `contact_channels` con `reserved: true` y `kind` incorrecto — ya
  cubierto por el estado `wrong_kind`, pero se repite como aviso porque tiene una
  reparación concreta y un lugar concreto donde hacerla.
- `PUBLIC_SITE_URL` sin dominio definitivo: es de entorno, no administrable
  (ver `CARGA-DE-DATOS.md` §4.2). Informativo, y depende de la Ola A-3, que sigue
  bloqueada por dominio/DNS/HTTPS.

---

## 6 · Forma de la respuesta

Ilustrativa: fija los nombres y los tipos, no los valores.

```jsonc
{
  "generatedAt": "2026-08-17T13:00:00.000Z",
  "overall": "pending",                 // complete | pending | review
  "sections": [
    {
      "id": "contact-channels",
      "label": "Canales de contacto",
      "status": "pending",
      "route": "/admin/contact-channels",   // ruta del panel, para el enlace
      "complete": 3,
      "total": 8,
      "items": [
        {
          "key": "emergencias",
          "label": "Emergencias",           // nombre de la fila, no el dato
          "expectedKind": "phone",
          "status": "empty"                 // missing|wrong_kind|inactive|empty|invalid|complete
        }
      ]
    },
    {
      "id": "schedules",
      "label": "Horarios de atención",
      "status": "pending",
      "route": "/admin/schedules",
      "publishable": 1,
      "total": 7,
      "items": [
        { "key": "consultorios", "label": "Consultorios externos", "status": "empty" }
      ]
    },
    {
      "id": "biopsias",
      "label": "Alcance de Biopsias",
      "status": "review",
      "route": "/admin/pages",
      "pageSlug": "estudios-biopsias",
      "reason": "Requiere confirmación escrita del sanatorio."
    }
  ],
  "warnings": [
    {
      "code": "emergencias_nota_sin_revisar",
      "severity": "warning",              // warning | info
      "route": "/admin/schedules",
      "message": "La fila de Emergencias tiene una nota anterior sin revisar. Abrí Horarios y verificá su contenido."
    }
  ]
}
```

Notas sobre la forma:

- `items[].label` es el nombre de la fila (`contact_channels.label`,
  `schedules.area`), no su valor.
- `route` es una ruta del panel, no un enlace absoluto: el front la resuelve.
- `warnings[].message` está en español (es-PY) como el resto de la UI. Los
  `code` son estables y en inglés, para que el front pueda ramificar sin
  depender del texto.
- `overall` es el peor estado de las secciones, con `review` peor que `pending`.

---

## 7 · Superficie en el panel

- **Ruta nueva**: `/admin/datos-pendientes`, en el menú lateral.
- **Tarjeta en el Dashboard**: título, `complete`/`total` global y el peor estado.
  Es lo primero que ve quien entra al panel, y su función es que nadie tenga que
  acordarse de revisar.
- **Enlaces por ítem**: cada fila lleva a la pantalla donde se carga —Canales,
  Horarios o el Page Builder de la página de Biopsias—. Sin esto la pantalla
  informa un problema y deja al operador buscando dónde resolverlo, que es el
  mismo error que se corrigió en el formulario de canales cuando bloqueaba el
  campo que había que reparar.

---

## 8 · Pruebas que la implementación tiene que traer

No es una lista de deseos: son los casos donde una implementación razonable se
equivoca.

1. El endpoint **exige autenticación** (401 sin token).
2. La respuesta **no contiene** ningún `value`, `hours`, `days` ni `note` de la
   base. Se verifica contra filas cargadas a propósito con datos de prueba,
   buscando esos literales en el JSON serializado.
3. Un canal con valor **inválido** guardado directo en la base da `invalid`, no
   `complete`.
4. Un canal institucional **borrado** directo en la base da `missing` y lleva la
   sección a `review`.
5. Un solo horario publicable **no** deja la sección en `complete`.
6. Un horario con horas cargadas e `active = 0` **no** cuenta como pendiente.
7. Biopsias da `review` aunque su página tenga texto largo y sin la nota en
   cursiva.
8. Con el snapshot de Emergencias en `motivo: "editada"`, el aviso aparece y el
   JSON **no** contiene la nota legacy.
9. El catálogo usado es el de la API: si se agrega una clave a
   `RESERVED_CHANNELS`, la sección la cuenta sin tocar esta pantalla.
