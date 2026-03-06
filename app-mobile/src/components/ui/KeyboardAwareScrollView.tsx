import React, {
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  ScrollView,
  ScrollViewProps,
  Platform,
  Dimensions,
  TextInput,
  findNodeHandle,
  UIManager,
  StyleProp,
  ViewStyle,
} from "react-native";
import { useKeyboard } from "../../hooks/useKeyboard";

const SCREEN_HEIGHT = Dimensions.get("window").height;

/**
 * Breathing room between the bottom of the focused input and the top of
 * the keyboard. Feels premium — not cramped, not wasteful.
 */
const KEYBOARD_PADDING = 40;

interface KeyboardAwareScrollViewProps extends ScrollViewProps {
  /**
   * Extra bottom offset subtracted from keyboard height (e.g. for tab bars
   * or persistent footers that sit below the scroll area). Default: 0
   */
  bottomOffset?: number;

  /**
   * Override the breathing room between input bottom and keyboard top.
   * Default: 40
   */
  keyboardPadding?: number;
}

/**
 * KeyboardAwareScrollView — drop-in ScrollView replacement that
 * automatically scrolls the currently focused TextInput to sit just
 * above the keyboard, with breathing room, on both iOS and Android.
 *
 * How it works:
 *  1. Listens for the keyboard-show event via useKeyboard's onShow callback.
 *  2. On show, finds the currently focused TextInput using RN's
 *     TextInput.State.currentlyFocusedInput().
 *  3. Measures the input's position on screen (measureInWindow).
 *  4. Measures the ScrollView's position on screen.
 *  5. Calculates exactly how much to scroll so the input's bottom edge
 *     sits KEYBOARD_PADDING pixels above the keyboard's top edge.
 *  6. Executes a smooth animated scroll.
 *
 * Handles:
 *  - Inputs at the top, middle, and bottom of long scrollable content
 *  - Inputs inside nested Views
 *  - Modals on Android (where KeyboardAvoidingView breaks)
 *  - Already-visible inputs (no unnecessary scroll)
 *  - Keyboard already open when tapping between inputs
 *
 * Usage:
 *   Replace <ScrollView> with <KeyboardAwareScrollView>.
 *   That's it. No refs, no onFocus wiring, no manual scroll calls.
 */
const KeyboardAwareScrollView = forwardRef<
  ScrollView,
  KeyboardAwareScrollViewProps
>(
  (
    {
      children,
      bottomOffset = 0,
      keyboardPadding = KEYBOARD_PADDING,
      contentContainerStyle,
      onScroll,
      ...scrollViewProps
    },
    ref
  ) => {
    const scrollViewRef = useRef<ScrollView>(null);
    const scrollOffsetRef = useRef(0);

    useImperativeHandle(ref, () => scrollViewRef.current as ScrollView);

    /**
     * Given the real keyboard height (from the keyboard event, not a guess),
     * find and scroll to the focused input.
     */
    const scrollToFocusedInput = useCallback(
      (kbHeight: number) => {
        // Find the currently focused TextInput
        const focusedInput =
          (TextInput.State as any).currentlyFocusedInput?.() ??
          (TextInput.State as any).currentlyFocusedField?.();

        if (!focusedInput || !scrollViewRef.current) return;

        const effectiveKbHeight = Math.max(kbHeight - bottomOffset, 0);

        // Small delay so layout has settled — iOS animates from willShow,
        // Android fires after didShow. Both need a beat for measurement.
        const delay = Platform.OS === "ios" ? 50 : 80;

        setTimeout(() => {
          try {
            const scrollNode = findNodeHandle(scrollViewRef.current);
            if (!scrollNode) return;

            // Measure ScrollView position on screen
            UIManager.measureInWindow(
              scrollNode,
              (_svX: number, svY: number, _svW: number, svH: number) => {
                // Measure focused input position on screen
                UIManager.measureInWindow(
                  focusedInput,
                  (
                    _fX: number,
                    fY: number,
                    _fW: number,
                    fH: number
                  ) => {
                    // Where the keyboard starts on screen
                    const keyboardTop = SCREEN_HEIGHT - effectiveKbHeight;
                    // Where the input's bottom edge is on screen
                    const inputBottom = fY + fH;
                    // How much the input overshoots past the safe zone
                    const overshoot =
                      inputBottom - (keyboardTop - keyboardPadding);

                    if (overshoot > 0) {
                      scrollViewRef.current?.scrollTo({
                        y: scrollOffsetRef.current + overshoot,
                        animated: true,
                      });
                    } else if (fY < svY) {
                      // Input is above the visible area — scroll up
                      const undershoot = svY - fY + keyboardPadding;
                      scrollViewRef.current?.scrollTo({
                        y: Math.max(
                          0,
                          scrollOffsetRef.current - undershoot
                        ),
                        animated: true,
                      });
                    }
                  }
                );
              }
            );
          } catch {
            // View may have unmounted during async measure
          }
        }, delay);
      },
      [bottomOffset, keyboardPadding]
    );

    const kbHeightRef = useRef(0);

    /**
     * When the keyboard is already open and the user taps a different
     * input, we need to re-scroll. We detect this via onFocus propagation
     * on the ScrollView container (TextInput focus bubbles up).
     */
    const handleFocusCapture = useCallback(() => {
      // If keyboard is already visible, scroll to the newly focused input
      if (kbHeightRef.current > 0) {
        // Slight delay so the new TextInput registers as focused
        setTimeout(() => {
          scrollToFocusedInput(kbHeightRef.current);
        }, 100);
      }
    }, [scrollToFocusedInput]);

    useKeyboard({
      onShow: (height) => {
        kbHeightRef.current = height;
        scrollToFocusedInput(height);
      },
      onHide: () => {
        kbHeightRef.current = 0;
      },
    });

    const handleScroll = useCallback(
      (event: any) => {
        scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
        onScroll?.(event);
      },
      [onScroll]
    );

    // Add bottom padding so the last input can scroll above the keyboard
    const extraPadding =
      kbHeightRef.current > 0
        ? Math.max(kbHeightRef.current - bottomOffset, 0) + keyboardPadding
        : 0;

    return (
      <ScrollView
        ref={scrollViewRef}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        scrollEventThrottle={16}
        onFocusCapture={handleFocusCapture}
        {...scrollViewProps}
        onScroll={handleScroll}
        contentContainerStyle={[
          contentContainerStyle,
          extraPadding > 0 && { paddingBottom: extraPadding },
        ]}
      >
        {children}
      </ScrollView>
    );
  }
);

KeyboardAwareScrollView.displayName = "KeyboardAwareScrollView";

export { KeyboardAwareScrollView };
export type { KeyboardAwareScrollViewProps };
