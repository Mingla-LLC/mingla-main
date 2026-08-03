/**
 * ClaimStepBookings (c8) — ORCH-1263 DESIGN §6.9: the suggestion treatment —
 * NEVER auto-on. The switch always starts OFF (venue_reservation_settings DB
 * default is probe-locked, R-11 — the design never fights it). When Google
 * hints reservable (20%), an info hint row renders ABOVE the toggle with the
 * ONE divergent chip text ("Suggested") — a suggestion, not adopted content.
 * Flipping the switch fades the hint out (M-6) and swaps the sub-label.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { useDraftVenueStore } from "../../../store/draftVenueStore";
import { BrandSwitch } from "../../ui/BrandSwitch";
import { Icon } from "../../ui/Icon";
import { ProvenanceChip } from "../../ui/ProvenanceChip";
import { venueBookingSetupCopy } from "../venueBookingSetupCopy";

export const ClaimStepBookings: React.FC = () => {
  const wantsReservations = useDraftVenueStore((s) => s.wantsReservations);
  const venueCategory = useDraftVenueStore((s) => s.venueCategory);
  const reservableHint = useDraftVenueStore(
    (s) => s.claim?.adopted.reservableHint === true,
  );
  const patch = useDraftVenueStore((s) => s.patch);

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Bookings</Text>
      <View style={styles.card}>
        {reservableHint && !wantsReservations ? (
          <View style={styles.hintRow}>
            <Icon name="calendar" size={14} color={semantic.info} />
            <Text style={styles.hintText}>
              Google shows you take reservations — flip this on and Mingla can
              take bookings too.
            </Text>
            <ProvenanceChip state="new" label="Suggested" />
          </View>
        ) : null}
        <View style={styles.toggleRow}>
          <View style={styles.textCol}>
            <Text style={styles.label}>Take reservations on Mingla</Text>
            <Text style={styles.sub}>
              {venueBookingSetupCopy(venueCategory, wantsReservations)}
            </Text>
          </View>
          <BrandSwitch
            value={wantsReservations}
            onValueChange={(on) => patch({ wantsReservations: on })}
            accessibilityLabel="Take reservations on Mingla"
            testID="claim-bookings-switch"
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  hintText: {
    flex: 1,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    color: textTokens.secondary,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  textCol: {
    flex: 1,
    gap: spacing.xxs,
  },
  label: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  sub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    color: textTokens.tertiary,
  },
});

export default ClaimStepBookings;
