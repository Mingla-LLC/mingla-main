/**
 * #4111 — web: the /m/{token} composer is pinned to the viewport bottom and
 * sits ABOVE the buyer-web privacy bar: its bottom offset adds
 * `var(--mingla-privacy-inset, 0px)`, which #2331 sets on the root element to
 * the privacy bar's height (0px when it is hidden or absent). A plain DOM
 * element keeps the CSS variable typed without casting React Native styles.
 */
import React from "react";

export interface PinnedBottomBarProps {
  background: string;
  children: React.ReactNode;
}

export function PinnedBottomBar({ background, children }: PinnedBottomBarProps): React.ReactElement {
  const style: React.CSSProperties = {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: "var(--mingla-privacy-inset, 0px)",
    zIndex: 20,
    background,
  };
  return (
    <div style={style} data-testid="issue-4111-pinned-composer">
      {children}
    </div>
  );
}

/** Web pins the bar out of flow, so the content reserves space for it. */
export const PINNED_BAR_IN_FLOW = false;
