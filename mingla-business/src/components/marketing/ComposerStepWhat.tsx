/**
 * ComposerStepWhat — Step 2. ChannelTabs + Subject + Body + Personalize
 * toolbar + Insert event + Preview link. Multiline body TextInput grows
 * from 120pt up to 320pt.
 *
 * Keyboard rule: parent compose route applies the global keyboard-avoiding
 * pattern (feedback_keyboard_never_blocks_input.md). This component
 * surfaces TextInputs unwrapped so the parent's KeyboardAvoidingView
 * sees them.
 *
 * Personalize toolbar (Round 2 polish): renders a row of tappable chips
 * above the body editor. Each chip inserts the matching `{token}` at the
 * cursor position. Server-side render then substitutes the token per-
 * recipient at send time. Operators no longer have to remember the
 * curly-brace syntax.
 */

import React from "react";
import {
  Pressable,
  ScrollView,
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

export type PersonalizationToken =
  | "first_name"
  | "event_name"
  | "event_date"
  | "event_time"
  | "brand_name"
  | "event_url";

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
  onInsertVariable: (token: PersonalizationToken) => void;
}

interface PersonalizeChip {
  token: PersonalizationToken;
  label: string;
  /** Server-side variable name (what gets inserted). */
  raw: string;
}

// Only the two tokens that have a clear single value per-recipient or
// per-campaign: `first_name` varies per recipient (truly personal); `brand_name`
// is constant within a campaign (useful for sign-offs). Event-specific tokens
// (event_name, event_date, event_time, event_url) are intentionally NOT
// surfaced as chips — a single marketing email can go to buyers of many
// events, so there's no sensible single value for them in the body. Operators
// who want per-event content insert the event card instead.
// (The server-side substitutor still recognises all tokens if someone hand-
// types one — we just don't promote the ambiguous ones in the UI.)
const PERSONALIZE_CHIPS: ReadonlyArray<PersonalizeChip> = [
  { token: "first_name", label: "First name", raw: "{first_name}" },
  { token: "brand_name", label: "Brand name", raw: "{brand_name}" },
];

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
  onInsertVariable,
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
        <View style={styles.bodyLabelRow}>
          <Text style={styles.fieldLabel}>Body</Text>
          <Text style={styles.fieldHelp}>Tap a chip to drop a variable</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.personalizeScroll}
          contentContainerStyle={styles.personalizeRow}
          keyboardShouldPersistTaps="handled"
        >
          {PERSONALIZE_CHIPS.map((chip) => (
            <Pressable
              key={chip.token}
              onPress={() => onInsertVariable(chip.token)}
              accessibilityRole="button"
              accessibilityLabel={`Insert ${chip.label} variable`}
              style={({ pressed }) => [
                styles.personalizeChip,
                pressed ? styles.personalizeChipPressed : null,
              ]}
            >
              <Text style={styles.personalizeChipLabel}>{chip.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
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
    </View>
  );
};

/**
 * Pure helper exported for compose.tsx — given the current body, the cursor
 * position, and a token, produces the new body + the new caret position so
 * the cursor lands AFTER the inserted token (so the next keystroke is
 * what the operator actually expects).
 */
export function insertVariableAtCursor(
  body: string,
  selectionStart: number,
  selectionEnd: number,
  token: PersonalizationToken,
): { body: string; cursor: number } {
  const chip = PERSONALIZE_CHIPS.find((c) => c.token === token);
  if (chip === undefined) return { body, cursor: selectionEnd };
  const safeStart = Math.max(0, Math.min(selectionStart, body.length));
  const safeEnd = Math.max(safeStart, Math.min(selectionEnd, body.length));
  const next = body.slice(0, safeStart) + chip.raw + body.slice(safeEnd);
  return { body: next, cursor: safeStart + chip.raw.length };
}

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
  bodyLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  fieldHelp: {
    ...typography.bodySm,
    color: textTokens.tertiary,
    fontSize: 11,
  },
  personalizeScroll: {
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: spacing.xs,
  },
  personalizeRow: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingVertical: 2,
  },
  personalizeChip: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
    backgroundColor: "rgba(235, 120, 37, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  personalizeChipPressed: {
    opacity: 0.78,
  },
  personalizeChipLabel: {
    ...typography.bodySm,
    color: accent.warm,
    fontWeight: "600",
    fontSize: 13,
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
});
