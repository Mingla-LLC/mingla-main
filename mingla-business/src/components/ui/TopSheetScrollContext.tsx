/**
 * TopSheetScrollContext — coordinates a TopSheet's dismiss-pan with the
 * caller's inner scrollable (ORCH-1173).
 *
 * # Why this exists
 * `TopSheetNative` wraps its arbitrary `children` in a `Gesture.Pan()` that
 * translates the panel up to dismiss on any upward drag. On Android that Pan
 * recognizer wins vertical-drag arbitration over an inner RN `ScrollView`, so a
 * list inside the sheet (BrandSwitcherSheet's brand list) could never scroll —
 * swiping up dismissed the sheet instead, leaving brands below the fold
 * unreachable (Seth, device-confirmed; iOS happened to arbitrate the other way
 * but the gating below makes BOTH platforms correct + deterministic).
 *
 * # The fix — scroll-position-gated dismiss-pan (the standard sheet pattern)
 * TopSheet exposes, via this context:
 *   - `onScroll`  — a reanimated `useAnimatedScrollHandler` the consumer wires
 *                   onto its scrollable. It writes the live scroll offset into a
 *                   UI-thread shared value owned by TopSheet.
 *   - `nativeGestureRef` — a ref to a `Gesture.Native()` that TopSheet composes
 *                   `Gesture.Simultaneous(...)` with its dismiss-pan. The
 *                   consumer attaches this to its scrollable via
 *                   `<GestureDetector gesture={nativeGesture}>` so the native
 *                   scroll gesture and the dismiss-pan run simultaneously, and
 *                   the dismiss-pan can yield to the scroll.
 *
 * TopSheet then gates its dismiss-pan to ONLY drive the dismiss-translate when
 * the list is at the top (`scrollOffset <= 0`); once the list is scrolled, the
 * pan no-ops and the ScrollView consumes the drag. (Because this is a TOP
 * sheet, "drag up" means BOTH dismiss AND scroll-the-list-down — they MUST be
 * arbitrated by scroll offset, which is exactly what the gate does.)
 *
 * # Default (no provider / compact mode)
 * `useTopSheetScroll()` returns `null` outside a provider. The `compact`
 * heightMode (UniversalCreatorSheet) renders no scrollable and provides no
 * context, so its short content keeps dismiss-dragging from anywhere —
 * unchanged. A consumer that does not consume the context (e.g. a future
 * non-scrolling fixed-70 sheet) is also unaffected.
 *
 * Web: `WebSafeGestureDetector.web` mounts no gesture and `TopSheetWeb` has no
 * dismiss-pan, so the web variant provides no context and consumers fall back
 * to a plain `ScrollView` (which already scrolls fine on web).
 */

import React, { createContext, useContext } from "react";
import type { GestureType } from "react-native-gesture-handler";
import type { useAnimatedScrollHandler } from "react-native-reanimated";

/** A reanimated scroll handler as produced by `useAnimatedScrollHandler`. */
type AnimatedScrollHandler = ReturnType<typeof useAnimatedScrollHandler>;

export interface TopSheetScrollContextValue {
  /**
   * Wire onto the consumer's scrollable (`Animated.ScrollView`'s `onScroll`).
   * Writes the live scroll offset into TopSheet's UI-thread shared value so the
   * dismiss-pan can gate on it.
   */
  onScroll: AnimatedScrollHandler;
  /**
   * Attach to the consumer's scrollable via
   * `<GestureDetector gesture={nativeGesture}>` so the native scroll gesture is
   * composed `Gesture.Simultaneous(...)` with TopSheet's dismiss-pan.
   */
  nativeGesture: GestureType;
}

const TopSheetScrollContext = createContext<TopSheetScrollContextValue | null>(
  null,
);

export const TopSheetScrollProvider = TopSheetScrollContext.Provider;

/**
 * Returns the TopSheet scroll-coordination handle, or `null` when not rendered
 * inside a `TopSheetNative` (web variant, compact mode, or no provider). A
 * `null` return means the consumer must fall back to a plain `ScrollView`.
 */
export function useTopSheetScroll(): TopSheetScrollContextValue | null {
  return useContext(TopSheetScrollContext);
}

export default TopSheetScrollContext;
