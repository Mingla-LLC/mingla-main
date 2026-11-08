// issue #1023 — native Reduce Motion, live (the setting can change while the
// page is open).
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useReduceMotionPreference(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduce(enabled);
      })
      .catch((error: unknown) => {
        console.warn("[theme-motion] could not read Reduce Motion", error);
      });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      setReduce(enabled);
    });
    return () => {
      mounted = false;
      // react-native-web returns no subscription for this event.
      sub?.remove();
    };
  }, []);
  return reduce;
}
