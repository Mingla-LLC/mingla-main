import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { colors } from '../constants/designSystem';
import { KICKER, PHOTO_PAGER, SURFACES } from '../../../packages/card-identity/index.js';

/**
 * #4347 wave 1 — the deck's loading face, in the NEW card layout: segment bars
 * at the top, then (bottom-anchored, where the real card puts them) the kicker,
 * a two-line title, and the plate with its fact line and controls. Same rhythm
 * as the card that replaces it, so nothing jumps when the deck arrives.
 *
 * Supersedes the old image-block / title / two-buttons skeleton, which drew a
 * layout the deck card has not had since #1609. The list and recommendation
 * skeletons that lived in this file had no importer and are deleted with it.
 *
 * Reduce Motion: the shimmer does not run; the skeleton is shown still.
 */
const S1 = SURFACES.s1Single;

interface SkeletonCardProps {
  width?: number;
  height?: number;
  borderRadius?: number;
  reducedMotion?: boolean;
}

export const SkeletonCard: React.FC<SkeletonCardProps> = ({
  width = 300,
  height = 400,
  borderRadius = S1.cardR,
  reducedMotion = false,
}) => {
  const shimmerAnimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) {
      shimmerAnimation.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnimation, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(shimmerAnimation, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmerAnimation, reducedMotion]);

  const shimmerTranslateX = shimmerAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [-width, width],
  });

  return (
    <View
      testID="deck-skeleton"
      style={[styles.container, { width, height, borderRadius }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.bars}>
        {[0, 1, 2].map((i) => (
          <View key={`bar_${i}`} style={styles.bar} />
        ))}
      </View>

      <View style={styles.column} testID="deck-skeleton-column">
        <View style={styles.kicker} />
        <View style={styles.titleLine} />
        <View style={[styles.titleLine, styles.titleLineShort]} />
      </View>

      <View style={styles.plate} testID="deck-skeleton-plate">
        <View style={styles.factLine} />
        <View style={styles.controls}>
          <View style={styles.pill} />
          <View style={styles.pill} />
          <View style={styles.disc} />
        </View>
      </View>

      {reducedMotion ? null : (
        <Animated.View
          testID="deck-skeleton-shimmer"
          style={[styles.shimmer, { transform: [{ translateX: shimmerTranslateX }] }]}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.gray[100],
    overflow: 'hidden',
    position: 'relative',
  },
  bars: {
    position: 'absolute',
    top: PHOTO_PAGER.bar.side,
    left: PHOTO_PAGER.bar.side,
    right: PHOTO_PAGER.bar.side,
    flexDirection: 'row',
    gap: PHOTO_PAGER.bar.gap,
  },
  bar: {
    flex: 1,
    height: PHOTO_PAGER.bar.height,
    borderRadius: PHOTO_PAGER.bar.radius,
    backgroundColor: colors.gray[200],
  },
  column: {
    position: 'absolute',
    left: S1.titleInset,
    right: S1.titleInset,
    bottom: S1.bottomInset + S1.plateH + S1.gap,
  },
  kicker: {
    width: '34%',
    height: KICKER.size,
    borderRadius: KICKER.size / 2,
    backgroundColor: colors.gray[200],
    marginBottom: KICKER.gap + 2,
  },
  titleLine: {
    height: S1.titleSize - 6,
    borderRadius: 6,
    backgroundColor: colors.gray[200],
    marginTop: S1.titleLH - S1.titleSize + 6,
  },
  titleLineShort: {
    width: '62%',
  },
  plate: {
    position: 'absolute',
    left: S1.sideInset,
    right: S1.sideInset,
    bottom: S1.bottomInset,
    height: S1.plateH,
    borderRadius: S1.plateR,
    backgroundColor: colors.gray[200],
    paddingHorizontal: S1.sideInset,
    justifyContent: 'space-evenly',
  },
  factLine: {
    width: '78%',
    height: S1.metaSize,
    borderRadius: S1.metaSize / 2,
    backgroundColor: colors.gray[300],
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pill: {
    width: 96,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.gray[300],
  },
  disc: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginLeft: 'auto',
    backgroundColor: colors.gray[300],
  },
  shimmer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    width: '100%',
  },
});
