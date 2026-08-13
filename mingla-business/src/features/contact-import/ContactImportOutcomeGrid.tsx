import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ContactImportCounts } from "../../services/contactImportService";
import {
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  text,
  typography,
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
  host: { gap: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    minWidth: 140,
    flexGrow: 1,
    flexBasis: "30%",
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  value: { ...typography.statValue, color: text.primary },
  label: { ...typography.bodySm, color: text.secondary, fontWeight: "600" },
  helper: { ...typography.bodySm, color: text.tertiary },
  suppression: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: semantic.info,
    backgroundColor: canvas.depth,
    gap: spacing.xs,
  },
  cardTitle: { ...typography.h3, color: text.primary },
  overlap: { ...typography.labelCap, color: semantic.info },
  body: { ...typography.bodySm, color: text.secondary },
});
