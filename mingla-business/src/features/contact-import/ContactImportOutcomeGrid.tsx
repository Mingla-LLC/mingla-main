import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ContactImportCounts } from "../../services/contactImportService";
import {
  radius,
  space,
  color,
  type,
} from "../../constants/designSystem";
const items: [keyof ContactImportCounts, string][] = [
  ["addedCount", "Added"],
  ["updatedCount", "Updated"],
  ["reviewCount", "Needs review"],
  ["invalidCount", "Invalid"],
  ["duplicateCount", "Duplicates"],
  ["unchangedCount", "Unchanged"],
];
export function ContactImportOutcomeGrid({
  counts,
}: {
  counts: ContactImportCounts;
}): React.ReactElement {
  return (
    <View
      style={s.host}
      accessibilityLabel={`All ${counts.rowCount} rows are represented by six outcomes`}
    >
      <View style={s.grid}>
        {items.map(([key, label]) => (
          <View key={key} style={s.tile}>
            <Text style={s.value}>{counts[key]}</Text>
            <Text style={s.label}>{label}</Text>
          </View>
        ))}
      </View>
      <Text style={s.helper}>
        These six outcomes add up to all {counts.rowCount} rows.
      </Text>
      <View style={s.suppression}>
        <Text style={s.cardTitle}>
          Already suppressed · {counts.alreadySuppressedCount}
        </Text>
        <Text style={s.overlap}>Overlaps the outcomes above</Text>
        <Text style={s.body}>
          These people are still in Your Book, but Mingla keeps their
          unsubscribed email or text channels skipped.
        </Text>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  host: { gap: space[2] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  tile: {
    minWidth: 140,
    flexGrow: 1,
    flexBasis: "30%",
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  value: { ...type.stat, color: color.text1 },
  label: { ...type.small, color: color.text2, fontWeight: "600" },
  helper: { ...type.small, color: color.text3 },
  suppression: {
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.info,
    backgroundColor: color.canvas,
    gap: space[1],
  },
  cardTitle: { ...type.h1, color: color.text1 },
  overlap: { ...type.label, color: color.info },
  body: { ...type.small, color: color.text2 },
});
