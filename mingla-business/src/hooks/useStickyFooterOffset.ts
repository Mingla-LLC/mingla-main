/**
 * useStickyFooterOffset — single source of truth for FAB / sticky-footer
 * bottom positioning across the app.
 *
 * On native + narrow web (<1024px): `safeAreaBottom + 96` — clears the
 * floating BottomNav capsule (~72pt visible + 24pt breathing room).
 * On wide-desktop (≥1024px): 24pt — canvas-bottom-aligned. The fixed-left
 * rail does not consume bottom space, so the legacy `+96` reservation
 * left FABs floating mid-screen with empty space below.
 *
 * Per SPEC_ORCH-0889 [Marketing tab desktop-web fit-and-finish] §3.5.1.
 * Enforced via strict-grep CI gate
 * `orch-0889-sticky-footer-via-hook.mjs` which rejects inline
 * `insets.bottom + 96` FAB positioning in marketing routes.
 *
 * Invariant I-STICKY-FOOTER-VIA-HOOK (ORCH-0889): FAB / sticky-footer
 * bottom offset in `mingla-business/app/(tabs)/marketing/**` MUST be
 * sourced from this hook.
 */

import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useResponsiveLayout } from "./useResponsiveLayout";

/**
 * Mobile bottom-nav capsule clearance. ~72pt visible capsule + 24pt
 * breathing room so the FAB never feels cramped against the nav.
 */
const MOBILE_BOTTOM_NAV_RESERVE = 96;

/**
 * Wide-desktop canvas-bottom padding (matches `spacing.lg` semantic;
 * hard-coded as a literal so this hook has no `designSystem` import
 * cycle risk).
 */
const DESKTOP_CANVAS_BOTTOM_PADDING = 24;

export function useStickyFooterOffset(): number {
  const { isWideDesktop } = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  return isWideDesktop
    ? DESKTOP_CANVAS_BOTTOM_PADDING
    : insets.bottom + MOBILE_BOTTOM_NAV_RESERVE;
}
