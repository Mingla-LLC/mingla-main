/**
 * #4420 SC-10 — the phone-web thread follows the VISIBLE band.
 *
 * On iPhone Safari with the keyboard up, the visual viewport can be scrolled
 * DOWN inside the layout viewport (`visualViewport.offsetTop > 0`). The thread
 * is pinned to the visible height but sits at the layout top, so its header
 * (and, after a scroll to the oldest message, the composer) can leave the
 * visible band. SheetMobile.tsx (ORCH-1197/1199) corrects for the same shift;
 * this does it for the thread by moving the pinned screen down by offsetTop
 * with a transform (no layout change, so the page height never changes).
 *
 * Feedback-loop guard: a transform does not change the document's layout
 * height, the value is read on visualViewport resize/scroll inside one
 * requestAnimationFrame, rounded, clamped to what keeps the screen inside the
 * layout viewport, and React state only changes when the rounded value does.
 * The loop to watch for on a device: offset applied → page scrolls again →
 * offsetTop changes → offset re-applied; the clamp and the equal-value skip
 * stop it from oscillating.
 */
import { useEffect, useState } from "react";
import { Platform } from "react-native";

/** How far to move a screen pinned to the visible height so it covers the visible band. */
export function visibleBandShift(input: { offsetTop: number; visibleHeight: number; layoutHeight: number }): number {
  const offset = Number.isFinite(input.offsetTop) ? input.offsetTop : 0;
  const room = Math.max(0, input.layoutHeight - input.visibleHeight);
  return Math.round(Math.min(Math.max(0, offset), room));
}

type VisualViewportLike = {
  height: number;
  offsetTop?: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

/** Web phones only: the shift for a visible-height pinned screen (0 elsewhere). */
export function useVisibleBandShift(enabled: boolean): number {
  const [shift, setShift] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "web" || !enabled || typeof window === "undefined") {
      setShift(0);
      return undefined;
    }
    const viewport: VisualViewportLike | null | undefined = (globalThis as { visualViewport?: VisualViewportLike | null }).visualViewport;
    if (!viewport) return undefined;
    let frame: number | null = null;
    const read = (): void => {
      frame = null;
      const next = visibleBandShift({
        offsetTop: viewport.offsetTop ?? 0,
        visibleHeight: viewport.height,
        layoutHeight: window.innerHeight,
      });
      setShift((current) => (current === next ? current : next));
    };
    const schedule = (): void => {
      if (frame === null) frame = window.requestAnimationFrame(read);
    };
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    schedule();
    return () => {
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return shift;
}
