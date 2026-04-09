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
 * Optional `onShow` callback fires with the final keyboard height the moment
 * the keyboard event fires — use this instead of setTimeout hacks to scroll
 * focused inputs into view.
 *
 * Usage:
 *   const { isVisible, keyboardHeight, dismiss } = useKeyboard({
 *     onShow: (height) => scrollFieldIntoView(height),
 *   });
 */
export function useKeyboard(opts?: {
  onShow?: (height: number) => void;
  onHide?: () => void;
  /** Skip LayoutAnimation on keyboard events (needed when using animated scrollTo). */
  disableLayoutAnimation?: boolean;
}): KeyboardState {
  const [isVisible, setIsVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Keep a ref so we never get stale closures in cleanup
  const heightRef = useRef(0);
  const onShowRef = useRef(opts?.onShow);
  const onHideRef = useRef(opts?.onHide);
  const disableLayoutAnimRef = useRef(opts?.disableLayoutAnimation ?? false);
  /** Android IME often emits spurious keyboardDidHide while typing; delay committing hide. */
  const androidHideDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  onShowRef.current = opts?.onShow;
  onHideRef.current = opts?.onHide;
  disableLayoutAnimRef.current = opts?.disableLayoutAnimation ?? false;

  useEffect(() => {
    // iOS fires "will" events before the animation begins (smoother).
    // Android only reliably fires "did" events.
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const clearAndroidHideDebounce = () => {
      if (androidHideDebounceRef.current) {
        clearTimeout(androidHideDebounceRef.current);
        androidHideDebounceRef.current = null;
      }
    };

    const onShow = (e: KeyboardEvent) => {
      if (Platform.OS === "android") {
        clearAndroidHideDebounce();
      }

      const height = e.endCoordinates.height;
      heightRef.current = height;

      // Animate the layout change for a smooth transition
      // (skipped when caller uses animated scrollTo — LayoutAnimation fights it)
      if (Platform.OS === "android" && !disableLayoutAnimRef.current) {
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
      onShowRef.current?.(height);
    };

    const commitHide = (e?: KeyboardEvent) => {
      heightRef.current = 0;

      if (Platform.OS === "android" && !disableLayoutAnimRef.current) {
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
      onHideRef.current?.();
    };

    const onHide = (e: KeyboardEvent) => {
      if (Platform.OS === "android") {
        clearAndroidHideDebounce();
        androidHideDebounceRef.current = setTimeout(() => {
          androidHideDebounceRef.current = null;
          commitHide(e);
        }, 160);
        return;
      }
      commitHide(e);
    };

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);

    return () => {
      clearAndroidHideDebounce();
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const dismiss = useCallback(() => {
    if (Platform.OS === "android" && androidHideDebounceRef.current) {
      clearTimeout(androidHideDebounceRef.current);
      androidHideDebounceRef.current = null;
    }
    heightRef.current = 0;
    setKeyboardHeight(0);
    setIsVisible(false);
    Keyboard.dismiss();
  }, []);

  return { isVisible, keyboardHeight, dismiss };
}
