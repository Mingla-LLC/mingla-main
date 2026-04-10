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
}
