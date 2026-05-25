// Prop contract for @mingla/event-rendering.
//
// Both mingla-business and app-mobile must shape their data into these types
// before passing to PublicEventPage. The package never imports from either
// app's types directly — this file IS the contract.
//
// If the underlying schema changes (e.g., M0 adds events.event_type), this
// file updates once; both apps' type-checkers immediately flag any drift.

export type EventCoverMediaType = "image" | "video" | "gif";
export type EventFormat = "in-person" | "online" | "hybrid";
export type EventStatus =
  | "draft"
  | "published"
  | "ended"
  | "cancelled";
export type TicketVisibility = "visible" | "hidden" | "disabled";
export type TicketAvailableAt = "online" | "door" | "both";

export interface PublicTicketProps {
  id: string;
  name: string;
  description: string | null;
  priceGbp: number | null;
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
}

export interface PublicBrandProps {
  id: string;
  slug: string;
  displayName: string;
}

export type ViewerRole = "organizer" | "ticket-holder" | "anonymous";

export type BuyerAction =
  | "buy"
  | "free"
  | "approval"
  | "waitlist"
  | "password";

export interface PublicEventCallbacks {
  onClose: () => void;
  onShare: () => void;
  onBuyTicket: (ticketId: string) => void;
  onClaimFreeTicket: (ticketId: string) => void;
  onJoinWaitlist: (ticketId: string) => void;
  onRequestApproval: (ticketId: string) => void;
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
}

export interface PublicEventNotFoundProps {
  onBrowse: () => void;
}
