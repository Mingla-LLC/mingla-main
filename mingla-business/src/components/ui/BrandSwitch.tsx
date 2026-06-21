/**
 * BrandSwitch — ORCH-1190 #3.
 *
 * The single shared on/off switch for the venue suite (and any surface that
 * wants the brand toggle look). A thin wrapper over the React Native `Switch`
 * that BAKES IN Mingla's brand colors so toggles never fall back to the native
 * GREEN/teal track:
 *   - ON   → `accent.warm` (brand orange) track
 *   - OFF  → neutral translucent track
 *   - thumb → white
 *   - iOS off-background → the same neutral track
 *
 * Before this component each venue Switch hand-repeated the trackColor/thumbColor
 * trio (and one — BrandHoursEditor's day toggle — set NONE, rendering the native
 * green Seth flagged). Routing them all through BrandSwitch makes the brand
 * styling apply suite-wide from ONE owner (Constitution #2/#8). Callers may still
 * pass any `Switch` prop (value, onValueChange, disabled, accessibilityLabel,
 * testID); the brand colors are defaults that callers should not override.
 */

import React from "react";
import { Switch } from "react-native";
import type { SwitchProps } from "react-native";

import { accent } from "../../constants/designSystem";

/** Neutral OFF-state track (translucent on dark glass). */
const OFF_TRACK = "rgba(255,255,255,0.16)";

export type BrandSwitchProps = SwitchProps;

export function BrandSwitch(props: BrandSwitchProps): React.ReactElement {
  return (
    <Switch
      trackColor={{ false: OFF_TRACK, true: accent.warm }}
      thumbColor="#ffffff"
      ios_backgroundColor={OFF_TRACK}
      {...props}
    />
  );
}

export default BrandSwitch;
