// @mingla/event-rendering — SHARED PURE-PRESENTATIONAL RENDERING
//
// Consumed by mingla-business (native + web) AND app-mobile (native).
// MUST NOT import from any app's src/ — see I-MOR-0827-PACKAGE-ISOLATION.
// All data is passed via props. All design tokens are local to this package.
//
// Per META-ORCH-0827 Pass 2 (Option C). Established 2026-05-13.

export { PublicEventPage } from "./PublicEventPage";
export { PublicEventNotFound } from "./PublicEventNotFound";
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
export { EventCoverMedia } from "./EventCoverMedia";
export type {
  EventCoverMediaProps,
  EventCoverMediaErrorEvent,
} from "./EventCoverMedia";
export { resolveEventCoverMediaPresentation } from "./coverMediaPresentation";
// ORCH-0964 — BlurView wrapper that skips backdrop-filter on mobile web (where
// stacked blur hard-crashes the renderer). Used by public brand + event pages.
export { GlassBlur } from "./GlassBlur";
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
