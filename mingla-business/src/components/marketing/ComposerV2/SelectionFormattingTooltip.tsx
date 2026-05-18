/**
 * ORCH-0864 [Marketing Composer V2] Stage F.5 — SelectionFormattingTooltip (pell pivot).
 *
 * Rewritten from TenTap's `useBridgeState` reactive binding to pell's
 * imperative `richEditor.sendAction(actions.setBold)` model.
 *
 * Pell limitation (queued for follow-up ORCH if operator wants polish):
 *   The pills DO NOT highlight to indicate active marks at the current
 *   selection. Pell does expose selection-change events but doesn't surface
 *   per-mark active-state without custom JS injection. Stage F.5 ships
 *   stateless pills — tapping toggles the mark; visual confirmation is
 *   the resulting body render. Operator can polish to active-state via a
 *   future ORCH that injects active-state messaging via commandDOM.
 *
 * Link insertion uses pell's native `insertLink(title, url)` — on iOS the
 * tap raises `Alert.prompt` for URL entry; on Android it falls back to a
 * "use the bar in compose for links" message (consistent with Stage D
 * behaviour).
 */

import React, { useCallback, type RefObject } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { RichEditor, actions } from "react-native-pell-rich-editor";

import {
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";

export interface SelectionFormattingTooltipProps {
  editorRef: RefObject<RichEditor | null>;
}

export function SelectionFormattingTooltip(
  props: SelectionFormattingTooltipProps,
): React.ReactElement {
  const { editorRef } = props;

  const onBold = useCallback((): void => {
    editorRef.current?.sendAction(actions.setBold, "result");
  }, [editorRef]);

  const onItalic = useCallback((): void => {
    editorRef.current?.sendAction(actions.setItalic, "result");
  }, [editorRef]);

  const onLink = useCallback((): void => {
    if (Platform.OS === "ios") {
      Alert.prompt(
        "Insert link",
        "Paste the URL the selected text should link to.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Insert",
            onPress: (url?: string) => {
              const trimmed = (url ?? "").trim();
              if (trimmed.length === 0) return;
              // Pell's insertLink takes (title, url); we pass URL as both
              // so the visible text is the URL itself when no selection.
              editorRef.current?.insertLink(trimmed, trimmed);
            },
          },
        ],
        "plain-text",
        "",
      );
    } else {
      Alert.alert(
        "Insert link",
        "Use the link option in the composer (coming soon on Android — iOS has Alert.prompt).",
      );
    }
  }, [editorRef]);

  return (
    <View style={styles.root} accessibilityLabel="Text formatting toolbar">
      <FormatPill label="B" onPress={onBold} accessibilityLabel="Bold" testID="composer-v2-format-bold" />
      <FormatPill label="I" onPress={onItalic} italic accessibilityLabel="Italic" testID="composer-v2-format-italic" />
      <FormatPill label="Link" onPress={onLink} accessibilityLabel="Insert link" testID="composer-v2-format-link" />
    </View>
  );
}

interface FormatPillProps {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
  italic?: boolean;
  testID?: string;
}

function FormatPill(props: FormatPillProps): React.ReactElement {
  const { label, onPress, accessibilityLabel, italic, testID } = props;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.pill,
        pressed ? styles.pillPressed : null,
      ]}
      testID={testID}
    >
      <Text style={[styles.pillText, italic === true ? styles.pillTextItalic : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: glass.tint.chrome.idle,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.chrome,
  },
  pill: {
    minHeight: 44, // I-WCAG-AA-TOUCH-44PT
    minWidth: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: glass.tint.badge.idle,
    borderColor: glass.border.chrome,
  },
  pillPressed: {
    opacity: 0.7,
  },
  pillText: {
    ...typography.buttonMd,
    fontWeight: "700",
    color: textTokens.secondary,
  },
  pillTextItalic: {
    fontStyle: "italic",
  },
});
