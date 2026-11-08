import React from "react";
import { Pressable, Text } from "react-native";

import { ThemeAccentGradientLayer } from "@mingla/offering-rendering/ThemeAccentFill";

import type { FollowButtonProps } from "./FollowButton";
import { accentEdgeOnFill, accentFill } from "@mingla/offering-rendering/themeAccentStyle";

const LoadedFollowButton = React.lazy(async () => {
  const module = await import("./FollowButton");
  return { default: module.FollowButton };
});

const ImmediateFollowButton: React.FC<FollowButtonProps> = (props) => {
  const active =
    props.isFollowing === true ||
    props.state === "following" ||
    props.state === "muted" ||
    props.state === "pending" ||
    props.state === "busy_unfollow";
  const disabled =
    props.followPending === true ||
    props.state === "busy_follow" ||
    props.state === "busy_unfollow" ||
    props.state === "disabled";
  const label =
    props.state === "pending"
      ? "Pending"
      : props.state === "muted"
        ? "Muted"
        : active
          ? "Following"
          : "Follow";
  return (
    <Pressable
      onPress={props.onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${props.brandName}`}
      accessibilityState={{ selected: active, disabled }}
      style={[
        {
          minHeight: 44,
          minWidth: props.size === "sm" ? 104 : 120,
          borderRadius: 14,
          paddingHorizontal: 20,
          alignItems: "center",
          justifyContent: "center",
          ...(active ? { backgroundColor: "transparent" } : accentFill(props.palette)),
          borderColor: active ? props.palette.secondaryText : accentEdgeOnFill(props.palette),
          borderWidth: active ? 1.5 : 0,
        },
        props.style,
      ]}
    >
      {/* issue #1023 — same gradient as the loaded button, filled state only. */}
      {props.theme !== undefined && !active && !disabled ? (
        <ThemeAccentGradientLayer theme={props.theme} palette={props.palette} borderRadius={14} />
      ) : null}
      <Text style={{ color: active ? props.palette.primaryText : props.palette.accentText, fontWeight: "700" }}>
        {label}
      </Text>
    </Pressable>
  );
};

export const SharedFollowButton: React.FC<FollowButtonProps> = (props) => (
  <React.Suspense fallback={<ImmediateFollowButton {...props} />}>
    <LoadedFollowButton {...props} />
  </React.Suspense>
);
