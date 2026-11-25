/**
 * #4490 — owner-only entry to the non-public venue preview.
 *
 * This is deliberately not one of #1483's public-page/share actions: those
 * controls remain absent until the venue is publicly reachable. Keeping the
 * preview as its own semantic control also lets the locked #1483 suites keep
 * proving that boundary without mistaking an owner preview for a public link.
 */
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import {
  radius,
  shadow as shadowTokens,
  size as sizeTokens,
  space,
  type,
} from "../../constants/designSystem";
import { color, materials } from "../../theme/surfaceTokens";

export interface VenuePreviewActionProps {
  compact: boolean;
  onPress: () => void;
}

export const VenuePreviewAction: React.FC<VenuePreviewActionProps> = ({
  compact,
  onPress,
}) => (
  <Pressable
    accessibilityLabel="Preview page"
    accessibilityRole="button"
    hitSlop={4}
    onPress={onPress}
    style={({ pressed }) => [
      styles.control,
      compact ? styles.compact : styles.labelled,
      pressed ? styles.pressed : null,
    ]}
    testID="venue-page-preview"
  >
    <Text numberOfLines={1} style={styles.label}>
      {compact ? "Preview" : "Preview page"}
    </Text>
  </Pressable>
);

const styles = StyleSheet.create({
  control: {
    minHeight: sizeTokens.btn.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: materials.control.solidFill,
    borderColor: materials.control.rim.edge,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    ...shadowTokens.paper,
  },
  compact: {
    paddingHorizontal: space[3],
  },
  labelled: {
    paddingHorizontal: space[4],
  },
  pressed: {
    backgroundColor: materials.selected.solidFill,
    opacity: 0.8,
  },
  label: {
    ...type.btnSm,
    color: color.text1,
  },
});
