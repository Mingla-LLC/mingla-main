import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  Animated,
  Easing,
} from "react-native";
import {
  colors,
  spacing,
  radius,
  fontWeights,
  shadows,
} from "../../constants/designSystem";

interface AIProcessingProps {
  photoUri: string;
  onItemsFound: (count: number) => void;
  totalItems: number;
  categories: string[];
  isComplete: boolean;
}

export default function AIProcessing({
  photoUri,
  totalItems,
  categories,
  isComplete,
}: AIProcessingProps): React.JSX.Element {
  const scanLineY = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [imageHeight, setImageHeight] = useState(280);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    // Scan line animation
    const loop = Animated.loop(
      Animated.timing(scanLineY, {
        toValue: imageHeight,
        duration: 3000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [imageHeight]);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        {/* Menu photo with scan line */}
        <View
          style={styles.imageContainer}
          onLayout={(e) => setImageHeight(e.nativeEvent.layout.height)}
        >
          <Image source={{ uri: photoUri }} style={styles.menuImage} />
          {!isComplete && (
            <Animated.View
              style={[
                styles.scanLine,
                { transform: [{ translateY: scanLineY }] },
              ]}
            />
          )}
          {/* Glow border */}
          <View style={styles.glowBorder} />
        </View>

        {/* Status text */}
        <Text style={styles.statusText}>
          {isComplete
            ? `Done! ${totalItems} items in ${categories.length} categories`
            : totalItems > 0
            ? `Found ${totalItems} items so far`
            : "Reading your menu..."}
        </Text>

        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              { width: isComplete ? "100%" : `${Math.min(95, totalItems * 4)}%` },
            ]}
          />
        </View>

        {/* Categories */}
        {categories.length > 0 && (
          <Text style={styles.categoriesText}>
            {categories.join(" · ")}
          </Text>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  content: {
    alignItems: "center",
    width: "100%",
  },
  imageContainer: {
    width: 200,
    height: 280,
    borderRadius: radius.lg,
    overflow: "hidden",
    marginBottom: spacing.xl,
    ...shadows.lg,
  },
  menuImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.primary[500],
    opacity: 0.8,
    shadowColor: colors.primary[500],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
  },
  glowBorder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: colors.primary[500],
    borderRadius: radius.lg,
    opacity: 0.2,
  },
  statusText: {
    fontSize: 18,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  progressTrack: {
    width: "60%",
    height: 4,
    backgroundColor: colors.gray[200],
    borderRadius: 2,
    overflow: "hidden",
    marginBottom: spacing.md,
  },
  progressFill: {
    height: 4,
    backgroundColor: colors.primary[500],
    borderRadius: 2,
  },
  categoriesText: {
    fontSize: 14,
    color: colors.text.tertiary,
    textAlign: "center",
  },
});
