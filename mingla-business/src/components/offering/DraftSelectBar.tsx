/**
 * DraftSelectBar — ORCH-1123 [Hub multi-select draft delete].
 *
 * Shared sticky action bar shown only while selection mode is active. Floats as
 * a radius.full capsule above the floating BottomNav (DESIGN §2.2/§9.2):
 *   bottom = bottomInset + 64 (NAV_HEIGHT) + 8 (gap) + 8 (nav paddingTop) = +80
 * Left Cancel (secondary), right Delete (N) as the paper primary — NOT red (red
 * is reserved for the irreversible ConfirmDialog confirm; two-tier escalation,
 * DESIGN §4.3). Delete disabled-but-present at count===0 (DESIGN §4.5).
 *
 * #4420 — the capsule surface is `<Material kind="chrome">`, the one glass
 * owner: iOS blur, Android / Reduce Transparency / phone web solid (the
 * ANDROID_GLASS_USES_OPAQUE_FALLBACK policy now lives in Material). No Android
 * shadow/elevation. The iOS shadow lives on the OUTER (non-clipped) wrapper so
 * overflow:'hidden' on the capsule doesn't clip it.
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
  View,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import {
  durations,
  radius as radiusTokens,
  color,
  space,
  type,
  shadow,
} from "../../constants/designSystem";
import { Material } from "../ui/Material";

const NAV_HEIGHT = 64; // floating BottomNav capsule height (app/(tabs)/_layout.tsx)
const BAR_TRANSLATE = 24;

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

  // clear floating BottomNav (NAV_HEIGHT 64) + 8 gap above + 8 nav paddingTop
  const bottom = bottomInset + NAV_HEIGHT + space[2] + space[2];

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
        Platform.OS === "ios" ? shadow.liquid : null,
        { opacity: anim, transform: [{ translateY }] },
      ]}
      pointerEvents="box-none"
    >
      <View testID="draft-select-bar" style={styles.capsule}>
        {/* L1 — the chrome material (blur on iOS, solid elsewhere) + its rim. */}
        <Material
          kind="chrome"
          radius={radiusTokens.full}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
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
            <ActivityIndicator color={color.ink} size="small" />
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
    left: space[4],
    right: space[4],
  },
  capsule: {
    height: 56,
    borderRadius: radiusTokens.full,
    overflow: "hidden", // REQUIRED for Android opaque clip (DESIGN §7)
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space[4],
    gap: space[2],
  },
  spacer: {
    flex: 1,
  },
  cancelBtn: {
    minWidth: 88,
    height: 40,
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[4],
    backgroundColor: "transparent",
  },
  cancelBtnPressed: {
    backgroundColor: color.fill.tile,
  },
  cancelLabel: {
    fontSize: type.btnSm.fontSize,
    lineHeight: type.btnSm.lineHeight,
    fontWeight: type.btnSm.fontWeight,
    letterSpacing: type.btnSm.letterSpacing,
    color: color.text2,
  },
  // #4420 — the paper primary; orange is not a button fill.
  deleteBtn: {
    minHeight: 40,
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.paper,
  },
  deleteBtnPressed: {
    backgroundColor: color.paperPressed,
  },
  deleteBtnDisabled: {
    backgroundColor: color.fill.tile,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  deleteLabel: {
    fontSize: type.btnSm.fontSize,
    lineHeight: type.btnSm.lineHeight,
    fontWeight: type.btnSm.fontWeight,
    letterSpacing: type.btnSm.letterSpacing,
    color: color.ink,
  },
  deleteLabelDisabled: {
    color: color.text3,
  },
});

export default DraftSelectBar;
