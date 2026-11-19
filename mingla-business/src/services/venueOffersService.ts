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

import { supabase } from "./supabase";
import { randomId } from "../utils/randomId";
import type {
  BusyRule,
  CapacityOverride,
  CheckInList,
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
  VenueDayBooking,
  VenueDayOffer,
  VenueDayPool,
  VenueOffer,
  VenueOfferKind,
  VenueOffersState,
  VenuePriceOption,
} from "../types/venueOffers";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** A server refusal with its token kept for mapping (never shown raw). */
export class VenueOfferError extends Error {
  readonly code: string;
  /** Text after "code:" (e.g. the first not-ready reason). */
  readonly detail: string | null;
  /** Every not-ready reason (from the error DETAIL), when the server sent them. */
  readonly reasons: string[];
  constructor(code: string, detail: string | null = null, reasons: string[] = []) {
    super(code);
    this.name = "VenueOfferError";
    this.code = code;
    this.detail = detail;
    this.reasons = reasons;
  }
}

export function toVenueOfferError(error: unknown): VenueOfferError {
  if (error instanceof VenueOfferError) return error;
  const obj = error !== null && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const raw = typeof obj.message === "string" ? obj.message : String(error ?? "");
  const idx = raw.indexOf(":");
  const code = (idx >= 0 ? raw.slice(0, idx) : raw).trim();
  const detail = idx >= 0 ? raw.slice(idx + 1).trim() : null;
  const details = typeof obj.details === "string" ? obj.details : "";
  const reasons =
    code === "offer_not_ready" && details.length > 0
      ? details.split(",").map((r) => r.trim()).filter((r) => r.length > 0)
      : detail !== null && code === "offer_not_ready"
        ? [detail]
        : [];
  // A network failure has no token: keep it distinct from a refusal.
  if (/failed to fetch|network/i.test(raw)) return new VenueOfferError("network", null);
  return new VenueOfferError(code.length > 0 ? code : "unknown", detail, reasons);
}

// ---------------------------------------------------------------------------
// Small readers (defensive: the JSON is the server's, not ours)
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown, fallback = 0): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return fallback;
};
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const weekdays = (v: unknown): number[] =>
  arr(v)
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);

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

function mapKind(v: unknown): VenueOfferKind {
  const k = str(v);
  return k === "group_package" || k === "private_hire" || k === "by_the_hour" ? k : "entry";
}

function mapStyle(v: unknown): EntryStyle | null {
  const s = str(v);
  return s === "walk_in" || s === "day_pass" || s === "timed_session" ? s : null;
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
  };
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

export function mapVenueDay(v: unknown): VenueDay {
  const d = obj(v);
  const check = obj(d.checkIn);
  return {
    localDate: str(d.localDate),
    timezone: str(d.timezone, "Africa/Lagos"),
    closed: d.closed === true,
    pools: arr(d.pools).map((p): VenueDayPool => {
      const r = obj(p);
      return {
        poolId: str(r.poolId),
        name: str(r.name),
        dailyLimit: num(r.dailyLimit),
        keptForWalkIns: num(r.keptForWalkIns),
        used: num(r.used),
        soldOnline: num(r.soldOnline),
        soldAtGate: num(r.soldAtGate),
        onlineLeft: num(r.onlineLeft),
        walkInLeft: num(r.walkInLeft),
        gateLeft: num(r.gateLeft),
        closed: r.closed === true,
        hasOverride: r.override !== null && r.override !== undefined,
      };
    }),
    offers: arr(d.offers).map((o): VenueDayOffer => {
      const r = obj(o);
      const status = str(r.status, "live");
      return {
        offerId: str(r.offerId),
        name: str(r.name),
        kind: mapKind(r.kind),
        entryStyle: mapStyle(r.entryStyle),
        status: status === "paused" ? "paused" : status === "draft" ? "draft" : status === "archived" ? "archived" : "live",
        poolId: strOrNull(r.poolId),
        sold: num(r.sold),
        held: num(r.held),
      };
    }),
    checkIn: { passes: num(check.passes), expected: num(check.expected), admitted: num(check.admitted) },
    bookings: arr(d.bookings).map((b): VenueDayBooking => {
      const r = obj(b);
      return {
        groupId: str(r.groupId),
        reference: str(r.reference),
        state: str(r.state),
        guestName: str(r.guestName, "Guest"),
        guests: num(r.guests),
        totalMinor: num(r.totalMinor),
        currencyCode: strOrNull(r.currencyCode),
        source: strOrNull(r.source),
        paymentCollection: strOrNull(r.paymentCollection),
        admittedCount: num(r.admittedCount),
        createdAt: str(r.createdAt),
      };
    }),
  };
}

export async function fetchVenueDay(venueId: string, localDate: string | null): Promise<VenueDay> {
  const { data, error } = await supabase.rpc("issue_4490_venue_day", {
    p_venue_id: venueId,
    p_local_date: localDate,
  });
  if (error !== null) throw toVenueOfferError(error);
  return mapVenueDay(data);
}

// ---------------------------------------------------------------------------
// Check-in door (edge function `venue-check-in`, staff JWT)
// ---------------------------------------------------------------------------

async function edgeError(error: { message?: string; context?: unknown }): Promise<VenueOfferError> {
  const context = error.context;
  if (context !== null && context !== undefined && typeof (context as Response).json === "function") {
    try {
      const body = obj(await (context as Response).json());
      if (typeof body.code === "string" && body.code.length > 0) {
        return new VenueOfferError(body.code, typeof body.remaining === "number" ? String(body.remaining) : null);
      }
    } catch {
      // An unreadable body falls through to the network/unknown mapping below.
    }
  }
  return toVenueOfferError({ message: error.message ?? "check_in_failed" });
}

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
  "undone",
];

export function mapScanOutcome(v: unknown): ScanOutcome {
  const d = obj(v);
  const result = str(d.result) as ScanResultCode;
  const ticket = d.ticket === undefined ? null : obj(d.ticket);
  return {
    result: SCAN_RESULTS.includes(result) ? result : "not_found",
    admitted: numOrNull(d.admitted ?? d.undid),
    logId: strOrNull(d.logId),
    balanceDueMinor: num(d.balanceDueMinor),
    kind: d.kind === "event_ticket" ? "event_ticket" : "pass",
    pass: d.pass === undefined || d.pass === null ? null : mapPass(d.pass),
    ticketHolder: ticket === null ? null : strOrNull(ticket.holderName),
    ticketName: ticket === null ? null : strOrNull(ticket.ticketName),
    venueName: strOrNull(d.venueName),
  };
}

export async function scanPass(input: {
  venueId: string;
  qrPayload: string;
  idChecked?: boolean;
}): Promise<ScanOutcome> {
  return mapScanOutcome(
    await checkIn<unknown>({
      action: "scan",
      venueId: input.venueId,
      qrPayload: input.qrPayload,
      idChecked: input.idChecked === true ? true : undefined,
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

export async function undoCheckIn(input: { venueId: string; logId: string }): Promise<ScanOutcome> {
  return mapScanOutcome(await checkIn<unknown>({ action: "undo", venueId: input.venueId, logId: input.logId }));
}

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
