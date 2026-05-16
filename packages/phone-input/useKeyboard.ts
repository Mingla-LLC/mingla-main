/**
 * useKeyboard — universal keyboard-awareness hook.
 *
 * Per ORCH-0847 Phase A — extracted verbatim from
 * `app-mobile/src/hooks/useKeyboard.ts` so the shared package is
 * self-contained. Consumer-app's hook is replaced by a re-export
 * thin wrapper at the original path.
 */

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

export function useKeyboard(opts?: {
  onShow?: (height: number) => void;
  onHide?: () => void;
  /** Skip LayoutAnimation on keyboard events (needed when using animated scrollTo). */
  disableLayoutAnimation?: boolean;
}): KeyboardState {
  const [isVisible, setIsVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const heightRef = useRef(0);
  const onShowRef = useRef(opts?.onShow);
  const onHideRef = useRef(opts?.onHide);
  const disableLayoutAnimRef = useRef(opts?.disableLayoutAnimation ?? false);
  const androidHideDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  onShowRef.current = opts?.onShow;
  onHideRef.current = opts?.onHide;
  disableLayoutAnimRef.current = opts?.disableLayoutAnimation ?? false;

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const clearAndroidHideDebounce = (): void => {
      if (androidHideDebounceRef.current) {
        clearTimeout(androidHideDebounceRef.current);
        androidHideDebounceRef.current = null;
      }
    };

    const onShow = (e: KeyboardEvent): void => {
      if (Platform.OS === "android") {
        clearAndroidHideDebounce();
      }

      const height = e.endCoordinates.height;
      heightRef.current = height;

      if (Platform.OS === "android" && !disableLayoutAnimRef.current) {
        LayoutAnimation.configureNext(
          LayoutAnimation.create(
            e.duration || 220,
            LayoutAnimation.Types.easeInEaseOut,
            LayoutAnimation.Properties.opacity,
          ),
        );
      }

      setKeyboardHeight(height);
      setIsVisible(true);
      onShowRef.current?.(height);
    };

    const commitHide = (e?: KeyboardEvent): void => {
      heightRef.current = 0;

      if (Platform.OS === "android" && !disableLayoutAnimRef.current) {
        LayoutAnimation.configureNext(
          LayoutAnimation.create(
            e?.duration || 220,
            LayoutAnimation.Types.easeInEaseOut,
            LayoutAnimation.Properties.opacity,
          ),
        );
      }

      setKeyboardHeight(0);
      setIsVisible(false);
      onHideRef.current?.();
    };

    const onHide = (e: KeyboardEvent): void => {
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

    return (): void => {
      clearAndroidHideDebounce();
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const dismiss = useCallback((): void => {
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
