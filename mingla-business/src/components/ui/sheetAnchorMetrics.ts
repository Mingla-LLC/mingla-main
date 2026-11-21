// #2331 (I-PRIVACY-BAR-NEVER-OCCLUDES) — SheetMobile's web dock maths, pure so
// it is testable without the native gesture and animation stack.

export interface SheetAnchorMetrics {
  /** Height the panel may use (bounded to the box above the strip). */
  visibleHeight: number;
  /** Where the dock sits: the bottom of the Modal box. */
  layoutHeight: number;
  /** visualViewport.offsetTop (non-zero on Android with the keyboard open). */
  offsetTop: number;
  /** How far the panel lifts so its bottom meets the visible bottom. */
  visibleBottomGap: number;
}

/**
 * #2331 — where the sheet's dock anchors on web. `band` is the privacy
 * strip's height when it bounds the Modal box (0 otherwise); the dock sits at
 * `inner − band`, and it lifts by however far the visible bottom sits above it.
 */
export const sheetAnchorMetrics = (input: {
  inner: number;
  visible: number;
  offsetTop: number;
  band: number;
}): SheetAnchorMetrics => {
  const anchorBottom = input.inner - input.band;
  return {
    visibleHeight: Math.min(input.visible, anchorBottom - input.offsetTop),
    layoutHeight: anchorBottom,
    offsetTop: input.offsetTop,
    visibleBottomGap: Math.max(anchorBottom - (input.offsetTop + input.visible), 0),
  };
};

