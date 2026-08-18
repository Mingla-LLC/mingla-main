// orch-strict-grep-allow orch-0892 — horizontal MMS thumbnail row (image list), not keyboard-avoiding scroll; no keyboard insets/listeners
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
// orch-strict-grep-allow orch-0892 — horizontal MMS thumbnail row (image list), not keyboard-avoiding scroll; no keyboard insets/listeners
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  composerSheetMinHeight,
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

// ORCH-1289 — Twilio MMS accepts up to 10 media items per message. Kept here as
// the default cap so a caller that omits `maxMedia` still gets the safe limit.
export const MMS_MAX_MEDIA = 10;

// ORCH-1289 — the operator asked to hide the monetary SMS cost estimate for now.
// Flip to `true` to restore the "Est. cost ~$X" figure. The cost-computation
// logic (estimateSmsCost) is intentionally left intact so this is trivially
// reversible — only the $ figure + its note are gated.
const SHOW_SMS_COST = false;

/** ORCH-1289 — one attached MMS photo, resolved for display by the parent. */
export interface SmsComposeMediaItem {
  /** Stable key for React + removal. */
  key: string;
  /** Display uri — verified public URL once uploaded, else the local preview. */
  uri: string | null;
  /** True while this item is still uploading (shows a spinner over the thumb). */
  uploading: boolean;
}

export interface SmsComposeCardProps {
  value: string;
  onChangeText: (text: string) => void;
  /** Truthful SMS reach from the audience resolver; null while loading. */
  reachableSms: number | null;
  /** Brand default currency (ISO 4217) for the cost estimate display. */
  currencyCode: string;
  editable?: boolean;
  // ORCH-1282 / ORCH-1289 — MMS photo attach (additive; SMS-only callers unaffected).
  /** Owning brand id; attach is disabled until a brand is resolved. */
  brandId?: string | null;
  /** ORCH-1289 — every attached photo (verified URL or optimistic local preview). */
  media?: SmsComposeMediaItem[];
  /** ORCH-1289 — safe MMS media cap (Twilio: 10). */
  maxMedia?: number;
  /** True while ANY photo is uploading (drives the zero-state button label). */
  uploading?: boolean;
  /** Parent owns pick + upload (may append several at once). */
  onPickMedia?: () => void;
  /** Parent clears a single attachment by key. */
  onRemoveMedia?: (key: string) => void;
}

export const SmsComposeCard: React.FC<SmsComposeCardProps> = ({
  value,
  onChangeText,
  reachableSms,
  currencyCode,
  editable = true,
  brandId = null,
  media = [],
  maxMedia = MMS_MAX_MEDIA,
  uploading = false,
  onPickMedia,
  onRemoveMedia,
}) => {
  const hasMedia = media.length > 0;
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
  const canAddMore = media.length < maxMedia;
  const attachDisabled = brandId === null;

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
            {/* ORCH-1289 — the $ figure is hidden behind SHOW_SMS_COST (operator
                request). Encoding / segments / message-count stay (non-cost). */}
            {SHOW_SMS_COST ? (
              <>
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
          </>
        ) : null}
      </View>

      {/* ORCH-1282 / ORCH-1289 — attach up to `maxMedia` photos (turns the blast
          into an MMS). Each thumbnail prefers the verified public URL once
          uploaded (cross-platform-renderable) and shows a spinner while it
          uploads. A local blob/file uri is only an optimistic pre-upload preview. */}
      {hasMedia ? (
        <View style={styles.mediaSection}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.thumbRow}
          >
            {media.map((item) => (
              <View key={item.key} style={styles.thumbWrap}>
                {item.uri !== null && item.uri.length > 0 ? (
                  <Image
                    source={{ uri: item.uri }}
                    style={styles.thumb}
                    resizeMode="cover"
                    accessibilityLabel="Attached photo"
                  />
                ) : (
                  <View style={styles.thumb} />
                )}
                {item.uploading ? (
                  <View style={styles.thumbOverlay}>
                    <ActivityIndicator size="small" color={textTokens.primary} />
                  </View>
                ) : null}
                <Pressable
                  onPress={() => onRemoveMedia?.(item.key)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.thumbRemove,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Icon name="close" size={14} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
            {canAddMore ? (
              <Pressable
                onPress={onPickMedia}
                disabled={attachDisabled}
                accessibilityRole="button"
                accessibilityLabel="Add another photo"
                accessibilityState={{ disabled: attachDisabled }}
                style={({ pressed }) => [
                  styles.thumbAdd,
                  attachDisabled ? styles.attachBtnDisabled : null,
                  pressed && !attachDisabled ? styles.pressed : null,
                ]}
              >
                <Icon name="upload" size={18} color={textTokens.primary} />
              </Pressable>
            ) : null}
          </ScrollView>
          <Text style={styles.mediaCount}>
            {media.length}/{maxMedia} photos
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={onPickMedia}
          disabled={attachDisabled}
          accessibilityRole="button"
          accessibilityLabel="Add photos to this text"
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
          Photos send as a picture message (MMS) to US numbers. Nigerian numbers
          get the words only. Up to {maxMedia} photos.
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  /**
   * #2262 — the SMS card is the SAME SHEET as the email composer, with the
   * subject row absent (SMS has no subject). One `composerSheetMinHeight` (240)
   * across both channels, deliberately: a second SMS-specific floor would be
   * the same defect class that `PHONE_WEB_BODY_MIN_PX` vs `Math.max(120, ...)`
   * already was — two numbers for one idea. Because the subject row is absent
   * here, SMS simply gets MORE body out of the same floor.
   */
  host: {
    flex: 1,
    minHeight: composerSheetMinHeight,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    overflow: "hidden",
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
  /**
   * #2262 — the body claims the space the sheet has left rather than declaring
   * a `minHeight: 140` of its own inside a second bordered box. The sheet owns
   * the one visible boundary; `minHeight: 0` is the axis-scoped bound
   * I-AXIS-SCOPED-FLEX requires on the flexed axis.
   */
  input: {
    ...typography.body,
    color: textTokens.primary,
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 0,
    paddingVertical: spacing.xs,
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
  // ORCH-1289 — horizontal thumbnail row for multi-photo MMS.
  mediaSection: {
    gap: spacing.xs,
  },
  thumbRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  thumbWrap: {
    width: 64,
    height: 64,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    backgroundColor: glass.tint.profileElevated,
  },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  thumbRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.72)",
  },
  thumbAdd: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  mediaCount: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  pressed: {
    opacity: 0.7,
  },
  mmsCaption: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
});
