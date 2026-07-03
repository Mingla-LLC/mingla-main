/**
 * ClaimStepHours (c2) — ORCH-1263 DESIGN §6.3: the pre-filled 7-day grid,
 * overnight spans included (D-D). Wraps the shared BrandHoursEditor (which
 * carries the "next day" micro-line); ONE provenance chip at the week level —
 * the week was adopted as a unit, 7 chips would be noise. Any change to any
 * row flips the single chip to Edited.
 */

import React, { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import type { BrandHourEntry } from "../../../types/brand";
import { provenanceFor, useDraftVenueStore } from "../../../store/draftVenueStore";
import { BrandHoursEditor } from "../BrandHoursEditor";
import { ProvenanceChip } from "../../ui/ProvenanceChip";

export interface ClaimStepHoursProps {
  showErrors: boolean;
}

export const ClaimStepHours: React.FC<ClaimStepHoursProps> = ({
  showErrors,
}) => {
  const draft = useDraftVenueStore();
  const hours = useDraftVenueStore((s) => s.hours);
  const setHoursRows = useDraftVenueStore((s) => s.setHoursRows);
  const chip = provenanceFor("hours", draft);

  // Same diff-forward pattern as VenueStep4Hours (the controlled editor emits
  // a full next-array; forward only changed rows through the bulk setter).
  const handleChange = useCallback(
    (next: BrandHourEntry[]): void => {
      const changed = next.filter((n) => {
        const prev = hours.find((h) => h.weekday === n.weekday);
        return (
          prev === undefined ||
          prev.openTime !== n.openTime ||
          prev.closeTime !== n.closeTime ||
          prev.isClosed !== n.isClosed
        );
      });
      for (const row of changed) {
        setHoursRows([row.weekday], {
          openTime: row.openTime,
          closeTime: row.closeTime,
          isClosed: row.isClosed,
        });
      }
    },
    [hours, setHoursRows],
  );

  return (
    <View style={styles.host}>
      <View style={styles.labelRow}>
        <Text style={styles.labelCap}>OPENING HOURS</Text>
        {chip !== null ? <ProvenanceChip state={chip} /> : null}
      </View>
      <Text style={styles.helper}>
        Late nights are fine — a close time earlier than the open time reads
        as next day.
      </Text>
      <BrandHoursEditor
        hours={hours}
        onChange={handleChange}
        showErrors={showErrors}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  labelCap: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: textTokens.tertiary,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
});

export default ClaimStepHours;
