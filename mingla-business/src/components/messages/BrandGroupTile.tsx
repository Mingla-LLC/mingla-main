/**
 * #4304 part 2 — a Brand group's square-rounded identity tile: the brand's
 * logo when it has one, otherwise its initial on a brand-coloured two-tone
 * fill (no gradient package: this renders in the thread's node render proofs).
 */
import React, { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { brandGroupTileColours } from "../../utils/brandGroupThreadModel";

export function BrandGroupTile({
  name,
  photoUrl,
  seed,
  size = 48,
}: {
  name: string;
  photoUrl: string | null | undefined;
  seed: string;
  size?: number;
}): React.ReactElement {
  const [failed, setFailed] = useState(false);
  const radius = Math.round(size * 0.28);
  const frame = { width: size, height: size, borderRadius: radius };
  if (photoUrl && !failed) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={[styles.image, frame]}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
      />
    );
  }
  const [top, bottom] = brandGroupTileColours(seed || name);
  return (
    <View style={[styles.tile, frame, { backgroundColor: top }]} accessibilityElementsHidden>
      <View style={[styles.shade, { backgroundColor: bottom, height: size * 0.62 }]} />
      <Text style={[styles.initial, { fontSize: Math.round(size * 0.42) }]}>
        {name.trim().charAt(0).toUpperCase() || "M"}
      </Text>
    </View>
  );
}

/** A teammate's round initial avatar beside the last bubble of a cluster. */
export function BrandGroupPersonAvatar({
  name,
  seed,
  size = 28,
}: {
  name: string;
  seed: string;
  size?: number;
}): React.ReactElement {
  const [top] = brandGroupTileColours(seed || name);
  return (
    <View
      style={[styles.person, { width: size, height: size, borderRadius: size / 2, backgroundColor: top }]}
      accessibilityElementsHidden
    >
      <Text style={[styles.personInitial, { fontSize: Math.round(size * 0.42) }]}>
        {name.trim().charAt(0).toUpperCase() || "M"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: "#1A1E24" },
  tile: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  shade: { position: "absolute", left: 0, right: 0, bottom: 0, opacity: 0.55 },
  initial: { color: "#FFFFFF", fontWeight: "800" },
  person: { alignItems: "center", justifyContent: "center" },
  personInitial: { color: "#FFFFFF", fontWeight: "800" },
});
