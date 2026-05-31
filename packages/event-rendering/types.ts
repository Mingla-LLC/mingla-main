// Prop contract for @mingla/event-rendering.
//
// Both mingla-business and app-mobile must shape their data into these types
// before passing to PublicEventPage. The package never imports from either
// app's types directly — this file IS the contract.
//
// If the underlying schema changes (e.g., M0 adds events.event_type), this
// file updates once; both apps' type-checkers immediately flag any drift.

import type { ComponentType } from "react";
import type { ScrollViewProps } from "react-native";

import type { ResolvedTheme, ThemeInput } from "./designTokens";

export type EventCoverMediaType = "image" | "video" | "gif";
export type EventFormat = "in-person" | "online" | "hybrid";
export type EventStatus = "draft" | "published" | "ended" | "cancelled";
export type TicketVisibility = "visible" | "hidden" | "disabled";
export type TicketAvailableAt = "online" | "door" | "both";

export interface PublicTicketProps {
  id: string;
  name: string;
  description: string | null;
  priceGbp: number | null;
  /**
   * ORCH-1006 Slice 3: server-computed tax/fee-inclusive (all-in) price in
   * major units. Optional + back-compat: when absent or null, surfaces fall
   * back to priceGbp. NULL for free tiers. Never recomputed client-side — it is
   * compute_all_in_cents output divided by 100.
   */
  priceAllInGbp?: number | null;
  currency: string | null;
  isFree: boolean;
  isUnlimited: boolean;
  capacity: number | null;
  visibility: TicketVisibility;
  passwordProtected: boolean;
  password: string | null;
  saleStartAt: string | null;
  saleEndAt: string | null;
  approvalRequired: boolean;
  waitlistEnabled: boolean;
  availableAt: TicketAvailableAt;
  displayOrder: number;
}

export interface PublicEventProps {
  id: string;
  name: string;
  brandId: string;
  brandSlug: string;
  eventSlug: string;
  description: string;

  // Date / time
  dateLine: string;
  dateSubline: string | null;
  datesList: string[];

  // Status
  status: EventStatus;
  endedAt: string | null;

  // Location
  format: EventFormat;
  venueName: string | null;
  address: string | null;
  hideAddressUntilTicket: boolean;

  // Cover
  coverHue: number;
  coverMediaUrl: string | null;
  coverMediaType: EventCoverMediaType | null;
  coverCredit: string | null;

  // Tickets
  tickets: PublicTicketProps[];
  currency: string;

  themeOverrides?: ThemeInput | null;
}

export interface PublicBrandProps {
  id: string;
  slug: string;
  displayName: string;
  photo?: string;
  theme?: ThemeInput | null;
}

export type ViewerRole = "organizer" | "ticket-holder" | "anonymous";

export type BuyerAction = "buy" | "free" | "approval" | "waitlist" | "password";

export interface PublicEventCallbacks {
  onClose: () => void;
  onShare: () => void;
  onBuyTicket: (ticketId: string) => void;
  onClaimFreeTicket: (ticketId: string) => void;
  onJoinWaitlist: (ticketId: string) => void;
  onRequestApproval: (ticketId: string) => void;
  onOpenBrand?: (brandSlug: string) => void;
  onOpenMaps?: (query: string) => void;
  onUnlockPassword?: (password: string) => boolean;
}

export interface PublicEventPageProps {
  event: PublicEventProps;
  brand: PublicBrandProps | null;
  viewerRole: ViewerRole;
  callbacks: PublicEventCallbacks;
  /**
   * When true, the shared renderer skips its built-in floating close/share
   * chrome so a host adapter (e.g. the buyer-web public event route) can own
   * the chrome itself without producing a duplicate Share/Close in the DOM and
   * accessibility tree. Default `false` preserves existing app-mobile sheet
   * + organizer-mode behavior. Added by ORCH-0961 rework after the buyer-web
   * adapter started rendering its own IconChrome row.
   */
  hideFloatingChrome?: boolean;
  theme?: ResolvedTheme;
  /**
   * META-ORCH-0991 (sheet rework — Bug 2): the scroll host the body renders with.
   * Defaults to React Native's `ScrollView` (the web/business behavior, unchanged).
   * When this page is hosted INSIDE a gorhom bottom sheet (app-mobile's
   * ExpandedBusinessEventSheet), the host injects gorhom's `BottomSheetScrollView`
   * here so the sheet has a SINGLE gorhom-aware scroll host instead of a raw RN
   * `ScrollView` nested inside the sheet's gorhom scroll (the fragile double-scroll
   * that was the probable freeze source). The component must accept ScrollView-shaped
   * props (`style`, `contentContainerStyle`, `showsVerticalScrollIndicator`).
   */
  ScrollComponent?: ComponentType<ScrollViewProps>;
}

export interface PublicEventNotFoundProps {
  onBrowse: () => void;
}
