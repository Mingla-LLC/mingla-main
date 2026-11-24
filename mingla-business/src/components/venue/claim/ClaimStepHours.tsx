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
  color,
  space,
  type,
} from "../../../constants/designSystem";
import type { BrandHourEntry } from "../../../types/brand";
import { provenanceFor, useDraftVenueStore } from "../../../store/draftVenueStore";
// #4518 — host-only, so loaded on intent (when the hours step / card shows),
// not in the shared boot payload every buyer page downloads.
const BrandHoursEditor = React.lazy(() =>
  import("../BrandHoursEditor").then((module) => ({ default: module.BrandHoursEditor })),
);
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
      <React.Suspense fallback={null}>
        <BrandHoursEditor
          hours={hours}
          onChange={handleChange}
          showErrors={showErrors}
        />
      </React.Suspense>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: space[2],
    paddingHorizontal: space[6],
    paddingBottom: space[7],
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  labelCap: {
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    fontWeight: type.label.fontWeight,
    letterSpacing: type.label.letterSpacing,
    color: color.text3,
  },
  helper: {
    fontSize: type.small.fontSize,
    color: color.text2,
  },
});

export default ClaimStepHours;
