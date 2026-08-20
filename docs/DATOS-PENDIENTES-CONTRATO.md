# Contrato de `GET /api/admin/data-readiness`

Especificación de la pantalla **Datos pendientes** (Ola A-2). El documento se
escribió **antes** de implementar el endpoint, para que la implementación no
tuviera que inventar decisiones que ya tienen respuesta en el proyecto —el
catálogo institucional, la validación de valores, la condición real de
publicación de un horario— y para dejar por escrito qué **no** puede devolver.
El endpoint ya está implementado en
`api/src/routes/admin/data_readiness.ts` y esta sigue siendo su especificación:
cuando los dos discrepen, el que está mal es el que se cambió sin actualizar al
otro.

Referencia operativa complementaria: [`CARGA-DE-DATOS.md`](./CARGA-DE-DATOS.md),
que explica al administrador cómo cargar cada dato. Este archivo explica al
programador cómo se calcula si falta. Las URLs `/admin/…` que aparecen allá son
direcciones para escribir en el navegador y están bien como están; las `route`
de acá son otra cosa (§2.2).

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
| **Efectos** | **Ninguno.** Sólo lectura: ni escribe, ni migra, ni repara, ni toca marcas de tiempo |
| **Idempotencia** | Total, y en sentido literal: la respuesta **no lleva ningún campo dinámico**, así que dos llamadas seguidas sobre la misma base devuelven exactamente el mismo JSON |
| **Caché** | Sin caché del lado del servidor. El panel lo pide con TanStack Query como cualquier otro recurso |

Es de sólo lectura por diseño, no por omisión. Un endpoint que además "arregla lo
que puede" convierte un diagnóstico en una escritura que nadie pidió, y sobre
datos institucionales eso es exactamente lo que este proyecto viene evitando.

**No hay `generatedAt`.** Un borrador de este contrato lo llevaba, y convivía mal
con la promesa de la fila de arriba: con un timestamp adentro, "dos llamadas
devuelven lo mismo" deja de ser cierto al pie de la letra y hay que explicar cuál
es la excepción. Nadie lo consumía —ni la pantalla ni la tarjeta del Dashboard—,
así que se sacó en vez de debilitar la promesa. Idempotencia acá significa que el
GET no escribe **y** que la respuesta no cambia sola.

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

### 2.2 · `route` son rutas internas del panel

Cada sección y cada aviso traen una `route`. Es la ruta **interna de React
Router**, sin el prefijo del panel:

| Destino | `route` |
|---|---|
| Canales de contacto | `/contact-channels` |
| Horarios | `/schedules` |
| Biopsias | `/pages/:id` si la página existe, `/pages` si no |
| La propia pantalla | `/datos-pendientes` |

El admin se construye con `base: "/admin"` y su router arranca con
`basename: import.meta.env.BASE_URL` (`apps/admin/src/main.tsx`), así que React
Router antepone `/admin` **solo**. Devolver `/admin/schedules` haría que un
`<Link>` apuntara a `/admin/admin/schedules`, que no existe: el enlace lleva a una
pantalla en blanco, y a nada que delate por qué.

La confusión es fácil porque [`CARGA-DE-DATOS.md`](./CARGA-DE-DATOS.md) sí escribe
`/admin/horarios` y compañía — y hace bien: ahí son URLs que una persona copia en
la barra del navegador. Son dos espacios de nombres distintos y ninguno de los
dos está mal; lo que está mal es mezclarlos.

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

Fuente: tabla `schedules`, cruzada contra `RESERVED_SCHEDULES` de
`api/src/institutional-schedules.ts` —el catálogo de runtime de las siete áreas,
con su clave y su nombre por defecto—.

> **Enumerar la tabla no alcanza, y por eso el catálogo existe.** Para reportar
> que **falta** una fila hay que saber cuáles tendrían que estar: recorrer
> `schedules` sólo dice qué hay, y una fila perdida —un dump restaurado a medias,
> un `DELETE` directo— desaparece del informe en vez de aparecer como problema.
>
> El catálogo tampoco se lee de `20260813000001_schedules.ts`. Una migración es
> un archivo histórico: describe lo que se aplicó una vez, no lo que el producto
> necesita hoy, y ningún código productivo debería importarla.
> `tests/horarios-catalogo.test.ts` compara el catálogo contra las filas que deja
> la cadena **completa** de migraciones y exige igualdad exacta en los dos
> sentidos, que es la garantía que hace falta para poder tener las dos cosas.

El `area` del catálogo es sólo el nombre por defecto: si la fila existe manda su
`area` guardada, que el sanatorio puede renombrar. El nombre del catálogo se usa
para poder nombrar una fila que **no está** en la base.

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

**El enlace va directo al Page Builder** cuando la página existe:
`route: "/pages/<id>"`. Mandar al listado obliga a buscarla entre todas, que es
la misma fricción que se corrigió en el formulario de canales. Si la página **no
existe**, la `route` cae a `/pages` —`/pages/undefined` sería una pantalla rota— y
el estado sigue siendo `review`: que falte la página no es una confirmación
pendiente, es un problema mayor, y el `reason` lo dice.

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
| Un rollback desarmó la restauración automática | `motivo: "editada"`, `notaAnterior: null` y existe `neutralizadoPor` (con la clave del blindaje que lo hizo) | La nota está limpia y siguió limpia. No hay nada que revisar en la fila; el aviso es informativo |

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
  "overall": "review",                  // complete | pending | review
  "summary": {                          // el panel NO recalcula esto
    "resolved": 4,
    "pending": 10,
    "review": 2,
    "total": 16                         // 8 canales + 7 horarios + 1 Biopsias
  },
  "sections": [
    {
      "id": "contact-channels",
      "label": "Canales de contacto",
      "status": "pending",
      "route": "/contact-channels",     // ruta interna del panel (§2.2)
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
      "route": "/schedules",
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
      "route": "/pages/12",             // "/pages" si la página no existe
      "pageSlug": "estudios-biopsias",
      "reason": "Requiere confirmación escrita del sanatorio…"
    }
  ],
  "warnings": [
    {
      "code": "emergencias_nota_sin_revisar",
      "severity": "warning",              // warning | info
      "route": "/schedules",
      "message": "La fila de Emergencias tiene una nota anterior que nadie revisó. …"
    }
  ]
}
```

### 6.1 · `summary`: el resumen lo arma el servidor

`summary` existe para que la tarjeta del Dashboard y la pantalla no tengan que
derivar el mismo número desde `sections`. Serían dos definiciones del mismo
criterio en dos archivos, y bastaría con tocar una para que la tarjeta dijera
"faltan 3" y la pantalla mostrara cuatro filas en rojo.

Cada ítem cae en **exactamente una** columna, y las tres suman `total`:

| Columna | Canales | Horarios | Biopsias |
|---|---|---|---|
| `resolved` | `complete` | `complete` e `inactive` | — |
| `pending` | `inactive`, `empty` | `empty` | — |
| `review` | `missing`, `wrong_kind`, `invalid` | `missing` | siempre 1 |

`total` es siempre **16**: los ocho canales del catálogo, las siete áreas de
horarios y la revisión de Biopsias. Es el catálogo lo que se cuenta, no las filas
que haya en la base — si no, borrar una fila haría bajar el total y el informe
mejoraría al empeorar la base.

**Un horario con `hours` cargado e inactivo cuenta como resuelto.** El dato está;
no publicarlo es una decisión que alguien tomó. Contarlo como pendiente
convertiría esa decisión en una tarea que nunca se termina. En canales es al
revés, y el porqué está en §3.2.

Notas sobre el resto de la forma:

- `items[].label` es el nombre de la fila (`contact_channels.label`,
  `schedules.area`), no su valor. Cuando la fila no existe se usa el nombre por
  defecto del catálogo, que es lo único que se puede decir de algo que falta.
- `route` es una ruta interna del panel, no un enlace absoluto (§2.2).
- `warnings[].message` está en español (es-PY) como el resto de la UI. Los
  `code` son estables y en inglés, para que el front pueda ramificar sin
  depender del texto.
- `overall` es el peor estado de las secciones, con `review` peor que `pending`.
  Mientras Biopsias siga sin confirmación explícita, `overall` es `review` por
  definición: siempre hay algo que una persona tiene que decidir.

---

## 7 · Superficie en el panel

- **Ruta nueva**: `/datos-pendientes` en el router del admin —o sea
  `/admin/datos-pendientes` en la barra del navegador—, con su entrada en el menú
  lateral.
- **Tarjeta en el Dashboard**: título, `resolved`/`total` global y el peor
  estado, todo leído de `summary`. Es lo primero que ve quien entra al panel, y
  su función es que nadie tenga que acordarse de revisar.
- **Enlaces por ítem**: cada fila lleva a la pantalla donde se carga —Canales,
  Horarios o el Page Builder de la página de Biopsias—. Sin esto la pantalla
  informa un problema y deja al operador buscando dónde resolverlo, que es el
  mismo error que se corrigió en el formulario de canales cuando bloqueaba el
  campo que había que reparar.
- **La pantalla no imprime ningún valor institucional.** Nombres, estados,
  cantidades y acciones. El endpoint tampoco los manda, así que no hay nada que
  filtrar del lado del panel — pero la regla vale igual para lo que se agregue
  después.

---

## 8 · Pruebas que la implementación tiene que traer

No es una lista de deseos: son los casos donde una implementación razonable se
equivoca. Están en `tests/data-readiness.test.ts`,
`tests/data-readiness-panel.test.tsx` y `tests/horarios-catalogo.test.ts`.

1. El endpoint **exige autenticación** (401 sin token).
2. **No tiene efectos**: un volcado de las tablas antes y después de llamarlo es
   idéntico, marcas de tiempo incluidas.
3. La respuesta **no contiene** ningún `value`, `hours`, `days` ni `note` de la
   base. Se verifica contra filas cargadas a propósito con datos de prueba,
   buscando esos literales en el JSON serializado.
4. Un canal con valor **inválido** guardado directo en la base da `invalid`, no
   `complete`.
5. Un canal institucional **borrado** directo en la base da `missing` y lleva la
   sección a `review`.
6. Un canal con el `kind` cambiado directo en la base da `wrong_kind`.
7. `inactive` y `empty` se distinguen: no colapsan en un único "falta".
8. Un solo horario publicable **no** deja la sección en `complete`.
9. Un horario con horas cargadas e `active = 0` **no** cuenta como pendiente, y
   sí cuenta como resuelto en `summary`.
10. Un horario **borrado** da `missing`, que el catálogo de runtime es lo único
    que puede detectar.
11. Biopsias da `review` aunque su página tenga texto largo y sin la nota en
    cursiva, y su `route` apunta al Page Builder de esa página.
12. Con el snapshot de Emergencias en `motivo: "editada"`, el aviso aparece y el
    JSON **no** contiene la nota legacy.
13. Los catálogos usados son los de la API: si se agrega una clave a
    `RESERVED_CHANNELS`, la sección la cuenta sin tocar esta pantalla.
14. Las `route` son internas: ningún enlace de la pantalla produce
    `/admin/admin/…` bajo `basename="/admin"`.
15. El DOM de la pantalla, del menú y de la tarjeta del Dashboard no imprime
    ningún teléfono, correo, horario ni nota.
