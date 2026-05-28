import React from "react";
import { Platform, View, useWindowDimensions } from "react-native";
import { BlurView } from "expo-blur";

const MOBILE_WEB_MAX_WIDTH = 768;

// GlassBlur — drop-in BlurView that skips the blur layer on MOBILE WEB only.
//
// Stacked `backdrop-filter: blur()` (what expo-blur's BlurView renders on web)
// hard-crashes the mobile browser renderer: a public page with several glass
// panels (e.g. PublicBrandPage's 9) reliably kills the WebContent/GPU process
// on iOS Safari + Chrome within ~1s, even on a near-empty heap (confirmed:
// neutralizing backdrop-filter flips the page from crash to alive). The panels
// already carry a translucent background color, so dropping the blur layer
// leaves a clean solid-translucent glass on mobile web. Desktop web (>= 768)
// and native apps (cheap native blur, no crash) keep the real blur.
export const GlassBlur: React.FC<React.ComponentProps<typeof BlurView>> = (
  props,
) => {
  const { width } = useWindowDimensions();
  if (Platform.OS === "web" && width < MOBILE_WEB_MAX_WIDTH) {
    return props.children !== undefined ? (
      <View style={props.style}>{props.children}</View>
    ) : null;
  }
  return <BlurView {...props} />;
};

export default GlassBlur;
