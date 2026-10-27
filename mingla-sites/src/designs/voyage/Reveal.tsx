"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/*
 * #2829 W7 — content that rises into place as it scrolls in.
 *
 * The HIDDEN state lives in CSS and only applies inside `html.js` (added by
 * the head script before first paint). Mounting this component stamps
 * `data-reveal-ready` on <html>: the proof the head script's failsafe waits
 * for. If the bundle never boots, the failsafe drops `.js` after 2.5 s and
 * every block is simply visible. Without IntersectionObserver, everything
 * shows at once. Reduced motion needs no branch: the CSS shows `.reveal`
 * fully visible with no transform.
 */
const STAGGER_MS = 60;
const STAGGER_CAP = 6;

export function revealDelay(index: number): string {
  return `${Math.min(Math.max(index, 0), STAGGER_CAP - 1) * STAGGER_MS}ms`;
}

export function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-reveal-ready", "");
    const element = ref.current;
    if (!element) return;
    if (!("IntersectionObserver" in window)) {
      // No observer: show at once (on the next frame, outside the effect body).
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="reveal v-fill" data-in={shown ? "true" : "false"} style={{ transitionDelay: revealDelay(delay) }}>
      {children}
    </div>
  );
}
