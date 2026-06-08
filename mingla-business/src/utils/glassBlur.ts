/**
 * glassBlur — single source of truth for "should this glass surface render a
 * real backdrop blur, or fall back to an opaque fill?"
 *
 * Why this exists (ORCH-1100 RC-2 fix)
 * ------------------------------------
 * Mingla's glass surfaces (BlurView L1 base + translucent tint floor) only read
 * correctly when the L1 base is actually opaque or actually blurred. Three host
 * environments break that assumption, and each needs the SAME opaque fallback:
 *
 *   1. Android — expo-blur's backdrop renders near-transparent against busy
 *      content (ANDROID_GLASS_USES_OPAQUE_FALLBACK policy, META-ORCH-1002 Sub-D).
 *   2. Web without `backdrop-filter` support — the BlurView web shim produces a
 *      plain transparent View.
 *   3. Web on phones (< 768px) — `scripts/inject-mobile-blur-css.mjs` injects a
 *      `@media (max-width:767px){* { backdrop-filter:none !important }}` rule to
 *      dodge the mobile-web blur compositor crash. `CSS.supports("backdrop-filter")`
 *      still returns `true`, so a naive support check is defeated at runtime: the
 *      BlurView renders a glass panel whose blur is stripped, leaving only a ~6%
 *      tint over a transparent base. This is the device-proven "Switch brand"
 *      sheet showing `background-color: rgba(0,0,0,0)` on phone web.
 *
 * Before ORCH-1100 this logic was copy-pasted into SheetMobile, TopSheet,
 * GlassChrome, Toast (each with its own `supportsBackdropFilter` +
 * `shouldUseRealBlur`), and case #3 was only handled inline in SheetMobile.
 * The other glass components had no width awareness → transparent sheets on
 * phone web. This module consolidates all three cases so the awareness lives in
 * ONE place and can't regress per-component.
 *
 * Native iOS/Android paths are byte-identical to the prior per-component logic.
 */

import { Platform } from "react-native";

/**
 * The mobile-web blur-kill breakpoint. Mirrors the `max-width:767px` media
 * query in `scripts/inject-mobile-blur-css.mjs` — `backdrop-filter` is disabled
 * for widths STRICTLY LESS THAN this value on web.
 */
export const MOBILE_WEB_BLUR_KILL_MAX_WIDTH = 768;

/**
 * Detected once at module scope. `true` when the host browser advertises
 * support for `backdrop-filter` (so expo-blur's web shim produces a real blur).
 * Always `false` off web. Note: this does NOT account for the runtime blur-kill
 * media rule (case #3 above) — use {@link shouldUseRealBlur} for the full,
 * width-aware decision.
 */
export const supportsBackdropFilter: boolean =
  Platform.OS === "web" &&
  typeof globalThis !== "undefined" &&
  typeof (globalThis as { CSS?: { supports?: (prop: string, value: string) => boolean } }).CSS?.supports === "function" &&
  ((globalThis as { CSS?: { supports?: (prop: string, value: string) => boolean } }).CSS!.supports!("backdrop-filter", "blur(10px)") ||
    (globalThis as { CSS?: { supports?: (prop: string, value: string) => boolean } }).CSS!.supports!("-webkit-backdrop-filter", "blur(10px)"));

/**
 * Single decision for every glass surface: should it render a real backdrop
 * blur (`true`) or an opaque fallback fill (`false`)?
 *
 * - iOS  → always real blur (UIVisualEffectView).
 * - Android → always opaque fallback (expo-blur backdrop too thin).
 * - Web  → real blur ONLY when `backdrop-filter` is supported AND the viewport
 *          is wide enough to be above the mobile-web blur-kill (≥ 768px).
 *
 * @param windowWidth Current viewport width in px (from `useWindowDimensions`).
 *   Required on web so the < 768px blur-kill case is respected. Components that
 *   only ever render off-web may pass any value (it is ignored on iOS/Android).
 */
export const shouldUseRealBlur = (windowWidth: number): boolean => {
  if (Platform.OS === "ios") return true;
  if (Platform.OS === "android") return false;
  // Web: blur is killed by the injected media rule below 768px, regardless of
  // what CSS.supports reports. Treat that as "no real blur" so callers paint an
  // opaque fallback instead of a see-through panel.
  if (windowWidth < MOBILE_WEB_BLUR_KILL_MAX_WIDTH) return false;
  return supportsBackdropFilter;
};
