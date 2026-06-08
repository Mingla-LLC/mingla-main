/**
 * WebSafeGestureDetector.web — web passthrough that DOES NOT mount
 * react-native-gesture-handler's `<GestureDetector>` (ORCH-1098 Stage 6).
 *
 * See `WebSafeGestureDetector.tsx` for the full root-cause writeup. Short
 * version: `<GestureDetector>` → `useAnimatedGesture()` → `Reanimated.useEvent`,
 * which `react-native-reanimated@4` removed and the reanimated WEB shim does not
 * provide. Mounting a `<GestureDetector>` on web therefore throws
 * `TypeError: Reanimated.useEvent is not a function` and crashes the route into
 * the error boundary.
 *
 * Metro picks THIS file on web. It renders the single child directly, so the
 * reanimated `useEvent` code path is never reached. Swipe-to-dismiss is a native
 * affordance only; on web, scrim-tap / the close button / Android back already
 * dismiss every sheet + toast, so no user-facing dismiss capability is lost.
 *
 * `gesture` is accepted (for a type-identical API with the native file) and
 * intentionally ignored.
 */

import React from "react";
import type { ComposedGesture, GestureType } from "react-native-gesture-handler";

export interface WebSafeGestureDetectorProps {
  /** Gesture built via `Gesture.Pan()` etc. Accepted for API parity, ignored on web. */
  gesture: ComposedGesture | GestureType;
  /** Exactly one React element child. */
  children: React.ReactElement;
}

export const WebSafeGestureDetector = ({
  children,
}: WebSafeGestureDetectorProps): React.ReactElement => {
  // No GestureDetector on web → reanimated `useEvent` never runs → no crash.
  return children;
};

export default WebSafeGestureDetector;
