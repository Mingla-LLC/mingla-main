"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/*
 * #4453 §3.3 — the two shared layouts that need a click: the review rail's
 * previous / next buttons and the review switcher. Both are complete without
 * JavaScript (the rail is a native scroll-snap row; the switcher lists every
 * review), so nothing is hidden at rest.
 */

/** Previous / next buttons that scroll the rail beside them by one card. */
export function RailControls({ railId }: { railId: string }) {
  const scroll = (direction: -1 | 1) => {
    const rail = document.getElementById(railId);
    const card = rail?.firstElementChild as HTMLElement | null;
    if (!rail || !card) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.getAttribute("data-motion") === "none";
    rail.scrollBy({ left: direction * (card.offsetWidth + 22), behavior: reduce ? "auto" : "smooth" });
  };
  return (
    <div className="mg-rail-ctl">
      <button type="button" aria-controls={railId} aria-label="Previous review" onClick={() => scroll(-1)}>{"←"}</button>
      <button type="button" aria-controls={railId} aria-label="Next review" onClick={() => scroll(1)}>{"→"}</button>
    </div>
  );
}

/**
 * One review at a time with numbered buttons (`aria-pressed`). Until it has
 * mounted, every review is shown (the no-JavaScript page).
 */
export function ReviewSwitcher({ count, labels, children }: { count: number; labels: string[]; children: ReactNode }) {
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!ready) return;
    ref.current?.querySelectorAll<HTMLElement>("[data-voice]").forEach((voice) => {
      voice.hidden = Number(voice.dataset.voice) !== active;
    });
  }, [active, ready]);
  return (
    <div ref={ref} data-ready={ready ? "true" : "false"}>
      {children}
      {count > 1 ? (
        <div className="mg-dots" role="group" aria-label="Choose a review">
          {labels.map((label, index) => (
            <button key={index} type="button" aria-pressed={index === active} aria-label={label} onClick={() => setActive(index)}>{index + 1}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
