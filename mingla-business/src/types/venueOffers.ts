/**
 * #4490 P2 — venue offers, day limits, the venue's day and the check-in door
 * (pure types; no React, no services). Shapes mirror the server contract
 * (`issue_4490_list_offers`, `issue_4490_venue_day`, edge `venue-check-in`).
 * Money is always minor units of the brand currency.
 */

export type VenueOfferKind = "entry" | "group_package" | "private_hire" | "by_the_hour";
export type EntryStyle = "walk_in" | "day_pass" | "timed_session";
export type VenueOfferStatus = "draft" | "live" | "paused" | "archived";
export type VatMode = "included" | "added" | "none";
export type BookingState = "active" | "paused";

/** Offer kinds whose host editor has shipped (mirror of `issue_4490_built_offer_kinds()`). */
export const BUILT_OFFER_KINDS: ReadonlySet<VenueOfferKind> = new Set<VenueOfferKind>(["entry"]);

export interface BusyRule {
  weekdays: number[];
  from: string;
  to: string;
  amountMinor: number;
}

export interface PriceOptionEligibility {
  label: string;
  checkAtGate: boolean;
}

export interface VenuePriceOption {
  id: string;
  name: string;
  unit: "guest" | "booking" | "hour" | "unit";
  guestMin: number;
  guestMax: number;
  /** 0 = Monday … 6 = Sunday. */
  weekdays: number[];
  startTime: string | null;
  endTime: string | null;
  eligibility: PriceOptionEligibility | null;
  busyRules: BusyRule[];
  sortOrder: number;
  status: string;
  version: number;
  priceMinor: number;
  priceVersionId: string | null;
}

export interface RefundRung {
  minMinutesBefore: number;
  refundBps: number;
}

export interface DateChangeRule {
  allowedUntilMinutesBefore: number | null;
  feeBps: number | null;
  maxChanges: number | null;
}

export interface VenueOfferPolicy {
  versionId: string | null;
  cancellationPolicy: string | null;
  refundLadder: RefundRung[];
  dateChangeRule: DateChangeRule | null;
}

export interface VenueOfferSchedule {
  ruleId: string | null;
  mode: "full_day" | "sessions";
  weekdays: number[];
  startTime: string | null;
  endTime: string | null;
  sessionMinutes: number | null;
  sessionEveryMinutes: number | null;
  startDate: string | null;
  endDate: string | null;
}

export interface VenueCapacityPool {
  id: string;
  name: string;
  dailyLimit: number;
  keptForWalkIns: number;
  spaceIds: string[] | null;
  archived: boolean;
  version: number;
}

export interface VenueOffer {
  id: string;
  venueId: string;
  kind: VenueOfferKind;
  entryStyle: EntryStyle | null;
  name: string;
  summary: string;
  description: string;
  status: VenueOfferStatus;
  version: number;
  sessionCapacity: number | null;
  minNoticeMinutes: number | null;
  maxAdvanceDays: number | null;
  sortOrder: number;
  poolId: string | null;
  options: VenuePriceOption[];
  policy: VenueOfferPolicy | null;
  schedule: VenueOfferSchedule | null;
  /** Every reason it can't go live yet (empty = ready). */
  readiness: string[];
}

export interface VenueBookingSettings {
  timezone: string;
  vatMode: VatMode;
  vatRateBps: number | null;
  instantPaymentHoldMinutes: number;
  bookingHorizonDays: number;
  bookingState: BookingState;
  version: number;
}

export interface VenueOffersState {
  venueId: string;
  flags: { reads: boolean; writes: boolean };
  settings: VenueBookingSettings | null;
  pools: VenueCapacityPool[];
  offers: VenueOffer[];
}

export interface CapacityOverride {
  poolId: string;
  localDate: string;
  dailyLimit: number | null;
  keptForWalkIns: number | null;
  closed: boolean;
  version: number;
}

// ---------------------------------------------------------------- the day

export interface VenueDayPool {
  poolId: string;
  name: string;
  dailyLimit: number;
  keptForWalkIns: number;
  used: number;
  soldOnline: number;
  soldAtGate: number;
  onlineLeft: number;
  walkInLeft: number;
  gateLeft: number;
  closed: boolean;
  hasOverride: boolean;
}

export interface VenueDayOffer {
  offerId: string;
  name: string;
  kind: VenueOfferKind;
  entryStyle: EntryStyle | null;
  status: VenueOfferStatus;
  poolId: string | null;
  sold: number;
  held: number;
}

export interface VenueDayBooking {
  groupId: string;
  reference: string;
  state: string;
  guestName: string;
  guests: number;
  totalMinor: number;
  currencyCode: string | null;
  source: string | null;
  paymentCollection: string | null;
  admittedCount: number;
  createdAt: string;
}

export interface VenueDay {
  localDate: string;
  timezone: string;
  closed: boolean;
  pools: VenueDayPool[];
  offers: VenueDayOffer[];
  checkIn: { passes: number; expected: number; admitted: number };
  bookings: VenueDayBooking[];
}

// ------------------------------------------------------------- check-in

export interface CheckInPass {
  passId: string;
  groupId: string | null;
  reference: string | null;
  holderName: string;
  offerName: string;
  offerKind: string | null;
  admits: number;
  admittedCount: number;
  remaining: number;
  validLocalDate: string | null;
  dayLabel: string | null;
  idCheckLabel: string | null;
  idCheckCount: number;
  status: string;
  source: string | null;
  time: string | null;
  lastAdmittedAt: string | null;
}

export interface CheckInTicket {
  ticketId: string;
  eventTitle: string;
  holderName: string;
  ticketName: string;
  admits: number;
  admittedCount: number;
  status: string;
  time: string | null;
}

export interface CheckInList {
  localDate: string;
  timezone: string;
  passes: CheckInPass[];
  tickets: CheckInTicket[];
  totals: { passes: number; admits: number; admitted: number };
}

export type ScanResultCode =
  | "admitted"
  | "already_used"
  | "wrong_day"
  | "not_yet"
  | "void"
  | "not_found"
  | "wrong_venue"
  | "id_required"
  | "undone";

export interface ScanOutcome {
  result: ScanResultCode;
  admitted: number | null;
  logId: string | null;
  balanceDueMinor: number;
  kind: "pass" | "event_ticket";
  pass: CheckInPass | null;
  ticketHolder: string | null;
  ticketName: string | null;
  venueName: string | null;
}

export type GateMethod = "cash" | "transfer" | "pay_link";

export interface GateSaleLine {
  priceOptionId: string;
  guests: number;
}

export interface GateSaleResult {
  method: GateMethod;
  passId: string | null;
  totalMinor: number;
  currencyCode: string | null;
  reference: string | null;
  payUrl: string | null;
}
