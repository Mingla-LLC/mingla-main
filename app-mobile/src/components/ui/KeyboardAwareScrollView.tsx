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

/**
 * Measure a view's position on screen. Works in both the old (Bridge) and
 * new (Bridgeless/Fabric) React Native architectures.
 *
 * New arch: `UIManager.measureInWindow` is removed — call the method
 * directly on the native node/ref instead.
 */
function measureInWindow(
  nodeOrHandle: any,
  callback: (x: number, y: number, w: number, h: number) => void
): void {
  // New architecture — the node itself exposes measureInWindow
  if (typeof nodeOrHandle?.measureInWindow === "function") {
    nodeOrHandle.measureInWindow(callback);
    return;
  }
  // Old architecture — go through UIManager
  if (typeof UIManager.measureInWindow === "function") {
    const handle =
      typeof nodeOrHandle === "number"
        ? nodeOrHandle
        : findNodeHandle(nodeOrHandle);
    if (handle) {
      UIManager.measureInWindow(handle, callback);
      return;
    }
  }
  // Neither path available — silently skip
}
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
 *  - Keyboard already open when tapping between inputs (re-fires on every
 *    keyboardWillShow / keyboardDidShow event)
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
     * Check whether `child` is a descendant of `ancestor` in the native
     * view hierarchy.  Works on both old arch (findNodeHandle → number)
     * and new arch (host-component refs that expose measureLayout).
     *
     * Returns `true` only when we can positively confirm ancestry.
     * Returns `false` when we cannot confirm (missing refs, cross-modal
     * inputs, etc.) — callers should skip scrolling in that case.
     */
    const isDescendant = useCallback(
      (ancestor: any, child: any): Promise<boolean> =>
        new Promise((resolve) => {
          try {
            // New arch: the child ref exposes measureLayout directly
            if (typeof child?.measureLayout === "function") {
              child.measureLayout(
                ancestor,
                () => resolve(true), // success → child is inside ancestor
                () => resolve(false) // failure → not a descendant
              );
              return;
            }

            // Old arch: use findNodeHandle + UIManager.measureLayout
            const ancestorHandle =
              typeof ancestor === "number"
                ? ancestor
                : findNodeHandle(ancestor);
            const childHandle =
              typeof child === "number" ? child : findNodeHandle(child);

            if (!ancestorHandle || !childHandle) {
              resolve(false);
              return;
            }

            UIManager.measureLayout(
              childHandle,
              ancestorHandle,
              () => resolve(false), // error → not a descendant
              () => resolve(true) // success → is a descendant
            );
          } catch {
            resolve(false);
          }
        }),
      []
    );

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

        setTimeout(async () => {
          try {
            const scrollNode =
              scrollViewRef.current ?? findNodeHandle(scrollViewRef.current);
            if (!scrollNode) return;

            // Guard: only scroll to inputs that are inside THIS scroll view.
            // Prevents ghost-scrolling when a nested modal (e.g. CountryPickerModal)
            // focuses its own TextInput — the keyboard event fires globally but
            // the focused input isn't in our view tree.
            const inside = await isDescendant(scrollNode, focusedInput);
            if (!inside) return;

            // Measure ScrollView position on screen
            measureInWindow(
              scrollNode,
              (_svX: number, svY: number, _svW: number, _svH: number) => {
                // Measure focused input position on screen
                measureInWindow(
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
      [bottomOffset, keyboardPadding, isDescendant]
    );

    // Use the hook's returned STATE (not just a ref) so re-renders happen
    // and extraPadding is computed correctly. Also disable LayoutAnimation
    // so it doesn't fight our animated scrollTo.
    const { keyboardHeight } = useKeyboard({
      onShow: (height) => {
        scrollToFocusedInput(height);
      },
      disableLayoutAnimation: true,
    });

    const handleScroll = useCallback(
      (event: any) => {
        scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
        onScroll?.(event);
      },
      [onScroll]
    );

    // Add bottom padding so the last input can scroll above the keyboard.
    // Uses the hook's state value (triggers re-render), not a ref.
    const extraPadding =
      keyboardHeight > 0
        ? Math.max(keyboardHeight - bottomOffset, 0) + keyboardPadding
        : 0;

    return (
      <ScrollView
        ref={scrollViewRef}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        scrollEventThrottle={16}
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
