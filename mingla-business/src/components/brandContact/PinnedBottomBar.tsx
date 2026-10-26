/**
 * #4111 — a bar pinned to the bottom of the screen (the /m/{token} composer).
 * Native: an ordinary last child of a full-height column. The web sibling
 * (`PinnedBottomBar.web.tsx`) pins it with `position: fixed` and lifts it above
 * the buyer-web privacy bar via `--mingla-privacy-inset` (#2331).
 */
import React from "react";
import { View } from "react-native";

export interface PinnedBottomBarProps {
  background: string;
  children: React.ReactNode;
  /** Web only: the measured lift above floating UI. Native never lifts. */
  onLiftChange?: (lift: number) => void;
}

export function PinnedBottomBar({ background, children }: PinnedBottomBarProps): React.ReactElement {
  return <View style={{ backgroundColor: background }}>{children}</View>;
}

/** Native keeps the bar in flow, so the content needs no spacer. */
export const PINNED_BAR_IN_FLOW = true;
