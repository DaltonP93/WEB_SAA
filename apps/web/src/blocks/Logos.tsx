import type { LogosProps } from "@sa/shared/blocks";

export default function Logos({ heading, logos }: LogosProps) {
  return (
    <section className="container-x py-10">
      {heading && <h2 className="text-center text-xl font-semibold mb-6">{heading}</h2>}
      <div className="flex flex-wrap items-center justify-center gap-8 opacity-80">
        {logos.map((l, i) => (
          <a key={i} href={l.href ?? "#"} className="block">
            <img src={l.imageUrl} alt={l.alt ?? ""} className="h-12 w-auto" />
          </a>
        ))}
      </div>
    </section>
  );
}
