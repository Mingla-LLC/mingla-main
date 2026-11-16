/*
 * #4453 §3.5 (decision D2: no GSAP) — Mingla's own motion module, the only
 * motion JavaScript a shared layout ships (budget: ≤ 6 KB gzipped, pinned by
 * a test). Most motion is CSS (public/designs/_shared/blocks-1.css): the hero
 * settle and drift, the headline line reveal, the pinned gallery and word
 * lighting use scroll-driven animations where the browser supports them.
 * This module adds what CSS cannot do alone:
 *
 * - rise-in for sections and staggered children (IntersectionObserver), at
 *   most 12 elements animating at once and at most 6 stagger steps;
 * - the count-up (the final number is already in the HTML);
 * - word spans for word lighting (desktop only).
 *
 * MINGLA-INVARIANT: I-SITES-MOTION-OPTIONAL | issue #4453 | every page is complete with motion off: nothing is hidden until this module has run, and it never runs under prefers-reduced-motion, `motion: none` or Save-Data (reduced-motion render test).
 *
 * Transform and opacity only. Native scrolling is never taken over.
 */

export const MAX_ANIMATING_AT_ONCE = 12;
export const MAX_STAGGER_STEPS = 6;

type Connection = { saveData?: boolean };

/** Whether this visitor gets motion at all. */
export function motionAllowed(root: Element, win: Window = window): boolean {
  if (root.getAttribute("data-motion") === "none") return false;
  if (win.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  const connection = (win.navigator as Navigator & { connection?: Connection }).connection;
  return !connection?.saveData;
}

function wrapWords(element: Element): void {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const parts = (node.textContent ?? "").split(/(\s+)/);
    if (parts.length < 2) continue;
    const fragment = element.ownerDocument.createDocumentFragment();
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) fragment.append(part);
      else {
        const span = element.ownerDocument.createElement("span");
        span.className = "mg-wd";
        span.textContent = part;
        fragment.append(span);
      }
    }
    node.replaceWith(fragment);
  }
}

function countUp(element: HTMLElement, durationMs: number): void {
  const target = Number(element.getAttribute("data-mg-count"));
  if (!Number.isFinite(target) || target <= 0) return;
  const start = performance.now();
  const tick = (now: number) => {
    const progress = Math.min(1, (now - start) / durationMs);
    element.textContent = String(Math.round(target * (1 - Math.pow(1 - progress, 3))));
    if (progress < 1) requestAnimationFrame(tick);
    else element.textContent = String(target);
  };
  requestAnimationFrame(tick);
}

/**
 * Starts motion inside `root` (the page). Returns a stop function. With
 * motion not allowed, or without IntersectionObserver, it does nothing and
 * the page stays exactly as the server drew it.
 */
export function startMotion(root: HTMLElement, win: Window = window): () => void {
  if (!motionAllowed(root, win) || !("IntersectionObserver" in win)) return () => {};
  const stagger = Number.parseFloat(win.getComputedStyle(root).getPropertyValue("--mg-stagger")) || 60;
  const duration = Number.parseFloat(win.getComputedStyle(root).getPropertyValue("--mg-dur")) || 700;
  // Children of a [data-mg-stagger] list rise one after another (≤ 6 steps).
  root.querySelectorAll("[data-mg-stagger]").forEach((list) => {
    Array.from(list.children).forEach((child, index) => {
      child.setAttribute("data-mg-rise", "");
      (child as HTMLElement).style.setProperty("--mg-d", `${Math.min(index, MAX_STAGGER_STEPS - 1) * stagger}ms`);
    });
  });
  if (win.matchMedia?.("(min-width: 721px)").matches) root.querySelectorAll("[data-mg-words]").forEach(wrapWords);
  const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-mg-rise]"));
  const counters = Array.from(root.querySelectorAll<HTMLElement>("[data-mg-count]"));
  // Only now (JS alive, motion allowed) may anything start hidden.
  root.setAttribute("data-mg-motion", "on");
  const observer = new IntersectionObserver((entries) => {
    let started = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const element = entry.target as HTMLElement;
      observer.unobserve(element);
      // Past the per-frame budget, an element simply appears.
      if (started >= MAX_ANIMATING_AT_ONCE) element.style.setProperty("--mg-d", "0ms");
      element.setAttribute("data-in", "");
      if (element.hasAttribute("data-mg-count")) countUp(element, duration * 1.6);
      started += 1;
    }
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
  for (const element of [...targets, ...counters]) observer.observe(element);
  return () => {
    observer.disconnect();
    root.removeAttribute("data-mg-motion");
  };
}
