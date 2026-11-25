/**
 * #4490 P6 — memberships on the Host: plans (`issue_4490_manage_membership_plan`,
 * `issue_4490_membership_plans`), the members list and one member
 * (`issue_4490_venue_members`, `issue_4490_venue_member`), and staff actions on
 * a member (`issue_4490_manage_member`). The door's member check-in goes
 * through the staff edge function `venue-check-in` (`admit_member`).
 *
 * The server checks who may act, versions and money. Errors keep their token
 * (`VenueOfferError`) for mapping to words (`membersModel.memberErrorCopy`);
 * a raw code never reaches a screen.
 */

import { supabase } from "./supabase";
import { randomId } from "../utils/randomId";
import { VenueOfferError, mapScanOutcome, toVenueOfferError } from "./venueOffersService";
import type { ScanOutcome } from "../types/venueOffers";
import type {
  ManageMemberAction,
  ManagePlanAction,
  MemberDiscountKind,
  MembershipJoinMode,
  MemberPaymentDue,
  MemberPeriod,
  MemberPeriodStatus,
  MemberStatus,
  MembersServerFilter,
  MembershipPlan,
  MembershipPlanPeriod,
  MembershipPlanStatus,
  MembershipPlansState,
  VenueMemberDetail,
  VenueMemberRow,
  VenueMembersList,
} from "../types/venueMembers";

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
const strings = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");

const MEMBER_STATUSES: readonly MemberStatus[] = ["pending", "active", "payment_due", "grace", "lapsed", "paused", "requested", "declined", "cancelled"];
const PLAN_STATUSES: readonly MembershipPlanStatus[] = ["draft", "live", "paused", "archived"];
const PLAN_PERIODS: readonly MembershipPlanPeriod[] = ["month", "year"];
const JOIN_MODES: readonly MembershipJoinMode[] = ["instant", "request"];
const DISCOUNT_KINDS: readonly MemberDiscountKind[] = ["entry", "group_package", "private_hire", "by_the_hour"];
const PERIOD_STATUSES: readonly MemberPeriodStatus[] = ["scheduled", "link_sent", "paid", "overdue", "void"];

export function mapMemberStatus(v: unknown): MemberStatus {
  const s = str(v) as MemberStatus;
  return MEMBER_STATUSES.includes(s) ? s : "pending";
}

export function mapMembershipPlan(v: unknown): MembershipPlan {
  const p = obj(v);
  const status = str(p.status) as MembershipPlanStatus;
  const period = str(p.interval) as MembershipPlanPeriod;
  const joinMode = str(p.joinMode) as MembershipJoinMode;
  return {
    id: str(p.id),
    venueId: str(p.venueId),
    name: str(p.name),
    summary: strOrNull(p.summary),
    inclusions: strings(p.inclusions),
    priceMinor: num(p.priceMinor),
    currencyCode: str(p.currencyCode, "NGN"),
    period: PLAN_PERIODS.includes(period) ? period : "month",
    joinMode: JOIN_MODES.includes(joinMode) ? joinMode : "instant",
    deskSpaceIds: strings(p.deskSpaceIds),
    deskSpaces: arr(p.deskSpaces)
      .map((space) => {
        const row = obj(space);
        return { id: str(row.id), name: str(row.name) };
      })
      .filter((space) => space.id.length > 0),
    entryIncluded: p.entryIncluded === true,
    entryOfferingId: strOrNull(p.entryOfferingId),
    entryOfferName: strOrNull(p.entryOfferName),
    roomHours: num(p.roomHours),
    hourOfferingIds: strings(p.hourOfferingIds),
    hourOfferNames: strings(p.hourOfferNames),
    guestPasses: num(p.guestPasses),
    discountBps: num(p.discountBps),
    discountKinds: strings(p.discountKinds).filter((k): k is MemberDiscountKind =>
      (DISCOUNT_KINDS as readonly string[]).includes(k),
    ),
    maxMembers: numOrNull(p.maxMembers),
    minMonths: num(p.minMonths, 1),
    noticeDays: num(p.noticeDays),
    graceDays: num(p.graceDays, 7),
    renewalNoticeDays: num(p.renewalNoticeDays, 7),
    status: PLAN_STATUSES.includes(status) ? status : "draft",
    sortOrder: num(p.sortOrder),
    version: num(p.version, 1),
    members: num(p.members),
    activeMembers: num(p.activeMembers),
    full: p.full === true,
    periodLocked: p.periodLocked === true,
  };
}

const idName = (v: unknown): { id: string; name: string } => {
  const o = obj(v);
  return { id: str(o.id), name: str(o.name) };
};

export function mapMembershipPlans(v: unknown): MembershipPlansState {
  const d = obj(v);
  return {
    venueId: str(d.venueId),
    featureOn: d.featureOn === true,
    canManage: d.canManage === true,
    entryOffers: arr(d.entryOffers).map(idName).filter((o) => o.id.length > 0),
    hourOffers: arr(d.hourOffers).map(idName).filter((o) => o.id.length > 0),
    spaces: arr(d.spaces).map(idName).filter((o) => o.id.length > 0),
    plans: arr(d.plans).map(mapMembershipPlan),
  };
}

export function mapMemberRow(v: unknown): VenueMemberRow {
  const m = obj(v);
  return {
    subscriptionId: str(m.subscriptionId),
    name: str(m.name, "Member"),
    email: strOrNull(m.email),
    phone: strOrNull(m.phone),
    planId: str(m.planId),
    planName: str(m.planName),
    planPeriod: PLAN_PERIODS.includes(str(m.planPeriod) as MembershipPlanPeriod)
      ? (str(m.planPeriod) as MembershipPlanPeriod)
      : "month",
    status: mapMemberStatus(m.status),
    activeUntil: strOrNull(m.activeUntil),
    renewsOn: strOrNull(m.renewsOn),
    leavingOn: strOrNull(m.leavingOn),
    pausingOn: strOrNull(m.pausingOn),
    roomHoursLeft: num(m.roomHoursLeft),
    guestPassesLeft: num(m.guestPassesLeft),
    inToday: m.inToday === true,
    amountDueMinor: numOrNull(m.amountDueMinor),
    assignedSpaceName: strOrNull(m.assignedSpaceName),
    version: num(m.version, 1),
    joinedAt: strOrNull(m.joinedAt),
  };
}

export function mapMembersList(v: unknown): VenueMembersList {
  const d = obj(v);
  const t = obj(d.tiles);
  const due = obj(t.paymentDue);
  return {
    venueId: str(d.venueId),
    localDate: str(d.localDate),
    tiles: {
      members: num(t.members),
      membersAllowed: numOrNull(t.membersAllowed),
      inToday: num(t.inToday),
      paymentDue: { count: num(due.count), amountMinor: num(due.amountMinor) },
      renewingThisWeek: num(t.renewingThisWeek),
    },
    members: arr(d.members).map(mapMemberRow),
  };
}

function mapPeriod(v: unknown): MemberPeriod {
  const p = obj(v);
  const status = str(p.status) as MemberPeriodStatus;
  const via = str(p.paidVia);
  return {
    periodId: str(p.periodId),
    sequence: num(p.sequence),
    start: str(p.start),
    end: str(p.end),
    amountMinor: num(p.amountMinor),
    currencyCode: str(p.currencyCode, "NGN"),
    dueAt: strOrNull(p.dueAt),
    status: PERIOD_STATUSES.includes(status) ? status : "scheduled",
    paidAt: strOrNull(p.paidAt),
    paidVia: via === "online" || via === "venue" ? via : null,
    paidMethod: strOrNull(p.paidMethod),
    remindersSent: strings(p.remindersSent),
  };
}

export function mapPaymentDue(v: unknown): MemberPaymentDue | null {
  if (v === null || v === undefined) return null;
  const p = obj(v);
  const status = str(p.status) as MemberPeriodStatus;
  return {
    periodId: str(p.periodId),
    amountMinor: num(p.amountMinor),
    currencyCode: str(p.currencyCode, "NGN"),
    periodStart: str(p.periodStart),
    periodEnd: str(p.periodEnd),
    dueAt: strOrNull(p.dueAt),
    status: PERIOD_STATUSES.includes(status) ? status : "scheduled",
    graceEndsAt: strOrNull(p.graceEndsAt),
    paying: p.paying === true,
  };
}

export function mapMemberDetail(v: unknown): VenueMemberDetail {
  const m = obj(v);
  const plan = obj(m.plan);
  const terms = obj(m.terms);
  const venue = obj(m.venue);
  const credits = obj(m.credits);
  const leaving = m.leaving === null || m.leaving === undefined ? null : obj(m.leaving);
  const pausing = m.pausing === null || m.pausing === undefined ? null : obj(m.pausing);
  const paused = m.paused === null || m.paused === undefined ? null : obj(m.paused);
  const reason = str(m.endReason);
  return {
    subscriptionId: str(m.subscriptionId),
    status: mapMemberStatus(m.status),
    memberCode: strOrNull(m.memberCode),
    memberName: str(m.memberName, "Member"),
    email: strOrNull(m.email),
    phone: strOrNull(m.phone),
    signedIn: m.signedIn === true,
    plan: {
      id: str(plan.id),
      name: str(plan.name),
      priceMinor: num(plan.priceMinor),
      currencyCode: str(plan.currencyCode, "NGN"),
      inclusions: strings(plan.inclusions),
      entryIncluded: plan.entryIncluded === true,
      roomHours: num(plan.roomHours),
      guestPasses: num(plan.guestPasses),
      discountBps: num(plan.discountBps),
      period: PLAN_PERIODS.includes(str(plan.interval) as MembershipPlanPeriod)
        ? (str(plan.interval) as MembershipPlanPeriod)
        : "month",
      joinMode: JOIN_MODES.includes(str(plan.joinMode) as MembershipJoinMode)
        ? (str(plan.joinMode) as MembershipJoinMode)
        : "instant",
      deskSpaces: arr(plan.deskSpaces)
        .map((space) => {
          const row = obj(space);
          return { id: str(row.id), name: str(row.name) };
        })
        .filter((space) => space.id.length > 0),
    },
    terms: {
      priceMinor: numOrNull(terms.priceMinor),
      minMonths: numOrNull(terms.minMonths),
      noticeDays: numOrNull(terms.noticeDays),
      graceDays: numOrNull(terms.graceDays),
    },
    venue: { id: str(venue.id), name: str(venue.name), timezone: str(venue.timezone, "Africa/Lagos") },
    startOn: strOrNull(m.startOn),
    startedAt: strOrNull(m.startedAt),
    activeUntil: strOrNull(m.activeUntil),
    renewsOn: strOrNull(m.renewsOn),
    renewalEmailOn: strOrNull(m.renewalEmailOn),
    canCheckIn: m.canCheckIn === true,
    assignedSpace:
      m.assignedSpace === null || m.assignedSpace === undefined
        ? null
        : { id: str(obj(m.assignedSpace).id), name: str(obj(m.assignedSpace).name) },
    deskBookedFrom: strOrNull(m.deskBookedFrom),
    paymentDue: mapPaymentDue(m.paymentDue),
    leaving: leaving === null ? null : { endsAt: str(leaving.endsAt), by: strOrNull(leaving.by) },
    pausing: pausing === null ? null : { from: str(pausing.from), by: strOrNull(pausing.by) },
    paused: paused === null ? null : { since: strOrNull(paused.since), by: strOrNull(paused.by) },
    endedAt: strOrNull(m.endedAt),
    endReason: reason === "left" || reason === "cancelled_by_venue" || reason === "not_paid" ? reason : null,
    credits: {
      roomHoursLeft: num(credits.roomHoursLeft),
      roomHoursPerMonth: num(credits.roomHoursPerMonth),
      guestPassesLeft: num(credits.guestPassesLeft),
      guestPassesPerMonth: num(credits.guestPassesPerMonth),
    },
    inToday: m.inToday === true,
    periods: arr(m.periods).map(mapPeriod),
    timeline: arr(m.timeline).map((e) => {
      const r = obj(e);
      const by = str(r.by);
      return {
        type: str(r.type),
        by: by === "member" || by === "staff" ? by : "system",
        at: str(r.at),
        periodId: strOrNull(r.periodId),
        detail: r.detail === null || r.detail === undefined ? null : obj(r.detail),
      };
    }),
    visits: arr(m.visits).map((x) => {
      const r = obj(x);
      return { localDate: str(r.localDate), guests: num(r.guests), at: str(r.at), undone: r.undone === true };
    }),
    canManage: m.canManage === true,
    canManageMoney: m.canManageMoney === true,
    version: num(m.version, 1),
    createdAt: strOrNull(m.createdAt),
  };
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export async function fetchMembershipPlans(venueId: string): Promise<MembershipPlansState> {
  const { data, error } = await supabase.rpc("issue_4490_membership_plans", { p_venue_id: venueId });
  if (error) throw toVenueOfferError(error);
  return mapMembershipPlans(data);
}

export async function manageMembershipPlan(input: {
  venueId: string;
  action: ManagePlanAction;
  payload: Record<string, unknown>;
  expectedVersion?: number | null;
}): Promise<MembershipPlan> {
  const { data, error } = await supabase.rpc("issue_4490_manage_membership_plan", {
    p_action: input.action,
    p_venue_id: input.venueId,
    p_payload: input.payload,
    p_expected_version: input.expectedVersion ?? null,
    p_idempotency_key: `venue-plan:${input.action}:${randomId()}`,
  });
  if (error) throw toVenueOfferError(error);
  return mapMembershipPlan(data);
}

export async function fetchVenueMembers(venueId: string, filter: MembersServerFilter): Promise<VenueMembersList> {
  const { data, error } = await supabase.rpc("issue_4490_venue_members", { p_venue_id: venueId, p_filter: filter });
  if (error) throw toVenueOfferError(error);
  return mapMembersList(data);
}

export async function fetchVenueMember(subscriptionId: string): Promise<VenueMemberDetail> {
  const { data, error } = await supabase.rpc("issue_4490_venue_member", { p_subscription_id: subscriptionId });
  if (error) throw toVenueOfferError(error);
  if (data === null || data === undefined) throw new VenueOfferError("membership_not_found");
  return mapMemberDetail(data);
}

export async function manageVenueMember(input: {
  subscriptionId: string;
  expectedVersion: number;
  change: ManageMemberAction;
}): Promise<VenueMemberDetail> {
  const { action, ...payload } = input.change;
  const { data, error } = await supabase.rpc("issue_4490_manage_member", {
    p_subscription_id: input.subscriptionId,
    p_action: action,
    p_payload: payload,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: `venue-member:${action}:${randomId()}`,
  });
  if (error) throw toVenueOfferError(error);
  return mapMemberDetail(data);
}

/** The door: check a member in from the list, with guests on their guest passes. */
export async function admitMember(input: { venueId: string; subscriptionId: string; guests: number }): Promise<ScanOutcome> {
  const { data, error } = await supabase.functions.invoke("venue-check-in", {
    body: { action: "admit_member", venueId: input.venueId, subscriptionId: input.subscriptionId, guests: input.guests },
  });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context !== null && context !== undefined && typeof (context as Response).json === "function") {
      try {
        const body = obj(await (context as Response).json());
        if (typeof body.code === "string" && body.code.length > 0) {
          throw new VenueOfferError(body.code, typeof body.left === "number" ? String(body.left) : null);
        }
      } catch (caught) {
        if (caught instanceof VenueOfferError) throw caught;
      }
    }
    throw toVenueOfferError({ message: (error as { message?: string }).message ?? "check_in_failed" });
  }
  const envelope = obj(data);
  if (envelope.kind !== "success") throw new VenueOfferError(str(envelope.code, "check_in_failed"));
  return mapScanOutcome(envelope.data);
}
