import { useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export interface LightboxImage {
  url: string;
  alt?: string;
}

interface Props {
  images: LightboxImage[];
  openIndex: number | null;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}

export default function Lightbox({ images, openIndex, onClose, onIndexChange }: Props) {
  const reduced = useReducedMotion();
  const isOpen = openIndex !== null;
  const idx = openIndex ?? 0;
  const total = images.length;

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onIndexChange((idx - 1 + total) % total);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onIndexChange((idx + 1) % total);
      }
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, idx, total, onClose, onIndexChange]);

  useEffect(() => {
    if (!isOpen) return;
    const html = document.documentElement;
    const prev = html.style.scrollbarGutter;
    html.style.scrollbarGutter = "stable";
    return () => {
      html.style.scrollbarGutter = prev;
    };
  }, [isOpen]);

  const current = images[idx];

  return (
    <AnimatePresence>
      {isOpen && current && (
        <motion.div
          key="lightbox"
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Visor de imágenes"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduced ? undefined : { opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.2 }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>

          {total > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onIndexChange((idx - 1 + total) % total);
              }}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition"
              aria-label="Anterior"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          <motion.img
            key={current.url}
            src={current.url}
            alt={current.alt ?? ""}
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-[90vh] object-contain rounded shadow-2xl"
            initial={reduced ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduced ? undefined : { opacity: 0, scale: 0.96 }}
            transition={{ duration: reduced ? 0 : 0.2 }}
          />

          {total > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onIndexChange((idx + 1) % total);
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition"
              aria-label="Siguiente"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}

          {total > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-sm tabular-nums">
              {idx + 1} / {total}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
