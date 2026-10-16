import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
} from "react-native";
import type { View } from "react-native";

interface FocusCapable {
  focus: () => void;
}

function hasFocusCapability(value: unknown): value is FocusCapable {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "focus" in value &&
    typeof value.focus === "function"
  );
}

/**
 * #3720 — Move accessibility focus to a Community deep-link target without
 * sending react-native-web through the native-only findNodeHandle path.
 */
export function focusCommunityTargetNode(node: View | null): void {
  if (node === null) return;
  if (Platform.OS === "web") {
    if (hasFocusCapability(node)) node.focus();
    return;
  }

  const nativeTag = findNodeHandle(node);
  if (nativeTag !== null) AccessibilityInfo.setAccessibilityFocus(nativeTag);
}
