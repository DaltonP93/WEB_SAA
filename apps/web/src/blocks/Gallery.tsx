import type { GalleryProps } from "@sa/shared/blocks";

export default function Gallery({ columns, images }: GalleryProps) {
  const cols = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4", 5: "md:grid-cols-5" }[columns];
  return (
    <section className="container-x py-10">
      <div className={`grid grid-cols-2 ${cols} gap-3`}>
        {images.map((img, i) => (
          <img key={i} src={img.url} alt={img.alt ?? ""} className="aspect-square object-cover rounded" />
        ))}
      </div>
    </section>
  );
}
