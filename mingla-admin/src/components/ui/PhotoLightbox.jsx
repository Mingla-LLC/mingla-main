/**
 * PhotoLightbox — shared UI primitive
 *
 * Full-screen photo viewer. Click outside to close, Esc to close,
 * arrow keys to navigate. Renders nothing if photos array is empty.
 *
 * Originally extracted from photoLabeling/LabelEditor.jsx for reuse on
 * placeIntelligenceTrial candidate cards (ORCH-0712 follow-up).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export function PhotoLightbox({ photos, startIndex = 0, onClose }) {
  const [index, setIndex] = useState(startIndex);
  const overlayRef = useRef(null);

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + photos.length) % photos.length);
  }, [photos.length]);

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % photos.length);
  }, [photos.length]);

  useEffect(() => {
    setIndex(startIndex);
  }, [startIndex]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, goPrev, goNext]);

  if (!photos || photos.length === 0) return null;

  return (
    <div
      ref={overlayRef}
      onMouseDown={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      className="fixed inset-0 flex items-center justify-center p-4 bg-black/85 backdrop-blur-[6px] animate-[fade-in_200ms_ease-out]"
      style={{ zIndex: "var(--z-modal)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <X className="w-5 h-5" />
      </button>

      {photos.length > 1 && (
        <button
          type="button"
          onClick={goPrev}
          aria-label="Previous photo"
          className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}

      <div className="max-w-[90vw] max-h-[88vh] flex flex-col items-center gap-3">
        <img
          src={photos[index]}
          alt={`Photo ${index + 1} of ${photos.length}`}
          className="max-w-full max-h-[80vh] object-contain rounded-md shadow-xl"
        />
        <span className="text-sm text-white/80 font-mono">
          {index + 1} / {photos.length}
        </span>
      </div>

      {photos.length > 1 && (
        <button
          type="button"
          onClick={goNext}
          aria-label="Next photo"
          className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}
    </div>
  );
}

export default PhotoLightbox;
