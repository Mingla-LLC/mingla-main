/**
 * SmsComposeCard — META-ORCH-1161 Sub-B.
 *
 * The SMS-channel body of the blast composer: a plain-text input plus a live
 * segment + cost estimate (the cost guard, SPEC §6.4). Shows reachable_sms (the
 * truthful SMS reach from the audience resolver) and the per-recipient segment
 * count (GSM-7 160/seg vs UCS-2 70/seg) BEFORE send so the brand sees scope +
 * cost. Estimate only — Twilio bills authoritatively (Constitution #9).
 *
 * The smsAdapter appends "Reply STOP to opt out." server-side, so the brand
 * doesn't type it; the estimate accounts for it.
 *
 * Accessibility: input + helper text labelled; counter is announced via the
 * field's accessibilityHint.
 */

import React, { useMemo } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { formatCurrency } from "../../utils/currency";
import { estimateSmsCost } from "../../utils/smsCost";

export interface SmsComposeCardProps {
  value: string;
  onChangeText: (text: string) => void;
  /** Truthful SMS reach from the audience resolver; null while loading. */
  reachableSms: number | null;
  /** Brand default currency (ISO 4217) for the cost estimate display. */
  currencyCode: string;
  editable?: boolean;
}

export const SmsComposeCard: React.FC<SmsComposeCardProps> = ({
  value,
  onChangeText,
  reachableSms,
  currencyCode,
  editable = true,
}) => {
  const estimate = useMemo(
    () => estimateSmsCost(value, reachableSms ?? 0),
    [value, reachableSms],
  );

  const hasBody = value.trim().length > 0;
  const reachLabel = reachableSms === null
    ? "Loading reach…"
    : `${reachableSms} reachable on SMS`;

  return (
    <View style={styles.host}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>SMS MESSAGE</Text>
        <Text style={styles.reach} accessibilityLabel={reachLabel}>
          {reachLabel}
        </Text>
      </View>

      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        multiline
        placeholder="Type your text blast. Links become trackable Mingla links automatically. We add “Reply STOP to opt out.” for you."
        placeholderTextColor={textTokens.tertiary}
        accessibilityLabel="SMS message body"
        accessibilityHint={`${estimate.charCount} characters, ${estimate.segmentsPerRecipient} ${estimate.segmentsPerRecipient === 1 ? "segment" : "segments"} per recipient`}
        textAlignVertical="top"
      />

      {/* Cost guard — segment + cost estimate before send. */}
      <View style={styles.estimateBox}>
        <View style={styles.estimateRow}>
          <Text style={styles.estimateKey}>Encoding</Text>
          <Text style={styles.estimateVal}>{estimate.encoding}</Text>
        </View>
        <View style={styles.estimateRow}>
          <Text style={styles.estimateKey}>Per recipient</Text>
          <Text style={styles.estimateVal}>
            {estimate.charCount} chars ·{" "}
            {estimate.segmentsPerRecipient}{" "}
            {estimate.segmentsPerRecipient === 1 ? "segment" : "segments"}
          </Text>
        </View>
        {hasBody && reachableSms !== null && reachableSms > 0 ? (
          <>
            <View style={styles.estimateRow}>
              <Text style={styles.estimateKey}>Total segments</Text>
              <Text style={styles.estimateVal}>{estimate.totalSegments}</Text>
            </View>
            <View style={styles.estimateRow}>
              <Text style={[styles.estimateKey, styles.estimateKeyStrong]}>
                Est. cost
              </Text>
              <Text style={[styles.estimateVal, styles.estimateValStrong]}>
                ~{formatCurrency(estimate.estimatedCostMinor, currencyCode, true)}
              </Text>
            </View>
            <Text style={styles.estimateNote}>
              Estimate only — final cost is metered by the carrier.
            </Text>
          </>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    flex: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  label: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  reach: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  input: {
    ...typography.body,
    color: textTokens.primary,
    minHeight: 140,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  estimateBox: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xxs,
  },
  estimateRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  estimateKey: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  estimateKeyStrong: {
    color: textTokens.primary,
    fontWeight: "600",
  },
  estimateVal: {
    ...typography.bodySm,
    color: textTokens.primary,
  },
  estimateValStrong: {
    color: accent.warm,
    fontWeight: "700",
  },
  estimateNote: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    marginTop: spacing.xxs,
  },
});
