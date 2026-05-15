// @mingla/event-rendering — SHARED PURE-PRESENTATIONAL RENDERING
//
// Consumed by mingla-business (native + web) AND app-mobile (native).
// MUST NOT import from any app's src/ — see I-MOR-0827-PACKAGE-ISOLATION.
// All data is passed via props. All design tokens are local to this package.
//
// Per META-ORCH-0827 Pass 2 (Option C). Established 2026-05-13.

export { PublicEventPage } from "./PublicEventPage";
export { PublicEventNotFound } from "./PublicEventNotFound";
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
