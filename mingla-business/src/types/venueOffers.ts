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
export const BUILT_OFFER_KINDS: ReadonlySet<VenueOfferKind> = new Set<VenueOfferKind>(["entry", "group_package", "private_hire"]);

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
  /** #4490 P3 — guests and extras can change until this many minutes before (packages). */
  guestChangeUntilMinutesBefore?: number | null;
}

// #4490 P3 — group packages: what's included, extras, deposit.
export type InclusionKind = "item" | "menu_item" | "staff" | "perk" | "choice";

export interface PackageInclusion {
  kind: InclusionKind;
  label: string;
  /** "guest" = one each, "booking" = one for the group. */
  qtyPer: "guest" | "booking" | null;
  menuItemId: string | null;
  /** Staff: one for every N guests. */
  staffRatio: number | null;
  /** Guests choose one (2..10 options). */
  options: string[] | null;
}

export interface PackageExtra {
  id: string;
  name: string;
  priceMinor: number;
  per: "booking" | "guest";
}

export type DepositKind = "none" | "percent" | "fixed";

export interface PackageDeposit {
  kind: DepositKind;
  /** Percent in basis points (5000 = 50%) or a fixed amount in minor units. */
  value: number | null;
  balanceDueDaysBefore: number | null;
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
  /** #4490 P3 — things to know that never block publishing (`online_payments_off`). */
  warnings: string[];
  /** #4490 P3 — false while the brand cannot take payments online. */
  canCollectOnline: boolean;
  inclusions: PackageInclusion[];
  extras: PackageExtra[];
  staffRoleLabel: string | null;
  deposit: PackageDeposit | null;
  payModes: Array<"deposit" | "full">;
  durationMinutes: number | null;
  /** Package start times, "HH:MM". */
  startTimes: string[];
  /** #4490 P4 — "request" (the venue answers first) or "instant". */
  confirmationMode: "request" | "instant";
  /** #4490 P4 — the private hire part (null for other kinds). */
  hire: HireTerms | null;
}

// ------------------------------------------------------ #4490 P4 private hire

export type HireCharge = "hire_fee" | "min_spend" | "per_guest";

export interface HireSpace {
  id: string;
  name: string;
  setting: string | null;
  capacityStanding: number | null;
  capacitySeated: number | null;
  capacity: number;
}

export interface HireCombination {
  id: string;
  name: string;
  spaceIds: string[];
  capacity: number;
}

/** One price row: a place (space or combination) and a group size. */
export interface HirePriceRow {
  optionId: string;
  name: string;
  unit: "guest" | "booking";
  spaceId: string | null;
  combinationId: string | null;
  placeName: string;
  capacity: number;
  guestMin: number;
  guestMax: number;
  /** 0 = Monday … 6 = Sunday. */
  weekdays: number[];
  priceMinor: number;
}

export interface HireSession {
  ruleId: string | null;
  label: string;
  startTime: string;
  endTime: string;
  pastMidnight: boolean;
  minutes: number;
  weekdays: number[];
  startDate: string | null;
  endDate: string | null;
}

export interface HireTerms {
  charge: HireCharge;
  bookingMode: "request" | "instant";
  spaces: HireSpace[];
  combinations: HireCombination[];
  rows: HirePriceRow[];
  sessions: HireSession[];
  setupMinutes: number;
  cleanupMinutes: number;
  damageDepositMinor: number;
  minSpendMinor: number;
  extraGuestMinor: number | null;
  overtimeMinorPerHour: number | null;
  /** Venue-wide: how long the venue has to reply to a request. */
  requestResponseHours: number;
  /** Venue-wide: how long an approved guest has to pay the deposit. */
  approvedPaymentMinutes: number;
}

export type RequestTab = "to_answer" | "waiting_for_deposit" | "confirmed" | "closed";
export type RequestFilter = RequestTab | "money_due" | "all";
export type ClosedReason = "declined" | "expired" | "not_paid" | "released" | "withdrawn" | "cancelled" | "needs_checking";

export interface RequestQueue {
  position: number;
  blockedByGroupId: string | null;
  blockedByReference: string | null;
  blockedByGuestName: string | null;
  blockedByHoldUntil: string | null;
  queuedAt: string | null;
  releasedAt: string | null;
}

export interface VenueRequest {
  groupId: string;
  reference: string;
  state: string;
  tab: RequestTab;
  version: number;
  offerKind: VenueOfferKind | null;
  offerName: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  guests: number;
  placeName: string | null;
  spaceIds: string[];
  sessionLabel: string | null;
  localDate: string;
  startsAt: string | null;
  endsAt: string | null;
  setupFrom: string | null;
  cleanupUntil: string | null;
  requestedAt: string | null;
  replyBy: string | null;
  holdUntil: string | null;
  currencyCode: string;
  totalDueMinor: number;
  depositMinor: number | null;
  paidMinor: number;
  balanceMinor: number;
  balanceDueAt: string | null;
  occasion: string | null;
  note: string | null;
  siteVisit: boolean;
  closedReason: ClosedReason | null;
  declineReason: string | null;
  placeStatus: "free" | "held" | "taken" | null;
  queue: RequestQueue | null;
  nextInLine: boolean;
  waitingBehind: number;
  nextInLineGuest: string | null;
}

export interface RequestCounts {
  toAnswer: number;
  waitingForDeposit: number;
  confirmed: number;
  closed: number;
  moneyDue: number;
}

export interface VenueRequestsList {
  counts: RequestCounts;
  requests: VenueRequest[];
}

export type CalendarClaimKind = "hire" | "hold" | "event" | "block";

export interface CalendarClaim {
  claimId: string;
  spaceId: string;
  source: string;
  state: string;
  kind: CalendarClaimKind;
  viaCombinationId: string | null;
  viaCombinationName: string | null;
  bookedFrom: string | null;
  bookedTo: string | null;
  claimFrom: string;
  claimTo: string;
  holdUntil: string | null;
  groupId: string | null;
  reference: string | null;
  groupState: string | null;
  guestName: string | null;
  offerName: string | null;
  sessionLabel: string | null;
  guests: number | null;
  eventId: string | null;
  eventTitle: string | null;
  blockReason: string | null;
}

export interface CalendarCombinationBlock {
  combinationId: string;
  claimId: string;
  blockedBy: string;
  from: string;
  to: string;
  state: string;
}

export interface CalendarRequest {
  groupId: string;
  reference: string;
  guestName: string;
  spaceIds: string[];
  placeName: string | null;
  bookedFrom: string | null;
  bookedTo: string | null;
  replyBy: string | null;
  collides: boolean;
}

export interface CalendarDayPool {
  poolId: string;
  name: string;
  dailyLimit: number;
  limitEffective: number;
  hireCut: number;
  venueHired: boolean;
  sold: number;
  closed: boolean;
}

export interface CalendarDayGroup {
  groupId: string;
  reference: string;
  state: string;
  offerName: string;
  guestName: string;
  guests: number;
  startsAt: string | null;
  endsAt: string | null;
}

export interface CalendarDay {
  localDate: string;
  closed: boolean;
  specialHours: { isClosed: boolean; label: string | null } | null;
  pools: CalendarDayPool[];
  groups: CalendarDayGroup[];
}

export interface CalendarEvent {
  eventId: string;
  title: string;
  spaceId: string | null;
  spaceUse: string | null;
  status: string;
  startsAt: string;
  endsAt: string;
}

export interface VenueCalendar {
  timezone: string;
  from: string;
  to: string;
  spaces: Array<{ id: string; name: string; setting: string | null; capacity: number; canBeHired: boolean }>;
  combinations: Array<{ id: string; name: string; spaceIds: string[] }>;
  claims: CalendarClaim[];
  combinationBlocks: CalendarCombinationBlock[];
  requests: CalendarRequest[];
  days: CalendarDay[];
  events: CalendarEvent[];
}

export interface NextFreeDate {
  windowId: string;
  localDate: string;
  startsAt: string;
  endsAt: string;
  sessionLabel: string | null;
}

export type StaffRequestAction = "approve" | "decline" | "queue" | "extend_hold" | "release_hold";

export interface StaffActionResult {
  groupId: string;
  state: string;
  holdUntil: string | null;
  depositMinor: number | null;
  totalDueMinor: number | null;
  position: number | null;
  blockedByReference: string | null;
  replayed: boolean;
}

/** The hire part of a booking read (staff and guest). */
export interface HireBookingFacts {
  placeName: string | null;
  spaceIds: string[];
  combinationId: string | null;
  sessionLabel: string | null;
  bookedFrom: string | null;
  bookedTo: string | null;
  setupFrom: string | null;
  cleanupUntil: string | null;
  guests: number;
  hireMinor: number;
  extraGuests: number;
  extraGuestMinor: number;
  overtimeHours: number;
  overtimeMinor: number;
  hireCharge: HireCharge | null;
  minSpendMinor: number;
  damageDepositMinor: number;
  occasion: string | null;
  note: string | null;
  siteVisit: boolean;
  replyWithinHours: number | null;
  declineReason: string | null;
  alternatives: string[];
  hostNote: string | null;
  closedReason: string | null;
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
  /** #4490 P3 (F4) — the brand can take payments online right now. */
  canCollectOnline: boolean;
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
  /** #4490 P3 (optional so P2 readers and fixtures stay valid). */
  offerKind?: VenueOfferKind | null;
  offerName?: string | null;
  startsAt?: string | null;
  balanceDueMinor?: number;
  balanceDueAt?: string | null;
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
  /** #4490 P3 — money still owed on the booking (0 when paid up). */
  balanceDueMinor?: number;
  totalDueMinor?: number;
  currencyCode?: string | null;
  /** The booking can take money at the door (confirmed). */
  canTakePayment?: boolean;
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

// ------------------------------------------------- #4490 P3 booking detail

export type OfflineMethod = "cash" | "transfer" | "card_at_venue" | "other";

export interface BookingPaymentRow {
  attemptId: string;
  stage: string;
  state: string;
  amountMinor: number;
  at: string | null;
}

export interface BookingVenuePaymentRow {
  paymentId: string;
  amountMinor: number;
  method: string;
  paidOn: string | null;
  note: string | null;
  at: string | null;
}

export interface BookingChangeRow {
  changeId: string;
  kind: string;
  fromGuests: number | null;
  toGuests: number | null;
  fromDate: string | null;
  toDate: string | null;
  extras: Array<{ name: string; qty: number }>;
  amountMinor: number;
  feeMinor: number;
  refundMinor: number;
  by: string | null;
  createdAt: string | null;
}

export interface BookingExtraRow {
  id: string;
  name: string;
  per: "booking" | "guest";
  qty: number;
  amountMinor: number;
  addedAt: string | null;
}

export interface BookingChangeRules {
  moveUntil: string | null;
  guestChangeUntil: string | null;
  maxChanges: number | null;
  changesUsed: number;
  feeBps: number;
  canMove: boolean;
  canChangeGuests: boolean;
  canAddExtras: boolean;
}

export interface VenueBookingLine {
  lineId: string;
  priceOptionId: string | null;
  name: string;
  guests: number;
  bookedGuests: number;
  unit: string | null;
  state: string;
}

export interface VenueBookingDetail {
  groupId: string;
  reference: string;
  state: string;
  version: number;
  offerKind: VenueOfferKind | null;
  offer: { id: string | null; name: string };
  guest: { name: string; email: string | null; phone: string | null };
  window: { windowId: string | null; localDate: string; startsAt: string | null; endsAt: string | null } | null;
  lines: VenueBookingLine[];
  currencyCode: string;
  totalMinor: number;
  totalDueMinor: number;
  paidMinor: number;
  paidOnlineMinor: number;
  paidAtVenueMinor: number;
  refundedMinor: number;
  balanceDueMinor: number;
  balanceDueAt: string | null;
  depositMinor: number | null;
  taxMinor: number;
  vatMode: VatMode | null;
  paymentCollection: string | null;
  bookingSource: string | null;
  extras: BookingExtraRow[];
  answers: Record<string, string>;
  inclusions: Array<{ kind: string; label: string; staffRatio: number | null }>;
  changes: BookingChangeRow[];
  changeRules: BookingChangeRules | null;
  payments: BookingPaymentRow[];
  paidAtVenue: BookingVenuePaymentRow[];
  history: Array<{ type: string; by: string | null; at: string | null }>;
  canManageMoney: boolean;
  canChange: boolean;
  admittedCount: number;
  admits: number;
  createdAt: string | null;
  timezone: string;
  /** For moving the day: the public venue address of the offer. */
  brandSlug: string | null;
  venueSlug: string | null;
  /** #4490 P4 — private hire facts (null for other kinds). */
  hire: HireBookingFacts | null;
  requestDeadline: string | null;
  paymentDeadline: string | null;
  /** The terms saved on the booking (refund ladder words). */
  policyText: string | null;
}

export type BookingChangeAction = "change_guests" | "move_date" | "add_extras";

export interface BookingChangeSummary {
  action: BookingChangeAction | string;
  fromGuests: number | null;
  toGuests: number | null;
  fromDate: string | null;
  toDate: string | null;
  toStartsAt: string | null;
  priceDeltaMinor: number;
  taxDeltaMinor: number;
  feeMinor: number;
  amountMinor: number;
  totalDueBeforeMinor: number;
  totalDueAfterMinor: number;
  paidMinor: number;
  refundMinor: number;
  balanceAfterMinor: number;
  currencyCode: string;
  groupVersion: number | null;
  replayed: boolean;
}

export interface DayClosurePreview {
  localDate: string;
  count: number;
  guests: number;
  paidMinor: number;
  bookings: Array<{
    groupId: string;
    reference: string;
    state: string;
    guestName: string;
    guests: number;
    offerName: string;
    paidMinor: number;
  }>;
}

export interface StaffCancelPreview {
  previewIds: string[];
  previewHash: string;
  paidMinor: number;
  refundMinor: number;
  keepMinor: number;
  currencyCode: string;
}
