import React from "react";
import { Pressable, Text } from "react-native";

import type { FollowButtonProps } from "./FollowButton";

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
          backgroundColor: active ? "transparent" : props.palette.accent,
          borderColor: active ? props.palette.secondaryText : props.palette.accent,
          borderWidth: active ? 1.5 : 0,
        },
        props.style,
      ]}
    >
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
