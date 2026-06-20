import React from "react";
import { Platform, View, useWindowDimensions } from "react-native";
import { BlurView } from "expo-blur";

const MOBILE_WEB_MAX_WIDTH = 768;

// META-ORCH-1002 Sub-C — Android glass policy = OPAQUE frosted fallback by default.
//
// expo-blur's BlurView renders a thin semi-transparent View on Android unless
// `experimentalBlurMethod="dimezisBlurView"` is set (and even then it's an
// experimental/unreliable blur). This shared primitive never set that method, so
// on Android the public event/brand pages got the washed-out see-through film
// (investigation Symptom B). Policy Option 1 (operator-locked in the first-strike
// SPEC): route ALL Android to an OPAQUE (>= 0.92) frosted fallback fill, mirroring
// the business `GlassChrome`/`shouldUseRealBlur()=false` posture — solid fill, not
// blur. Real `dimezisBlurView` blur is reserved for on-device-validated hero
// surfaces only (a future ORCH), NOT these panels. iOS + web are byte-identical.
//
// Opaque fills are keyed to the BlurView `tint` so the panel reads as the same
// dark/light frosted material it was designed for:
//  - dark (and every system*Dark / default / unrecognized tint) -> rgba(20,22,26,0.92)
//    (the already-shipped, on-device-validated business GlassChrome dark fallback)
//  - light (and every *Light tint)                              -> rgba(248,249,251,0.94)
const ANDROID_OPAQUE_DARK_FILL = "rgba(20, 22, 26, 0.92)";
const ANDROID_OPAQUE_LIGHT_FILL = "rgba(248, 249, 251, 0.94)";

const androidOpaqueFillForTint = (
  tint: React.ComponentProps<typeof BlurView>["tint"],
): string =>
  typeof tint === "string" && /light/i.test(tint)
    ? ANDROID_OPAQUE_LIGHT_FILL
    : ANDROID_OPAQUE_DARK_FILL;

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
  // META-ORCH-1002 Sub-C: on Android, paint an opaque frosted fill instead of the
  // thin BlurView fallback so the public-page panels read as solid frosted glass.
  // Blur-only props (intensity/tint/experimentalBlurMethod) are dropped — they are
  // not valid View props; tint is consumed to pick the opaque fill.
  if (Platform.OS === "android") {
    const {
      intensity: _intensity,
      tint,
      experimentalBlurMethod: _experimentalBlurMethod,
      blurReductionFactor: _blurReductionFactor,
      children,
      style,
      ...viewProps
    } = props;
    return (
      <View
        {...viewProps}
        style={[style, { backgroundColor: androidOpaqueFillForTint(tint) }]}
      >
        {children}
      </View>
    );
  }
  return <BlurView {...props} />;
};

export default GlassBlur;
