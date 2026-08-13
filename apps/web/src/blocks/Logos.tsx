import type { LogosProps } from "@sa/shared/blocks";
import { isInternalHref, isSafeExternalHref, safeInternalHref, safeMediaSrc } from "../lib/url";

/**
 * Logos de convenios y aliados.
 *
 * Tanto el `imageUrl` como el `href` de cada logo son administrables, así que
 * los dos se validan antes de llegar al DOM: sin imagen válida el logo no se
 * dibuja, y sin destino válido queda como imagen sin enlace en vez de
 * convertirse en un `<a href="javascript:…">`.
 */
export default function Logos({ heading, logos }: LogosProps) {
  return (
    <section className="container-x section-y-sm">
      {heading && <h2 className="text-center text-xl font-semibold mb-6">{heading}</h2>}
      <div className="flex flex-wrap items-center justify-center gap-8 opacity-80">
        {logos.map((l, i) => {
          const src = safeMediaSrc(l.imageUrl);
          if (!src) return null;
          const img = <img src={src} alt={l.alt ?? ""} className="h-12 w-auto" />;
          const href = l.href?.trim();
          if (href && isInternalHref(href)) {
            return (
              <a key={i} href={safeInternalHref(href)} className="block">
                {img}
              </a>
            );
          }
          if (href && isSafeExternalHref(href)) {
            return (
              <a key={i} href={href} className="block" target="_blank" rel="noreferrer">
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
