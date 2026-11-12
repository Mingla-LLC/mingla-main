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
import React from "react";
import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { spacing } from "../../constants/designSystem";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DONE_BAR_OCCUPIED, ScrollView } from "../../wrappers/SmartScrollView";
import { useKeyboardHeight } from "../../wrappers/useKeyboardHeight";

/**
 * How far the sheet's footer must rise for the keyboard (and its Done bar).
 * The panel already keeps `spacing.lg + insets.bottom` under its content
 * (SheetMobile body padding), which the keyboard covers first.
 */
export function sheetKeyboardLift(keyboardHeight: number, bottomInset: number): number {
  if (keyboardHeight <= 0) return 0;
  return Math.max(0, keyboardHeight + DONE_BAR_OCCUPIED - (spacing.lg + bottomInset));
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

/** Only keyboard-aware sheets subscribe to the keyboard. */
const KeyboardLiftedLayout: React.FC<SheetScrollLayoutProps> = (props) => {
  const keyboardHeight = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  return <Layout {...props} lift={sheetKeyboardLift(keyboardHeight, insets.bottom)} />;
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.md, gap: spacing.sm },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
});

export default SheetScrollLayout;
