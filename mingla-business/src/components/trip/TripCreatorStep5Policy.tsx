/**
 * ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — Step 5 of the trip
 * creator wizard. Combined "Cancellation & deadline" step per DESIGN_ORCH-0875
 * §2 DECISION A (A3 — one combined step; rejects A1 two-separate-steps and
 * A2 fold-into-Pricing).
 *
 * Renders 3 stacked GlassCard sections:
 *   1. RefundPolicyEditor — template chips + custom builder + monotonicity
 *   2. BookingDeadlinePicker — datetime picker with operator-brand TZ context
 *   3. ORCH-1339 — "Guest privacy" (the two display gates: Private guest list /
 *      Hide remaining count), persisted by the wizard parent via the
 *      biz_set_event_guest_privacy leaf-write RPC (D2: server-authoritative
 *      display gates; NEVER routed through the big edit RPCs).
 *
 * Wizard parent owns autosave timing (autosaveStep5) per Step pattern.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { RefundPolicy } from "../../services/refundPolicyService";
import { BookingDeadlinePicker } from "./BookingDeadlinePicker";
import { RefundPolicyEditor } from "./RefundPolicyEditor";
import { GlassCard } from "../ui/GlassCard";

export interface Step5Draft {
  refundPolicy: RefundPolicy | null;
  bookingDeadline: string | null; // ISO timestamptz, null = no deadline
  // ORCH-1339 — the two guest-privacy display gates (D2).
  privateGuestList: boolean;
  hideRemainingCount: boolean;
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

// ORCH-1339 — local ToggleRow mirroring the CreatorStep6Settings visual pattern
// (Pressable switch row: label + sub column, 44×26 track, 20 thumb). Step 5 had
// no toggle primitive before this.
interface ToggleRowProps {
  label: string;
  sub: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  testID?: string;
}

const ToggleRow: React.FC<ToggleRowProps> = ({
  label,
  sub,
  on,
  onToggle,
  disabled = false,
  testID,
}) => (
  <Pressable
    onPress={onToggle}
    disabled={disabled}
    accessibilityRole="switch"
    accessibilityState={{ checked: on, disabled }}
    accessibilityLabel={label}
    style={styles.toggleRow}
    testID={testID}
  >
    <View style={styles.toggleLabelCol}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Text style={styles.toggleSub}>{sub}</Text>
    </View>
    <View style={[styles.toggleTrack, on && styles.toggleTrackOn]}>
      <View
        style={[styles.toggleThumb, on ? styles.toggleThumbOn : styles.toggleThumbOff]}
      />
    </View>
  </Pressable>
);

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

      {/* ORCH-1339 — Guest privacy (D2 display gates). Persisted by the wizard
          parent via biz_set_event_guest_privacy (leaf write; never the big
          trip RPCs). Copy per SPEC §4.8 — byte-exact. */}
      <GlassCard variant="base" padding={spacing.md} radius="lg">
        <Text style={styles.sectionLabel}>Guest privacy</Text>
        <ToggleRow
          label="Private guest list"
          sub="Hide who's going. Travelers still see the going count."
          on={draft.privateGuestList}
          onToggle={() => onChange({ privateGuestList: !draft.privateGuestList })}
          disabled={disabled}
          testID="trip-step5-private-guestlist"
        />
        <ToggleRow
          label="Hide remaining count"
          sub={'Don\'t show "X spots left" or how full it is.'}
          on={draft.hideRemainingCount}
          onToggle={() => onChange({ hideRemainingCount: !draft.hideRemainingCount })}
          disabled={disabled}
          testID="trip-step5-hide-count"
        />
      </GlassCard>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  // ORCH-1339 — Guest-privacy section (ToggleRow styles mirror
  // CreatorStep6Settings.tsx's ToggleRow block).
  sectionLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    letterSpacing: 0.2,
    color: textTokens.secondary,
    marginBottom: spacing.sm,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.sm,
  },
  toggleLabelCol: {
    flex: 1,
    marginRight: spacing.sm,
  },
  toggleLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
    color: textTokens.primary,
  },
  toggleSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.16)",
    padding: 3,
  },
  toggleTrackOn: {
    backgroundColor: accent.warm,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: "#fff",
  },
  toggleThumbOff: {
    transform: [{ translateX: 0 }],
  },
  toggleThumbOn: {
    transform: [{ translateX: 18 }],
  },
});
