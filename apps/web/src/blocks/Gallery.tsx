import { useState } from "react";
import type { GalleryProps } from "@sa/shared/blocks";
import Lightbox, { type LightboxImage } from "../components/Lightbox";

export default function Gallery({ columns, images }: GalleryProps) {
  const cols = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4", 5: "md:grid-cols-5" }[columns];
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const lightboxImages: LightboxImage[] = images.map((i) => ({ url: i.url, alt: i.alt }));
  return (
    <section className="container-x section-y-sm">
      <div className={`grid grid-cols-2 ${cols} gap-3`}>
        {images.map((img, i) => (
          <button
            type="button"
            key={i}
            onClick={() => setOpenIndex(i)}
            className="aspect-square overflow-hidden rounded group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={`Abrir imagen ${i + 1} de ${images.length}`}
          >
            <img
              src={img.url}
              alt={img.alt ?? ""}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          </button>
        ))}
      </div>
      <Lightbox
        images={lightboxImages}
        openIndex={openIndex}
        onClose={() => setOpenIndex(null)}
        onIndexChange={setOpenIndex}
      />
    </section>
  );
}
