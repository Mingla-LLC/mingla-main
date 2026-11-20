/**
 * Ve1 wizard — Step 4: Weekly hours (Mon–Sun).
 *
 * ORCH-1186-A: thin wrapper binding the draft venue store to the shared,
 * controlled <BrandHoursEditor> (subtract-before-adding — the editor JSX,
 * pickers, bulk bar, and validation now live in BrandHoursEditor and are reused
 * by the live venue Settings tab). This wrapper re-adds the wizard host's outer
 * padding + the step title/helper that the editor sheds.
 */

import React, { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  color,
  space,
  type,
} from "../../constants/designSystem";
import type { BrandHourEntry } from "../../types/brand";
import { useDraftVenueStore } from "../../store/draftVenueStore";
// #4518 — host-only, so loaded on intent (when the hours step / card shows),
// not in the shared boot payload every buyer page downloads.
const BrandHoursEditor = React.lazy(() =>
  import("./BrandHoursEditor").then((module) => ({ default: module.BrandHoursEditor })),
);

export interface VenueStep4HoursProps {
  showErrors: boolean;
}

export const VenueStep4Hours: React.FC<VenueStep4HoursProps> = ({
  showErrors,
}) => {
  const hours = useDraftVenueStore((s) => s.hours);
  const setHoursRows = useDraftVenueStore((s) => s.setHoursRows);

  // The store exposes per-row + bulk setters; the controlled editor emits a full
  // next-array. Diff it against the current rows and forward only the changes
  // through the existing bulk setter (preserves the store's update semantics).
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
      <Text style={styles.title}>Opening hours</Text>
      <Text style={styles.helper}>Default: Mon–Sat 9–5, Sun closed.</Text>
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
  title: {
    fontSize: type.h1.fontSize,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
  },
  helper: {
    fontSize: type.small.fontSize,
    color: color.text2,
  },
});

export default VenueStep4Hours;
