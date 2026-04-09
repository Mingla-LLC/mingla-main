import React, { PropsWithChildren } from "react";
import {
  View,
  StyleSheet,
  ViewStyle,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
  StyleProp,
} from "react-native";
import { useKeyboard } from "../../hooks/useKeyboard";

interface KeyboardAwareViewProps {
  /**
   * Extra bottom offset (e.g. for tab bars or bottom navs that sit below).
   * The component will subtract this from the keyboard height so the input
   * doesn't overshoot.  Default: 0
   */
  bottomOffset?: number;

  /**
   * When true, tapping the non-input area dismisses the keyboard.
   * Default: true
   */
  dismissOnTap?: boolean;

  /**
   * Optional style applied to the outer container (takes flex:1 by default).
   */
  style?: StyleProp<ViewStyle>;

  /**
   * Optional style for the inner content wrapper.
   */
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/**
 * KeyboardAwareView – drop-in wrapper that pushes content up when the
 * soft keyboard appears on **both** Android and iOS.
 *
 * Note: If `expo.android.softwareKeyboardLayoutMode` is `"pan"` (Mingla’s default),
 * the activity window does not resize like `adjustResize`; manual padding (this
 * component or an animated `marginBottom` on the composer) is required on Android.
 *
 * When a bottom tab bar sits between your content and the keyboard, pass its total
 * height as `bottomOffset` (or subtract it from keyboard-driven lift) so you don’t
 * double-count that strip — see MessageInterface + `useAppLayout().bottomNavTotalHeight`.
 *
 * Unlike the built-in KeyboardAvoidingView, this component:
 *  • Works reliably **inside modals** (a common Android pain-point).
 *  • Uses dynamic paddingBottom instead of layout behavior heuristics.
 *  • Uses LayoutAnimation for a smooth native-grade transition.
 *  • Optionally dismisses the keyboard when the user taps outside input.
 *
 * Usage:
 *   <KeyboardAwareView>
 *     <ScrollView>…messages…</ScrollView>
 *     <InputBar />
 *   </KeyboardAwareView>
 */
export const KeyboardAwareView: React.FC<
  PropsWithChildren<KeyboardAwareViewProps>
> = ({
  children,
  bottomOffset = 0,
  dismissOnTap = true,
  style,
  contentContainerStyle,
}) => {
  const { isVisible, keyboardHeight, dismiss } = useKeyboard();

  // Effective padding: keyboard height minus any persistent bottom chrome
  const effectivePadding = isVisible
    ? Math.max(keyboardHeight - bottomOffset, 0)
    : 0;

  const content = (
    <View
      style={[
        styles.container,
        style,
        { paddingBottom: effectivePadding },
        contentContainerStyle,
      ]}
    >
      {children}
    </View>
  );

  if (dismissOnTap) {
    return (
      <TouchableWithoutFeedback onPress={dismiss} accessible={false}>
        {content}
      </TouchableWithoutFeedback>
    );
  }

  return content;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default KeyboardAwareView;
