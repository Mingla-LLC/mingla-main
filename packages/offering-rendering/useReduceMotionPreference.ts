// issue #1023 — native Reduce Motion, live (the setting can change while the
// page is open).
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useReduceMotionPreference(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    // issue #4420 — a host without the API (a stripped test double, an old
    // runtime) keeps full motion rather than crashing the page.
    if (
      AccessibilityInfo === undefined ||
      typeof AccessibilityInfo.isReduceMotionEnabled !== "function"
    ) {
      return undefined;
    }
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduce(enabled);
      })
      .catch((error: unknown) => {
        console.warn("[theme-motion] could not read Reduce Motion", error);
      });
    const sub =
      typeof AccessibilityInfo.addEventListener === "function"
        ? AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
            setReduce(enabled);
          })
        : undefined;
    return () => {
      mounted = false;
      // react-native-web returns no subscription for this event.
      sub?.remove();
    };
  }, []);
  return reduce;
}
