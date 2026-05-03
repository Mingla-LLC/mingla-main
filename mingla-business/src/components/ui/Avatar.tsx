/**
 * Avatar — circular / rounded-square avatar primitive.
 *
 * Two size variants:
 *   `row`  (40×40, fully circular, 18px initial) — list rows, member rows
 *   `hero` (84×84, lg-rounded square, 36px initial) — profile heros
 *
 * Visual contract (preserved from inline implementations across J-A7/J-A8/
 * J-A9): circular wrap with `accent.tint` background + 1px `accent.border` +
 * first-letter-uppercase initial in `accent.warm`. When `photo` is supplied,
 * the image fills the wrap (overflow clipped to shape). When `dimmed`, the
 * whole avatar drops to 50% opacity (used for pending-invitation rows).
 *
 * Additive kit carve-out under DEC-079 closure protocol — promoted from
 * inline composition after D-IMPL-A9-3 watch-point hit 4 uses across
 * BrandProfileView (84 hero), BrandEditView (84 hero with pencil overlay),
 * BrandTeamView (40 row + dimmed variant), BrandMemberDetailView (84 hero).
 *
 * Composition: consumers wrap this in their own `position: relative` View
 * to absolute-position siblings (e.g., the photo-edit pencil button on
 * BrandEditView). The Avatar primitive itself stays atomic — no children
 * prop, no overlay support baked in.
 */

import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import {
  accent,
  radius as radiusTokens,
} from "../../constants/designSystem";

export type AvatarSize = "row" | "hero";

export interface AvatarProps {
  /**
   * Display name. First letter (uppercase) renders as the fallback initial
   * when `photo` is absent. Also used as the default accessibility label.
   */
  name: string;
  size: AvatarSize;
  /** Optional photo URL. When supplied, renders as filled Image. */
  photo?: string;
  /**
   * When true, drops the whole avatar to 50% opacity. Used for
   * pending-invitation rows in the team list.
   */
  dimmed?: boolean;
  /** Accessibility label override. Defaults to `Avatar for {name}`. */
  accessibilityLabel?: string;
  /** Style override merged after component styles (e.g., margin tweaks). */
  style?: StyleProp<ViewStyle>;
}

interface SizeTokens {
  width: number;
  height: number;
  borderRadius: number;
  fontSize: number;
}

const SIZE_TOKENS: Record<AvatarSize, SizeTokens> = {
  row: {
    width: 40,
    height: 40,
    borderRadius: 999,
    fontSize: 18,
  },
  hero: {
    width: 84,
    height: 84,
    borderRadius: radiusTokens.lg,
    fontSize: 36,
  },
};

export const Avatar: React.FC<AvatarProps> = ({
  name,
  size,
  photo,
  dimmed = false,
  accessibilityLabel,
  style,
}) => {
  const tokens = SIZE_TOKENS[size];
  const initial = name.length > 0 ? name.charAt(0).toUpperCase() : "?";

  return (
    <View
      accessibilityLabel={accessibilityLabel ?? `Avatar for ${name}`}
      style={[
        styles.wrap,
        {
          width: tokens.width,
          height: tokens.height,
          borderRadius: tokens.borderRadius,
        },
        dimmed && styles.dimmed,
        style,
      ]}
    >
      {photo !== undefined ? (
        <Image source={{ uri: photo }} style={styles.image} />
      ) : (
        <Text
          style={[
            styles.initial,
            { fontSize: tokens.fontSize },
          ]}
        >
          {initial}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  dimmed: {
    opacity: 0.5,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  initial: {
    fontWeight: "700",
    color: accent.warm,
  },
});

export default Avatar;
