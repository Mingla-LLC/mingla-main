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

import { color, radius, space, type } from "../../constants/designSystem";

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
            placeholderTextColor={color.text4}
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
            placeholderTextColor={color.text4}
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
    gap: space[6],
  },
  block: {
    gap: space[1],
  },
  label: {
    ...type.label,
    color: color.text3,
  },
  readonlyText: {
    ...type.body,
    color: color.text1,
  },
  input: {
    paddingHorizontal: space[4],
    paddingVertical: space[2] + 2,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    color: color.text1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: type.body.fontWeight,
    minHeight: 48,
  },
  inputMultiline: {
    minHeight: 192,
  },
  cheatsheet: {
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  cheatsheetText: {
    ...type.small,
    color: color.text3,
  },
  token: {
    fontSize: type.mono.fontSize,
    lineHeight: type.mono.lineHeight,
    fontWeight: type.mono.fontWeight,
    color: color.text1,
  },
});
