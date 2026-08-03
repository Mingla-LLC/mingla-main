import * as Haptics from 'expo-haptics';

// Haptic feedback utility for consistent user feedback
export class HapticFeedback {
  // Helper method to safely call haptic functions
  private static safeHaptic(callback: () => void) {
    try {
      if (Haptics && typeof callback === 'function') {
        callback();
      }
    } catch (error) {
      console.warn('Haptic feedback not available:', error);
    }
  }

  // Light haptic for subtle interactions
  static light() {
    HapticFeedback.safeHaptic(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    });
  }

  // Medium haptic for standard interactions
  static medium() {
    HapticFeedback.safeHaptic(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    });
  }

  // Heavy haptic for important interactions
  static heavy() {
    HapticFeedback.safeHaptic(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    });
  }

  // Success haptic for positive actions
  static success() {
    HapticFeedback.safeHaptic(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
  }

  // Warning haptic for cautionary actions
  static warning() {
    HapticFeedback.safeHaptic(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    });
  }

  // Error haptic for negative actions
  static error() {
    HapticFeedback.safeHaptic(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    });
  }

  // Selection haptic for UI element selection
  static selection() {
    HapticFeedback.safeHaptic(() => {
      Haptics.selectionAsync();
    });
  }

  // Custom haptic patterns for specific app interactions
  static cardSwipe() {
    HapticFeedback.light();
  }

  static cardLike() {
    HapticFeedback.success();
  }

  static cardDislike() {
    HapticFeedback.light();
  }

  static buttonPress() {
    HapticFeedback.light();
  }

  static toggleSwitch() {
    HapticFeedback.selection();
  }

  static sliderMove() {
    HapticFeedback.light();
  }

  static longPress() {
    HapticFeedback.medium();
  }

  static pullToRefresh() {
    HapticFeedback.medium();
  }

  static navigation() {
    HapticFeedback.selection();
  }

  static save() {
    HapticFeedback.success();
  }

  static delete() {
    HapticFeedback.warning();
  }

  static share() {
    HapticFeedback.light();
  }
}

// Hook for easy haptic feedback in components
export const useHapticFeedback = () => {
  return {
    light: HapticFeedback.light,
    medium: HapticFeedback.medium,
    heavy: HapticFeedback.heavy,
    success: HapticFeedback.success,
    warning: HapticFeedback.warning,
    error: HapticFeedback.error,
    selection: HapticFeedback.selection,
    cardSwipe: HapticFeedback.cardSwipe,
    cardLike: HapticFeedback.cardLike,
    cardDislike: HapticFeedback.cardDislike,
    buttonPress: HapticFeedback.buttonPress,
    toggleSwitch: HapticFeedback.toggleSwitch,
    sliderMove: HapticFeedback.sliderMove,
    longPress: HapticFeedback.longPress,
    pullToRefresh: HapticFeedback.pullToRefresh,
    navigation: HapticFeedback.navigation,
    save: HapticFeedback.save,
    delete: HapticFeedback.delete,
    share: HapticFeedback.share,
  };
};
