import React from "react";
import { StyleSheet, View } from "react-native";

export function DiscoverGridSkeleton(): React.ReactElement {
  return (
    <View style={styles.grid} accessibilityLabel="Loading Discover">
      {[0, 1, 2, 3].map((key) => <View key={key} style={styles.card} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 16, paddingTop: 14 },
  card: { width: "48%", aspectRatio: 0.72, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.07)" },
});
