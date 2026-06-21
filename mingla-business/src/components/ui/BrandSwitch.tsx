/**
 * BrandSwitch — ORCH-1190 #3.
 *
 * The single shared on/off switch for the venue suite (and any surface that
 * wants the brand toggle look). A thin wrapper over the React Native `Switch`
 * that BAKES IN Mingla's brand colors so toggles never fall back to the native
 * GREEN/teal track OR (on web) the native GREEN/teal HANDLE:
 *   - ON   -> `accent.warm` (brand orange) track + WHITE handle
 *   - OFF  -> neutral translucent track + WHITE handle
 *   - iOS off-background -> the same neutral track
 *
 * Before this component each venue Switch hand-repeated the trackColor/thumbColor
 * trio (and one — BrandHoursEditor's day toggle — set NONE, rendering the native
 * green Seth flagged). Routing them all through BrandSwitch makes the brand
 * styling apply suite-wide from ONE owner (Constitution #2/#8). Callers may still
 * pass any `Switch` prop (value, onValueChange, disabled, accessibilityLabel,
 * testID); the brand colors are defaults that callers should not override.
 *
 * ORCH-1190 R2 — WEB PARITY FIX. The native RN `Switch` exposes ONE `thumbColor`
 * that covers both states, but react-native-web's `Switch` paints the ON-state
 * THUMB from a SEPARATE prop, `activeThumbColor` (default `#009688`, teal-green),
 * and the ON-state TRACK from `activeTrackColor` (default `#A3D3CF`) when
 * `trackColor` is a string. The first cut set only `thumbColor`/`trackColor`, so
 * on business WEB (business.usemingla.com) the HANDLE rendered teal-green when ON
 * (the track was correctly orange) — the off-brand toggle Seth flagged. The
 * native jest render tests run on the `ios` platform, where one `thumbColor`
 * covers both states, so they passed while web stayed broken. We now ALSO set the
 * web-only `activeThumbColor`/`activeTrackColor` so the handle is white and the
 * track is brand-orange on web AND native. (`activeThumbColor`/`activeTrackColor`
 * are inert on native — RN's `Switch` ignores unknown props — so this is safe
 * cross-platform.)
 */

import React from "react";
import { Switch } from "react-native";
import type { SwitchProps } from "react-native";

import { accent } from "../../constants/designSystem";

/** Neutral OFF-state track (translucent on dark glass). */
const OFF_TRACK = "rgba(255,255,255,0.16)";
/** White handle in BOTH states (native + web). */
const THUMB = "#ffffff";

// react-native-web-only props — web paints the ON-state thumb/track from these.
// They are NOT in RN's native `SwitchProps`, so type the web fields separately.
type WebSwitchExtras = {
  activeThumbColor?: string;
  activeTrackColor?: string;
};

export type BrandSwitchProps = SwitchProps;

export function BrandSwitch(props: BrandSwitchProps): React.ReactElement {
  const webExtras: WebSwitchExtras = {
    activeThumbColor: THUMB,
    activeTrackColor: accent.warm,
  };
  return (
    <Switch
      trackColor={{ false: OFF_TRACK, true: accent.warm }}
      thumbColor={THUMB}
      ios_backgroundColor={OFF_TRACK}
      {...webExtras}
      {...props}
    />
  );
}

export default BrandSwitch;
