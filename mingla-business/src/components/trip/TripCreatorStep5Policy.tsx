/**
 * ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — Step 5 of the trip
 * creator wizard. Combined "Cancellation & deadline" step per DESIGN_ORCH-0875
 * §2 DECISION A (A3 — one combined step; rejects A1 two-separate-steps and
 * A2 fold-into-Pricing).
 *
 * Renders 2 stacked GlassCard sections:
 *   1. RefundPolicyEditor — template chips + custom builder + monotonicity
 *   2. BookingDeadlinePicker — datetime picker with operator-brand TZ context
 *
 * Wizard parent owns autosave timing (autosaveStep5) per Step pattern.
 */

import React from "react";
import { StyleSheet, View } from "react-native";

import { spacing } from "../../constants/designSystem";
import type { RefundPolicy } from "../../services/refundPolicyService";
import { BookingDeadlinePicker } from "./BookingDeadlinePicker";
import { RefundPolicyEditor } from "./RefundPolicyEditor";
import { GlassCard } from "../ui/GlassCard";

export interface Step5Draft {
  refundPolicy: RefundPolicy | null;
  bookingDeadline: string | null; // ISO timestamptz, null = no deadline
}

export interface TripCreatorStep5PolicyProps {
  draft: Step5Draft;
  onChange: (patch: Partial<Step5Draft>) => void;
  /** Trip start ISO — used by BookingDeadlinePicker as maximumDate. */
  tripStartIso: string | null;
  /** Operator's brand timezone — used by BookingDeadlinePicker for display label. */
  brandTimezone: string | null;
  disabled?: boolean;
}

export const TripCreatorStep5Policy: React.FC<TripCreatorStep5PolicyProps> = ({
  draft,
  onChange,
  tripStartIso,
  brandTimezone,
  disabled = false,
}) => {
  return (
    <View style={styles.container}>
      <GlassCard variant="base" padding={spacing.md} radius="lg">
        <RefundPolicyEditor
          value={draft.refundPolicy}
          onChange={(next) => onChange({ refundPolicy: next })}
        />
      </GlassCard>

      <GlassCard variant="base" padding={spacing.md} radius="lg">
        <BookingDeadlinePicker
          value={draft.bookingDeadline}
          tripStartIso={tripStartIso}
          brandTimezone={brandTimezone}
          onChange={(next) => onChange({ bookingDeadline: next })}
        />
      </GlassCard>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
});
