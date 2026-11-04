/**
 * Issue #4265 — Likes loading state: a 2×2 skeleton shaped exactly like the
 * saved card (4:5 photo, title bar, facts bar, button bar). It replaces the old
 * spinner. A soft opacity shimmer runs unless the user has reduce motion on.
 */
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from "../../constants/designSystem";

const L = glass.likes;
const OPAQUE = ANDROID_GLASS_USES_OPAQUE_FALLBACK;
const SKELETON_CARDS = [0, 1, 2, 3];

interface SavedGridSkeletonProps {
  cardWidth: number;
  reduceMotion: boolean;
  accessibilityLabel: string;
}

export default function SavedGridSkeleton({
  cardWidth,
  reduceMotion,
  accessibilityLabel,
}: SavedGridSkeletonProps): React.ReactElement {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(1);
      return undefined;
    }
    const half = L.skeleton.shimmerMs / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: L.skeleton.shimmerLowOpacity, duration: half, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: half, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <View
      style={styles.grid}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: true }}
    >
      {SKELETON_CARDS.map((i) => (
        <Animated.View key={i} style={[styles.card, { width: cardWidth, opacity: pulse }]}>
          <View style={styles.photo} />
          <View style={styles.titleBar} />
          <View style={styles.factsBar} />
          <View style={styles.buttonBar} />
        </Animated.View>
      ))}
    </View>
  );
}

const block = OPAQUE ? L.skeleton.blockOpaque : L.skeleton.block;
const blockDim = OPAQUE ? L.skeleton.blockDimOpaque : L.skeleton.blockDim;

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: L.grid.columnGap,
    rowGap: L.grid.rowGap,
    paddingHorizontal: L.grid.sidePadding,
    paddingTop: L.grid.topPadding,
  },
  card: {
    gap: 8,
  },
  photo: {
    aspectRatio: L.card.photoAspectRatio,
    borderRadius: L.card.photoRadius,
    backgroundColor: block,
  },
  titleBar: {
    height: 14,
    width: "80%",
    borderRadius: 6,
    backgroundColor: block,
  },
  factsBar: {
    height: 10,
    width: "55%",
    borderRadius: 6,
    backgroundColor: blockDim,
  },
  buttonBar: {
    height: L.card.buttonHeight,
    borderRadius: L.card.buttonRadius,
    backgroundColor: blockDim,
  },
});
