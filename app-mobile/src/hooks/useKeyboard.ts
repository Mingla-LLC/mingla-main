import { useEffect, useState, useCallback, useRef } from "react";
import {
  Keyboard,
  Platform,
  KeyboardEvent,
  LayoutAnimation,
  UIManager,
} from "react-native";

// Enable LayoutAnimation on Android
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export interface KeyboardState {
  /** Whether the keyboard is currently visible */
  isVisible: boolean;
  /** The current keyboard height in points (0 when hidden) */
  keyboardHeight: number;
  /** Dismiss the keyboard programmatically */
  dismiss: () => void;
}

/**
 * useKeyboard – Universal hook for keyboard awareness on iOS & Android.
 *
 * Subscribes to the platform-appropriate keyboard events and returns:
 *  • isVisible  – boolean
 *  • keyboardHeight – number (0 when hidden)
 *  • dismiss() – helper to close the keyboard
 *
 * Usage:
 *   const { isVisible, keyboardHeight, dismiss } = useKeyboard();
 *   // Use keyboardHeight as bottom padding on your input container.
 */
export function useKeyboard(): KeyboardState {
  const [isVisible, setIsVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Keep a ref so we never get stale closures in cleanup
  const heightRef = useRef(0);

  useEffect(() => {
    // iOS fires "will" events before the animation begins (smoother).
    // Android only reliably fires "did" events.
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const onShow = (e: KeyboardEvent) => {
      const height = e.endCoordinates.height;
      heightRef.current = height;

      // Animate the layout change for a smooth transition
      if (Platform.OS === "android") {
        LayoutAnimation.configureNext(
          LayoutAnimation.create(
            e.duration || 220,
            LayoutAnimation.Types.easeInEaseOut,
            LayoutAnimation.Properties.opacity
          )
        );
      }

      setKeyboardHeight(height);
      setIsVisible(true);
    };

    const onHide = (e: KeyboardEvent) => {
      heightRef.current = 0;

      if (Platform.OS === "android") {
        LayoutAnimation.configureNext(
          LayoutAnimation.create(
            e?.duration || 220,
            LayoutAnimation.Types.easeInEaseOut,
            LayoutAnimation.Properties.opacity
          )
        );
      }

      setKeyboardHeight(0);
      setIsVisible(false);
    };

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const dismiss = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  return { isVisible, keyboardHeight, dismiss };
}
