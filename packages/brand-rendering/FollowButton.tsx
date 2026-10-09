// #3682 Follow Design Contract — shared Follow / Following control (web + app).
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import {
  opaqueSurfaceColor,
  type ThemePalette,
} from "@mingla/offering-rendering/themePalette";

import {
  followSizeStyle,
  followTokens,
  resolveFollowVisualState,
  type FollowButtonSize,
  type FollowVisualState,
} from "./followTokens";

export type { FollowButtonSize, FollowVisualState };

export type FollowButtonProps = {
  brandName: string;
  palette: ThemePalette;
  /** Opaque hex behind the button (defaults to opaque card surface). */
  surface?: string;
  state?: FollowVisualState;
  /** Legacy host props — mapped into `state` when `state` is omitted. */
  isFollowing?: boolean;
  followPending?: boolean;
  size?: FollowButtonSize;
  onPress: () => void;
  disabledReason?: string;
  testID?: string;
  /** Desktop brand panel uses lg with desk spacing owned by the host. */
  style?: ViewStyle;
};

export const FollowButton: React.FC<FollowButtonProps> = ({
  brandName,
  palette,
  surface,
  state: stateProp,
  isFollowing,
  followPending,
  size = "lg",
  onPress,
  disabledReason,
  testID = "follow-button",
  style,
}) => {
  const state = resolveFollowVisualState({
    followState: stateProp,
    isFollowing,
    followPending,
  });
  const surfaceHex = surface ?? opaqueSurfaceColor(palette);
  const tokens = followTokens(palette, surfaceHex);
  const sizeStyle = followSizeStyle(size);

  const isFollowingLike =
    state === "following" ||
    state === "muted" ||
    state === "busy_unfollow" ||
    state === "pending";
  const isBusy = state === "busy_follow" || state === "busy_unfollow";
  const isDisabled = state === "disabled";

  const fill = isDisabled
    ? tokens.disabledFill
    : isFollowingLike
      ? tokens.followingFill
      : tokens.followFill;
  const labelColor = isDisabled
    ? tokens.disabledLabel
    : isFollowingLike
      ? tokens.followingLabel
      : tokens.followLabel;
  const edge = isDisabled
    ? null
    : isFollowingLike
      ? tokens.followingEdge
      : tokens.followEdge;
  const iconColor = isFollowingLike
    ? tokens.followingIcon
    : tokens.followLabel;

  const label =
    state === "pending"
      ? "Pending"
      : state === "muted"
        ? "Muted"
        : isFollowingLike
          ? "Following"
          : "Follow";

  const a11yLabel =
    state === "pending"
      ? `Follow pending. Check your email to finish.`
      : state === "muted"
        ? `Muted ${brandName}`
        : state === "disabled"
          ? `Follow ${brandName}, unavailable. ${disabledReason ?? ""}`.trim()
          : isFollowingLike
            ? `Following ${brandName}`
            : `Follow ${brandName}`;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isBusy || isDisabled}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={isFollowingLike && !isBusy ? "Opens options" : undefined}
      accessibilityState={{
        selected: isFollowingLike && state !== "pending",
        busy: isBusy,
        disabled: isBusy || isDisabled,
      }}
      accessibilityValue={{ text: state }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: sizeStyle.minHeight,
          minWidth: sizeStyle.minWidth,
          borderRadius: sizeStyle.borderRadius,
          paddingHorizontal: sizeStyle.paddingHorizontal,
          alignSelf: sizeStyle.fullWidth ? "stretch" : "flex-start",
          backgroundColor:
            pressed && !isBusy && !isDisabled
              ? isFollowingLike
                ? tokens.followingFillPressed
                : tokens.followFillPressed
              : fill,
          borderColor: edge ?? fill,
          borderWidth: edge !== null ? 1.5 : 0,
        },
        // sm drawn 36 → hitSlop to 44
        size === "sm" ? undefined : undefined,
        style,
      ]}
      hitSlop={size === "sm" ? { top: 4, bottom: 4 } : undefined}
    >
      <View style={styles.row}>
        {isBusy ? (
          <ActivityIndicator size="small" color={iconColor} />
        ) : state === "pending" ? (
          // Glyphs (not lucide) so buyer-web Brand+Event share does not hoist
          // lucide-react-native into the eager `__common` chunk (#3682 / ORCH-1083).
          <Text style={[styles.glyph, { color: iconColor }]} accessibilityElementsHidden>
            …
          </Text>
        ) : isFollowingLike ? (
          <Text style={[styles.glyph, { color: iconColor }]} accessibilityElementsHidden>
            ✓
          </Text>
        ) : null}
        <Text
          style={[styles.label, { color: labelColor }]}
          maxFontSizeMultiplier={1.35}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  glyph: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  icon: {
    marginRight: 0,
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
});
