/**
 * ComposerStepWhat — Step 2. ChannelTabs + Subject + Body + Insert event +
 * Preview link. Multiline body TextInput grows from 120pt up to 320pt.
 *
 * Keyboard rule: parent compose route applies the global keyboard-avoiding
 * pattern (feedback_keyboard_never_blocks_input.md). This component
 * surfaces TextInputs unwrapped so the parent's KeyboardAvoidingView
 * sees them.
 */

import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";

import { ChannelTabs, type MarketingChannelKind } from "./ChannelTabs";
import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface ComposerStepWhatProps {
  channel: MarketingChannelKind;
  onChannelChange: (kind: MarketingChannelKind) => void;
  subject: string;
  onSubjectChange: (value: string) => void;
  body: string;
  onBodyChange: (value: string) => void;
  onSelectionChange?: (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => void;
  onInsertEventCard: () => void;
  onOpenPreview: () => void;
}

const SUBJECT_MAX = 200;
const BODY_MIN_HEIGHT = 120;
const BODY_MAX_HEIGHT = 320;

export const ComposerStepWhat: React.FC<ComposerStepWhatProps> = ({
  channel,
  onChannelChange,
  subject,
  onSubjectChange,
  body,
  onBodyChange,
  onSelectionChange,
  onInsertEventCard,
  onOpenPreview,
}) => {
  return (
    <View style={styles.host}>
      <Text style={styles.stepLabel} accessibilityRole="header">STEP 2 — WHAT</Text>
      <ChannelTabs active={channel} onChange={onChannelChange} />
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Subject</Text>
        <TextInput
          value={subject}
          onChangeText={onSubjectChange}
          placeholder="What's this campaign about?"
          placeholderTextColor={textTokens.tertiary}
          style={styles.subjectInput}
          maxLength={SUBJECT_MAX}
          accessibilityLabel="Campaign subject line"
          returnKeyType="next"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Body</Text>
        <TextInput
          value={body}
          onChangeText={onBodyChange}
          onSelectionChange={onSelectionChange}
          placeholder={"Hi {first_name},\n\nWrite your message…"}
          placeholderTextColor={textTokens.tertiary}
          style={styles.bodyInput}
          multiline
          accessibilityLabel="Campaign body"
          textAlignVertical="top"
        />
      </View>
      <View style={styles.actionsRow}>
        <Pressable
          onPress={onInsertEventCard}
          accessibilityRole="button"
          accessibilityLabel="Insert an event card"
          style={({ pressed }) => [
            styles.ghostBtn,
            pressed ? styles.ghostBtnPressed : null,
          ]}
        >
          <Text style={styles.ghostBtnLabel}>+ Insert event card</Text>
        </Pressable>
        <Pressable
          onPress={onOpenPreview}
          accessibilityRole="button"
          accessibilityLabel="Preview email"
          style={({ pressed }) => [
            styles.ghostBtn,
            pressed ? styles.ghostBtnPressed : null,
          ]}
        >
          <Text style={[styles.ghostBtnLabel, styles.previewLabel]}>
            Preview email →
          </Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        Use {"{first_name}"} / {"{event_name}"} / {"{event_date}"} — variables
        substitute at send time.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
  },
  stepLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  subjectInput: {
    ...typography.body,
    color: textTokens.primary,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  bodyInput: {
    ...typography.body,
    color: textTokens.primary,
    minHeight: BODY_MIN_HEIGHT,
    maxHeight: BODY_MAX_HEIGHT,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  ghostBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostBtnPressed: {
    opacity: 0.78,
  },
  ghostBtnLabel: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
  },
  previewLabel: {
    color: accent.warm,
  },
  hint: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
});
