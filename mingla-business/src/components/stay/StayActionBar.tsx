/**
 * #1532 [stay-manager-ux] §2.4 — the Stay manager's pinned bottom action bar.
 *
 * Nothing in the Stay manager was pinned. `stay-offering-save`,
 * `stay-settings-save`, `stay-publish` and `stay-availability-save` all sat
 * inline at the bottom of a long scroll, under 144pt of dead padding sized for
 * a bottom nav that `/venue/[venueId]` does not render. So the primary action
 * of every module was somewhere below the fold, and the operator had to scroll
 * to find out whether there even was one.
 *
 * D5, CONFIRMED BY SETH: the bar HIDES while the keyboard is visible; the
 * sticky-footer-that-rides-the-keyboard alternative was considered and dropped.
 * Two reasons, both measured:
 *   - `KeyboardToolbarRoot` already owns the slot directly above the keyboard,
 *     so a second bar would stack two chrome bands into a ~470pt band and eat
 *     ~160pt of it;
 *   - `SmartScrollView` already scrolls the focused field clear of that
 *     toolbar, so the bar buys nothing while typing and costs a third of the
 *     visible form.
 *
 * The geometry is lifted VERBATIM from the shipped trip dock
 * (`EditPublishedTripScreen.tsx` `styles.dock` + its `useKeyboardIsVisible()`
 * hide) rather than reinvented — same product, same bar, one behaviour.
 *
 * On WEB `useKeyboardIsVisible()` is a constant `false` (there is no soft
 * keyboard to react to), so the bar simply stays put — which is correct there.
 */

import React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  color,
  space,
  materials,
} from "../../constants/designSystem";
import { useKeyboardIsVisible } from "../../wrappers/useKeyboardIsVisible";

export interface StayActionBarProps {
  children: React.ReactNode;
  testID?: string;
}

export function StayActionBar({
  children,
  testID,
}: StayActionBarProps): React.ReactElement | null {
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardIsVisible();

  if (keyboardVisible) return null;

  return (
    <View
      style={[styles.bar, { paddingBottom: insets.bottom + space[4] }]}
      testID={testID}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: space[4],
    paddingHorizontal: space[4],
    // Opaque, not glass: content scrolls UNDER this bar, and a translucent
    // fill would let a half-scrolled input ghost through the primary action.
    backgroundColor: materials.pane.solidFill,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
});

export default StayActionBar;
