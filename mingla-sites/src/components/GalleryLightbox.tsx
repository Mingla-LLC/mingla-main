/* eslint-disable @next/next/no-img-element -- media is already sanitized, responsive, immutable, and integrity-checked by the controlled route. */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LightboxImage = { url: string; alt: string };

/**
 * #3149 — the gallery photographs open larger.
 *
 * gogi's own gallery links every photograph; ours were inert pictures. The
 * markup is an ANCHOR around each one, pointing at the full image, so the
 * feature exists before any JavaScript does: with scripting off, or before
 * hydration, a click still opens the photograph. Script upgrades that same
 * anchor into a dialog. A button would have been a dead tap until hydration
 * (Constitution rule 1), and a div with a click handler is not reachable from
 * a keyboard at all.
 *
 * Modified clicks are left alone — a visitor who asked for a new tab gets one.
 *
 * The dialog is a real one:
 *   - focus moves to it when it opens (the close control),
 *   - Escape closes it,
 *   - Tab cycles WITHIN it and cannot reach the page behind,
 *   - focus returns to the photograph that opened it.
 *
 * Motion is CSS, so `prefers-reduced-motion` is honoured in the stylesheet
 * rather than sniffed here: reduced motion means the panel appears without the
 * fade, not a lightbox that refuses to open.
 */
export function GalleryLightbox(
  { images, className }: { images: LightboxImage[]; className: string },
) {
  const [open, setOpen] = useState<number | null>(null);
  const openerRef = useRef<HTMLAnchorElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const count = images.length;

  useEffect(() => {
    if (open === null) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>("button:not([disabled])"),
      ];
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      /*
       * Focus can be OUTSIDE the dialog even while it is open — a click on the
       * page behind it, or a browser that moved focus on its own. Pulling it
       * back is the difference between a trap and a wrap: without this branch
       * the next Tab walks into the page underneath and the modal is a lie.
       */
      if (!active || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    // Capture, so a handler on the image or a button cannot swallow Escape.
    document.addEventListener("keydown", onKeyDown, true);
    const restoreOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = restoreOverflow;
    };
  }, [open, close]);

  /*
   * Focus goes back where it came from. Losing it to the top of the document
   * is how a keyboard visitor ends up re-walking the whole page after looking
   * at one photograph. On first render there is no opener, so this is inert.
   */
  useEffect(() => {
    if (open !== null) return;
    const opener = openerRef.current;
    openerRef.current = null;
    opener?.focus();
  }, [open]);

  const shown = open === null ? null : images[open] ?? null;
  const step = (delta: number) =>
    setOpen((current) =>
      current === null ? current : (current + delta + count) % count
    );

  return (
    <>
      <div className={className}>
        {images.map((image, index) => (
          <a
            key={`${image.url}-${index}`}
            href={image.url}
            className="gallery-item"
            aria-haspopup="dialog"
            aria-label={image.alt
              ? `View larger: ${image.alt}`
              : `View photograph ${index + 1} larger`}
            onClick={(event) => {
              if (
                event.metaKey || event.ctrlKey || event.shiftKey ||
                event.altKey || event.button !== 0
              ) return;
              event.preventDefault();
              openerRef.current = event.currentTarget;
              setOpen(index);
            }}
          >
            <img
              src={image.url}
              alt={image.alt}
              width={640}
              height={640}
              loading="lazy"
            />
          </a>
        ))}
      </div>
      {shown
        ? (
          <div
            className="lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={shown.alt || `Photograph ${(open ?? 0) + 1} of ${count}`}
            ref={dialogRef}
            onClick={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            <div className="lightbox-panel">
              <button
                type="button"
                className="lightbox-close"
                ref={closeRef}
                onClick={close}
              >
                <span aria-hidden="true">×</span>
                <span className="sr-only">Close</span>
              </button>
              <img src={shown.url} alt={shown.alt} />
              {count > 1
                ? (
                  <div className="lightbox-steps">
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => step(-1)}
                    >
                      Previous
                    </button>
                    <p className="lightbox-count">
                      {`${(open ?? 0) + 1} of ${count}`}
                    </p>
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => step(1)}
                    >
                      Next
                    </button>
                  </div>
                )
                : null}
              {shown.alt ? <p className="lightbox-alt">{shown.alt}</p> : null}
            </div>
          </div>
        )
        : null}
    </>
  );
}
