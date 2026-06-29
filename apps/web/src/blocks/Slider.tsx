import { useEffect, useState } from "react";
import type { SliderProps } from "@sa/shared/blocks";

export default function Slider({ slides, autoplayMs = 5000 }: SliderProps) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!slides.length || !autoplayMs) return;
    const t = setInterval(() => setI((x) => (x + 1) % slides.length), autoplayMs);
    return () => clearInterval(t);
  }, [slides.length, autoplayMs]);
  if (!slides.length) return null;
  const s = slides[i];
  return (
    <section className="relative h-[400px] md:h-[520px] overflow-hidden">
      {s.imageUrl && <img src={s.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700" />}
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative container-x h-full flex flex-col justify-end pb-12 text-white">
        {s.title && <h2 className="text-3xl md:text-5xl font-bold">{s.title}</h2>}
        {s.text && <p className="mt-2 max-w-xl">{s.text}</p>}
      </div>
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
        {slides.map((_, k) => (
          <button key={k} onClick={() => setI(k)} className={`w-2 h-2 rounded-full ${k === i ? "bg-white" : "bg-white/50"}`} />
        ))}
      </div>
    </section>
  );
}
