import { useState } from "react";
import type { AccordionProps } from "@sa/shared/blocks";

export default function Accordion({ heading, items }: AccordionProps) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="container-x py-10">
      {heading && <h2 className="text-2xl font-bold mb-6 text-primary">{heading}</h2>}
      <div className="divide-y border rounded">
        {items.map((it, i) => (
          <div key={i}>
            <button onClick={() => setOpen(open === i ? null : i)} className="w-full flex justify-between items-center px-4 py-3 text-left font-medium hover:bg-gray-50">
              <span>{it.title}</span>
              <span>{open === i ? "−" : "+"}</span>
            </button>
            {open === i && <div className="px-4 py-3 text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: it.body }} />}
          </div>
        ))}
      </div>
    </section>
  );
}
