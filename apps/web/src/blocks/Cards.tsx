import type { CardsProps } from "@sa/shared/blocks";

export default function Cards({ columns, items, heading }: CardsProps) {
  const cols = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" }[columns];
  return (
    <section className="container-x py-12">
      {heading && <h2 className="text-2xl md:text-3xl font-bold text-center mb-8 text-primary">{heading}</h2>}
      <div className={`grid grid-cols-1 ${cols} gap-6`}>
        {items.map((it, i) => (
          <a key={i} href={it.href ?? "#"} className="block bg-white rounded shadow hover:shadow-lg transition overflow-hidden">
            {it.imageUrl && <img src={it.imageUrl} alt={it.title} className="w-full h-44 object-cover" />}
            <div className="p-4">
              <h3 className="font-semibold text-primary">{it.title}</h3>
              {it.text && <p className="text-sm text-gray-600 mt-1">{it.text}</p>}
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
