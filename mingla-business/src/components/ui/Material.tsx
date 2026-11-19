/**
 * Material — the ONE owner of glass in Mingla Host (#4420 Graphite Glass).
 *
 * Every translucent surface (pane, control, selected, chrome, liquid, onPhoto,
 * sheet) is drawn by this component from its `materials.<kind>` recipe in
 * `constants/designSystem.ts`. It is the only file allowed to import
 * `expo-blur` (I-HOST-CHROME-TOKENS-ONLY, #4420 guard).
 *
 * How the platform is chosen, in this order:
 *   1. Android → `solidFill` (alpha 1; onPhoto .84 by design), no BlurView,
 *      same rim. expo-blur on Android draws a near-transparent layer over busy
 *      content (ANDROID_GLASS_USES_OPAQUE_FALLBACK).
 *   2. Reduce Transparency (iOS `AccessibilityInfo` + its change listener; web
 *      `prefers-reduced-transparency: reduce`) → `reducedFill` (onPhoto →
 *      solid control).
 *   3. Web → `shouldUseRealBlur(width)` stays the one switch (ORCH-1100). False
 *      (no backdrop-filter, or phone web < 768 where the injected CSS kills
 *      blur) → solid. True → `glassFill` + `backdropFilter`.
 *   4. iOS → BlurView (intensity + `systemChromeMaterialDark`) under the
 *      `glassFill` overlay. A recipe with `blur: null` (selected) is fill only.
 *
 * Auth-free and store-free, so it is safe on anon buyer routes.
 */

import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { BlurView } from "expo-blur";

import { materials } from "../../theme/surfaceTokens";
import type { MaterialKind, MaterialRecipe } from "../../constants/designSystem";
import { shouldUseRealBlur } from "../../utils/glassBlur";

export type { MaterialKind } from "../../constants/designSystem";

/** How a material renders on the current platform. */
export type MaterialMode = "solid" | "webBlur" | "blur";

export interface MaterialEnv {
  platform: string;
  reduceTransparency: boolean;
  /** `shouldUseRealBlur(windowWidth)`; only read on web. */
  realBlur: boolean;
}

export interface MaterialResolution {
  mode: MaterialMode;
  /** The background colour painted on the surface itself. */
  fill: string;
  /** BlurView settings, only when `mode === "blur"`. */
  blur: MaterialRecipe["blur"];
  /** CSS backdrop-filter value, only when `mode === "webBlur"`. */
  backdropFilter: string | null;
}

/**
 * Pure decision used by the component (and its regression test): which fill,
 * and whether a BlurView or a CSS backdrop-filter is drawn.
 */
export const resolveMaterial = (kind: MaterialKind, env: MaterialEnv): MaterialResolution => {
  const recipe: MaterialRecipe = materials[kind];
  if (env.platform === "android") {
    return { mode: "solid", fill: recipe.solidFill, blur: null, backdropFilter: null };
  }
  if (env.reduceTransparency) {
    return { mode: "solid", fill: recipe.reducedFill, blur: null, backdropFilter: null };
  }
  if (env.platform === "web") {
    if (!env.realBlur) {
      return { mode: "solid", fill: recipe.solidFill, blur: null, backdropFilter: null };
    }
    return { mode: "webBlur", fill: recipe.glassFill, blur: null, backdropFilter: recipe.webBackdrop };
  }
  if (env.platform === "ios") {
    return { mode: "blur", fill: recipe.glassFill, blur: recipe.blur, backdropFilter: null };
  }
  // Any other host (windows, macos): never risk a see-through panel.
  return { mode: "solid", fill: recipe.solidFill, blur: null, backdropFilter: null };
};

const REDUCED_TRANSPARENCY_QUERY = "(prefers-reduced-transparency: reduce)";

type MediaQueryListLike = {
  matches: boolean;
  addEventListener?: (type: "change", listener: (event: { matches: boolean }) => void) => void;
  removeEventListener?: (type: "change", listener: (event: { matches: boolean }) => void) => void;
};

const webReduceQuery = (): MediaQueryListLike | null => {
  const host = globalThis as { matchMedia?: (query: string) => MediaQueryListLike };
  if (typeof host.matchMedia !== "function") return null;
  try {
    return host.matchMedia(REDUCED_TRANSPARENCY_QUERY);
  } catch {
    // A browser without matchMedia support for this query: treat as "not reduced".
    return null;
  }
};

/**
 * Live Reduce Transparency setting. iOS reads `AccessibilityInfo` and follows
 * `reduceTransparencyChanged`; web follows the media query; Android never asks
 * (it is always solid).
 */
export const useReduceTransparency = (): boolean => {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (Platform.OS !== "web") return false;
    return webReduceQuery()?.matches === true;
  });

  useEffect(() => {
    if (Platform.OS === "web") {
      const query = webReduceQuery();
      if (query === null || typeof query.addEventListener !== "function") return undefined;
      const onChange = (event: { matches: boolean }): void => setReduced(event.matches);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener?.("change", onChange);
    }
    if (Platform.OS !== "ios") return undefined;
    // A host without the accessibility API (a test double, an old runtime)
    // keeps glass, the default iOS look, rather than crashing the screen.
    if (
      typeof AccessibilityInfo?.isReduceTransparencyEnabled !== "function" ||
      typeof AccessibilityInfo?.addEventListener !== "function"
    ) {
      return undefined;
    }
    let alive = true;
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (alive) setReduced(enabled);
      })
      .catch(() => {
        // The setting could not be read: keep glass (the default iOS look).
        if (alive) setReduced(false);
      });
    const subscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", (enabled: boolean) => {
      setReduced(enabled);
    });
    return () => {
      alive = false;
      subscription?.remove?.();
    };
  }, []);

  return reduced;
};

type WebBackdropStyle = ViewStyle & {
  backdropFilter?: string;
  WebkitBackdropFilter?: string;
};

export interface MaterialProps {
  kind: MaterialKind;
  /** Corner radius; the layers clip to it. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  testID?: string;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
}

export const Material: React.FC<MaterialProps> = ({
  kind,
  radius = 0,
  style,
  children,
  testID,
  pointerEvents,
}) => {
  const { width } = useWindowDimensions();
  const reduceTransparency = useReduceTransparency();
  const recipe: MaterialRecipe = materials[kind];
  const resolved = resolveMaterial(kind, {
    platform: Platform.OS,
    reduceTransparency,
    realBlur: Platform.OS === "web" ? shouldUseRealBlur(width) : false,
  });

  const surface: WebBackdropStyle =
    resolved.mode === "webBlur" && resolved.backdropFilter !== null
      ? {
          backgroundColor: resolved.fill,
          backdropFilter: resolved.backdropFilter,
          WebkitBackdropFilter: resolved.backdropFilter,
        }
      : { backgroundColor: resolved.mode === "blur" ? undefined : resolved.fill };

  return (
    <View
      testID={testID}
      pointerEvents={pointerEvents}
      style={[styles.clip, { borderRadius: radius }, surface, style]}
    >
      {resolved.mode === "blur" && resolved.blur !== null ? (
        <BlurView
          testID={testID ? `${testID}-blur` : undefined}
          intensity={resolved.blur.intensity}
          tint={resolved.blur.tint}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {resolved.mode === "blur" ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: resolved.fill }]} />
      ) : null}
      {recipe.rim.top !== null ? (
        <View pointerEvents="none" style={[styles.rimTop, { backgroundColor: recipe.rim.top }]} />
      ) : null}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: radius, borderColor: recipe.rim.edge, borderWidth: recipe.rim.edgeWidth },
        ]}
      />
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  clip: {
    overflow: "hidden",
  },
  rimTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
});
