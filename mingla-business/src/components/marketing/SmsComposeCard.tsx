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
 * ORCH-1282 — optional single-photo attach: turns the blast into an MMS to US
 * numbers (the cost box switches to the MMS per-message rate). NG numbers can't
 * receive MMS through our provider, so they get the words only — the composer
 * says so plainly. The parent owns pick + upload; this card only renders the
 * affordance + thumbnail + remove.
 *
 * Accessibility: input + helper text labelled; counter is announced via the
 * field's accessibilityHint; attach + remove controls are labelled buttons.
 */

import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
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
  // ORCH-1282 — MMS photo attach (all additive; SMS-only callers unaffected).
  /** Owning brand id; attach is disabled until a brand is resolved. */
  brandId?: string | null;
  /** Verified public URL of the attached photo (or null). */
  mediaUrl?: string | null;
  /** Local preview uri for the thumbnail before/after upload. */
  mediaLocalUri?: string | null;
  /** True while the picked photo is uploading. */
  uploading?: boolean;
  /** Parent owns pick + upload. */
  onPickMedia?: () => void;
  /** Parent clears the attachment. */
  onRemoveMedia?: () => void;
  /** = mediaUrl != null. Drives the MMS cost + caption. */
  hasMedia?: boolean;
}

export const SmsComposeCard: React.FC<SmsComposeCardProps> = ({
  value,
  onChangeText,
  reachableSms,
  currencyCode,
  editable = true,
  brandId = null,
  mediaUrl = null,
  mediaLocalUri = null,
  uploading = false,
  onPickMedia,
  onRemoveMedia,
  hasMedia = false,
}) => {
  const estimate = useMemo(
    () => estimateSmsCost(value, reachableSms ?? 0, undefined, hasMedia),
    [value, reachableSms, hasMedia],
  );

  const hasBody = value.trim().length > 0;
  const reachLabel = reachableSms === null
    ? "Loading reach…"
    : `${reachableSms} reachable on SMS`;
  const isMms = estimate.encoding === "MMS";
  const perRecipientUnit = isMms
    ? "1 message"
    : `${estimate.segmentsPerRecipient} ${estimate.segmentsPerRecipient === 1 ? "segment" : "segments"}`;
  const thumbUri = mediaLocalUri ?? mediaUrl;
  const attachDisabled = uploading || brandId === null;

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
        accessibilityHint={`${estimate.charCount} characters, ${perRecipientUnit} per recipient`}
        textAlignVertical="top"
      />

      {/* Cost guard — segment/message + cost estimate before send. */}
      <View style={styles.estimateBox}>
        <View style={styles.estimateRow}>
          <Text style={styles.estimateKey}>Encoding</Text>
          <Text style={styles.estimateVal}>{estimate.encoding}</Text>
        </View>
        <View style={styles.estimateRow}>
          <Text style={styles.estimateKey}>Per recipient</Text>
          <Text style={styles.estimateVal}>
            {estimate.charCount} chars · {perRecipientUnit}
          </Text>
        </View>
        {hasBody && reachableSms !== null && reachableSms > 0 ? (
          <>
            <View style={styles.estimateRow}>
              <Text style={styles.estimateKey}>
                {isMms ? "Total messages" : "Total segments"}
              </Text>
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

      {/* ORCH-1282 — attach a photo (turns the blast into an MMS). */}
      {hasMedia ? (
        <View style={styles.attachChip}>
          {thumbUri !== null ? (
            <Image
              source={{ uri: thumbUri }}
              style={styles.thumb}
              resizeMode="cover"
              accessibilityLabel="Attached photo"
            />
          ) : (
            <View style={styles.thumb} />
          )}
          <Text style={styles.attachChipLabel}>Photo attached</Text>
          <Pressable
            onPress={onRemoveMedia}
            accessibilityRole="button"
            accessibilityLabel="Remove photo"
            hitSlop={8}
            style={({ pressed }) => [pressed ? styles.pressed : null]}
          >
            <Icon name="close" size={20} color={textTokens.secondary} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={onPickMedia}
          disabled={attachDisabled}
          accessibilityRole="button"
          accessibilityLabel="Add a photo to this text"
          accessibilityState={{ disabled: attachDisabled }}
          style={({ pressed }) => [
            styles.attachBtn,
            attachDisabled ? styles.attachBtnDisabled : null,
            pressed && !attachDisabled ? styles.pressed : null,
          ]}
        >
          {uploading ? (
            <>
              <ActivityIndicator size="small" color={textTokens.secondary} />
              <Text style={styles.attachLabel}>Uploading…</Text>
            </>
          ) : (
            <>
              <Icon name="upload" size={18} color={textTokens.primary} />
              <Text style={styles.attachLabel}>Add photo</Text>
            </>
          )}
        </Pressable>
      )}

      {hasMedia ? (
        <Text style={styles.mmsCaption}>
          Photos send as a picture message (MMS) to US numbers — costs more than a
          text. Nigerian numbers get the words only.
        </Text>
      ) : null}
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
  // ORCH-1282 — attach affordance + thumbnail chip.
  attachBtn: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  attachBtnDisabled: {
    opacity: 0.5,
  },
  attachLabel: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
  },
  attachChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    backgroundColor: glass.tint.profileElevated,
  },
  attachChipLabel: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "600",
    flex: 1,
  },
  pressed: {
    opacity: 0.7,
  },
  mmsCaption: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
});
