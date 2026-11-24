/**
 * #4522 — one-tap inclusions (Flights, Hotel, Breakfast, Airport transfer,
 * Guide, Activities, Insurance, Dinners). A tap adds the chip as an included
 * item; a second tap removes it. "Add your own" stays the existing list below
 * (TripCreatorStep3Inclusions), which these chips write into.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../constants/designSystem";
import { TripBuilderChip } from "./TripBuilderChip";
import {
  INCLUSION_CHIPS,
  inclusionChipOn,
  toggleInclusionChip,
  type InclusionItem,
} from "./tripBuilderV2Model";

export interface TripInclusionChipsProps {
  items: ReadonlyArray<InclusionItem>;
  onChange: (next: InclusionItem[]) => void;
  disabled?: boolean;
}

export const TripInclusionChips: React.FC<TripInclusionChipsProps> = ({
  items,
  onChange,
  disabled = false,
}) => (
  <View style={styles.host} testID="trip-inclusion-chips">
    <Text accessibilityRole="header" style={styles.title}>
      What&rsquo;s in the price
    </Text>
    <Text style={styles.sub}>Tap what travelers get. Add anything else below.</Text>
    <View style={styles.row}>
      {INCLUSION_CHIPS.map((chip) => (
        <TripBuilderChip
          key={chip.label}
          label={chip.label}
          icon={chip.icon}
          selected={inclusionChipOn(items, chip.label)}
          disabled={disabled}
          onPress={() => onChange(toggleInclusionChip(items, chip.label))}
          testID={`trip-inclusion-chip-${chip.label.toLowerCase().replace(/\s+/g, "-")}`}
        />
      ))}
    </View>
  </View>
);

const styles = StyleSheet.create({
  host: { gap: space[2], paddingBottom: space[2] },
  title: {
    fontSize: type.h2.fontSize,
    lineHeight: type.h2.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
  sub: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
    marginBottom: space[2],
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
});
