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

  // ORCH-1116 [Hub multi-select draft delete] — Medium-impact "you grabbed
  // something" haptic fired once at the long-press delayLongPress threshold
  // (select-mode enter). Distinct from buttonPress() (Light, reused for every
  // per-row toggle). Additive; mirrors the existing safe-wrap. Native-only —
  // safeHaptic no-ops on web.
  static selectionEnter() {
    HapticFeedback.safeHaptic(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    });
  }
}
