// ORCH-1159 [hide-web-close-x] — single-owner decision for whether the floating
// "X" (close) button renders on an offering cover.
//
// Extracted to its own RN-free module so the regression test can EXECUTE the
// real decision on both web and native inputs without mounting the
// react-native / react-native-svg tree (Deno can't import those). OfferingChrome
// imports this and applies it to its close-button render.
//
// Contract: the close button is hidden ONLY when the caller opts in
// (`hideCloseOnWeb`, set by the public event / trip / experience pages) AND the
// platform is web. The Share + Mute buttons are NEVER governed by this — they
// render on every surface. Native is byte-identical to before. The public brand
// page does NOT opt in, so it keeps its X on web.

export type PlatformOSValue =
  | "ios"
  | "android"
  | "web"
  | "windows"
  | "macos";

export const shouldRenderCloseButton = (
  hideCloseOnWeb: boolean,
  platformOS: PlatformOSValue,
): boolean => !(hideCloseOnWeb && platformOS === "web");
