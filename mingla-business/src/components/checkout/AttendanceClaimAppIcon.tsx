import React from "react";
import { Image, type ImageProps } from "react-native";
import { MINGLA_APP_ICON } from "@mingla/brand-assets";

export default function AttendanceClaimAppIcon(
  props: Omit<ImageProps, "source">,
): React.ReactElement {
  return <Image {...props} source={MINGLA_APP_ICON} />;
}
