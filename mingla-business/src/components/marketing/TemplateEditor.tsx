/**
 * TemplateEditor — body shared between the read-only / editable / new
 * modes of the Template detail screen (ORCH-0863). Per DESIGN §6.1 + §6.2.
 *
 * Token cheatsheet caption is always rendered. Both `{first_name}` and
 * `{{event:abc}}` token grammars are preserved verbatim — body is a plain
 * <Text> in read-only mode and a plain <TextInput multiline> in editable
 * mode, no regex transform, no escape.
 *
 * Honors `feedback_keyboard_never_blocks_input.md`: editable mode body
 * input has minHeight 192 (≈8 rows × 24pt line-height) so the keyboard
 * never occludes content above the cursor in normal use. Outer route file
 * wraps in KeyboardAvoidingView per the composer pattern.
 *
 * Cross-platform note (DESIGN §10): RN-Web has a known constraint that
 * <TextInput multiline> auto-grow is unsupported — on web the body input
 * stays at minHeight + becomes scrollable internally when content overflows.
 * Acceptable degradation per operator's preview-surface stance.
 */
// ORCH-0863-RN-WEB-GAP: multiline TextInput auto-grow unsupported on web;
// using fixed minHeight + internal scroll (intentional degradation).

import React, { useCallback } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputChangeEventData,
} from "react-native";

import {
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export type TemplateEditorMode = "readonly" | "editable" | "new";

export interface TemplateEditorProps {
  mode: TemplateEditorMode;
  subject: string;
  body: string;
  onSubjectChange?: (next: string) => void;
  onBodyChange?: (next: string) => void;
}

export const TemplateEditor: React.FC<TemplateEditorProps> = ({
  mode,
  subject,
  body,
  onSubjectChange,
  onBodyChange,
}) => {
  const isReadOnly = mode === "readonly";

  const handleSubjectChange = useCallback(
    (e: NativeSyntheticEvent<TextInputChangeEventData>) => {
      if (onSubjectChange !== undefined) {
        onSubjectChange(e.nativeEvent.text);
      }
    },
    [onSubjectChange],
  );

  const handleBodyChange = useCallback(
    (e: NativeSyntheticEvent<TextInputChangeEventData>) => {
      if (onBodyChange !== undefined) {
        onBodyChange(e.nativeEvent.text);
      }
    },
    [onBodyChange],
  );

  return (
    <View style={styles.host}>
      <View style={styles.block}>
        <Text style={styles.label}>SUBJECT</Text>
        {isReadOnly ? (
          <Text style={styles.readonlyText} selectable accessibilityLabel="Subject">
            {subject.length > 0 ? subject : "(no subject)"}
          </Text>
        ) : (
          <TextInput
            value={subject}
            onChange={handleSubjectChange}
            placeholder="Subject line — what your buyers see in their inbox"
            placeholderTextColor={textTokens.quaternary}
            style={styles.input}
            accessibilityLabel="Subject"
            autoCorrect
            autoCapitalize="sentences"
          />
        )}
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>BODY</Text>
        {isReadOnly ? (
          <Text
            style={styles.readonlyText}
            selectable
            accessibilityLabel="Body — supports first_name and event-card tokens"
          >
            {body}
          </Text>
        ) : (
          <TextInput
            value={body}
            onChange={handleBodyChange}
            placeholder={"Hi {first_name},\n\nWrite your message here…"}
            placeholderTextColor={textTokens.quaternary}
            style={[styles.input, styles.inputMultiline]}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Body — supports first_name and event-card tokens"
          />
        )}
      </View>

      <View style={styles.cheatsheet}>
        <Text style={styles.cheatsheetText}>
          Use <Text style={styles.token}>{"{first_name}"}</Text> for personalization ·{" "}
          <Text style={styles.token}>{"{{event:abc}}"}</Text> to embed an event card.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.lg,
  },
  block: {
    gap: spacing.xs,
  },
  label: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  readonlyText: {
    ...typography.body,
    color: textTokens.primary,
  },
  input: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: typography.body.fontWeight,
    minHeight: 48,
  },
  inputMultiline: {
    minHeight: 192,
  },
  cheatsheet: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  cheatsheetText: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
  token: {
    fontSize: typography.monoMd.fontSize,
    lineHeight: typography.monoMd.lineHeight,
    fontWeight: typography.monoMd.fontWeight,
    color: textTokens.primary,
  },
});
