/**
 * PushComposeCard — #3682 wave 2. The push line of a campaign: a short
 * message under the brand name, with a live preview of the notification and
 * the receive reason Mingla adds for the guest. Push is free and unlimited;
 * it reaches Mingla accounts only and respects each guest's mute and push
 * switch for this brand.
 */
import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import {
  accent,
  composerSheetMinHeight,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export const PUSH_BODY_MAX = 120;

export type PushAudienceReason = "follower" | "extended" | "book";

/** The line Mingla adds to every campaign push (never host-editable). */
export function pushReasonLine(reason: PushAudienceReason, brandName: string): string {
  if (reason === "extended") return `A friend of yours follows ${brandName}.`;
  if (reason === "book") return `You're on ${brandName}'s guest list.`;
  return `You follow ${brandName}.`;
}

export function pushBodyIssue(body: string): string | null {
  if (body.trim().length === 0) return "Write a short push message.";
  if (body.length > PUSH_BODY_MAX) return `Keep it to ${PUSH_BODY_MAX} characters.`;
  return null;
}

export interface PushComposeCardProps {
  body: string;
  onChangeBody: (next: string) => void;
  brandName: string;
  reason: PushAudienceReason;
  /** Shown instead of the editor note when push cannot reach this audience. */
  unavailableReason?: string | null;
  /** #4273 — "Filled in from your email · edit anytime" / "Edited by you". */
  autoFillLabel?: string | null;
  /** #4273 — the notification's title (the email subject). Absent shows the brand. */
  title?: string | null;
}

export function PushPreview({ body, brandName, reason, title }: {
  title?: string | null;
  body: string;
  brandName: string;
  reason: PushAudienceReason;
}) {
  return (
    <View style={styles.preview} accessibilityLabel="Push preview" testID="push-preview">
      <Text style={styles.previewApp}>MINGLA · now</Text>
      <Text style={styles.previewTitle} numberOfLines={1}>{title && title.length > 0 ? title : brandName}</Text>
      <Text style={styles.previewBody} numberOfLines={3}>
        {`${body.trim().length > 0 ? body.trim() : "Your message"} ${pushReasonLine(reason, brandName)}`}
      </Text>
    </View>
  );
}

export const PushComposeCard: React.FC<PushComposeCardProps> = ({
  body,
  onChangeBody,
  brandName,
  reason,
  unavailableReason,
  autoFillLabel,
  title,
}) => {
  const remaining = PUSH_BODY_MAX - body.length;
  return (
    <View style={styles.host} testID="push-compose-card">
      <View style={styles.headerRow}>
        <Text style={styles.label}>PUSH MESSAGE</Text>
        <Text style={[styles.counter, remaining < 0 ? styles.counterOver : null]}>
          {`${remaining}`}
        </Text>
      </View>
      {autoFillLabel ? (
        <Text style={styles.autoFill} testID="push-autofill-label">{autoFillLabel}</Text>
      ) : null}
      <TextInput
        value={body}
        onChangeText={onChangeBody}
        placeholder="Doors open at 9. New dates just added."
        placeholderTextColor={textTokens.tertiary}
        multiline
        maxLength={PUSH_BODY_MAX + 40}
        accessibilityLabel="Push message"
        style={styles.input}
      />
      <PushPreview body={body} brandName={brandName} reason={reason} title={title} />
      <Text style={styles.note}>
        {unavailableReason ??
          "Free and unlimited. Sent to Mingla accounts in this audience; muted guests and anyone who switched push off for your brand are skipped."}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    minHeight: composerSheetMinHeight,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
  },
  headerRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  label: { ...typography.labelCap, color: textTokens.tertiary },
  counter: { color: textTokens.tertiary, fontSize: 12, fontWeight: "600" },
  counterOver: { color: accent.warm },
  autoFill: { color: accent.warm, fontSize: 11, fontWeight: "700" },
  input: {
    minHeight: 72,
    color: textTokens.primary,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  preview: {
    borderRadius: radius.md,
    padding: spacing.sm,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    gap: 2,
  },
  previewApp: { color: textTokens.tertiary, fontSize: 11, fontWeight: "700" },
  previewTitle: { color: textTokens.primary, fontSize: 14, fontWeight: "800" },
  previewBody: { color: textTokens.secondary, fontSize: 13, lineHeight: 18 },
  note: { color: textTokens.tertiary, fontSize: 12, lineHeight: 16 },
});
