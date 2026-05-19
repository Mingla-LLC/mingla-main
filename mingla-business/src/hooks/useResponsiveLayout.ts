/**
 * useResponsiveLayout — single source of truth for desktop layout gating.
 *
 * Returns `{ isWideDesktop, isWeb, width }`. `isWideDesktop` is true iff
 * the app is running on web AND the viewport width is at-or-above 1024px
 * (inclusive). Native (iOS/Android) ALWAYS returns `isWideDesktop: false`
 * regardless of width — mobile UX is byte-identical to today.
 *
 * Per SPEC_ORCH-0885-A §2:
 * - The boundary at 1024 is INCLUSIVE (width === 1024 → true).
 * - SSR / headless safety: when `useWindowDimensions()` reports
 *   `{ width: 0, height: 0 }` (RN-web's documented behaviour when no
 *   `window`), this hook returns `isWideDesktop: false` without throwing.
 * - Resize-responsive: `useWindowDimensions()` re-renders on every browser
 *   resize event on web, so consumers re-evaluate at every 1024 crossing.
 *
 * Invariant I-DESKTOP-GATE-VIA-HOOK (ORCH-0885-A §10): every desktop-gated
 * branch in `mingla-business/src/` or `mingla-business/app/` must read
 * from this hook. Inlining `Platform.OS === 'web' && width >= 1024` is
 * forbidden anywhere outside the allow-list enforced by the strict-grep
 * gate `orch-0885-a-no-bottomnav-on-wide-desktop.mjs`. Adding a new
 * allow-list entry requires a new ORCH amending this invariant.
 */

import { Platform, useWindowDimensions } from "react-native";

export interface ResponsiveLayout {
  isWideDesktop: boolean;
  isWeb: boolean;
  width: number;
}

/**
 * Inclusive desktop-width boundary in CSS pixels (matches mock 01).
 * 1024 is the canonical tablet-landscape / small-laptop threshold.
 */
export const WIDE_DESKTOP_MIN_WIDTH = 1024;

export const useResponsiveLayout = (): ResponsiveLayout => {
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";

  // SSR / headless safety: RN-web returns { width: 0, height: 0 } when no
  // window is available (e.g. server-rendered build, jest jsdom without
  // dimensions set). Treat as "not wide desktop" — never throw.
  const hasMeasuredViewport = width > 0;

  const isWideDesktop =
    isWeb && hasMeasuredViewport && width >= WIDE_DESKTOP_MIN_WIDTH;

  return { isWideDesktop, isWeb, width };
};

export default useResponsiveLayout;
