/**
 * Every creator wizard step opens at the top.
 *
 * Each creator (event, RSVP, trip, experience, venue) renders ALL of its steps
 * inside ONE long-lived ScrollView and swaps the body when the step changes.
 * The ScrollView keeps its content offset across that swap, so leaving Step 5
 * scrolled to the bottom opened Step 6 already scrolled, with the "Preview"
 * title clipped under the header (iOS does not clamp the offset when the new
 * content is shorter, and the heading is at the top of the new content).
 *
 * Call it with the wizard's ScrollView ref and its step index. It scrolls to
 * the top — without animation, before paint — only when the step actually
 * changes, never on first mount and never for re-renders within a step.
 */
import { useLayoutEffect, useRef } from "react";

export interface ScrollableToTop {
  scrollTo(options: { x?: number; y?: number; animated?: boolean }): void;
}

export const useScrollToTopOnStepChange = (
  scrollRef: { readonly current: ScrollableToTop | null },
  step: string | number,
): void => {
  const previousStep = useRef(step);
  useLayoutEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    scrollRef.current?.scrollTo({ x: 0, y: 0, animated: false });
  }, [scrollRef, step]);
};
