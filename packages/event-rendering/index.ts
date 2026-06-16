// @mingla/event-rendering — SHARED PURE-PRESENTATIONAL RENDERING
//
// Consumed by mingla-business (native + web) AND app-mobile (native).
// MUST NOT import from any app's src/ — see I-MOR-0827-PACKAGE-ISOLATION.
// All data is passed via props. All design tokens are local to this package.
//
// Per META-ORCH-0827 Pass 2 (Option C). Established 2026-05-13.

export { PublicEventPage } from "./PublicEventPage";
// ORCH-1138 A1/A2 — the shared theming engine, extracted out of PublicEventPage
// so trip/experience/brand pages derive accent/surface/text from ONE algorithm.
export {
  createThemePalette,
  resolveOfferingSurface,
  offeringSurfaceStyles,
  // ORCH-1138 Leg-1 (native-parity fix #2) — weight-aware theme font family.
  // A loaded custom font ignores fontWeight on native; bold text must point
  // fontFamily at the 700-weight loaded family. boldFontFamily(theme) returns it.
  FONT_FAMILY_BOLD_MAP,
  boldFontFamily,
} from "./themePalette";
export type { ThemePalette, OfferingSurfaceStyles } from "./themePalette";
export { PublicEventNotFound } from "./PublicEventNotFound";
export { EventCoverMedia } from "./EventCoverMedia";
export { ThemeEntranceAnimation } from "./ThemeEntranceAnimation";
export {
  computeForeground,
  isThemeAnimationSlug,
  isThemeColor,
  isThemeFontSlug,
  resolveTheme,
} from "./themeResolver";
export {
  FONT_FAMILY_MAP,
  MINGLA_DEFAULT_THEME,
  THEME_ANIMATION_SLUGS,
  THEME_FONT_SLUGS,
} from "./designTokens";
export type {
  EventCoverMediaErrorEvent,
  EventCoverMediaProps,
} from "./EventCoverMedia";
// ORCH-0847 Phase A2 — shared ticket-tier quantity stepper used by
// mingla-business public cart screen AND consumer-app TicketCartSheet.
export { QuantityRow } from "./QuantityRow";
export type {
  QuantityRowProps,
  QuantityRowTicket,
  QuantityRowTheme,
} from "./QuantityRow";
// ORCH-0964 — shared cover media (image + GIF + video, web + native) used by
// mingla-business cards/public pages, app-mobile, AND the shared brand page.
export { EventCover } from "./EventCover";
export type { EventCoverProps } from "./EventCover";
export { resolveEventCoverMediaPresentation } from "./coverMediaPresentation";
export { shouldFreezeCoverForReduceMotion } from "./coverMediaPresentation";
// ORCH-1016 — shared trip date-range formatter (consumer TripCard/detail +
// business TripPreview/public page format trip dates identically).
export { formatTripDateRange } from "./formatTripDateRange";
export type { FormatTripDateRangeOptions } from "./formatTripDateRange";
// ORCH-1016 — shared refund ladder (consumer trip detail + business public/
// preview render the identical ladder; business side is a re-export shim).
export { RefundPolicyDisplay } from "./RefundPolicyDisplay";
export type {
  RefundPolicyDisplayProps,
  RefundPolicyShape,
  RefundPolicyTier,
} from "./RefundPolicyDisplay";
// ORCH-0964 — BlurView wrapper that skips backdrop-filter on mobile web (where
// stacked blur hard-crashes the renderer). Used by public brand + event pages.
export { GlassBlur } from "./GlassBlur";
// ORCH-1117 — the single buy/unavailable state machine consumed by BOTH the
// inline ticket row AND the per-host floating Buy bar (no forked gate logic).
export {
  resolveOfferingCta,
  computeOfferingVariant,
  ticketSaleEnded,
  ticketIsSoldOut,
  ticketIsDoorOnly,
  // ORCH-1150 — RSVP Going/Not-going CTA machine (money-free).
  resolveRsvpCta,
} from "./offeringCta";
export type {
  CtaState,
  OfferingVariant,
  ResolveOfferingCtaInput,
  // ORCH-1150
  RsvpCtaState,
  RsvpCtaDescriptor,
  ResolveRsvpCtaInput,
} from "./offeringCta";
export type {
  PublicEventProps,
  PublicBrandProps,
  PublicTicketProps,
  ViewerRole,
  PublicEventCallbacks,
  PublicEventPageProps,
  PublicEventNotFoundProps,
  EventCoverMediaType,
  EventFormat,
  EventStatus,
  TicketVisibility,
  TicketAvailableAt,
} from "./types";
export type {
  ResolvedTheme,
  ThemeAnimationSlug,
  ThemeFontSlug,
  ThemeInput,
} from "./designTokens";
