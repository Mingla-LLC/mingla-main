// @mingla/offering-rendering — ORCH-1138 A2.
//
// Pure-presentational Direction-A layout primitives shared by the public
// trip/event/experience/brand offering pages. Props-only; NO app src/ imports
// (I-MOR-0827-PACKAGE-ISOLATION). Renders on react-native-web AND native RN.
//
// Built first for the trip page (Leg 1); event/experience/brand snap onto these
// same primitives in later legs (the page-specific booking/ticket/summary panel
// is passed in as `stickyPanel` / children).

export { ParallaxCoverShell } from "./ParallaxCoverShell";
export type { ParallaxCoverShellProps } from "./ParallaxCoverShell";

export { OfferingChrome } from "./OfferingChrome";
export type { OfferingChromeProps } from "./OfferingChrome";

export { CountAwareGallery } from "./CountAwareGallery";
export type {
  CountAwareGalleryProps,
  CountAwareGalleryItem,
} from "./CountAwareGallery";
export { pickGalleryLayout } from "./galleryLayout";
export type { GalleryLayout } from "./galleryLayout";

export { ChipGroup } from "./ChipGroup";
export type { Chip, ChipGroupProps } from "./ChipGroup";

export {
  useResponsiveLayout,
  DESKTOP_BREAKPOINT,
} from "./useResponsiveLayout";
export type { ResponsiveLayout } from "./useResponsiveLayout";

// Surface theming helper lives in @mingla/event-rendering (alongside the palette
// engine). Re-exported here so a page can import everything offering-related from
// one place.
export {
  offeringSurfaceStyles,
  resolveOfferingSurface,
} from "@mingla/event-rendering";
export type { OfferingSurfaceStyles } from "@mingla/event-rendering";
