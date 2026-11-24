/**
 * #4490 — the venue's day (Today, Overview, the Hub venue card): one read and
 * its mapper, split from venueOffersService so the Hub card does not load the
 * whole Host offers service.
 */
import type { EntryStyle, VenueDay, VenueDayBooking, VenueDayMoney, VenueDayMoneyParts, VenueDayOffer, VenueDayPool, VenueOfferKind } from "../types/venueOffers";
import { supabase } from "./supabase";
import { arr, num, obj, str, strOrNull } from "./venueJsonRead";
import { toVenueOfferError } from "./venueOfferErrors";

export function mapKind(v: unknown): VenueOfferKind {
  const k = str(v);
  return k === "group_package" || k === "private_hire" || k === "by_the_hour" ? k : "entry";
}

export function mapStyle(v: unknown): EntryStyle | null {
  const s = str(v);
  return s === "walk_in" || s === "day_pass" || s === "timed_session" ? s : null;
}

export function mapVenueDay(v: unknown): VenueDay {
  const d = obj(v);
  const check = obj(d.checkIn);
  const guestList = obj(d.guestList);
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
    membersIn: num(d.membersIn),
    guestList: { names: num(guestList.names), in: num(guestList.in) },
    money: parseVenueDayMoney(d.money),
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
        offerKind: r.offerKind === undefined || r.offerKind === null ? null : mapKind(r.offerKind),
        offerName: strOrNull(r.offerName),
        startsAt: strOrNull(r.startsAt),
        // A gate sale paid by cash or transfer is settled at the door but carries no
        // payment row, so the server reports its whole total as owed: it owes nothing.
        balanceDueMinor: str(r.paymentCollection) === "property" ? 0 : num(r.balanceDueMinor),
        balanceDueAt: strOrNull(r.balanceDueAt),
      };
    }),
  };
}

/** #4490 07-E — the day's money as the server computed it; null when absent or malformed. */
export function parseVenueDayMoney(raw: unknown): VenueDayMoney | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const parts = (p: unknown): VenueDayMoneyParts | null => {
    if (p === null || typeof p !== "object") return null;
    const o = p as Record<string, unknown>;
    const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v ?? 0) || 0);
    return { online: n(o.online), atVenue: n(o.atVenue), members: n(o.members), tableDeposits: n(o.tableDeposits), refunded: n(o.refunded) };
  };
  const paidIn = parts(r.paidIn);
  const forToday = parts(r.forToday);
  const paidInMinor = Number(r.paidInMinor);
  const forTodayPaidMinor = Number(r.forTodayPaidMinor);
  if (paidIn === null || forToday === null || !Number.isFinite(paidInMinor) || !Number.isFinite(forTodayPaidMinor)) {
    return null;
  }
  return {
    currencyCode: typeof r.currencyCode === "string" && r.currencyCode.length > 0 ? r.currencyCode : null,
    otherCurrency: r.otherCurrency === true,
    paidInMinor,
    paidIn,
    forTodayPaidMinor,
    forToday,
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
