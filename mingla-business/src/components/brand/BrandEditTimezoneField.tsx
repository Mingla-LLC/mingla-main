/**
 * BrandEditTimezoneField — #3355 Wave A (A4, Seth D5a) the brand's time zone
 * on Brand Edit.
 *
 * Production 2026-11-10: Ari handed a Lagos host off to Brand profile to add a
 * time zone, and Brand profile had no time zone field, so the check could never
 * pass. This field writes `brands.default_timezone` through Brand Edit's own
 * save (useUpdateBrand → mapUiToBrandUpdatePatch); the database's
 * `brands_default_timezone_guard` still refuses a zone it does not know, and a
 * single-zone country fills the zone on its own (migration 20280623023355).
 *
 * Same picker as the venue Availability timezone card (issue #1586): the
 * ~400-zone list only mounts when "Change" is pressed, labels come from the
 * shared `formatTimezoneLabel`, and "Not set" is said plainly rather than
 * showing UTC (a real zone that would read as a choice).
 *
 * Loaded lazily by BrandEditView (like BrandEditAddressField) so it stays out
 * of the shared Host bundle.
 */
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { formatTimezoneLabel, getAllTimezones } from "../../utils/timezones";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

export interface BrandEditTimezoneFieldProps {
  value: string | undefined;
  onChange: (zone: string) => void;
  testID?: string;
}

/** The first matches for a search (whole list capped, so the form stays short). */
export function filterTimezones(
  zones: readonly string[],
  query: string,
  limit = 40,
): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "_");
  const hits = q.length === 0
    ? zones
    : zones.filter((zone) => zone.toLowerCase().includes(q));
  return hits.slice(0, limit);
}

export const BrandEditTimezoneField: React.FC<BrandEditTimezoneFieldProps> = ({
  value,
  onChange,
  testID = "brand-edit-timezone",
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const zones = useMemo<string[]>(() => (open ? getAllTimezones() : []), [open]);
  const shown = useMemo(() => filterTimezones(zones, query), [zones, query]);
  const current = value && value.trim().length > 0 ? value : null;

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.head}>
        <View style={styles.valueCol}>
          {current ? (
            <Text style={styles.value} testID={`${testID}-value`}>
              {formatTimezoneLabel(current)}
            </Text>
          ) : (
            <Text style={styles.empty} testID={`${testID}-unset`}>
              Not set
            </Text>
          )}
        </View>
        <Button
          label={open ? "Cancel" : current ? "Change" : "Choose"}
          onPress={() => {
            setOpen(!open);
            setQuery("");
          }}
          variant="secondary"
          size="sm"
          accessibilityLabel={
            open ? "Cancel choosing a time zone" : "Choose your brand's time zone"
          }
          testID={`${testID}-toggle`}
        />
      </View>
      {open ? (
        <View style={styles.picker}>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Search time zones (for example Lagos)"
            accessibilityLabel="Search time zones"
            testID={`${testID}-search`}
          />
          {shown.length === 0 ? (
            <Text style={styles.empty}>No time zones match that search.</Text>
          ) : (
            shown.map((zone) => (
              <Pressable
                key={zone}
                onPress={() => {
                  onChange(zone);
                  setOpen(false);
                  setQuery("");
                }}
                accessibilityRole="button"
                accessibilityLabel={`Use time zone ${zone}`}
                style={styles.row}
                testID={`${testID}-option-${zone}`}
              >
                <Text style={zone === current ? styles.rowActive : styles.rowText}>
                  {formatTimezoneLabel(zone)}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  valueCol: {
    flex: 1,
    paddingHorizontal: spacing.xs,
  },
  value: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
  },
  empty: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
  picker: {
    gap: spacing.xs,
  },
  row: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  rowText: {
    ...typography.bodySm,
    color: textTokens.primary,
  },
  rowActive: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "700",
  },
});
