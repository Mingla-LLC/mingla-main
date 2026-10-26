/**
 * #4111 — web: the /m/{token} composer is pinned to the viewport bottom and
 * must NEVER be covered (tester P1-1: at 375px the floating "Ad privacy
 * choices" button sat on top of Send).
 *
 * Two layers, so it works before and after #2331's full-width privacy bar:
 *   1. bottom = var(--mingla-privacy-inset, 0px) — #2331's contract: its bar
 *      publishes its height there and the composer sits on top of it.
 *   2. a measured lift — anything else floating over the composer's footprint
 *      (today: the "Ad privacy choices" button or the consent card; tomorrow:
 *      whatever floats there) is found with document.elementsFromPoint, and
 *      the composer is lifted clear of it. When nothing floats there the lift
 *      is 0, so once #2331 removes the floating button only layer 1 remains.
 *
 * A plain DOM element keeps the CSS variable typed without casting React
 * Native styles.
 */
import React, { useEffect, useRef, useState } from "react";

export interface PinnedBottomBarProps {
  background: string;
  children: React.ReactNode;
  /** The measured lift, so the page can keep its last message scrollable above the composer. */
  onLiftChange?: (lift: number) => void;
}

/** Gap kept between the composer and whatever floats below it. */
const LIFT_GAP = 8;

/**
 * True when `el` is page content scrolling BEHIND the composer (it sits inside
 * a scroll container that does not hold the composer). Thread messages are
 * such content: counting them as floaters made the composer jump up and down
 * as the guest scrolled (#4111 tester retest). Floating UI (the privacy
 * button, the consent card) is never inside such a scroller.
 */
function insidePageScroller(el: Element, bar: HTMLElement, view: Window): boolean {
  if (typeof view.getComputedStyle !== "function") return false;
  let node: Element | null = el.parentElement;
  while (node !== null && node !== undefined) {
    if (node.contains(bar)) return false;
    const overflowY = view.getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * How far (px) the bar must rise so nothing floating covers the area it
 * occupies when unlifted. Exported for the DOM hit-test proof.
 */
export function measureObstructionLift(bar: HTMLElement, currentLift: number, doc: Document = document): number {
  const view = doc.defaultView;
  if (view === null || typeof doc.elementsFromPoint !== "function") return 0;
  const rect = bar.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return 0;
  // The footprint the bar has with NO lift.
  const baseBottom = rect.bottom + currentLift;
  const baseTop = baseBottom - rect.height;
  const xs = [rect.left + 8, rect.left + rect.width / 2, rect.right - 8, rect.right - 40, rect.right - 80];
  const ys = [baseTop + 4, (baseTop + baseBottom) / 2, baseBottom - 4];
  let highestTop = Number.POSITIVE_INFINITY;
  for (const x of xs) {
    for (const y of ys) {
      if (y < 0 || y > view.innerHeight || x < 0 || x > view.innerWidth) continue;
      for (const el of doc.elementsFromPoint(x, y)) {
        if (el === bar || bar.contains(el)) break; // reached the composer: nothing above it here
        if (el.contains(bar)) continue; // a page container that holds the composer
        if (!(el instanceof view.HTMLElement)) continue;
        if (insidePageScroller(el, bar, view)) continue; // thread content behind the bar, not a floater
        // Anything hit-tested ABOVE the composer here is painted over it
        // (the consent card's inner nodes are position: relative inside a
        // floating wrapper, so position alone cannot tell).
        const r = el.getBoundingClientRect();
        if (r.height > view.innerHeight * 0.6) continue; // a full-screen layer, not a floater
        highestTop = Math.min(highestTop, r.top);
      }
    }
  }
  if (!Number.isFinite(highestTop)) return 0;
  return Math.max(0, Math.ceil(baseBottom - highestTop + LIFT_GAP));
}

export function PinnedBottomBar({ background, children, onLiftChange }: PinnedBottomBarProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [lift, setLift] = useState(0);
  const liftRef = useRef(0);

  useEffect(() => {
    onLiftChange?.(lift);
  }, [lift, onLiftChange]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const bar = ref.current;
      if (bar === null) return;
      const next = measureObstructionLift(bar, liftRef.current);
      if (next !== liftRef.current) {
        liftRef.current = next;
        setLift(next);
      }
    };
    const schedule = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    schedule();
    window.addEventListener("resize", schedule);
    const observer =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(schedule);
    observer?.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    // Safety net for changes no mutation reports (fonts, CSS variables).
    const timer = window.setInterval(schedule, 1500);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  const style: React.CSSProperties = {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: `calc(var(--mingla-privacy-inset, 0px) + ${lift}px)`,
    zIndex: 20,
    background,
  };
  return (
    <div ref={ref} style={style} data-testid="issue-4111-pinned-composer" data-lift={lift}>
      {children}
    </div>
  );
}

/** Web pins the bar out of flow, so the content reserves space for it. */
export const PINNED_BAR_IN_FLOW = false;
