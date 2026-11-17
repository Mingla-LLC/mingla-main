/**
 * #4420 web journey (shot 34) — an offering with no cover showed the
 * authoring placeholder (Mingla-orange stripes) at the top of checkout,
 * while its public page shows the host's own colour (ParallaxCoverShell's
 * themed cover). Checkout now matches the page: the host's gradient when they
 * chose one, else their single colour fading to 72%. Graphite (no host
 * palette yet) draws the Graphite accent the same way.
 */
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { ThemePalette } from "@mingla/offering-rendering";
import {
  hexToRgba,
  paletteAccentGradient,
} from "@mingla/offering-rendering/themePalette";

import { color as graphite } from "../../constants/designSystem";
import { activeCheckoutPalette } from "./checkoutTheme";

/** The two stops the no-cover band draws, as the public page draws them. */
export const checkoutCoverFallbackStops = (
  palette: ThemePalette | null,
): [string, string] => {
  if (palette === null) return [graphite.accent, hexToRgba(graphite.accent, 0.72)];
  const stops = paletteAccentGradient(palette);
  return stops !== null
    ? [stops[0], stops[1]]
    : [palette.accent, hexToRgba(palette.accent, 0.72)];
};

export function CheckoutCoverFallback(props: {
  style?: StyleProp<ViewStyle>;
  testID?: string;
}): React.ReactElement {
  const stops = checkoutCoverFallbackStops(activeCheckoutPalette());
  return (
    <View style={[styles.clip, props.style]} testID={props.testID ?? "checkout-themed-cover"}>
      <LinearGradient
        colors={stops}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
});
