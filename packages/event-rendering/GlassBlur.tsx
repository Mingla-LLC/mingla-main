import React from "react";
import { Platform, View, useWindowDimensions } from "react-native";
import { BlurView } from "expo-blur";

const MOBILE_WEB_MAX_WIDTH = 768;

// Catch-all safety net for the mobile-web blur crash.
//
// The per-instance width guard below only neutralizes THIS component's blur, but
// the public pages crash at ~34 DOM nodes — before those render — because other
// `backdrop-filter` sources (app shell / early chrome) also stack up and kill the
// mobile renderer. A global media-query stylesheet disables backdrop-filter for
// EVERY element under 768px at paint time (immune to the SPA render-timing race),
// which is the exact thing proven to stop the crash. Injected once, web-only;
// desktop web (>=768px) and native apps are unaffected.
if (typeof document !== "undefined") {
  const STYLE_ID = "mingla-mobile-web-no-backdrop-blur";
  if (!document.getElementById(STYLE_ID)) {
    const styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    styleEl.textContent =
      "@media (max-width:" +
      (MOBILE_WEB_MAX_WIDTH - 1) +
      "px){*,*::before,*::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}}";
    (document.head || document.documentElement).appendChild(styleEl);
  }
}

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
