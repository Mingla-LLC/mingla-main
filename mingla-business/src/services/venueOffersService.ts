/**
 * #4490 P2 — venue offers (Entry), day limits, booking settings, the venue's
 * day and the check-in door.
 *
 * Host writes go through the #4490 RPCs (`issue_4490_manage_offer`,
 * `issue_4490_manage_capacity_pool`, `issue_4490_set_capacity_override`,
 * `issue_4490_save_booking_settings`); the door goes through the staff edge
 * function `venue-check-in`. The server checks authority, versions and stock
 * and computes every total. Errors keep their token for mapping
 * (`venueOfferErrorCopy`); a raw code never reaches a screen.
 */

import { isVenueLayout, type VenueLayout } from "@mingla/brand-rendering/venueOffers/layoutModel";

import { supabase } from "./supabase";
import { arr, num, numOrNull, obj, str, strOrNull, weekdays, type Json } from "./venueJsonRead";
import { VenueOfferError, edgeError, toVenueOfferError } from "./venueOfferErrors";
import { mapKind, mapStyle } from "./venueDayService";
import { mapGuestListEntry, mapGuestListTerms } from "./venuePromoterGuestListService";

// #4490 — split out so the Hub card and the Guest pages load only what they use;
// re-exported so Host callers keep one import.
export { VenueOfferError, toVenueOfferError } from "./venueOfferErrors";
export { fetchVenueDay, mapVenueDay, parseVenueDayMoney } from "./venueDayService";
export {
  fetchPromoterGuestList,
  mapGuestListEntry,
  mapGuestListTerms,
  writePromoterGuestList,
} from "./venuePromoterGuestListService";
import { randomId } from "../utils/randomId";
import type {
  BusyRule,
  HourTerms,
  CapacityOverride,
  CheckInList,
  CheckInMember,
  CheckInPass,
  CheckInTicket,
  DateChangeRule,
  EntryStyle,
  GateMethod,
  GateSaleLine,
  GateSaleResult,
  RefundRung,
  ScanOutcome,
  ScanResultCode,
  VenueBookingSettings,
  VenueCapacityPool,
  VenueDay,
  VenueDayMoney,
  VenueDayMoneyParts,
  VenueDayBooking,
  VenueDayOffer,
  VenueDayPool,
  VenueOffer,
  VenueOfferGuestFrom,
  VenueOfferKind,
  VenueOffersState,
  VenuePriceOption,
  BookingChangeAction,
  BookingChangeSummary,
  DayClosurePreview,
  OfflineMethod,
  PackageDeposit,
  PackageExtra,
  PackageInclusion,
  StaffCancelPreview,
  VenueBookingDetail,
  CalendarClaim,
  ClosedReason,
  HireBookingFacts,
  DamageDepositState,
  DamageDepositStatus,
  HireHoursYouSet,
  HireTerms,
  NextFreeDate,
  RequestFilter,
  RequestTab,
  StaffActionResult,
  StaffRequestAction,
  VenueCalendar,
  VenueRequest,
  VenueRequestsList,
  VenueGuestListDay,
  VenueGuestListEntry,
  VenueGuestListPromoter,
  VenueGuestListTerms,
  PromoterGuestListPage,
} from "../types/venueOffers";


function mapBusyRule(v: unknown): BusyRule {
  const r = obj(v);
  return {
    weekdays: weekdays(r.weekdays),
    from: str(r.from),
    to: str(r.to),
    amountMinor: num(r.amount_minor ?? r.amountMinor),
  };
}

function mapOption(v: unknown): VenuePriceOption {
  const o = obj(v);
  const elig = o.eligibility === null || o.eligibility === undefined ? null : obj(o.eligibility);
  const unit = str(o.unit, "guest");
  return {
    id: str(o.id),
    name: str(o.name),
    unit: unit === "booking" || unit === "hour" || unit === "unit" ? unit : "guest",
    guestMin: num(o.guestMin, 1),
    guestMax: num(o.guestMax, 1),
    weekdays: weekdays(o.weekdays),
    startTime: strOrNull(o.startTime),
    endTime: strOrNull(o.endTime),
    eligibility:
      elig === null || str(elig.label).length === 0
        ? null
        : { label: str(elig.label), checkAtGate: elig.checkAtGate === true },
    busyRules: arr(o.busyRules).map(mapBusyRule),
    sortOrder: num(o.sortOrder),
    status: str(o.status, "active"),
    version: num(o.version, 1),
    priceMinor: num(o.priceMinor),
    priceVersionId: strOrNull(o.priceVersionId),
    passDays: numOrNull(o.passDays),
    passWindowDays: numOrNull(o.passWindowDays),
  };
}

export function mapPool(v: unknown): VenueCapacityPool {
  const p = obj(v);
  return {
    id: str(p.id),
    name: str(p.name),
    dailyLimit: num(p.dailyLimit),
    keptForWalkIns: num(p.keptForWalkIns),
    spaceIds: Array.isArray(p.spaceIds) ? p.spaceIds.filter((s): s is string => typeof s === "string") : null,
    archived: p.archived === true,
    version: num(p.version, 1),
  };
}

function mapInclusion(v: unknown): PackageInclusion {
  const i = obj(v);
  const kind = str(i.kind, "item");
  const qty = str(i.qtyPer ?? i.qty_per);
  return {
    kind: kind === "menu_item" || kind === "staff" || kind === "perk" || kind === "choice" ? kind : "item",
    label: str(i.label),
    qtyPer: qty === "guest" || qty === "booking" ? qty : null,
    menuItemId: strOrNull(i.menuItemId ?? i.menu_item_id),
    staffRatio: numOrNull(i.staffRatio ?? i.staff_ratio),
    options: Array.isArray(i.options) ? i.options.filter((x): x is string => typeof x === "string") : null,
  };
}

function mapExtra(v: unknown): PackageExtra {
  const e = obj(v);
  return {
    id: str(e.id),
    name: str(e.name),
    priceMinor: num(e.priceMinor ?? e.price_minor),
    per: str(e.per) === "guest" ? "guest" : "booking",
  };
}

function mapDeposit(v: unknown): PackageDeposit | null {
  if (v === null || v === undefined) return null;
  const d = obj(v);
  const kind = str(d.kind, "none");
  return {
    kind: kind === "percent" || kind === "fixed" ? kind : "none",
    value: numOrNull(d.value),
    balanceDueDaysBefore: numOrNull(d.balanceDueDaysBefore),
  };
}

/** #4490 W3 fix 2: the server's guest "from" for a live offer (null when absent or malformed). */
export function mapGuestFrom(v: unknown): VenueOfferGuestFrom | null {
  if (v === null || v === undefined || typeof v !== "object") return null;
  const g = obj(v);
  const from = numOrNull(g.fromMinor);
  if (from === null || from < 0) return null;
  const unit = g.unit;
  return {
    fromMinor: from,
    unit: unit === "booking" || unit === "hour" || unit === "unit" ? unit : "guest",
  };
}

export function mapOffer(v: unknown): VenueOffer {
  const o = obj(v);
  const policy = o.policy === null || o.policy === undefined ? null : obj(o.policy);
  const schedule = o.schedule === null || o.schedule === undefined ? null : obj(o.schedule);
  const pool = o.pool === null || o.pool === undefined ? null : obj(o.pool);
  const change = policy === null ? null : obj(policy.dateChangeRule);
  const status = str(o.status, "draft");
  return {
    id: str(o.id),
    venueId: str(o.venueId),
    kind: mapKind(o.kind),
    entryStyle: mapStyle(o.entryStyle),
    name: str(o.name),
    summary: str(o.summary),
    description: str(o.description),
    status: status === "live" || status === "paused" || status === "archived" ? status : "draft",
    version: num(o.version, 1),
    sessionCapacity: numOrNull(o.sessionCapacity),
    minNoticeMinutes: numOrNull(o.minNoticeMinutes),
    maxAdvanceDays: numOrNull(o.maxAdvanceDays),
    sortOrder: num(o.sortOrder),
    poolId: pool === null || str(pool.id).length === 0 ? null : str(pool.id),
    options: arr(o.options).map(mapOption),
    policy:
      policy === null
        ? null
        : {
            versionId: strOrNull(policy.versionId),
            cancellationPolicy: strOrNull(policy.cancellationPolicy),
            refundLadder: arr(policy.refundLadder).map((r) => ({
              minMinutesBefore: num(obj(r).minMinutesBefore),
              refundBps: num(obj(r).refundBps),
            })),
            dateChangeRule:
              change === null || Object.keys(change).length === 0
                ? null
                : {
                    allowedUntilMinutesBefore: numOrNull(change.allowedUntilMinutesBefore),
                    feeBps: numOrNull(change.feeBps),
                    maxChanges: numOrNull(change.maxChanges),
                    guestChangeUntilMinutesBefore: numOrNull(change.guestChangeUntilMinutesBefore),
                  },
          },
    schedule:
      schedule === null
        ? null
        : {
            ruleId: strOrNull(schedule.ruleId),
            mode: str(schedule.mode) === "sessions" ? "sessions" : "full_day",
            weekdays: weekdays(schedule.weekdays),
            startTime: strOrNull(schedule.startTime),
            endTime: strOrNull(schedule.endTime),
            sessionMinutes: numOrNull(schedule.sessionMinutes),
            sessionEveryMinutes: numOrNull(schedule.sessionEveryMinutes),
            startDate: strOrNull(schedule.startDate),
            endDate: strOrNull(schedule.endDate),
          },
    readiness: arr(o.readiness).filter((r): r is string => typeof r === "string"),
    guestFrom: mapGuestFrom(o.guestFrom),
    outsideOpeningHours: o.outsideOpeningHours === true,
    outsideOpeningHoursDays: arr(o.outsideOpeningHoursDays).filter((d): d is number => typeof d === "number"),
    warnings: arr(o.warnings).filter((r): r is string => typeof r === "string"),
    canCollectOnline: o.canCollectOnline !== false,
    inclusions: arr(o.inclusions).map(mapInclusion).filter((i) => i.label.length > 0),
    extras: arr(o.extras).map(mapExtra).filter((e) => e.id.length > 0),
    staffRoleLabel: strOrNull(o.staffRoleLabel),
    deposit: mapDeposit(o.deposit),
    payModes: arr(o.payModes).filter((m): m is "deposit" | "full" => m === "deposit" || m === "full"),
    durationMinutes: numOrNull(o.durationMinutes),
    startTimes: arr(o.startTimes).filter((t): t is string => typeof t === "string" && /^\d{2}:\d{2}$/.test(t)),
    confirmationMode: str(o.confirmationMode) === "request" ? "request" : "instant",
    hire: o.hire === null || o.hire === undefined ? null : mapHireTerms(o.hire),
    hour: o.hour === null || o.hour === undefined ? null : mapHourTerms(o.hour),
  };
}

// ---------------------------------------------------------------------------
// #4490 P4 — private hire (offer part, requests, calendar, staff actions)
// ---------------------------------------------------------------------------

/** #4490 P5 — the by-the-hour part of an offer projection. */
export function mapHourTerms(v: unknown): HourTerms {
  const h = obj(v);
  const hours = h.hours === null || h.hours === undefined ? null : obj(h.hours);
  return {
    allocation: str(h.allocation) === "any_one" ? "any_one" : "all",
    places: arr(h.places).map((p) => {
      const r = obj(p);
      return { id: str(r.id), name: str(r.name), setting: strOrNull(r.setting), capacity: num(r.capacity) };
    }),
    hours:
      hours === null || str(hours.startTime).length === 0
        ? null
        : {
            ruleId: strOrNull(hours.ruleId),
            weekdays: weekdays(hours.weekdays),
            startTime: str(hours.startTime).slice(0, 5),
            endTime: str(hours.endTime).slice(0, 5),
            pastMidnight: hours.pastMidnight === true,
            startDate: strOrNull(hours.startDate),
            endDate: strOrNull(hours.endDate),
          },
    stepMinutes: num(h.stepMinutes, 60),
    minMinutes: numOrNull(h.minMinutes),
    maxMinutes: numOrNull(h.maxMinutes),
    pricePerHourMinor: numOrNull(h.pricePerHourMinor),
    setupMinutes: num(h.setupMinutes),
    cleanupMinutes: num(h.cleanupMinutes),
    noShowReleaseMinutes: numOrNull(h.noShowReleaseMinutes),
    staffCanStart: h.staffCanStart === true,
  };
}

export type ManageHourAction = "set_place" | "set_hours" | "set_length" | "set_rules";

export async function manageVenueHour(input: {
  venueId: string;
  action: ManageHourAction;
  payload: Record<string, unknown>;
  expectedVersion: number;
}): Promise<VenueOffer> {
  const { data, error } = await supabase.rpc("issue_4490_manage_hour", {
    p_action: input.action,
    p_venue_id: input.venueId,
    p_payload: input.payload,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: `hour-${input.action}-${randomId()}`,
  });
  if (error !== null) throw toVenueOfferError(error);
  return mapOffer(data);
}

export function mapHireTerms(v: unknown): HireTerms {
  const h = obj(v);
  const charge = str(h.charge, "hire_fee");
  return {
    charge: charge === "min_spend" || charge === "per_guest" ? charge : "hire_fee",
    bookingMode: str(h.bookingMode) === "instant" ? "instant" : "request",
    layouts: arr(h.layouts).filter(isVenueLayout),
    spaces: arr(h.spaces).map((x) => {
      const s = obj(x);
      return {
        id: str(s.id),
        name: str(s.name),
        setting: strOrNull(s.setting),
        capacityStanding: numOrNull(s.capacityStanding),
        capacitySeated: numOrNull(s.capacitySeated),
        capacity: num(s.capacity),
      };
    }),
    combinations: arr(h.combinations).map((x) => {
      const c = obj(x);
      return {
        id: str(c.id),
        name: str(c.name),
        spaceIds: arr(c.spaceIds).filter((id): id is string => typeof id === "string"),
        capacity: num(c.capacity),
      };
    }),
    rows: arr(h.rows).map((x) => {
      const r = obj(x);
      const capacities: Partial<Record<VenueLayout, number>> = {};
      for (const [layout, capacity] of Object.entries(obj(r.layoutCapacities))) {
        if (isVenueLayout(layout) && typeof capacity === "number" && Number.isFinite(capacity)) capacities[layout] = capacity;
      }
      return {
        optionId: str(r.optionId),
        name: str(r.name),
        unit: str(r.unit) === "guest" ? ("guest" as const) : str(r.unit) === "hour" ? ("hour" as const) : ("booking" as const),
        spaceId: strOrNull(r.spaceId),
        combinationId: strOrNull(r.combinationId),
        placeName: str(r.placeName),
        capacity: num(r.capacity),
        layoutCapacities: capacities,
        guestMin: num(r.guestMin, 1),
        guestMax: num(r.guestMax, 1),
        weekdays: weekdays(r.weekdays),
        priceMinor: num(r.priceMinor),
      };
    }),
    sessions: arr(h.sessions).map((x) => {
      const r = obj(x);
      return {
        ruleId: strOrNull(r.ruleId),
        label: str(r.label),
        startTime: str(r.startTime),
        endTime: str(r.endTime),
        pastMidnight: r.pastMidnight === true,
        minutes: num(r.minutes),
        weekdays: weekdays(r.weekdays),
        startDate: strOrNull(r.startDate),
        endDate: strOrNull(r.endDate),
      };
    }),
    setupMinutes: num(h.setupMinutes),
    cleanupMinutes: num(h.cleanupMinutes),
    damageDepositMinor: num(h.damageDepositMinor),
    minSpendMinor: num(h.minSpendMinor),
    extraGuestMinor: numOrNull(h.extraGuestMinor),
    overtimeMinorPerHour: numOrNull(h.overtimeMinorPerHour),
    requestResponseHours: num(h.requestResponseHours, 48),
    approvedPaymentMinutes: num(h.approvedPaymentMinutes, 4320),
    hoursYouSet: mapHoursYouSet(h.hoursYouSet),
    damageDepositReleaseDays: num(h.damageDepositReleaseDays, 7),
  };
}

function mapHoursYouSet(v: unknown): HireHoursYouSet | null {
  if (v === null || v === undefined || typeof v !== "object") return null;
  const r = obj(v);
  return {
    ruleId: strOrNull(r.ruleId),
    weekdays: weekdays(r.weekdays),
    startTime: str(r.startTime),
    endTime: str(r.endTime),
    pastMidnight: r.pastMidnight === true,
    minMinutes: num(r.minMinutes, 60),
    maxMinutes: numOrNull(r.maxMinutes),
    stepMinutes: num(r.stepMinutes, 60),
  };
}

export type ManageHireAction = "set_spaces" | "set_price_row" | "set_sessions" | "set_terms" | "set_booking" | "set_flexible" | "set_extras" | "set_layouts";

export async function manageVenueHire(input: {
  venueId: string;
  action: ManageHireAction;
  payload: Record<string, unknown>;
  expectedVersion: number;
}): Promise<VenueOffer> {
  const { data, error } = await supabase.rpc("issue_4490_manage_hire", {
    p_action: input.action,
    p_venue_id: input.venueId,
    p_payload: input.payload,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: `hire-${input.action}-${randomId()}`,
  });
  if (error !== null) throw toVenueOfferError(error);
  return mapOffer(data);
}

const REQUEST_TABS: readonly RequestTab[] = ["to_answer", "waiting_for_deposit", "confirmed", "closed"];
const CLOSED_REASONS: readonly ClosedReason[] = [
  "declined",
  "expired",
  "not_paid",
  "released",
  "withdrawn",
  "cancelled",
  "needs_checking",
];

export function mapVenueRequest(v: unknown): VenueRequest {
  const r = obj(v);
  const tab = str(r.tab) as RequestTab;
  const reason = str(r.closedReason) as ClosedReason;
  const q = r.queue === null || r.queue === undefined ? null : obj(r.queue);
  const place = str(r.placeStatus);
  return {
    groupId: str(r.groupId),
    reference: str(r.reference),
    state: str(r.state),
    tab: REQUEST_TABS.includes(tab) ? tab : "closed",
    version: num(r.version, 1),
    offerKind: r.offerKind === undefined || r.offerKind === null ? null : mapKind(r.offerKind),
    offerName: str(r.offerName),
    guestName: str(r.guestName, "Guest"),
    guestEmail: strOrNull(r.guestEmail),
    guestPhone: strOrNull(r.guestPhone),
    guests: num(r.guests),
    placeName: strOrNull(r.placeName),
    layout: isVenueLayout(r.layout) ? r.layout : null,
    layoutCapacity: numOrNull(r.layoutCapacity),
    spaceIds: arr(r.spaceIds).filter((x): x is string => typeof x === "string"),
    sessionLabel: strOrNull(r.sessionLabel),
    localDate: str(r.localDate),
    startsAt: strOrNull(r.startsAt),
    endsAt: strOrNull(r.endsAt),
    setupFrom: strOrNull(r.setupFrom),
    cleanupUntil: strOrNull(r.cleanupUntil),
    requestedAt: strOrNull(r.requestedAt),
    replyBy: strOrNull(r.replyBy),
    holdUntil: strOrNull(r.holdUntil),
    currencyCode: str(r.currencyCode, "NGN"),
    totalDueMinor: num(r.totalDueMinor),
    depositMinor: numOrNull(r.depositMinor),
    paidMinor: num(r.paidMinor),
    balanceMinor: num(r.balanceMinor),
    balanceDueAt: strOrNull(r.balanceDueAt),
    occasion: strOrNull(r.occasion),
    note: strOrNull(r.note),
    siteVisit: r.siteVisit === true,
    closedReason: CLOSED_REASONS.includes(reason) ? reason : null,
    declineReason: strOrNull(r.declineReason),
    placeStatus: place === "free" || place === "held" || place === "taken" ? place : null,
    queue:
      q === null || Object.keys(q).length === 0
        ? null
        : {
            position: num(q.position, 1),
            blockedByGroupId: strOrNull(q.blockedByGroupId),
            blockedByReference: strOrNull(q.blockedByReference),
            blockedByGuestName: strOrNull(q.blockedByGuestName),
            blockedByHoldUntil: strOrNull(q.blockedByHoldUntil),
            queuedAt: strOrNull(q.queuedAt),
            releasedAt: strOrNull(q.releasedAt),
          },
    nextInLine: r.nextInLine === true,
    waitingBehind: num(r.waitingBehind),
    nextInLineGuest: strOrNull(r.nextInLineGuest),
  };
}

export async function fetchVenueRequests(venueId: string, filter: RequestFilter): Promise<VenueRequestsList> {
  const { data, error } = await supabase.rpc("issue_4490_requests_list", { p_venue_id: venueId, p_filter: filter });
  if (error !== null) throw toVenueOfferError(error);
  const d = obj(data);
  const c = obj(d.counts);
  return {
    counts: {
      toAnswer: num(c.toAnswer),
      waitingForDeposit: num(c.waitingForDeposit),
      confirmed: num(c.confirmed),
      closed: num(c.closed),
      moneyDue: num(c.moneyDue),
    },
    requests: arr(d.requests).map(mapVenueRequest),
  };
}

function mapClaim(v: unknown): CalendarClaim {
  const c = obj(v);
  const kind = str(c.kind);
  return {
    claimId: str(c.claimId),
    spaceId: str(c.spaceId),
    source: str(c.source),
    state: str(c.state),
    kind: kind === "hold" || kind === "event" || kind === "block" ? kind : "hire",
    viaCombinationId: strOrNull(c.viaCombinationId),
    viaCombinationName: strOrNull(c.viaCombinationName),
    bookedFrom: strOrNull(c.bookedFrom),
    bookedTo: strOrNull(c.bookedTo),
    claimFrom: str(c.claimFrom),
    claimTo: str(c.claimTo),
    holdUntil: strOrNull(c.holdUntil),
    groupId: strOrNull(c.groupId),
    reference: strOrNull(c.reference),
    groupState: strOrNull(c.groupState),
    guestName: strOrNull(c.guestName),
    offerName: strOrNull(c.offerName),
    sessionLabel: strOrNull(c.sessionLabel),
    guests: numOrNull(c.guests),
    eventId: strOrNull(c.eventId),
    eventTitle: strOrNull(c.eventTitle),
    blockReason: strOrNull(c.blockReason),
  };
}

export function mapVenueCalendar(v: unknown): VenueCalendar {
  const d = obj(v);
  return {
    timezone: str(d.timezone, "Africa/Lagos"),
    from: str(d.from),
    to: str(d.to),
    spaces: arr(d.spaces).map((x) => {
      const s = obj(x);
      return { id: str(s.id), name: str(s.name), setting: strOrNull(s.setting), capacity: num(s.capacity), canBeHired: s.canBeHired !== false };
    }),
    combinations: arr(d.combinations).map((x) => {
      const c = obj(x);
      return { id: str(c.id), name: str(c.name), spaceIds: arr(c.spaceIds).filter((id): id is string => typeof id === "string") };
    }),
    claims: arr(d.claims).map(mapClaim),
    combinationBlocks: arr(d.combinationBlocks).map((x) => {
      const b = obj(x);
      return { combinationId: str(b.combinationId), claimId: str(b.claimId), blockedBy: str(b.blockedBy), from: str(b.from), to: str(b.to), state: str(b.state) };
    }),
    requests: arr(d.requests).map((x) => {
      const r = obj(x);
      return {
        groupId: str(r.groupId),
        reference: str(r.reference),
        guestName: str(r.guestName, "Guest"),
        spaceIds: arr(r.spaceIds).filter((id): id is string => typeof id === "string"),
        placeName: strOrNull(r.placeName),
        bookedFrom: strOrNull(r.bookedFrom),
        bookedTo: strOrNull(r.bookedTo),
        replyBy: strOrNull(r.replyBy),
        collides: r.collides === true,
      };
    }),
    days: arr(d.days).map((x) => {
      const day = obj(x);
      const sh = day.specialHours === null || day.specialHours === undefined ? null : obj(day.specialHours);
      return {
        localDate: str(day.localDate),
        closed: day.closed === true,
        specialHours: sh === null ? null : { isClosed: sh.isClosed === true, label: strOrNull(sh.label) },
        pools: arr(day.pools).map((p) => {
          const r = obj(p);
          return {
            poolId: str(r.poolId),
            name: str(r.name),
            dailyLimit: num(r.dailyLimit),
            limitEffective: num(r.limitEffective, num(r.dailyLimit)),
            hireCut: num(r.hireCut),
            venueHired: r.venueHired === true,
            sold: num(r.sold),
            closed: r.closed === true,
          };
        }),
        groups: arr(day.groups).map((g) => {
          const r = obj(g);
          return {
            groupId: str(r.groupId),
            reference: str(r.reference),
            state: str(r.state),
            offerName: str(r.offerName),
            guestName: str(r.guestName, "Guest"),
            guests: num(r.guests),
            startsAt: strOrNull(r.startsAt),
            endsAt: strOrNull(r.endsAt),
          };
        }),
      };
    }),
    events: arr(d.events).map((x) => {
      const e = obj(x);
      return {
        eventId: str(e.eventId),
        title: str(e.title),
        spaceId: strOrNull(e.spaceId),
        combinationId: strOrNull(e.combinationId),
        spaceIds: arr(e.spaceIds).filter((x): x is string => typeof x === "string"),
        spaceUse: strOrNull(e.spaceUse),
        status: str(e.status),
        startsAt: str(e.startsAt),
        endsAt: str(e.endsAt),
        eventType: strOrNull(e.eventType),
      };
    }),
  };
}

export async function fetchVenueCalendar(venueId: string, from: string, to: string): Promise<VenueCalendar> {
  const { data, error } = await supabase.rpc("issue_4490_venue_calendar", { p_venue_id: venueId, p_from: from, p_to: to });
  if (error !== null) throw toVenueOfferError(error);
  return mapVenueCalendar(data);
}

export async function fetchNextFreeDates(input: {
  offeringId: string;
  priceOptionId: string;
  from?: string | null;
  limit?: number;
}): Promise<NextFreeDate[]> {
  const { data, error } = await supabase.rpc("issue_4490_next_free_dates", {
    p_offering_id: input.offeringId,
    p_price_option_id: input.priceOptionId,
    p_from: input.from ?? null,
    p_limit: input.limit ?? 3,
  });
  if (error !== null) throw toVenueOfferError(error);
  return arr(data).map((x) => {
    const r = obj(x);
    return {
      windowId: str(r.windowId),
      localDate: str(r.localDate),
      startsAt: str(r.startsAt),
      endsAt: str(r.endsAt),
      sessionLabel: strOrNull(r.sessionLabel),
    };
  });
}

/** A refusal from `venue-offer-staff`, with the capacity detail when sent. */
export class VenueStaffError extends VenueOfferError {
  readonly capacity: { localDate: string | null; poolName: string | null; sold: number; limitAfterHire: number } | null;
  constructor(code: string, capacity: VenueStaffError["capacity"] = null) {
    super(code);
    this.name = "VenueStaffError";
    this.capacity = capacity;
  }
}

async function staff(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("venue-offer-staff", { body });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context !== null && context !== undefined && typeof (context as Response).json === "function") {
      try {
        const parsed = obj(await (context as Response).json());
        if (typeof parsed.code === "string" && parsed.code.length > 0) {
          const detail = parsed.detail === undefined ? null : obj(parsed.detail);
          throw new VenueStaffError(
            parsed.code,
            detail === null
              ? null
              : {
                  localDate: strOrNull(detail.localDate),
                  poolName: strOrNull(detail.poolName),
                  sold: num(detail.sold),
                  limitAfterHire: num(detail.limitAfterHire),
                },
          );
        }
      } catch (caught) {
        if (caught instanceof VenueStaffError) throw caught;
        // An unreadable body falls through to the network/unknown mapping.
      }
    }
    const fallback = toVenueOfferError({ message: (error as { message?: string }).message ?? "staff_action_failed" });
    throw new VenueStaffError(fallback.code === "unknown" ? "staff_action_failed" : fallback.code);
  }
  const envelope = obj(data);
  if (envelope.kind !== "success") throw new VenueStaffError(str(envelope.code, "staff_action_failed"));
  return obj(envelope.data);
}

export async function staffRequestAction(input: {
  action: StaffRequestAction;
  groupId: string;
  expectedVersion: number;
  idempotencyKey: string;
  quoteEdit?: { baseMinor: number; note?: string } | null;
  note?: string | null;
  reason?: string | null;
  alternatives?: string[];
  hours?: 12 | 24 | 48;
}): Promise<StaffActionResult> {
  const body: Record<string, unknown> = {
    action: input.action,
    groupId: input.groupId,
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
  };
  if (input.action === "approve") {
    if (input.quoteEdit !== undefined && input.quoteEdit !== null) {
      body.quoteEdit = {
        baseMinor: input.quoteEdit.baseMinor,
        ...(input.quoteEdit.note !== undefined && input.quoteEdit.note.trim().length > 0 ? { note: input.quoteEdit.note.trim() } : {}),
      };
    }
    if (input.note !== undefined && input.note !== null && input.note.trim().length > 0) body.note = input.note.trim();
  }
  if (input.action === "decline") {
    body.reason = (input.reason ?? "").trim();
    body.alternatives = input.alternatives ?? [];
  }
  if (input.action === "extend_hold") body.hours = input.hours ?? 24;
  if (input.action === "release_hold" && input.reason !== undefined && input.reason !== null && input.reason.trim().length > 0) {
    body.reason = input.reason.trim();
  }
  const d = await staff(body);
  return {
    groupId: str(d.groupId, input.groupId),
    state: str(d.state),
    holdUntil: strOrNull(d.holdUntil),
    depositMinor: numOrNull(d.depositMinor),
    totalDueMinor: numOrNull(d.totalDueMinor),
    position: numOrNull(d.position),
    blockedByReference: strOrNull(d.blockedByReference),
    replayed: d.replayed === true,
  };
}

export async function blockVenueSpace(input: {
  venueId: string;
  from: string;
  to: string;
  reason: string | null;
  spaceIds?: string[];
  combinationId?: string;
  idempotencyKey: string;
}): Promise<{ claimIds: string[] }> {
  const d = await staff({
    action: "block",
    venueId: input.venueId,
    idempotencyKey: input.idempotencyKey,
    from: input.from,
    to: input.to,
    ...(input.reason !== null && input.reason.trim().length > 0 ? { reason: input.reason.trim() } : {}),
    ...(input.combinationId !== undefined ? { combinationId: input.combinationId } : { spaceIds: input.spaceIds ?? [] }),
  });
  return { claimIds: arr(d.claimIds).filter((x): x is string => typeof x === "string") };
}

export async function unblockVenueSpace(input: { venueId: string; claimId: string; idempotencyKey: string }): Promise<void> {
  await staff({ action: "unblock", venueId: input.venueId, claimId: input.claimId, idempotencyKey: input.idempotencyKey });
}

export function mapHireBookingFacts(v: unknown): HireBookingFacts | null {
  if (v === null || v === undefined) return null;
  const h = obj(v);
  const charge = str(h.hireCharge);
  return {
    placeName: strOrNull(h.placeName),
    layout: isVenueLayout(h.layout) ? h.layout : null,
    layoutCapacity: numOrNull(h.layoutCapacity),
    spaceIds: arr(h.spaceIds).filter((x): x is string => typeof x === "string"),
    combinationId: strOrNull(h.combinationId),
    sessionLabel: strOrNull(h.sessionLabel),
    bookedFrom: strOrNull(h.bookedFrom),
    bookedTo: strOrNull(h.bookedTo),
    setupFrom: strOrNull(h.setupFrom),
    cleanupUntil: strOrNull(h.cleanupUntil),
    guests: num(h.guests),
    hireMinor: num(h.hireMinor),
    extraGuests: num(h.extraGuests),
    extraGuestMinor: num(h.extraGuestMinor),
    overtimeHours: num(h.overtimeHours),
    overtimeMinor: num(h.overtimeMinor),
    hireCharge: charge === "hire_fee" || charge === "min_spend" || charge === "per_guest" ? charge : null,
    minSpendMinor: num(h.minSpendMinor),
    damageDepositMinor: num(h.damageDepositMinor),
    occasion: strOrNull(h.occasion),
    note: strOrNull(h.note),
    siteVisit: h.siteVisit === true,
    replyWithinHours: numOrNull(h.replyWithinHours),
    declineReason: strOrNull(h.declineReason),
    alternatives: arr(h.alternatives).filter((x): x is string => typeof x === "string"),
    hostNote: strOrNull(h.hostNote),
    closedReason: strOrNull(h.closedReason),
    damageDeposit: mapDamageDeposit(h.damageDeposit),
  };
}

const DEPOSIT_STATUSES: readonly DamageDepositStatus[] = ["none", "due", "collected", "held_by_venue", "released"];

export function mapDamageDeposit(v: unknown): DamageDepositState | null {
  if (v === null || v === undefined || typeof v !== "object") return null;
  const d = obj(v);
  const status = str(d.status) as DamageDepositStatus;
  if (!DEPOSIT_STATUSES.includes(status) || status === "none") return null;
  return {
    amountMinor: num(d.amountMinor),
    paidMinor: num(d.paidMinor),
    status,
    hireEndsAt: strOrNull(d.hireEndsAt),
    releaseAt: strOrNull(d.releaseAt),
    heldReason: strOrNull(d.heldReason),
    refundedMinor: numOrNull(d.refundedMinor),
    keptMinor: numOrNull(d.keptMinor),
    keptReason: strOrNull(d.keptReason),
    releasedAt: strOrNull(d.releasedAt),
  };
}

/** #4490 P4 follow-up — return the damage deposit after the hire (keep part of it with a reason). Money rights only. */
export async function releaseDamageDeposit(input: { groupId: string; keepMinor: number; reason: string | null; idempotencyKey: string }): Promise<DamageDepositState | null> {
  const { data, error } = await supabase.rpc("issue_4490_release_damage_deposit", {
    p_group_id: input.groupId,
    p_keep_minor: input.keepMinor,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error !== null) throw toVenueOfferError(error);
  return mapDamageDeposit(data);
}

/** #4490 P4 follow-up — keep holding the damage deposit (something to sort out); it then doesn't go back by itself. */
export async function holdDamageDeposit(input: { groupId: string; reason: string; idempotencyKey: string }): Promise<DamageDepositState | null> {
  const { data, error } = await supabase.rpc("issue_4490_hold_damage_deposit", {
    p_group_id: input.groupId,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error !== null) throw toVenueOfferError(error);
  return mapDamageDeposit(data);
}

export function mapBookingSettings(v: unknown): VenueBookingSettings | null {
  if (v === null || v === undefined) return null;
  const s = obj(v);
  const vat = str(s.vatMode, "added");
  return {
    timezone: str(s.timezone, "Africa/Lagos"),
    vatMode: vat === "included" || vat === "none" ? vat : "added",
    vatRateBps: numOrNull(s.vatRateBps),
    instantPaymentHoldMinutes: num(s.instantPaymentHoldMinutes, 15),
    bookingHorizonDays: num(s.bookingHorizonDays, 365),
    bookingState: str(s.bookingState) === "paused" ? "paused" : "active",
    version: num(s.version, 1),
  };
}

export function mapOffersState(v: unknown): VenueOffersState {
  const s = obj(v);
  const flags = obj(s.flags);
  return {
    venueId: str(s.venueId),
    canCollectOnline: s.canCollectOnline !== false,
    flags: { reads: flags.reads === true, writes: flags.writes === true },
    settings: mapBookingSettings(s.settings),
    pools: arr(s.pools).map(mapPool).filter((p) => !p.archived),
    offers: arr(s.offers).map(mapOffer),
  };
}

// ---------------------------------------------------------------------------
// Offers (host)
// ---------------------------------------------------------------------------

export async function fetchVenueOffers(venueId: string): Promise<VenueOffersState> {
  const { data, error } = await supabase.rpc("issue_4490_list_offers", { p_venue_id: venueId });
  if (error !== null) throw toVenueOfferError(error);
  return mapOffersState(data);
}

export type ManageOfferAction =
  | "create_draft"
  | "update"
  | "set_pool"
  | "upsert_price_option"
  | "archive_price_option"
  | "set_policy"
  | "set_schedule"
  | "publish"
  | "pause"
  | "archive";

export interface ManageOfferInput {
  venueId: string;
  action: ManageOfferAction;
  payload: Record<string, unknown>;
  /** The offer's version (omit for create_draft). */
  expectedVersion?: number | null;
}

export async function manageVenueOffer(input: ManageOfferInput): Promise<VenueOffer> {
  const { data, error } = await supabase.rpc("issue_4490_manage_offer", {
    p_action: input.action,
    p_venue_id: input.venueId,
    p_payload: input.payload,
    p_expected_version: input.expectedVersion ?? null,
    p_idempotency_key: `offer-${input.action}-${randomId()}`,
  });
  if (error !== null) throw toVenueOfferError(error);
  return mapOffer(data);
}

/**
 * #4490 fix 2 (N5) — copy an offer of the venue as a new draft ("<name>
 * (copy)") with its prices, rules, schedule, extras and spaces. The server
 * copies; nothing is retyped and nothing sold is copied.
 */
export async function duplicateVenueOffer(venueId: string, offerId: string): Promise<VenueOffer> {
  const { data, error } = await supabase.rpc("issue_4490_duplicate_offer", {
    p_venue_id: venueId,
    p_offer_id: offerId,
    p_idempotency_key: `offer-duplicate-${randomId()}`,
  });
  if (error !== null) throw toVenueOfferError(error);
  return mapOffer(data);
}

export interface PoolInput {
  venueId: string;
  action: "create" | "update" | "archive";
  poolId?: string;
  name?: string;
  dailyLimit?: number;
  keptForWalkIns?: number;
  expectedVersion?: number | null;
}

export async function manageCapacityPool(input: PoolInput): Promise<VenueCapacityPool> {
  const payload: Record<string, unknown> = {};
  if (input.poolId !== undefined) payload.poolId = input.poolId;
  if (input.name !== undefined) payload.name = input.name;
  if (input.dailyLimit !== undefined) payload.dailyLimit = input.dailyLimit;
  if (input.keptForWalkIns !== undefined) payload.keptForWalkIns = input.keptForWalkIns;
  const { data, error } = await supabase.rpc("issue_4490_manage_capacity_pool", {
    p_action: input.action,
    p_venue_id: input.venueId,
    p_payload: payload,
    p_expected_version: input.expectedVersion ?? null,
    p_idempotency_key: `pool-${input.action}-${randomId()}`,
  });
  if (error !== null) throw toVenueOfferError(error);
  return mapPool(data);
}

export async function saveBookingSettings(input: {
  venueId: string;
  settings: Pick<
    VenueBookingSettings,
    "vatMode" | "instantPaymentHoldMinutes" | "bookingHorizonDays" | "bookingState"
  >;
  expectedVersion: number | null;
}): Promise<VenueBookingSettings | null> {
  const { data, error } = await supabase.rpc("issue_4490_save_booking_settings", {
    p_venue_id: input.venueId,
    p_payload: input.settings,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: `booking-settings-${randomId()}`,
  });
  if (error !== null) throw toVenueOfferError(error);
  return mapBookingSettings(data);
}

// ---------------------------------------------------------------------------
// Day limits
// ---------------------------------------------------------------------------

/** Day limits from today on (RLS: venue viewers may read them). */
export async function fetchCapacityOverrides(venueId: string, fromDate: string): Promise<CapacityOverride[]> {
  const { data, error } = await supabase
    .from("venue_capacity_overrides")
    .select("pool_id, local_date, daily_limit, kept_for_walk_ins, closed, version")
    .eq("venue_id", venueId)
    .gte("local_date", fromDate)
    .order("local_date", { ascending: true })
    .limit(200);
  if (error !== null) throw toVenueOfferError(error);
  return arr(data).map((row) => {
    const r = obj(row);
    return {
      poolId: str(r.pool_id),
      localDate: str(r.local_date),
      dailyLimit: numOrNull(r.daily_limit),
      keptForWalkIns: numOrNull(r.kept_for_walk_ins),
      closed: r.closed === true,
      version: num(r.version, 1),
    };
  });
}

export async function setCapacityOverride(input: {
  venueId: string;
  poolId: string;
  localDate: string;
  dailyLimit: number | null;
  keptForWalkIns: number | null;
  closed: boolean;
  clear: boolean;
}): Promise<void> {
  const { error } = await supabase.rpc("issue_4490_set_capacity_override", {
    p_venue_id: input.venueId,
    p_pool_id: input.poolId,
    p_local_date: input.localDate,
    p_daily_limit: input.dailyLimit,
    p_kept_for_walk_ins: input.keptForWalkIns,
    p_closed: input.closed,
    p_clear: input.clear,
    p_idempotency_key: `override-${randomId()}`,
  });
  if (error !== null) throw toVenueOfferError(error);
}

// ---------------------------------------------------------------------------
// The venue's day (Today, Overview, Hub card)
// ---------------------------------------------------------------------------

function mapGuestListPromoter(v: unknown): VenueGuestListPromoter {
  const p = obj(v);
  return {
    id: str(p.id),
    name: str(p.name),
    phone: strOrNull(p.phone),
    email: strOrNull(p.email),
    namesPerNight: numOrNull(p.namesPerNight),
    active: p.active !== false,
    version: num(p.version),
    names: num(p.names),
    in: num(p.in),
  };
}

export function mapGuestListDay(v: unknown): VenueGuestListDay {
  const d = obj(v);
  const counts = obj(d.counts);
  return {
    venueId: str(d.venueId),
    localDate: str(d.localDate),
    terms: mapGuestListTerms(d.terms),
    entries: arr(d.entries).map(mapGuestListEntry),
    promoters: arr(d.promoters).map(mapGuestListPromoter),
    counts: { names: num(counts.names), in: num(counts.in) },
  };
}

export async function fetchGuestListDay(venueId: string, localDate: string | null): Promise<VenueGuestListDay> {
  const { data, error } = await supabase.rpc("issue_4490_guest_list_day", {
    p_venue_id: venueId,
    p_local_date: localDate,
  });
  if (error !== null) throw toVenueOfferError(error);
  return mapGuestListDay(data);
}

export type ManageGuestListAction =
  | "set_terms"
  | "add_entry"
  | "edit_entry"
  | "remove_entry"
  | "add_promoter"
  | "edit_promoter"
  | "new_promoter_link"
  | "pause_promoter";

export async function manageGuestList(input: {
  venueId: string;
  action: ManageGuestListAction;
  payload: Record<string, unknown>;
  expectedVersion?: number | null;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("issue_4490_manage_guest_list", {
    p_action: input.action,
    p_venue_id: input.venueId,
    p_payload: input.payload,
    p_expected_version: input.expectedVersion ?? null,
    p_idempotency_key: `guest-list-${input.action}-${randomId()}`,
  });
  if (error !== null) throw toVenueOfferError(error);
  return obj(data);
}

// ---------------------------------------------------------------------------
// Check-in door (edge function `venue-check-in`, staff JWT)
// ---------------------------------------------------------------------------

async function checkIn<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("venue-check-in", { body });
  if (error) throw await edgeError(error as { message?: string; context?: unknown });
  const envelope = obj(data);
  if (envelope.kind !== "success") {
    throw new VenueOfferError(str(envelope.code, "check_in_failed"));
  }
  return envelope.data as T;
}

export function mapPass(v: unknown): CheckInPass {
  const p = obj(v);
  return {
    passId: str(p.passId),
    groupId: strOrNull(p.groupId),
    reference: strOrNull(p.reference),
    holderName: str(p.holderName, "Guest"),
    offerName: str(p.offerName),
    offerKind: strOrNull(p.offerKind),
    admits: num(p.admits, 1),
    admittedCount: num(p.admittedCount),
    remaining: num(p.remaining, Math.max(0, num(p.admits, 1) - num(p.admittedCount))),
    validLocalDate: strOrNull(p.validLocalDate),
    dayLabel: strOrNull(p.dayLabel),
    idCheckLabel: strOrNull(p.idCheckLabel),
    idCheckCount: num(p.idCheckCount),
    status: str(p.status, "valid"),
    source: strOrNull(p.source),
    time: strOrNull(p.time),
    lastAdmittedAt: strOrNull(p.lastAdmittedAt),
    daysAllowed: Math.max(1, num(p.daysAllowed, 1)),
    daysUsed: Math.max(0, num(p.daysUsed)),
    dayNumber: Math.max(1, num(p.dayNumber, 1)),
    allDaysUsed: p.allDaysUsed === true,
    validUntilLocalDate: strOrNull(p.validUntilLocalDate),
    // Gate sales are paid at the door (see mapVenueDay): nothing to take again.
    balanceDueMinor: str(p.source) === "gate" || str(p.source) === "gate_sale" ? 0 : num(p.balanceDueMinor),
    totalDueMinor: num(p.totalDueMinor),
    currencyCode: strOrNull(p.currencyCode),
    canTakePayment: p.canTakePayment === true,
  };
}

export async function fetchCheckInList(venueId: string, localDate: string | null): Promise<CheckInList> {
  const data = obj(await checkIn<unknown>({ action: "list", venueId, localDate: localDate ?? undefined }));
  const totals = obj(data.totals);
  return {
    localDate: str(data.localDate),
    timezone: str(data.timezone, "Africa/Lagos"),
    passes: arr(data.passes).map(mapPass),
    tickets: arr(data.tickets).map((t): CheckInTicket => {
      const r = obj(t);
      return {
        ticketId: str(r.ticketId),
        eventTitle: str(r.eventTitle),
        holderName: str(r.holderName, "Guest"),
        ticketName: str(r.ticketName),
        admits: num(r.admits, 1),
        admittedCount: num(r.admittedCount),
        status: str(r.status),
        time: strOrNull(r.time),
      };
    }),
    totals: { passes: num(totals.passes), admits: num(totals.admits), admitted: num(totals.admitted) },
    members: arr(data.members).map((m): CheckInMember => {
      const r = obj(m);
      return {
        subscriptionId: str(r.subscriptionId),
        holderName: str(r.holderName, "Member"),
        planName: str(r.planName),
        planPeriod: r.planPeriod === "year" ? "year" : "month",
        status: str(r.status, "active"),
        paymentDue: r.paymentDue === true,
        guestPassesLeft: num(r.guestPassesLeft),
        inToday: r.inToday === true,
        guests: num(r.guests),
        logId: strOrNull(r.logId),
        checkedInAt: strOrNull(r.checkedInAt),
      };
    }),
    guestList: arr(data.guestList).map(mapGuestListEntry),
  };
}

const SCAN_RESULTS: readonly ScanResultCode[] = [
  "admitted",
  "already_used",
  "wrong_day",
  "not_yet",
  "void",
  "not_found",
  "wrong_venue",
  "id_required",
  "days_used",
  "day_full",
  "undone",
  "sell",
  "list_closed_for_price",
];

export function mapScanOutcome(v: unknown): ScanOutcome {
  const d = obj(v);
  const result = str(d.result) as ScanResultCode;
  const ticket = d.ticket === undefined ? null : obj(d.ticket);
  const member = d.member === undefined || d.member === null ? null : obj(d.member);
  const memberPlan = member === null ? {} : obj(member.plan);
  const memberCredits = member === null ? {} : obj(member.credits);
  return {
    result: SCAN_RESULTS.includes(result) ? result : "not_found",
    admitted: numOrNull(d.admitted ?? d.undid),
    logId: strOrNull(d.logId),
    balanceDueMinor: num(d.balanceDueMinor),
    kind: d.kind === "event_ticket" ? "event_ticket" : d.kind === "member" ? "member" : d.kind === "guest_list" ? "guest_list" : "pass",
    member:
      member === null
        ? null
        : {
            subscriptionId: str(member.subscriptionId),
            name: str(member.memberName ?? member.name, "Member"),
            planName: str(memberPlan.name ?? member.planName),
            planPeriod: memberPlan.interval === "year" || member.planPeriod === "year" ? "year" : "month",
            status: str(member.status),
            guestPassesLeft: num(memberCredits.guestPassesLeft),
            paymentDue: member.paymentDue !== null && member.paymentDue !== undefined && ["payment_due", "grace"].includes(str(member.status)),
          },
    paymentDue: d.paymentDue === true,
    pass: d.pass === undefined || d.pass === null ? null : mapPass(d.pass),
    ticketHolder: ticket === null ? null : strOrNull(ticket.holderName),
    ticketName: ticket === null ? null : strOrNull(ticket.ticketName),
    venueName: strOrNull(d.venueName),
    guestListEntry: d.entry === undefined || d.entry === null ? null : mapGuestListEntry(d.entry),
    guestListEntryId: strOrNull(d.guestListEntryId),
    priceOptionId: strOrNull(d.priceOptionId),
    offeringId: strOrNull(d.offeringId),
    count: num(d.count),
  };
}

export async function admitGuestList(input: {
  venueId: string;
  entryId: string;
  count?: number;
}): Promise<ScanOutcome> {
  return mapScanOutcome(await checkIn<unknown>({
    action: "admit_guest_list",
    venueId: input.venueId,
    entryId: input.entryId,
    count: input.count,
  }));
}

export async function scanPass(input: {
  venueId: string;
  qrPayload: string;
  idChecked?: boolean;
  /** #4490 P3 — how many of a group go in now (default: everyone left). */
  admitCount?: number;
}): Promise<ScanOutcome> {
  return mapScanOutcome(
    await checkIn<unknown>({
      action: "scan",
      venueId: input.venueId,
      qrPayload: input.qrPayload,
      idChecked: input.idChecked === true ? true : undefined,
      admitCount: input.admitCount,
    }),
  );
}

export async function admitPass(input: {
  venueId: string;
  passId: string;
  count?: number;
  idChecked?: boolean;
}): Promise<ScanOutcome> {
  return mapScanOutcome(
    await checkIn<unknown>({
      action: "admit",
      venueId: input.venueId,
      passId: input.passId,
      count: input.count,
      idChecked: input.idChecked === true ? true : undefined,
    }),
  );
}

/** A member's six-character fallback code, scoped by the server to this venue. */
export async function admitMemberCode(input: {
  venueId: string;
  memberCode: string;
  guests?: number;
}): Promise<ScanOutcome> {
  return mapScanOutcome(
    await checkIn<unknown>({
      action: "admit_code",
      venueId: input.venueId,
      memberCode: input.memberCode,
      guests: input.guests ?? 0,
    }),
  );
}

export async function undoCheckIn(input: { venueId: string; logId: string }): Promise<ScanOutcome> {
  return mapScanOutcome(await checkIn<unknown>({ action: "undo", venueId: input.venueId, logId: input.logId }));
}

// [TRANSITIONAL] #4490 spec 08 §13: venue-check-in `sell` / `sell_guest_list`
// for the gate sale sheet while the Till is off; exits when every venue is on the Till.
export async function sellAtGate(input: {
  venueId: string;
  offeringId: string;
  lines: GateSaleLine[];
  method: GateMethod;
  buyer?: { name?: string; email?: string; phone?: string };
  idempotencyKey: string;
}): Promise<GateSaleResult> {
  const data = obj(
    await checkIn<unknown>({
      action: "sell",
      venueId: input.venueId,
      offeringId: input.offeringId,
      lines: input.lines,
      method: input.method,
      buyer: input.buyer,
      idempotencyKey: input.idempotencyKey,
    }),
  );
  const booking = obj(data.booking);
  return {
    method: input.method,
    passId: strOrNull(data.passId),
    totalMinor: num(booking.totalMinor),
    currencyCode: strOrNull(booking.currencyCode),
    reference: strOrNull(booking.reference),
    payUrl: strOrNull(data.payUrl),
  };
}

export async function sellGuestListAtGate(input: {
  venueId: string;
  entryId: string;
  count: number;
  method: GateMethod;
  buyer?: { name?: string; email?: string; phone?: string };
  idempotencyKey: string;
}): Promise<GateSaleResult> {
  const data = obj(await checkIn<unknown>({
    action: "sell_guest_list",
    venueId: input.venueId,
    entryId: input.entryId,
    count: input.count,
    method: input.method,
    buyer: input.buyer,
    idempotencyKey: input.idempotencyKey,
  }));
  const booking = obj(data.booking);
  return {
    method: input.method,
    passId: strOrNull(data.passId),
    totalMinor: num(booking.totalMinor),
    currencyCode: strOrNull(booking.currencyCode),
    reference: strOrNull(booking.reference),
    payUrl: strOrNull(data.payUrl),
  };
}

/** Rebuild the payload a refund ladder / date rule is saved with. */
export function policyPayload(ladder: RefundRung[], change: DateChangeRule | null): Record<string, unknown> {
  return {
    refundLadder: ladder.map((r) => ({ minMinutesBefore: r.minMinutesBefore, refundBps: r.refundBps })),
    dateChangeRule:
      change === null
        ? {}
        : {
            ...(change.allowedUntilMinutesBefore !== null
              ? { allowedUntilMinutesBefore: change.allowedUntilMinutesBefore }
              : {}),
            ...(change.feeBps !== null ? { feeBps: change.feeBps } : {}),
            ...(change.maxChanges !== null ? { maxChanges: change.maxChanges } : {}),
          },
  };
}

// ---------------------------------------------------------------------------
// #4490 P3 — group packages (host editor)
// ---------------------------------------------------------------------------

export type ManagePackageAction = "set_package" | "set_payment" | "set_start_times" | "set_change_rules";

export async function manageVenuePackage(input: {
  venueId: string;
  action: ManagePackageAction;
  payload: Record<string, unknown>;
  expectedVersion: number;
}): Promise<VenueOffer> {
  const { data, error } = await supabase.rpc("issue_4490_manage_package", {
    p_action: input.action,
    p_venue_id: input.venueId,
    p_payload: input.payload,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: `package-${input.action}-${randomId()}`,
  });
  if (error !== null) throw toVenueOfferError(error);
  return mapOffer(data);
}

// ---------------------------------------------------------------------------
// #4490 P3 — one booking with its money (host)
// ---------------------------------------------------------------------------

export function mapVenueBooking(v: unknown): VenueBookingDetail {
  const b = obj(v);
  const offer = obj(b.offer);
  const guest = obj(b.guest);
  const win = b.window === null || b.window === undefined ? null : obj(b.window);
  const rules = b.changeRules === null || b.changeRules === undefined ? null : obj(b.changeRules);
  const passes = arr(b.passes).map(obj);
  const answers: Record<string, string> = {};
  for (const [k, val] of Object.entries(obj(b.answers))) {
    if (typeof val === "string") answers[k] = val;
  }
  const vat = str(b.vatMode);
  return {
    groupId: str(b.groupId),
    reference: str(b.reference),
    state: str(b.state),
    version: num(b.version, 1),
    offerKind: b.offerKind === undefined || b.offerKind === null ? null : mapKind(b.offerKind),
    offer: { id: strOrNull(offer.id), name: str(offer.name) },
    guest: { name: str(guest.name, "Guest"), email: strOrNull(guest.email), phone: strOrNull(guest.phone) },
    window:
      win === null
        ? null
        : {
            windowId: strOrNull(win.windowId),
            localDate: str(win.localDate),
            startsAt: strOrNull(win.startsAt),
            endsAt: strOrNull(win.endsAt),
          },
    lines: arr(b.lines).map((l) => {
      const r = obj(l);
      return {
        lineId: str(r.lineId),
        priceOptionId: strOrNull(r.priceOptionId),
        name: str(r.name),
        guests: num(r.guests),
        bookedGuests: num(r.bookedGuests, num(r.guests)),
        unit: strOrNull(r.unit),
        state: str(r.state),
      };
    }),
    currencyCode: str(b.currencyCode, "NGN"),
    totalMinor: num(b.totalMinor),
    totalDueMinor: num(b.totalDueMinor, num(b.totalMinor)),
    paidMinor: num(b.paidMinor),
    paidOnlineMinor: num(b.paidOnlineMinor, num(b.paidMinor)),
    paidAtVenueMinor: num(b.paidAtVenueMinor),
    refundedMinor: num(b.refundedMinor),
    // Gate sales are paid at the door (see mapVenueDay): nothing still to pay.
    balanceDueMinor: str(b.paymentCollection) === "property" ? 0 : num(b.balanceDueMinor),
    balanceDueAt: strOrNull(b.balanceDueAt),
    depositMinor: numOrNull(b.depositMinor),
    taxMinor: num(b.taxMinor),
    vatMode: vat === "added" || vat === "included" || vat === "none" ? vat : null,
    paymentCollection: strOrNull(b.paymentCollection),
    bookingSource: strOrNull(b.bookingSource),
    extras: arr(b.extras).map((x) => {
      const e = obj(x);
      return {
        id: str(e.id),
        name: str(e.name),
        per: str(e.per) === "guest" ? ("guest" as const) : ("booking" as const),
        qty: num(e.qty, 1),
        amountMinor: num(e.amountMinor),
        addedAt: strOrNull(e.addedAt),
      };
    }),
    answers,
    inclusions: arr(b.inclusions).map((x) => {
      const i = obj(x);
      return { kind: str(i.kind, "item"), label: str(i.label), staffRatio: numOrNull(i.staffRatio) };
    }),
    changes: arr(b.changes).map((x) => {
      const c = obj(x);
      return {
        changeId: str(c.changeId),
        kind: str(c.kind),
        fromGuests: numOrNull(c.fromGuests),
        toGuests: numOrNull(c.toGuests),
        fromDate: strOrNull(c.fromDate),
        toDate: strOrNull(c.toDate),
        extras: arr(c.extras).map((e) => ({ name: str(obj(e).name), qty: num(obj(e).qty, 1) })),
        amountMinor: num(c.amountMinor),
        feeMinor: num(c.feeMinor),
        refundMinor: num(c.refundMinor),
        by: strOrNull(c.by),
        createdAt: strOrNull(c.createdAt),
      };
    }),
    changeRules:
      rules === null
        ? null
        : {
            moveUntil: strOrNull(rules.moveUntil),
            guestChangeUntil: strOrNull(rules.guestChangeUntil),
            maxChanges: numOrNull(rules.maxChanges),
            changesUsed: num(rules.changesUsed),
            feeBps: num(rules.feeBps),
            canMove: rules.canMove === true,
            canChangeGuests: rules.canChangeGuests === true,
            canAddExtras: rules.canAddExtras === true,
          },
    payments: arr(b.payments).map((x) => {
      const p = obj(x);
      return { attemptId: str(p.attemptId), stage: str(p.stage), state: str(p.state), amountMinor: num(p.amountMinor), at: strOrNull(p.at) };
    }),
    paidAtVenue: arr(b.paidAtVenue).map((x) => {
      const p = obj(x);
      return {
        paymentId: str(p.paymentId),
        amountMinor: num(p.amountMinor),
        method: str(p.method),
        paidOn: strOrNull(p.paidOn),
        note: strOrNull(p.note),
        at: strOrNull(p.at),
      };
    }),
    history: arr(b.history).map((x) => {
      const h = obj(x);
      return { type: str(h.type), by: strOrNull(h.by), at: strOrNull(h.at) };
    }),
    canManageMoney: b.canManageMoney === true,
    canChange: b.canChange === true,
    admittedCount: passes.reduce((n, p) => n + num(p.admittedCount), 0),
    admits: passes.reduce((n, p) => n + num(p.admits), 0),
    createdAt: strOrNull(b.createdAt),
    timezone: str(obj(b.venue).timezone, "Africa/Lagos"),
    brandSlug: strOrNull(obj(b.venue).brandSlug),
    venueSlug: strOrNull(obj(b.venue).slug),
    hire: mapHireBookingFacts(b.hire),
    requestDeadline: strOrNull(b.requestDeadline),
    paymentDeadline: strOrNull(b.paymentDeadline),
    // The saved terms say "30 day(s)"; read them as plain words.
    policyText: (() => {
      const t = strOrNull(obj(b.policy).text);
      return t === null ? null : t.replace(/\b(\d+) day\(s\)/g, (_m, n: string) => (n === "1" ? "1 day" : `${n} days`));
    })(),
  };
}

export async function fetchVenueBooking(groupId: string): Promise<VenueBookingDetail> {
  const { data, error } = await supabase.rpc("issue_4490_get_booking", { p_group_id: groupId });
  if (error !== null) throw toVenueOfferError(error);
  return mapVenueBooking(data);
}

export function mapChangeSummary(v: unknown): BookingChangeSummary {
  const c = obj(v);
  return {
    action: str(c.action),
    fromGuests: numOrNull(c.fromGuests),
    toGuests: numOrNull(c.toGuests),
    fromDate: strOrNull(c.fromDate),
    toDate: strOrNull(c.toDate),
    toStartsAt: strOrNull(c.toStartsAt),
    priceDeltaMinor: num(c.priceDeltaMinor),
    taxDeltaMinor: num(c.taxDeltaMinor),
    feeMinor: num(c.feeMinor),
    amountMinor: num(c.amountMinor),
    totalDueBeforeMinor: num(c.totalDueBeforeMinor),
    totalDueAfterMinor: num(c.totalDueAfterMinor),
    paidMinor: num(c.paidMinor),
    refundMinor: num(c.refundMinor),
    balanceAfterMinor: num(c.balanceAfterMinor),
    currencyCode: str(c.currencyCode, "NGN"),
    groupVersion: numOrNull(c.groupVersion),
    replayed: c.replayed === true,
  };
}

export async function changeVenueBooking(input: {
  groupId: string;
  action: BookingChangeAction;
  payload: Record<string, unknown>;
  preview: boolean;
  expectedVersion?: number | null;
}): Promise<BookingChangeSummary> {
  const { data, error } = await supabase.rpc("issue_4490_change_booking", {
    p_group_id: input.groupId,
    p_action: input.action,
    p_payload: input.payload,
    p_preview: input.preview,
    p_expected_version: input.preview ? null : (input.expectedVersion ?? null),
    p_idempotency_key: input.preview ? null : `booking-change-${randomId()}`,
  });
  if (error !== null) throw toVenueOfferError(error);
  return mapChangeSummary(data);
}

export async function recordOfflinePayment(input: {
  groupId: string;
  amountMinor: number;
  method: OfflineMethod;
  paidOn: string | null;
  note: string | null;
}): Promise<{ balanceMinor: number }> {
  const { data, error } = await supabase.rpc("issue_4490_record_offline_payment", {
    p_group_id: input.groupId,
    p_amount_minor: input.amountMinor,
    p_method: input.method,
    p_paid_on: input.paidOn,
    p_note: input.note,
    p_idempotency_key: `offline-payment-${randomId()}`,
  });
  if (error !== null) throw toVenueOfferError(error);
  return { balanceMinor: num(obj(data).balanceMinor) };
}

export async function sendBookingReminder(groupId: string): Promise<{ sent: boolean; balanceMinor: number }> {
  const { data, error } = await supabase.rpc("issue_4490_send_booking_reminder", {
    p_group_id: groupId,
    p_idempotency_key: `booking-reminder-${randomId()}`,
  });
  if (error !== null) throw toVenueOfferError(error);
  const d = obj(data);
  return { sent: d.sent !== false, balanceMinor: num(d.balanceMinor) };
}

export async function fetchDayClosurePreview(venueId: string, localDate: string): Promise<DayClosurePreview> {
  const { data, error } = await supabase.rpc("issue_4490_preview_day_closure", {
    p_venue_id: venueId,
    p_local_date: localDate,
  });
  if (error !== null) throw toVenueOfferError(error);
  const d = obj(data);
  return {
    localDate: str(d.localDate, localDate),
    count: num(d.count),
    guests: num(d.guests),
    paidMinor: num(d.paidMinor),
    bookings: arr(d.bookings).map((x) => {
      const r = obj(x);
      return {
        groupId: str(r.groupId),
        reference: str(r.reference),
        state: str(r.state),
        guestName: str(r.guestName, "Guest"),
        guests: num(r.guests),
        offerName: str(r.offerName),
        paidMinor: num(r.paidMinor),
      };
    }),
  };
}

function mapStaffCancelPreview(v: unknown): StaffCancelPreview {
  const d = obj(v);
  return {
    previewIds: arr(d.previewIds).filter((x): x is string => typeof x === "string"),
    previewHash: str(d.previewHash),
    paidMinor: num(d.paidMinor),
    refundMinor: num(d.refundMinor),
    keepMinor: num(d.keepMinor),
    currencyCode: str(d.currencyCode, "NGN"),
  };
}

export async function staffCancelPreview(groupId: string): Promise<StaffCancelPreview> {
  const { data, error } = await supabase.rpc("issue_4490_cancel_preview", { p_group_id: groupId });
  if (error !== null) throw toVenueOfferError(error);
  return mapStaffCancelPreview(data);
}

export async function staffCancelBooking(input: {
  preview: StaffCancelPreview;
  reason: string;
}): Promise<{ refundMinor: number }> {
  const { data, error } = await supabase.rpc("issue_4490_cancel", {
    p_preview_ids: input.preview.previewIds,
    p_preview_hash: input.preview.previewHash,
    p_idempotency_key: `staff-cancel-${randomId()}`,
    p_reason: input.reason,
  });
  if (error !== null) throw toVenueOfferError(error);
  return { refundMinor: num(obj(data).refundMinor) };
}

// Door money (edge `venue-check-in`).
export async function takeBalanceAtDoor(input: {
  venueId: string;
  groupId: string;
  amountMinor: number;
  method: OfflineMethod;
}): Promise<{ balanceMinor: number }> {
  const data = obj(
    await checkIn<unknown>({
      action: "take_balance",
      venueId: input.venueId,
      groupId: input.groupId,
      amountMinor: input.amountMinor,
      method: input.method,
      idempotencyKey: `door-balance-${randomId()}`,
    }),
  );
  return { balanceMinor: num(data.balanceMinor) };
}

export async function balancePayLink(input: { venueId: string; groupId: string }): Promise<{
  payUrl: string;
  balanceMinor: number;
  currencyCode: string | null;
}> {
  const data = obj(await checkIn<unknown>({ action: "balance_link", venueId: input.venueId, groupId: input.groupId }));
  return { payUrl: str(data.payUrl), balanceMinor: num(data.balanceMinor), currencyCode: strOrNull(data.currencyCode) };
}

