/**
 * #4389 — the body of a bottom Sheet: content that scrolls INSIDE the panel,
 * and a footer (the sheet's buttons) pinned to the bottom of the panel.
 *
 * The Sheet panel has a fixed, bounded height (computeSheetHeight: a snap
 * ratio of the screen, never above 95%) and clips what does not fit. A plain
 * View body therefore pushed its buttons out of the panel on a small phone at
 * a large text size. This layout keeps the buttons visible: the scroll area
 * takes the room that is left above them.
 *
 * keyboardAware (sheets with an input): the column lifts by the keyboard's
 * height (useKeyboardHeight, library-backed; 0 on web) plus the Done bar,
 * less what the panel already keeps below the footer (its bottom padding and
 * the bottom safe area), so the footer and the focused field stay above the
 * keyboard. The Sheet primitive owns no keyboard logic (ORCH-0892-B v2).
 * #4389 (device r4): the library KeyboardAvoidingView did not lift inside the
 * Sheet's Modal window (it measures its own frame relative to its parent, and
 * the panel is a fixed-height, bottom-docked box), so Back / Delete brand and
 * Save sat behind the keyboard.
 *
 * Invariant I-4389-SHEET-BOUNDED-SCROLL-BODY | issue #4389 | Every bottom sheet #4389 added or changed renders its content in SheetScrollLayout (or its own ScrollView body) inside a snap point of "half" or "full", with its buttons in the pinned footer. Enforced by issue_4389_sheets_bounded.implementor.test.tsx.
 */
import React, { useContext } from "react";
import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { color, space } from "../../constants/designSystem";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DONE_BAR_OCCUPIED, ScrollView } from "../../wrappers/SmartScrollView";
import { useKeyboardHeight } from "../../wrappers/useKeyboardHeight";
import { SheetKeyboardContext } from "./sheetKeyboardContext";

/**
 * How far the sheet's footer must rise for the keyboard (and its Done bar).
 * The panel already keeps `spacing.lg + insets.bottom` under its content
 * (SheetMobile body padding), which the keyboard covers first.
 */
export function sheetKeyboardLift(keyboardHeight: number, bottomInset: number): number {
  if (keyboardHeight <= 0) return 0;
  return Math.max(0, keyboardHeight + DONE_BAR_OCCUPIED - (space[6] + bottomInset));
}

export interface SheetScrollLayoutProps {
  children: React.ReactNode;
  /** The sheet's buttons, pinned under the scroll area. */
  footer?: React.ReactNode;
  /** The sheet holds an input: lift the footer above the keyboard. */
  keyboardAware?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export const SheetScrollLayout: React.FC<SheetScrollLayoutProps> = (props) =>
  props.keyboardAware === true ? <KeyboardLiftedLayout {...props} /> : <Layout {...props} lift={0} />;

/**
 * Only keyboard-aware sheets subscribe to the keyboard. #4420 (device round
 * 2): inside the native bottom Sheet the panel body itself now clears the
 * keyboard + Done bar (SheetKeyboardContext is set), so the layout adds no
 * lift of its own there; lifting again would float the footer a keyboard-high
 * above the bar. Outside that sheet (no context) it keeps its own lift.
 */
const KeyboardLiftedLayout: React.FC<SheetScrollLayoutProps> = (props) => {
  const keyboardHeight = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  const sheet = useContext(SheetKeyboardContext);
  const lift = sheet === null ? sheetKeyboardLift(keyboardHeight, insets.bottom) : 0;
  return <Layout {...props} lift={lift} />;
};

const Layout: React.FC<SheetScrollLayoutProps & { lift: number }> = ({
  children,
  footer,
  contentStyle,
  testID,
  lift,
}) => (
  <View style={[styles.root, lift > 0 ? { paddingBottom: lift } : null]} testID={testID}>
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, contentStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator
      testID={testID !== undefined ? `${testID}-scroll` : undefined}
    >
      {children}
    </ScrollView>
    {footer !== undefined && footer !== null ? (
      <View style={styles.footer} testID={testID !== undefined ? `${testID}-footer` : undefined}>
        {footer}
      </View>
    ) : null}
  </View>
);

// #4420: the sheet body already pads 20 on each side (kit `.sheet-body`), so
// the layout adds no horizontal padding of its own. The footer is the kit's
// sticky foot: a hairline top, 12 above the buttons, 8 between them.
const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingTop: space[1], paddingBottom: space[4], gap: space[3] },
  footer: {
    paddingTop: space[3],
    gap: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
});

export default SheetScrollLayout;
