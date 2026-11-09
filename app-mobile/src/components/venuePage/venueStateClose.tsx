/**
 * #4347 wave 4 rework (A-6) — the Close on the venue route's loading, error and
 * not-found states. It is the ONLY way out of a page that could not load, so it
 * must not depend on anything that can fail to load: it lives in this leaf
 * module (React and react-native only), held statically by the route, never in
 * the lazily loaded Explorer layer.
 *
 * The cross is drawn with two Views rather than the app's Icon set, so the
 * route still pulls no icon or i18n stack. Its label matches the route's other
 * state copy ("Loading venue…", "Venue not found"), which is English too.
 */
import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";

export function VenueStateClose({
  onPress,
  topInset,
}: {
  onPress: () => void;
  topInset: number;
}): React.ReactElement {
  return (
    <TouchableOpacity
      testID="venue-state-close"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Close"
      hitSlop={8}
      style={[styles.button, { top: topInset + 8 }]}
    >
      <View style={[styles.stroke, styles.strokeA]} />
      <View style={[styles.stroke, styles.strokeB]} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  stroke: {
    position: "absolute",
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: "#FFFFFF",
  },
  strokeA: { transform: [{ rotate: "45deg" }] },
  strokeB: { transform: [{ rotate: "-45deg" }] },
});
