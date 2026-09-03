"use client";

import { useEffect } from "react";

/**
 * #2830 — reveal sections as they arrive.
 *
 * DELIBERATELY FAIL-VISIBLE. The hiding is applied by `.js-reveal`, a class
 * this component adds at runtime, so a visitor with no JavaScript — or one
 * whose bundle fails — sees the whole page rather than a blank column of
 * invisible sections. A reveal effect that can hide a restaurant's menu is a
 * worse bug than having no effect at all.
 *
 * `prefers-reduced-motion` is honoured in CSS, and the observer is skipped
 * entirely where IntersectionObserver is unavailable.
 */
export function RevealOnScroll() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    if (reduced) return;
    const root = document.documentElement;
    root.classList.add("js-reveal");
    const targets = document.querySelectorAll<HTMLElement>("main section");
    targets.forEach((node) => node.classList.add("reveal"));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    targets.forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
      root.classList.remove("js-reveal");
      targets.forEach((node) => node.classList.remove("reveal", "in"));
    };
  }, []);
  return null;
}
