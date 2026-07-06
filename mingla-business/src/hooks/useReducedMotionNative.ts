/**
 * useReducedMotionNative — RN-core reduce-motion source (NO react-native-reanimated).
 *
 * ORCH-1320: `BottomNav` was de-worklet-ed off `react-native-reanimated` (its
 * worklet-driven spotlight raced the Fabric mount-commit on the New Architecture
 * → EXC_BAD_ACCESS use-after-free; Apple rejection 3). Reanimated's
 * `useReducedMotion` hook went with it, so this hook re-sources the "reduce
 * motion" accessibility preference from RN core `AccessibilityInfo` with ZERO
 * reanimated import. Only `BottomNav` consumes it; `ProvenanceChip` keeps its own
 * `useReducedMotion` (out of scope — not on the tap-Account mount-commit path).
 */

import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useReducedMotionNative(): boolean {
  const [reduceMotion, setReduceMotion] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch((err: unknown) => {
        // Fail open (motion enabled) but never swallow silently.
        if (__DEV__) {
          console.warn("[useReducedMotionNative] init failed:", err);
        }
      });

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled: boolean) => {
        if (mounted) setReduceMotion(enabled);
      },
    );

    return (): void => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

export default useReducedMotionNative;
