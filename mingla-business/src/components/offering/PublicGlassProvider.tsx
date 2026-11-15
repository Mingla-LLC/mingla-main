/**
 * PublicGlassProvider — issue #4420.
 *
 * Hands the shared public pages (packages/offering-rendering,
 * packages/brand-rendering) the Host app's real glass, so the bottom bar, the
 * header band and the venue tab strip blur what scrolls under them on iOS.
 * The package cannot import expo-blur; this is the injection point. Material
 * stays the only owner of the blur (I-HOST-CHROME-TOKENS-ONLY).
 *
 * When the blur is real:
 *   - iOS native, Reduce Transparency off, on a DARK page. Material's blur
 *     tint is the dark chrome material, so a light host page keeps the
 *     package's near-opaque paper fill (a dark blur under a light page reads
 *     muddy).
 * Everywhere else (Android, phone web, Reduce Transparency, light pages) the
 * package keeps its own near-opaque fill; desktop web keeps the package's CSS
 * backdrop blur. Auth-free and store-free: safe on anonymous buyer routes.
 */

import React, { useMemo } from "react";
import { Platform, StyleSheet } from "react-native";

import {
  OfferingGlassProvider,
  type OfferingGlassBackdropProps,
  type OfferingGlassMaterial,
} from "@mingla/offering-rendering";

import { Material, useReduceTransparency } from "../ui/Material";

const PublicGlassBackdrop: React.FC<OfferingGlassBackdropProps> = ({ radius }) => (
  <Material
    kind="liquid"
    radius={radius}
    pointerEvents="none"
    style={StyleSheet.absoluteFill}
  />
);

/** Pure: does the Host app really blur behind a public glass surface here? */
export const publicGlassBlursTint = (env: {
  platform: string;
  reduceTransparency: boolean;
  tint: "dark" | "light";
}): boolean =>
  env.platform === "ios" && !env.reduceTransparency && env.tint === "dark";

export const PublicGlassProvider: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  const reduceTransparency = useReduceTransparency();
  const value = useMemo<OfferingGlassMaterial>(
    () => ({
      Backdrop: PublicGlassBackdrop,
      blursTint: (tint) =>
        publicGlassBlursTint({ platform: Platform.OS, reduceTransparency, tint }),
    }),
    [reduceTransparency],
  );
  return <OfferingGlassProvider value={value}>{children}</OfferingGlassProvider>;
};

export default PublicGlassProvider;
