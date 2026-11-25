/**
 * #4490 — pick a space (or spaces) of a venue. Each row says what the space
 * fits, so the host never has to remember capacities. Combinations (spaces
 * hired together) are listed after the spaces when `combinations` is passed.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import type {
  VenueSpace,
  VenueSpaceCombination,
} from "../../services/venueFeaturesService";
import { Icon } from "./Icon";

export function spaceFitsLabel(spaceRow: Pick<VenueSpace, "capacityStanding" | "capacitySeated">): string {
  const parts: string[] = [];
  if (spaceRow.capacityStanding !== null) parts.push(`${spaceRow.capacityStanding.toLocaleString("en-US")} standing`);
  if (spaceRow.capacitySeated !== null) parts.push(`${spaceRow.capacitySeated.toLocaleString("en-US")} seated`);
  return parts.length > 0 ? parts.join(" · ") : "No capacity set";
}

/** Capacity of a combination = the sum of its parts (never stored). */
export function combinationCapacity(
  combination: Pick<VenueSpaceCombination, "spaceIds">,
  spaces: readonly VenueSpace[],
): { capacityStanding: number | null; capacitySeated: number | null } {
  const parts = spaces.filter((s) => combination.spaceIds.includes(s.id));
  const sum = (pick: (s: VenueSpace) => number | null): number | null => {
    const values = parts.map(pick).filter((v): v is number => v !== null);
    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
  };
  return { capacityStanding: sum((s) => s.capacityStanding), capacitySeated: sum((s) => s.capacitySeated) };
}

export interface SpacePickerProps {
  spaces: readonly VenueSpace[];
  combinations?: readonly VenueSpaceCombination[];
  /** Selected ids (space or combination ids). */
  value: readonly string[];
  onChange: (next: string[]) => void;
  mode: "single" | "multi";
  /** Single mode: offer "No space" as the first row. */
  noneLabel?: string;
  label?: string;
  disabled?: boolean;
  /** Ids that cannot be picked (e.g. the space being edited). */
  excludeIds?: readonly string[];
  testID?: string;
}

export function SpacePicker({
  spaces,
  combinations = [],
  value,
  onChange,
  mode,
  noneLabel,
  label,
  disabled = false,
  excludeIds = [],
  testID,
}: SpacePickerProps): React.ReactElement {
  const rows: Array<{ id: string; name: string; fits: string; combined: boolean }> = [
    ...spaces
      .filter((s) => !excludeIds.includes(s.id))
      .map((s) => ({ id: s.id, name: s.name, fits: spaceFitsLabel(s), combined: false })),
    ...combinations
      .filter((c) => !excludeIds.includes(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        fits: `Combined · ${spaceFitsLabel(combinationCapacity(c, spaces))}`,
        combined: true,
      })),
  ];
  const pick = (id: string | null): void => {
    if (mode === "single") {
      onChange(id === null ? [] : [id]);
      return;
    }
    if (id === null) return;
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };
  const role = mode === "single" ? "radio" : "checkbox";
  return (
    <View style={styles.host} testID={testID}>
      {label !== undefined ? <Text style={styles.label}>{label}</Text> : null}
      {mode === "single" && noneLabel !== undefined ? (
        <Pressable
          onPress={() => pick(null)}
          disabled={disabled}
          accessibilityRole="radio"
          accessibilityState={{ checked: value.length === 0, disabled }}
          accessibilityLabel={noneLabel}
          style={[styles.row, value.length === 0 && styles.rowOn]}
          testID={testID !== undefined ? `${testID}-none` : undefined}
        >
          <Text style={styles.name}>{noneLabel}</Text>
          {value.length === 0 ? <Icon name="check" size={16} color={color.text1} /> : null}
        </Pressable>
      ) : null}
      {rows.length === 0 ? (
        <Text style={styles.empty}>No spaces yet.</Text>
      ) : (
        rows.map((row) => {
          const on = value.includes(row.id);
          return (
            <Pressable
              key={row.id}
              onPress={() => pick(row.id)}
              disabled={disabled}
              accessibilityRole={role}
              accessibilityState={{ checked: on, disabled }}
              accessibilityLabel={`${row.name}, ${row.fits}`}
              style={[styles.row, on && styles.rowOn, disabled && styles.disabled]}
              testID={testID !== undefined ? `${testID}-${row.id}` : undefined}
            >
              <View style={styles.text}>
                <Text style={styles.name} numberOfLines={1}>{row.name}</Text>
                <Text style={styles.fits} numberOfLines={1}>{row.fits}</Text>
              </View>
              {on ? <Icon name="check" size={16} color={color.text1} /> : null}
            </Pressable>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[1] },
  label: { ...type.small, color: color.text2 },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  rowOn: { borderColor: color.accent, backgroundColor: color.accentLine },
  disabled: { opacity: 0.5 },
  text: { flex: 1, minWidth: 0 },
  name: { ...type.row, color: color.text1 },
  fits: { ...type.caption, color: color.text3 },
  empty: { ...type.small, color: color.text3 },
});
