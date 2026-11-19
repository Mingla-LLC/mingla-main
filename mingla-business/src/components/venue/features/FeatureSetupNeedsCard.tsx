/**
 * #4490 N20 / N61 — "Still to set up": each chosen feature that is not ready
 * yet, in one plain sentence, with a button to the place that fixes it. Shown
 * on the add-venue success screen and at the top of the venue Overview.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../constants/designSystem";
import { Button } from "../../ui/Button";
import type { FeatureSetupNeed, SetupTarget } from "./featureSetupModel";

export interface FeatureSetupNeedsCardProps {
  needs: readonly FeatureSetupNeed[];
  onOpen: (target: SetupTarget) => void;
  testID?: string;
}

export function FeatureSetupNeedsCard({
  needs,
  onOpen,
  testID = "venue-feature-setup-needs",
}: FeatureSetupNeedsCardProps): React.ReactElement | null {
  if (needs.length === 0) return null;
  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.title} accessibilityRole="header">
        Still to set up
      </Text>
      {needs.map((need) => (
        <View key={need.key} style={styles.row} testID={`${testID}-${need.key}`}>
          <Text style={styles.text}>{need.text}</Text>
          {need.target !== null && need.buttonLabel !== null ? (
            <Button
              label={need.buttonLabel}
              variant="secondary"
              size="sm"
              onPress={() => onOpen(need.target as SetupTarget)}
              testID={`${testID}-${need.key}-action`}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  title: { ...type.row, color: color.text1 },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], flexWrap: "wrap" },
  text: { ...type.small, color: color.text2, flex: 1, minWidth: 200 },
});
