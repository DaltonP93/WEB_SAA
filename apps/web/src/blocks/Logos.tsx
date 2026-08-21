import { LOGOS_OPACIDAD_POR_DEFECTO, type LogoItem, type LogosProps } from "@sa/shared/blocks";
import { isInternalHref, isSafeExternalHref, safeInternalHref, safeMediaSrc } from "../lib/url";

/**
 * Logos de convenios y aliados.
 *
 * `imageUrl` y `href` son administrables, así que los dos se validan antes de
 * llegar al DOM: sin imagen válida el logo no se dibuja, y sin destino válido
 * queda como imagen sin enlace en vez de convertirse en un
 * `<a href="javascript:…">`.
 *
 * ## Compatibilidad con lo que ya está guardado
 *
 * Los bloques `logos` que existen en la base se guardaron con tres claves:
 * `imageUrl`, `alt` y `href`. Todo lo que se agregó después —`active`,
 * `width`, `height`, y la opacidad del bloque— es opcional y tiene un default
 * que **reproduce exactamente lo que se veía antes**: sin `active` el logo se
 * muestra, y sin `opacity` la fila usa el 80 que estaba fijo en la clase. Un
 * bloque viejo no cambia hasta que alguien lo edite a propósito.
 *
 * ## Un enlace tiene que decir a dónde va
 *
 * Un logo enlazado sin `alt` produce un `<a>` cuyo contenido es una imagen sin
 * texto: en un lector de pantalla se anuncia como "enlace" y nada más, y quien
 * lo escucha no tiene forma de saber a dónde lleva. En una fila de doce logos
 * eso son doce enlaces indistinguibles. Cuando falta el `alt` —lo que puede
 * pasar en una fila legacy— el logo se dibuja **sin** enlace: se pierde el
 * destino, que es recuperable editando el bloque, y no la navegación.
 */

/** El logo se muestra salvo que lo hayan desactivado explícitamente. */
const estaActivo = (l: LogoItem) => l.active !== false;

/** Una dimensión sirve para reservar espacio sólo si es un entero positivo. */
const dimension = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 10000 ? v : undefined;

export default function Logos({ heading, logos, opacity }: LogosProps) {
  const visibles = (logos ?? []).filter(estaActivo);
  if (visibles.length === 0) return null;

  const opacidad = typeof opacity === "number" ? opacity : LOGOS_OPACIDAD_POR_DEFECTO;

  return (
    <section className="container-x section-y-sm">
      {heading && <h2 className="text-center text-xl font-semibold mb-6">{heading}</h2>}
      <div
        className="flex flex-wrap items-center justify-center gap-8"
        // Inline y no una clase de Tailwind: el valor es administrable y
        // `opacity-${n}` no existiría en el CSS generado.
        style={{ opacity: opacidad / 100 }}
      >
        {visibles.map((l, i) => {
          const src = safeMediaSrc(l.imageUrl);
          if (!src) return null;

          const alt = l.alt?.trim() ?? "";
          const img = (
            <img
              src={src}
              alt={alt}
              // Las dimensiones reales reservan el espacio antes de que la
              // imagen cargue: sin ellas la fila salta cuando llega cada logo
              // y empuja lo que está debajo.
              width={dimension(l.width)}
              height={dimension(l.height)}
              loading="lazy"
              decoding="async"
              className="h-12 w-auto max-w-full object-contain"
            />
          );

          const href = l.href?.trim();
          // Sin `alt` no hay nombre accesible posible para el enlace, así que
          // no se dibuja un enlace. Ver el comentario de arriba.
          const puedeEnlazar = Boolean(href) && alt.length > 0;

          if (puedeEnlazar && isInternalHref(href!)) {
            return (
              <a key={i} href={safeInternalHref(href!)} className="block">
                {img}
              </a>
            );
          }
          if (puedeEnlazar && isSafeExternalHref(href!)) {
            return (
              // `noopener` además de `noreferrer`: sin él la página destino
              // recibe una referencia a esta ventana por `window.opener`.
              <a key={i} href={href} className="block" target="_blank" rel="noopener noreferrer">
                {img}
              </a>
            );
          }
          return (
            <span key={i} className="block">
              {img}
            </span>
          );
        })}
      </div>
    </section>
  );
}
