/**
 * #4420 — the phone tab bar's measured geometry, in ONE dependency-free module
 * (useStickyFooterOffset imports it and must not import designSystem).
 *
 *   capsule 64 (the Create ember is 54, centred inside it)
 *   + navWrap top padding 8
 *   + navWrap minimum bottom padding 8 (the safe area replaces it when larger,
 *     and the hook adds `insets.bottom` on top, so this is the zero-inset floor)
 *   + breathing room 16 above the capsule for a FAB / sticky footer
 *   = 96
 */
export const BOTTOM_NAV_CAPSULE_HEIGHT = 64;
export const BOTTOM_NAV_EMBER_SIZE = 54;
export const BOTTOM_NAV_WRAP_PADDING_TOP = 8;
export const BOTTOM_NAV_WRAP_MIN_PADDING_BOTTOM = 8;
export const BOTTOM_NAV_BREATHING = 16;

export const MOBILE_BOTTOM_NAV_RESERVE =
  BOTTOM_NAV_CAPSULE_HEIGHT +
  BOTTOM_NAV_WRAP_PADDING_TOP +
  BOTTOM_NAV_WRAP_MIN_PADDING_BOTTOM +
  BOTTOM_NAV_BREATHING;
