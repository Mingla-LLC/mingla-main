/**
 * DraftSelectBar — ORCH-1123 [Hub multi-select draft delete].
 *
 * Shared sticky action bar shown only while selection mode is active. Floats as
 * a radius.full capsule above the floating BottomNav (DESIGN §2.2/§9.2):
 *   bottom = bottomInset + 64 (NAV_HEIGHT) + 8 (gap) + 8 (nav paddingTop) = +80
 * Left Cancel (secondary), right Delete (N) in brand WARM — NOT red (red is
 * reserved for the irreversible ConfirmDialog confirm; two-tier escalation,
 * DESIGN §4.3). Delete disabled-but-present at count===0 (DESIGN §4.5).
 *
 * Android opaque-glass policy (ANDROID_GLASS_USES_OPAQUE_FALLBACK): opaque
 * #16181b fill, overflow:'hidden', no Android shadow/elevation (DESIGN §7).
 * The iOS shadow lives on the OUTER (non-clipped) wrapper so overflow:'hidden'
 * on the capsule doesn't clip it.
 */

import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import { useReducedMotion } from "react-native-reanimated";

import {
  accent,
  blurIntensity as blurIntensityTokens,
  durations,
  glass,
  radius as radiusTokens,
  shadows,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { shouldUseRealBlur } from "../../utils/glassBlur";

const NAV_HEIGHT = 64; // floating BottomNav capsule height (app/(tabs)/_layout.tsx)
const BAR_TRANSLATE = 24;
const ANDROID_OPAQUE_FILL = "#16181b"; // canonical Android opaque-glass value

export interface DraftSelectBarProps {
  count: number; // selected count → "Delete (N)"
  deleting: boolean; // disables both buttons + shows spinner on Delete
  onCancel: () => void; // → useDraftMultiSelect.exit()
  onDelete: () => void; // → open ConfirmDialog
  bottomInset: number; // safe-area inset to clear the home indicator
}

export const DraftSelectBar: React.FC<DraftSelectBarProps> = ({
  count,
  deleting,
  onCancel,
  onDelete,
  bottomInset,
}) => {
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: reducedMotion ? durations.fast : durations.entry,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim, reducedMotion]);

  const deleteDisabled = count === 0 || deleting;
  const blurOk = shouldUseRealBlur(width);

  // clear floating BottomNav (NAV_HEIGHT 64) + 8 gap above + 8 nav paddingTop
  const bottom = bottomInset + NAV_HEIGHT + spacing.sm + spacing.sm;

  const translateY = reducedMotion
    ? 0
    : anim.interpolate({
        inputRange: [0, 1],
        outputRange: [BAR_TRANSLATE, 0],
      });

  return (
    <Animated.View
      style={[
        styles.wrap,
        { bottom },
        Platform.OS === "ios" ? shadows.glassChrome : null,
        { opacity: anim, transform: [{ translateY }] },
      ]}
      pointerEvents="box-none"
    >
      <View testID="draft-select-bar" style={styles.capsule}>
        {/* L1 — fill: iOS translucent over blur, Android/mobile-web opaque */}
        {Platform.OS === "ios" && blurOk ? (
          <>
            <BlurView
              intensity={blurIntensityTokens.chrome}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: "rgba(12, 14, 18, 0.72)" },
              ]}
            />
          </>
        ) : (
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: ANDROID_OPAQUE_FILL },
            ]}
          />
        )}

        {/* L2 — hairline border */}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radiusTokens.full,
              borderWidth: 1,
              borderColor: glass.border.chrome,
            },
          ]}
        />

        {/* Cancel (left) */}
        <Pressable
          testID="draft-select-cancel"
          onPress={onCancel}
          disabled={deleting}
          accessibilityRole="button"
          accessibilityLabel="Cancel selection"
          accessibilityState={{ disabled: deleting }}
          hitSlop={4}
          style={({ pressed }) => [
            styles.cancelBtn,
            pressed && styles.cancelBtnPressed,
            deleting && styles.btnDisabled,
          ]}
        >
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>

        <View style={styles.spacer} />

        {/* Delete (N) (right) — brand warm, NOT red */}
        <Pressable
          testID="draft-select-delete"
          onPress={onDelete}
          disabled={deleteDisabled}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${count} selected draft${count === 1 ? "" : "s"}`}
          accessibilityState={{ disabled: deleteDisabled }}
          hitSlop={4}
          style={({ pressed }) => [
            styles.deleteBtn,
            pressed && !deleteDisabled && styles.deleteBtnPressed,
            deleteDisabled && styles.deleteBtnDisabled,
          ]}
        >
          {deleting ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              style={[
                styles.deleteLabel,
                deleteDisabled && styles.deleteLabelDisabled,
              ]}
            >
              {`Delete (${count})`}
            </Text>
          )}
        </Pressable>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
  },
  capsule: {
    height: 56,
    borderRadius: radiusTokens.full,
    overflow: "hidden", // REQUIRED for Android opaque clip (DESIGN §7)
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  spacer: {
    flex: 1,
  },
  cancelBtn: {
    minWidth: 88,
    height: 40,
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: glass.border.chrome,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    backgroundColor: "transparent",
  },
  cancelBtnPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  cancelLabel: {
    fontSize: typography.buttonMd.fontSize,
    lineHeight: typography.buttonMd.lineHeight,
    fontWeight: typography.buttonMd.fontWeight,
    letterSpacing: typography.buttonMd.letterSpacing,
    color: textTokens.secondary,
  },
  deleteBtn: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.warm,
  },
  deleteBtnPressed: {
    backgroundColor: "#d96c1f",
  },
  deleteBtnDisabled: {
    backgroundColor: "rgba(235, 120, 37, 0.32)",
  },
  btnDisabled: {
    opacity: 0.6,
  },
  deleteLabel: {
    fontSize: typography.buttonMd.fontSize,
    lineHeight: typography.buttonMd.lineHeight,
    fontWeight: typography.buttonMd.fontWeight,
    letterSpacing: typography.buttonMd.letterSpacing,
    color: "#ffffff",
  },
  deleteLabelDisabled: {
    color: "rgba(255, 255, 255, 0.5)",
  },
});

export default DraftSelectBar;
