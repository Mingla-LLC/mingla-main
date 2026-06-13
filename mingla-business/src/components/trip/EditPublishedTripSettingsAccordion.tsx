/**
 * ORCH-1120 [Published-trip Settings tab → editable refund tiers + booking
 * deadline + bookings-closed (sales-gated)] — <EditPublishedTripSettingsAccordion />.
 *
 * REWORK (2026-06-12, Seth device feedback): consolidated to the screen's
 * SINGLE standard bottom "Save changes" button. This accordion is now a PURE
 * CONTROLLED EDITOR — it owns NO save button, NO reason dialog, NO mutation,
 * NO reject wiring. The three edited values (refund_policy / booking_deadline /
 * bookings_closed) are lifted to the parent EditPublishedTripScreen via
 * controlled props (value + onChange). The parent folds them into its existing
 * LocalTripEditState → buildLiveTripPatch diff → ChangeSummaryModal (single
 * reason prompt) → biz_update_live_trip RPC (single gate) → buildRejectDialog
 * (single reject path). There is exactly ONE save button, ONE reason prompt,
 * ONE gate, app-wide. The previous duplicate save+reason path inside this
 * accordion is GONE.
 *
 * The Settings sibling of EditPublishedTripIntakeAccordion (ORCH-0880). Mounts
 * the shipped ORCH-0875 RefundPolicyEditor + BookingDeadlinePicker (UNMODIFIED)
 * plus a LIVE "Bookings closed" Switch. Replaces the read-only Settings snapshot
 * + dead-end "use the wizard" hint.
 *
 * ALL writes route through `biz_update_live_trip` (via the PARENT's
 * useUpdateLiveTripFields mutation in handleConfirmSave), NEVER through the
 * sales-unaware refundPolicyService.updateRefundPolicy / updateBookingDeadline
 * (those stay draft-wizard-only — INVESTIGATE F-4 / DISC-1120-A; enforced by the
 * i-proposed-1120-published-refund-via-gated-rpc strict-grep gate). The RPC
 * enforces the buyer-protection asymmetry: with paid non-cancelled orders,
 * buyer-UNFAVORABLE edits (lower realized refund %, earlier deadline, harmful
 * bookings-closed flip) HARD-BLOCK and surface a "Refund first" dialog via the
 * parent's single ConfirmDialog; buyer-FAVORABLE edits always apply; no sales =>
 * fully editable.
 *
 * Composes GlassCard + Icon + RefundPolicyEditor + BookingDeadlinePicker +
 * RN Switch. No new primitives. The proactive sales-aware banner remains as
 * read-only CONTEXT (it is NOT a save/reason control).
 */

import React from "react";
import { StyleSheet, Switch, Text, View } from "react-native";

import {
  accent,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import type { RefundPolicy } from "../../services/refundPolicyService";
import { BookingDeadlinePicker } from "./BookingDeadlinePicker";
import { RefundPolicyEditor } from "./RefundPolicyEditor";

export interface EditPublishedTripSettingsAccordionProps {
  /** Controlled — current refund policy value (parent owns edit state). */
  refundPolicy: RefundPolicy | null;
  onRefundPolicyChange: (next: RefundPolicy | null) => void;
  /** Controlled — current booking deadline ISO (parent owns edit state). */
  bookingDeadline: string | null; // ISO
  onBookingDeadlineChange: (next: string | null) => void;
  /** Controlled — current bookings-closed flag (parent owns edit state). */
  bookingsClosed: boolean;
  onBookingsClosedChange: (next: boolean) => void;
  tripStartIso: string | null;
  brandTimezone: string | null;
  /** Paid non-cancelled order count. >0 ⇒ proactive read-only sales banner +
   * the RPC will block buyer-unfavorable edits at save time (the parent's
   * single gate). Undefined/0 ⇒ banner hidden. */
  affectedOrderCount?: number;
  /** Disables the editors while the parent's save is in flight. */
  submitting?: boolean;
  testID?: string;
}

export const EditPublishedTripSettingsAccordion: React.FC<
  EditPublishedTripSettingsAccordionProps
> = ({
  refundPolicy,
  onRefundPolicyChange,
  bookingDeadline,
  onBookingDeadlineChange,
  bookingsClosed,
  onBookingsClosedChange,
  tripStartIso,
  brandTimezone,
  affectedOrderCount = 0,
  submitting = false,
  testID,
}) => {
  const hasSales = affectedOrderCount > 0;
  const salesLabel = affectedOrderCount === 1 ? "" : "s";

  return (
    <View style={styles.container} testID={testID ?? "settings-accordion-body"}>
      {/* Block A — Refund policy */}
      <View style={styles.block}>
        <Text style={styles.blockLabel}>Refund policy</Text>
        <Text style={styles.blockHelp}>
          How much travelers get back when they cancel.
        </Text>
        <View
          pointerEvents={submitting ? "none" : "auto"}
          style={{ opacity: submitting ? 0.6 : 1 }}
        >
          <RefundPolicyEditor
            value={refundPolicy}
            onChange={onRefundPolicyChange}
          />
        </View>
      </View>

      {/* Block B — Booking window */}
      <View style={styles.block}>
        <Text style={styles.blockLabel}>Booking window</Text>
        <View
          pointerEvents={submitting ? "none" : "auto"}
          style={{ opacity: submitting ? 0.6 : 1 }}
        >
          <BookingDeadlinePicker
            value={bookingDeadline}
            tripStartIso={tripStartIso}
            brandTimezone={brandTimezone}
            onChange={onBookingDeadlineChange}
          />
        </View>
        <View style={styles.switchRow}>
          <View style={styles.switchRowText}>
            <Text style={styles.switchLabel}>Bookings closed</Text>
            <Text style={styles.switchHelp}>
              Stop taking new bookings now, before the deadline.
            </Text>
          </View>
          <Switch
            value={bookingsClosed}
            onValueChange={onBookingsClosedChange}
            disabled={submitting}
            trackColor={{
              false: "rgba(255,255,255,0.16)",
              true: accent.warm,
            }}
            thumbColor="#ffffff"
            ios_backgroundColor="rgba(255,255,255,0.16)"
            accessibilityRole="switch"
            accessibilityLabel="Bookings closed"
            accessibilityState={{ checked: bookingsClosed, disabled: submitting }}
            accessibilityHint="Stops new bookings immediately."
            testID="settings-bookings-closed-switch"
          />
        </View>
      </View>

      {/* Block C — Proactive sales-aware notice (read-only context; NOT a save
          or reason control — the single gate lives on the parent's bottom
          Save button). */}
      {hasSales ? (
        <GlassCard
          variant="base"
          padding={spacing.md}
          radius="lg"
          style={styles.warningBanner}
        >
          <View style={styles.warningRow}>
            <Icon
              name="bell"
              size={20}
              color={semantic.warning}
              strokeWidth={2}
            />
            <Text style={styles.warningText}>
              {`${affectedOrderCount} traveler${salesLabel} already booked. More-generous refunds, an extra tier, or a later deadline save instantly — but you can't make terms worse for them here.`}
            </Text>
          </View>
        </GlassCard>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  block: {
    gap: spacing.sm,
  },
  blockLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    letterSpacing: 0.2,
    color: textTokens.secondary,
  },
  blockHelp: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.tertiary,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  switchRowText: {
    flex: 1,
    gap: 2,
  },
  switchLabel: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
  switchHelp: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    color: textTokens.tertiary,
  },
  warningBanner: {
    borderColor: semantic.warning,
    borderWidth: 1,
    backgroundColor: semantic.warningTint,
    marginTop: spacing.sm,
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  warningText: {
    flex: 1,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
});

export default EditPublishedTripSettingsAccordion;
