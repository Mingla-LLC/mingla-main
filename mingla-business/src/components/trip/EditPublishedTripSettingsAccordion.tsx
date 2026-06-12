/**
 * ORCH-1120 [Published-trip Settings tab → editable refund tiers + booking
 * deadline + bookings-closed (sales-gated)] — <EditPublishedTripSettingsAccordion />.
 *
 * The Settings sibling of EditPublishedTripIntakeAccordion (ORCH-0880). Mounts
 * the shipped ORCH-0875 RefundPolicyEditor + BookingDeadlinePicker (UNMODIFIED)
 * plus a LIVE "Bookings closed" Switch, reusing the intake accordion's proven
 * reason-and-save GlassCard banner + Toast chassis. Replaces the read-only
 * Settings snapshot + dead-end "use the wizard" hint.
 *
 * ALL writes route through `biz_update_live_trip` (via useUpdateLiveTripFields),
 * NEVER through the sales-unaware refundPolicyService.updateRefundPolicy /
 * updateBookingDeadline (those stay draft-wizard-only — INVESTIGATE F-4 /
 * DISC-1120-A; enforced by the i-proposed-1120-published-refund-via-gated-rpc
 * strict-grep gate). The RPC enforces the buyer-protection asymmetry: with paid
 * non-cancelled orders, buyer-UNFAVORABLE edits (lower realized refund %, earlier
 * deadline, harmful bookings-closed flip) HARD-BLOCK and surface a "Refund first"
 * dialog via the parent's setRejectDialog (FORK 1); buyer-FAVORABLE edits always
 * apply; no sales => fully editable.
 *
 * Per SPEC_ORCH-1120 §4.3 + the embedded design (§Design):
 *   FORK 1 (LOCKED) — ok:false business rejects route to the parent dialog via
 *     onReject(result); thrown/network errors stay LOCAL as reasonError.
 *   FORK 2 (LOCKED) — editors take no `disabled` prop, so each is wrapped in a
 *     <View pointerEvents={submitting?"none":"auto"} opacity 0.6/1>; the Switch
 *     uses native disabled={submitting}.
 *
 * Composes GlassCard + Button + Icon + Toast + RefundPolicyEditor +
 * BookingDeadlinePicker + RN Switch. No new primitives.
 */

import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Switch, Text, TextInput, View } from "react-native";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Toast } from "../ui/Toast";
import type { RefundPolicy } from "../../services/refundPolicyService";
import type {
  LiveTripPatch,
  UpdateLiveTripResult,
} from "../../services/tripsService";
import { UpdateLiveTripPermissionError } from "../../services/tripsService";
import { useUpdateLiveTripFields } from "../../hooks/useTrips";
import { BookingDeadlinePicker } from "./BookingDeadlinePicker";
import { RefundPolicyEditor } from "./RefundPolicyEditor";

export interface EditPublishedTripSettingsAccordionProps {
  eventId: string;
  refundPolicy: RefundPolicy | null;
  bookingDeadline: string | null; // ISO
  bookingsClosed: boolean;
  tripStartIso: string | null;
  brandTimezone: string | null;
  /** Paid non-cancelled order count. >0 ⇒ proactive sales banner + the RPC
   * will block buyer-unfavorable edits. Undefined/0 ⇒ banner hidden (the
   * SERVER is the source of truth for the actual block). */
  affectedOrderCount?: number;
  /** Lifts dirtiness so the parent's editedSectionKeys badge fires for
   * "settings". */
  onDirtyChange?: (dirty: boolean) => void;
  /** FORK 1 — the parent wires onReject={(r) => setRejectDialog(buildRejectDialog(r))}
   * so the 4 refund-class reject reasons render through the screen's single
   * ConfirmDialog. */
  onReject: (result: Extract<UpdateLiveTripResult, { ok: false }>) => void;
  testID?: string;
}

const REASON_MIN = 10;
const REASON_MAX = 200;

export const EditPublishedTripSettingsAccordion: React.FC<
  EditPublishedTripSettingsAccordionProps
> = ({
  eventId,
  refundPolicy,
  bookingDeadline,
  bookingsClosed,
  tripStartIso,
  brandTimezone,
  affectedOrderCount = 0,
  onDirtyChange,
  onReject,
  testID,
}) => {
  const updateMutation = useUpdateLiveTripFields();

  // Server-seeded local edit state (synchronous from props — no loading
  // skeleton; the parent screen already gated the whole trip-load query).
  const [policy, setPolicy] = useState<RefundPolicy | null>(refundPolicy);
  const [deadline, setDeadline] = useState<string | null>(bookingDeadline);
  const [closed, setClosed] = useState<boolean>(bookingsClosed);

  const dirty =
    JSON.stringify(policy) !== JSON.stringify(refundPolicy) ||
    deadline !== bookingDeadline ||
    closed !== bookingsClosed;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Reason-and-save banner state (intake parity).
  const [reasonDialogVisible, setReasonDialogVisible] =
    useState<boolean>(false);
  const [reason, setReason] = useState<string>("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  const hasSales = affectedOrderCount > 0;
  const salesLabel = affectedOrderCount === 1 ? "" : "s";

  const onSavePressed = useCallback((): void => {
    if (!dirty) return;
    setReason("");
    setReasonError(null);
    setReasonDialogVisible(true);
  }, [dirty]);

  const onConfirmSave = useCallback(async (): Promise<void> => {
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX) {
      setReasonError(
        `Reason must be between ${REASON_MIN} and ${REASON_MAX} characters.`,
      );
      return;
    }
    // Carry ONLY the dirty fields so the RPC classifier evaluates only what
    // changed (omit unchanged keys).
    const patch: LiveTripPatch = {};
    if (JSON.stringify(policy) !== JSON.stringify(refundPolicy)) {
      patch.refund_policy = policy;
    }
    if (deadline !== bookingDeadline) {
      patch.booking_deadline = deadline;
    }
    if (closed !== bookingsClosed) {
      patch.bookings_closed = closed;
    }

    setSubmitting(true);
    setReasonError(null);
    try {
      const result = await updateMutation.mutateAsync({
        eventId,
        patch,
        reason: trimmed,
      });
      if (result.ok) {
        setReasonDialogVisible(false);
        setToast({ visible: true, message: "Settings saved. Live now." });
      } else {
        // FORK 1 — business reject (ok:false). Keep the banner OPEN (preserve
        // the typed reason + edit state so the planner can dial the edit back
        // to favorable and retry) and route the reason to the parent dialog.
        onReject(result);
      }
    } catch (e) {
      // FORK 1 — thrown/network errors stay LOCAL (banner stays open).
      if (e instanceof UpdateLiveTripPermissionError) {
        setReasonError(
          e.code === "authentication_required"
            ? "You're signed out. Sign in to save changes."
            : e.code === "event_not_a_trip"
              ? "This isn't a trip — open the event editor instead."
              : "You don't have permission to edit this trip.",
        );
      } else {
        setReasonError("Couldn't save. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    reason,
    policy,
    refundPolicy,
    deadline,
    bookingDeadline,
    closed,
    bookingsClosed,
    updateMutation,
    eventId,
    onReject,
  ]);

  const onCloseReasonDialog = useCallback((): void => {
    if (submitting) return;
    setReasonDialogVisible(false);
  }, [submitting]);

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
          <RefundPolicyEditor value={policy} onChange={setPolicy} />
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
            value={deadline}
            tripStartIso={tripStartIso}
            brandTimezone={brandTimezone}
            onChange={setDeadline}
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
            value={closed}
            onValueChange={setClosed}
            disabled={submitting}
            trackColor={{
              false: "rgba(255,255,255,0.16)",
              true: accent.warm,
            }}
            thumbColor="#ffffff"
            ios_backgroundColor="rgba(255,255,255,0.16)"
            accessibilityRole="switch"
            accessibilityLabel="Bookings closed"
            accessibilityState={{ checked: closed, disabled: submitting }}
            accessibilityHint="Stops new bookings immediately."
            testID="settings-bookings-closed-switch"
          />
        </View>
      </View>

      {/* Block C — Proactive sales-aware notice (only when paid sales exist) */}
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
              {affectedOrderCount} traveler{salesLabel} already booked.
              More-generous refunds, an extra tier, or a later deadline save
              instantly — but you can't make terms worse for them here.
            </Text>
          </View>
        </GlassCard>
      ) : null}

      {/* Reason-and-save (intake chassis verbatim) */}
      {reasonDialogVisible ? (
        <GlassCard
          variant="base"
          padding={spacing.md}
          radius="lg"
          style={styles.reasonBanner}
        >
          <Text style={styles.reasonTitle}>Save settings changes?</Text>
          <Text style={styles.reasonDescription}>
            {hasSales
              ? `${affectedOrderCount} traveler${salesLabel} already booked. Favorable changes save instantly; buyer-unfavorable changes are blocked here.`
              : "No travelers are currently affected."}
          </Text>
          <Text style={styles.reasonLabel}>Reason for change *</Text>
          <TextInput
            value={reason}
            onChangeText={(t) => setReason(t.slice(0, REASON_MAX))}
            placeholder="e.g., Extended the free-cancellation window for travelers."
            placeholderTextColor={textTokens.quaternary}
            maxLength={REASON_MAX}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            style={styles.reasonInput}
            accessibilityLabel="Reason for change"
            autoCapitalize="sentences"
          />
          <Text style={styles.reasonCounter}>
            {reason.trim().length} / {REASON_MAX}
          </Text>
          {reasonError !== null ? (
            <Text style={styles.reasonError} accessibilityLiveRegion="polite">
              {reasonError}
            </Text>
          ) : null}
          <View style={styles.reasonButtons}>
            <View style={styles.reasonCancelCell}>
              <Button
                label="Keep editing"
                variant="ghost"
                size="md"
                onPress={onCloseReasonDialog}
                disabled={submitting}
                fullWidth
              />
            </View>
            <View style={styles.reasonConfirmCell}>
              <Button
                label="Save changes"
                variant="primary"
                size="md"
                onPress={() => {
                  void onConfirmSave();
                }}
                loading={submitting}
                disabled={submitting || reason.trim().length < REASON_MIN}
                fullWidth
                testID="settings-accordion-reason-confirm"
              />
            </View>
          </View>
        </GlassCard>
      ) : (
        <View style={styles.saveWrap}>
          <Button
            label="Save changes"
            variant="primary"
            size="md"
            onPress={onSavePressed}
            disabled={!dirty || submitting}
            loading={submitting}
            fullWidth
            testID="settings-accordion-save"
          />
        </View>
      )}

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="success"
          message={toast.message}
          onDismiss={() => setToast({ visible: false, message: "" })}
        />
      </View>
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
  saveWrap: {
    marginTop: spacing.sm,
  },
  reasonBanner: {
    marginTop: spacing.sm,
    borderColor: accent.border,
    borderWidth: 1,
  },
  reasonTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  reasonDescription: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  reasonLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: textTokens.secondary,
    marginBottom: spacing.xs,
  },
  reasonInput: {
    minHeight: 80,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.sm,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
  },
  reasonCounter: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    textAlign: "right",
    marginTop: 2,
  },
  reasonError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xs,
  },
  reasonButtons: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  reasonCancelCell: {
    flex: 1,
  },
  reasonConfirmCell: {
    flex: 2,
  },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
    zIndex: 100,
  },
});

export default EditPublishedTripSettingsAccordion;
