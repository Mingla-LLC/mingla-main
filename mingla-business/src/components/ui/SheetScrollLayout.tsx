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
 * keyboardAware (sheets with an input): the column is the library
 * KeyboardAvoidingView (web: a plain View, ORCH-0892), so the footer and the
 * focused field stay above the keyboard and its Done bar. The Sheet primitive
 * itself owns no keyboard logic (ORCH-0892-B v2).
 *
 * MINGLA-INVARIANT: I-4389-SHEET-BOUNDED-SCROLL-BODY | issue #4389 | Every bottom sheet #4389 added or changed renders its content in SheetScrollLayout (or its own ScrollView body) inside a snap point of "half" or "full", with its buttons in the pinned footer. Enforced by issue_4389_sheets_bounded.implementor.test.tsx.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { spacing } from "../../constants/designSystem";
import { DONE_BAR_OCCUPIED, ScrollView } from "../../wrappers/SmartScrollView";
import { KeyboardAvoidingView } from "../../wrappers/SmartKeyboardAvoidingView";

export interface SheetScrollLayoutProps {
  children: React.ReactNode;
  /** The sheet's buttons, pinned under the scroll area. */
  footer?: React.ReactNode;
  /** The sheet holds an input: lift the footer above the keyboard. */
  keyboardAware?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export const SheetScrollLayout: React.FC<SheetScrollLayoutProps> = ({
  children,
  footer,
  keyboardAware = false,
  contentStyle,
  testID,
}) => {
  const body = (
    <>
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
    </>
  );
  if (keyboardAware) {
    return (
      <View style={styles.root} testID={testID}>
        <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={DONE_BAR_OCCUPIED} style={styles.root}>
          {body}
        </KeyboardAvoidingView>
      </View>
    );
  }
  return (
    <View style={styles.root} testID={testID}>
      {body}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.md, gap: spacing.sm },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
});

export default SheetScrollLayout;
