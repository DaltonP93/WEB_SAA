import { useCallback, useEffect, useRef, useState } from "react";
import type { SliderProps } from "@sa/shared/blocks";

export default function Slider({ slides, autoplayMs = 5000 }: SliderProps) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<number | null>(null);
  const reduced = useRef(
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );

  const go = useCallback(
    (next: number) => {
      if (!slides.length) return;
      setI(((next % slides.length) + slides.length) % slides.length);
    },
    [slides.length]
  );

  useEffect(() => {
    if (!slides.length || !autoplayMs || paused || reduced.current) return;
    timer.current = window.setTimeout(() => go(i + 1), autoplayMs);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [i, paused, autoplayMs, slides.length, go]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") go(i - 1);
      if (e.key === "ArrowRight") go(i + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, go]);

  if (!slides.length) return null;
  const current = slides[i];

  return (
    <section
      className="relative h-[400px] md:h-[520px] overflow-hidden bg-gray-900"
      role="region"
      aria-roledescription="carousel"
      aria-label="Slides principales"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {slides.map((s, k) => (
        <div
          key={k}
          className={`absolute inset-0 transition-opacity duration-700 ease-in-out ${k === i ? "opacity-100 z-10" : "opacity-0 z-0"}`}
          aria-hidden={k !== i}
        >
          {s.imageUrl && (
            <img
              src={s.imageUrl}
              alt={k === i ? s.title ?? "" : ""}
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-black/40" />
        </div>
      ))}

      <div className="relative z-20 container-x h-full flex flex-col justify-end pb-12 text-white">
        {current.title && <h2 className="text-3xl md:text-5xl font-bold text-balance">{current.title}</h2>}
        {current.text && <p className="mt-2 max-w-xl">{current.text}</p>}
      </div>

      <button
        type="button"
        onClick={() => go(i - 1)}
        aria-label="Slide anterior"
        className="absolute z-30 left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition"
      >
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => go(i + 1)}
        aria-label="Siguiente slide"
        className="absolute z-30 right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition"
      >
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      <div className="absolute z-30 bottom-4 left-1/2 -translate-x-1/2 flex gap-2" role="tablist" aria-label="Indicadores de slide">
        {slides.map((_, k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={k === i}
            aria-label={`Ir al slide ${k + 1}`}
            onClick={() => go(k)}
            className={`h-2 rounded-full transition-all duration-300 ${k === i ? "bg-white w-8" : "bg-white/50 w-2 hover:bg-white/80"}`}
          />
        ))}
      </div>
    </section>
  );
}
