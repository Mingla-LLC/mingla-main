// useResponsiveLayout — ORCH-1138 A2.
//
// The Direction-A foundation switches between a phone single-column immersive
// layout (<1024px) and a desktop two-column sticky-panel shell (≥1024px). That
// breakpoint only ever matters on react-native-web (the public /t/ /e/ /exp/ /b/
// routes); native RN is ALWAYS the single-column immersive layout (a phone/tablet
// app screen), so this hook reports `isDesktop=false` on native unconditionally.
//
// Pure: react-native only (useWindowDimensions + Platform). No app imports.

import { Platform, useWindowDimensions } from "react-native";

export const DESKTOP_BREAKPOINT = 1024;

export interface ResponsiveLayout {
  width: number;
  /** true only on web ≥1024px — drives the two-column desktop shell. */
  isDesktop: boolean;
  /** true on native always, and on web <1024px — the immersive single column. */
  isPhone: boolean;
  /** true on web (any width) — gates web-only CSS (fixed/sticky) behaviors. */
  isWeb: boolean;
}

export const useResponsiveLayout = (): ResponsiveLayout => {
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= DESKTOP_BREAKPOINT;
  return {
    width,
    isDesktop,
    isPhone: !isDesktop,
    isWeb,
  };
};
