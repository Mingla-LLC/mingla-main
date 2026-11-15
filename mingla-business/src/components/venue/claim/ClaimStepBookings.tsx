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
  color,
  space,
  type,
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
            <Icon name="calendar" size={14} color={color.info} />
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
    gap: space[4],
    paddingHorizontal: space[6],
    paddingBottom: space[7],
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
  },
  card: {
    gap: space[2],
    padding: space[4],
    borderRadius: 12,
    backgroundColor: color.fill.tile,
  },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  hintText: {
    flex: 1,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.fontWeight,
    letterSpacing: type.caption.letterSpacing,
    color: color.text2,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: type.body.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  sub: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.fontWeight,
    letterSpacing: type.caption.letterSpacing,
    color: color.text3,
  },
});

export default ClaimStepBookings;
