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

// ORCH-1159 — RN-free close-button visibility predicate (single owner).
export { shouldRenderCloseButton } from "./closeButtonVisibility";
export type { PlatformOSValue } from "./closeButtonVisibility";

export { CountAwareGallery } from "./CountAwareGallery";
export type {
  CountAwareGalleryProps,
  CountAwareGalleryItem,
} from "./CountAwareGallery";
export { pickGalleryLayout } from "./galleryLayout";
export type { GalleryLayout } from "./galleryLayout";

export { ChipGroup } from "./ChipGroup";
export type { Chip, ChipGroupProps } from "./ChipGroup";

// ORCH-1167 [event-page-canonical] — THE ONE shared, shell-agnostic body for the
// standard ticketed-event public page (event_type='event'). Rendered byte-
// identically on buyer-web + business iOS/Android + consumer iOS/Android. Hosts NO
// scroll root (each surface injects its scroll + parallax-cover scaffold around it).
// Carries the inline on-page ticket box (per-tier steppers + live Σ-all-in running
// total (WYSIWYP) + in-box Proceed) and the surface-pinned floating Get-tickets bar.
// ORCH-1167-R2 — EventTicketBox is the extracted inline box, rendered inline on
// phone/native and inside the desktop sticky panel (change 5; one owner).
export {
  EventOfferingBody,
  EventOfferingFloatingBar,
  EventTicketBox,
  computeRunningTotal,
  totalSelectedQuantity,
} from "./EventOfferingBody";
export type {
  EventOfferingBodyProps,
  EventOfferingFloatingBarProps,
  EventTicketBoxProps,
} from "./EventOfferingBody";

// ORCH-1157 [rsvp-public-redesign] — the shared Direction-C "Momentum" RSVP hero
// (going-count + capacity meter + faceless anonymous cluster + Going/Maybe/Can't
// decision). Consumed by the business RsvpPublicBody (buyer-web + business +
// preview) AND the consumer ConsumerEventDetailScreen RSVP branch — one unit,
// every surface. RSVP is ticketless: NO price/checkout/cart affordance here.
export { RsvpMomentumDecision } from "./RsvpMomentumDecision";
export type {
  RsvpMomentumDecisionProps,
  RsvpMomentumVariant,
  RsvpGuestStatus,
  RsvpGuestApproval,
} from "./RsvpMomentumDecision";
export {
  deriveMomentum,
  partyTypeLabel,
  RSVP_CLUSTER_SHOWN,
} from "./rsvpMomentum";
export type { RsvpMomentumModel } from "./rsvpMomentum";

// ORCH-1138 [trip-page-redesign] — shared "City, Country" route-leg normalizer
// (departure/destination) used identically by the business/web TripPreview and
// the consumer ConsumerTripDetailScreen so the leaving-from/destination block
// stays standardized + balanced on one aligned row across every surface.
export { normalizeCityCountry } from "./normalizeCityCountry";
export type { StructuredPlaceParts } from "./normalizeCityCountry";

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
