import * as Haptics from "expo-haptics";

export class HapticFeedback {
  private static safeHaptic(callback: () => void) {
    try {
      callback();
    } catch {
      /* optional */
    }
  }

  static buttonPress() {
    HapticFeedback.safeHaptic(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    });
  }

  // ORCH-1064 — success notification haptic for the venue-claim feedback flow
  // (item flipped to Fixed; claim re-submitted). Additive; mirrors the existing
  // safe-wrap. expo-haptics is already imported. Native-only — safeHaptic
  // no-ops on web.
  static success() {
    HapticFeedback.safeHaptic(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
  }
}
